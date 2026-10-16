import { b64urlDecode, descramble, stringUnshuffle } from './crypto';
import { nativeFetch, nativeFetchBytes } from './fetch';
import type { ResolvedMedia } from './types';
import { cleanupIframe, debugLog } from './utils';

/**
 * Decrypt googleapiscdn player playlists into playable HLS sources.
 *
 * 1) Join split avsToken string literals on the player page
 * 2) GET the player HTML + encrypted playlist (up to 3 attempts)
 * 3) AES-GCM decrypt the concatenated `_t` fragments (envelope cn/sk/ts/uid)
 * 4) url-cipher AES-CTR on `/hls/?e=` → real http segment URLs
 *    (lh3.googleusercontent PNG files; AES-128 TS at #EXT-X-BYTERANGE offset)
 * 5) Inline seg-key URIs, build a data: m3u8 keeping KEY/BYTERANGE/EXTINF
 */

export function getAvsUa(): string {
  return typeof navigator !== 'undefined' && navigator.userAgent
    ? navigator.userAgent
    : '';
}

function bypassHeaders(referer?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': getAvsUa(),
  };
  if (referer) h.Referer = referer;
  return h;
}

/** Join all `"…"` chunks after `const avsToken =` into one JWT. */
export function extractAvsToken(html: string): string | null {
  const decl = html.match(
    /const\s+avsToken\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)\s*;/,
  );
  if (decl && decl[1]) {
    const parts = decl[1].match(/"((?:[^"\\]|\\.)*)"/g);
    if (parts && parts.length) {
      const joined = parts.map(p => p.slice(1, -1)).join('');
      if (joined) {
        debugLog(
          'avsToken concat parts=' +
            parts.length +
            ' lens=' +
            parts.map(p => p.length - 2).join(',') +
            ' joined=' +
            joined.length,
        );
        return joined;
      }
    }
  }
  const single = html.match(/const\s+avsToken\s*=\s*"([^"]+)"/);
  if (single && single[1]) return single[1];
  return null;
}

function b64urlToString(b64: string): string {
  let s = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  return atob(s);
}

function parseEnvelope(
  envB64: string,
): { cn: string; sk: string; ts: string; uid: string } | null {
  try {
    const bytes = b64urlDecode(envB64);
    if (bytes.length < 11) return null;
    if (
      bytes[0] !== 85 ||
      bytes[1] !== 83 ||
      bytes[2] !== 68 ||
      bytes[3] !== 75
    ) {
      return null;
    }
    if (bytes[4] !== 1) return null;
    const payloadLen = ((bytes[5] & 0xff) << 8) | (bytes[6] & 0xff);
    if (bytes.length < 7 + payloadLen + 4) return null;
    const payload = bytes.subarray(7, 7 + payloadLen);
    let iso = '';
    for (const b of payload) iso += String.fromCharCode(b);
    const decoded = decodeURIComponent(iso);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function buildM3u8DataUri(m3u8Text: string): string {
  const lines = m3u8Text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const headerTag =
    /^#EXT-X-(VERSION|TARGETDURATION|MEDIA-SEQUENCE|PLAYLIST-TYPE)/i;
  // KEY/BYTERANGE must stay in order: segments are AES-128 ranges inside a PNG file.
  const mediaTag = /^#(EXTINF:|EXT-X-(KEY|BYTERANGE|DISCONTINUITY)\b)/i;
  const headers: string[] = [];
  const media: string[] = [];
  let hasExtinf = false;
  for (const line of lines) {
    if (/urn:avs:shield/i.test(line)) continue;
    if (/\/hls\/[0-9a-f]{24}\.ts/i.test(line)) continue;
    if (line.startsWith('#')) {
      if (headerTag.test(line)) {
        const name = line.split(':')[0].toUpperCase();
        if (!headers.some(h => h.split(':')[0].toUpperCase() === name)) {
          headers.push(line);
        }
      } else if (mediaTag.test(line)) {
        if (/^#EXTINF:/i.test(line)) hasExtinf = true;
        media.push(line);
      }
      continue;
    }
    if (/^https?:\/\//i.test(line)) {
      if (!hasExtinf) media.push('#EXTINF:10.0,');
      media.push(line);
      hasExtinf = false;
    }
  }

  // Nekori/hls.js require the format identifier as the first line.
  const out: string[] = ['#EXTM3U', ...headers, ...media, '#EXT-X-ENDLIST'];
  const body = out.join('\n');
  const segs = out.filter(l => /^https?:/i.test(l)).length;
  debugLog(
    'm3u8 data uri segs=' +
      segs +
      ' extinf=' +
      out.filter(l => /^#EXTINF:/i.test(l)).length +
      ' keys=' +
      out.filter(l => /^#EXT-X-KEY/i.test(l)).length +
      ' ranges=' +
      out.filter(l => /^#EXT-X-BYTERANGE/i.test(l)).length +
      ' bodyLen=' +
      body.length +
      ' head=' +
      out[0] +
      ' first=' +
      (out.find(l => /^https?:/i.test(l)) || '').slice(0, 70),
  );
  return (
    'data:application/vnd.apple.mpegurl;charset=utf-8,' +
    encodeURIComponent(body)
  );
}

/** Inline `#EXT-X-KEY` seg-key URIs as data URIs, like the site's init.min.js does. */
async function inlineSegmentKeys(
  m3u8Text: string,
  playerUrl: string,
): Promise<string> {
  const uris: string[] = [];
  const re = /#EXT-X-KEY:[^\r\n]*?URI="(https?:[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(m3u8Text)) !== null) {
    if (uris.indexOf(m[1]) === -1) uris.push(m[1]);
  }
  if (!uris.length) return m3u8Text;

  let out = m3u8Text;
  let inlined = 0;
  await Promise.all(
    uris.map(async uri => {
      try {
        const res = await nativeFetchBytes(
          uri,
          Object.assign({ Referer: playerUrl }, bypassHeaders()),
        );
        if (res.status !== 200 || res.bytes.length !== 16) {
          debugLog('seg-key HTTP=' + res.status + ' len=' + res.bytes.length);
          return;
        }
        let bin = '';
        for (const b of res.bytes) bin += String.fromCharCode(b);
        out = out
          .split('"' + uri + '"')
          .join('"data:application/octet-stream;base64,' + btoa(bin) + '"');
        inlined++;
      } catch (e) {
        debugLog('seg-key error: ' + (e instanceof Error ? e.message : e));
      }
    }),
  );
  debugLog('seg-key inlined ' + inlined + '/' + uris.length);
  if (inlined < uris.length) {
    throw new Error('Không tải được khóa AES-128 của segment.');
  }
  return out;
}

/** Rewrite `/hls/<fileId>.ts?e=` lines to http URLs via HMAC(jtiOdd)+AES-CTR; keep #EXTINF. */
async function decryptM3u8SegmentUrls(
  intermediateM3u8: string,
  jtiOdd: string,
): Promise<string> {
  const lines = intermediateM3u8.split('\n');
  const outLines = lines.slice();
  const hlsRe = /\/hls\/([0-9a-f]{24})\.ts/i;
  let replaced = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(hlsRe);
    if (!m) continue;
    try {
      const fileId = m[1];
      const qIdx = line.indexOf('?');
      const params: Record<string, string> = {};
      if (qIdx >= 0) {
        for (const p of line.slice(qIdx + 1).split('&')) {
          const eq = p.indexOf('=');
          if (eq >= 0) params[p.slice(0, eq)] = p.slice(eq + 1);
        }
      }
      const eParam = params.e || '';
      const iParam = parseInt(params.i || '0', 10) || 0;
      if (!eParam) continue;

      const hmacKey = new TextEncoder().encode(jtiOdd);
      const k = await crypto.subtle.importKey(
        'raw',
        hmacKey as never,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const aesKeyRaw = await crypto.subtle.sign(
        'HMAC',
        k,
        new TextEncoder().encode('url-cipher|' + fileId) as never,
      );
      const ctrKey = await crypto.subtle.importKey(
        'raw',
        aesKeyRaw as never,
        { name: 'AES-CTR' },
        false,
        ['decrypt'],
      );
      const counter = new Uint8Array(16);
      counter[12] = (iParam >>> 24) & 0xff;
      counter[13] = (iParam >>> 16) & 0xff;
      counter[14] = (iParam >>> 8) & 0xff;
      counter[15] = iParam & 0xff;
      const dec = await crypto.subtle.decrypt(
        { name: 'AES-CTR', counter: counter as never, length: 64 },
        ctrKey,
        b64urlDecode(eParam) as never,
      );
      const url = new TextDecoder().decode(dec);
      if (/^https?:\/\//i.test(url)) {
        outLines[i] = url;
        replaced++;
      }
    } catch {
      //
    }
  }

  const clean = outLines.filter(
    l =>
      l && !l.includes('urn:avs:shield') && !/\/hls\/[0-9a-f]{24}\.ts/i.test(l),
  );
  debugLog(
    'decryptM3u8SegmentUrls replaced=' + replaced + ' lines=' + clean.length,
  );
  return clean.join('\n');
}

/** Decrypt an encrypted server playlist using envelope headers + `_t` GCM blob. */
async function processEncryptedM3u8(
  m3u8Text: string,
  m3u8Headers: Record<string, string>,
  avsToken: string,
): Promise<string | null> {
  const jwtParts = avsToken.split('.');
  if (jwtParts.length < 2) return null;

  let jti = '';
  try {
    const payload = JSON.parse(b64urlToString(jwtParts[1]));
    jti = String(payload.jti || '');
  } catch {
    debugLog('JWT payload parse fail');
  }
  if (!jti) return null;

  let jtiOdd = '';
  for (let i = 0; i < jti.length; i++) {
    if (i % 2 === 1) jtiOdd += jti[i];
  }
  debugLog('jtiOdd len=' + jtiOdd.length);

  let cn = '';
  let sk = '';
  let ts = '0';
  let uid = 'anon';

  const envHeader =
    m3u8Headers['x-envelope'] ||
    m3u8Headers['x-avs-envelope'] ||
    m3u8Headers['x-stream-envelope'] ||
    '';
  if (envHeader) {
    const envJson = parseEnvelope(envHeader);
    if (envJson) {
      cn = envJson.cn || '';
      sk = envJson.sk || '';
      ts = envJson.ts || '0';
      uid = envJson.uid || 'anon';
      debugLog('envelope ok cn=' + cn.slice(0, 12));
    }
  }
  if (!cn) cn = m3u8Headers['x-edge-tag'] || '';
  if (!sk) sk = m3u8Headers['x-cache-node'] || '';
  if (!ts || ts === '0') ts = m3u8Headers['x-request-trace'] || '0';
  if (uid === 'anon') {
    const pd = m3u8Headers['x-proxy-digest'];
    if (pd) {
      try {
        uid = decodeURIComponent(pd);
      } catch {
        uid = pd;
      }
    }
  }
  if (!cn || !sk) {
    debugLog('missing cn/sk');
    return null;
  }

  const lines = m3u8Text.split('\n');
  const tValues: string[] = [];
  const headerLines: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine;
    if (line.startsWith('#') || line.trim() === '') {
      if (
        !/^#EXTINF:/i.test(line) &&
        !/^#EXT-X-ENDLIST/i.test(line) &&
        !/^#EXT-X-KEY/i.test(line)
      ) {
        headerLines.push(line);
      }
    } else {
      const tm = line.match(/[?&]_t=([^&\s]+)/);
      if (tm) tValues.push(tm[1]);
    }
  }
  if (!tValues.length) {
    debugLog('no _t values');
    return null;
  }
  debugLog(
    '_t count=' +
      tValues.length +
      ' cn=' +
      cn.slice(0, 10) +
      ' sk=' +
      sk.slice(0, 10),
  );

  const concatenated = tValues.join('');
  const cnBytes = b64urlDecode(cn);
  const iv = cnBytes.slice(0, Math.min(12, cnBytes.length));

  const unshuffleFns: ((s: string) => string)[] = [
    s => stringUnshuffle(s, sk),
    s => s,
  ];
  const hmacFormats = [
    uid + ':' + ts + ':' + sk + ':0',
    uid + ':' + ts + ':' + sk,
  ];

  for (const unshuffleFn of unshuffleFns) {
    for (const hmacData of hmacFormats) {
      try {
        const unshuffled = unshuffleFn(concatenated);
        const encryptedBlob = b64urlDecode(unshuffled);
        const macKey = await crypto.subtle.importKey(
          'raw',
          cnBytes as never,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const gcmKeyRaw = await crypto.subtle.sign(
          'HMAC',
          macKey,
          new TextEncoder().encode(hmacData) as never,
        );
        const gcmKey = await crypto.subtle.importKey(
          'raw',
          gcmKeyRaw as never,
          { name: 'AES-GCM' },
          false,
          ['decrypt'],
        );
        const rawResult = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as never, tagLength: 128 },
          gcmKey,
          encryptedBlob as never,
        );
        const rawBytes = new Uint8Array(rawResult);
        let m3u8Body = new TextDecoder().decode(rawBytes);
        if (!m3u8Body.includes('#EXTINF') && !m3u8Body.includes('/hls/')) {
          m3u8Body = new TextDecoder().decode(descramble(rawBytes, sk, ts));
        }

        let fullM3u8Text = headerLines.join('\n') + '\n' + m3u8Body;
        if (!/^#EXTM3U/m.test(fullM3u8Text.trimStart())) {
          fullM3u8Text =
            '#EXTM3U\n' + fullM3u8Text.replace(/^#EXTM3U[^\n]*\n?/i, '');
        }
        if (!fullM3u8Text.includes('#EXT-X-ENDLIST')) {
          fullM3u8Text += '\n#EXT-X-ENDLIST';
        }

        if (/\/hls\/[0-9a-f]{24}\.ts\?e=/i.test(fullM3u8Text) && jtiOdd) {
          debugLog('GCM ok → url-cipher path');
          return await decryptM3u8SegmentUrls(fullM3u8Text, jtiOdd);
        }
        if (m3u8Body.includes('#EXTINF')) {
          debugLog('GCM ok → plaintext m3u8 body');
          return fullM3u8Text;
        }
      } catch {
        // next unshuffle / hmac combo
      }
    }
  }

  debugLog('GCM decrypt failed all combos');
  return null;
}

export async function resolveGoogleApisCdn(
  playerUrl: string,
): Promise<ResolvedMedia> {
  const overlay = document.createElement('div');
  overlay.setAttribute('data-avs-challenge-overlay', '');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'background:#111',
    'visibility:hidden',
    'opacity:0',
    'pointer-events:none',
  ].join(';');

  const iframe = document.createElement('iframe');
  iframe.title = 'Cloudflare verification';
  iframe.style.cssText = [
    'display:block',
    'width:100%',
    'height:100%',
    'border:0',
    'background:#fff',
  ].join(';');
  iframe.src = playerUrl;
  overlay.appendChild(iframe);
  (document.body || document.documentElement).appendChild(overlay);

  const iframeReady = new Promise<void>(resolve => {
    iframe.addEventListener('load', () => resolve(), { once: true });
  });
  const maxWait = 8000;
  debugLog('Đợi player iframe/cookie, tối đa ' + maxWait + 'ms…');
  await Promise.race([
    iframeReady,
    new Promise<void>(resolve => setTimeout(resolve, maxWait)),
  ]);
  debugLog('Player iframe loaded, polling clearance/token…');

  try {
    return await decryptGoogleApisCdn(playerUrl, iframe, overlay);
  } catch (err) {
    cleanupIframe(iframe);
    throw err;
  }
}

/** Fetch player page + playlist after Cloudflare clearance, then decrypt it. */
async function decryptGoogleApisCdn(
  playerUrl: string,
  iframe: HTMLIFrameElement,
  overlay: HTMLElement,
): Promise<ResolvedMedia> {
  const videoHash = (playerUrl.match(/\/player\/([0-9a-f]+)/) || [])[1];
  const baseUrl = (playerUrl.match(/^(https?:\/\/[^/]+)/) || [])[1];
  if (!videoHash || !baseUrl) {
    throw new Error('Không tìm thấy video hash/baseUrl trong URL player.');
  }

  const maxAttempts = 120;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const playerRes = await nativeFetch(playerUrl, bypassHeaders(playerUrl));
      const html = playerRes.text;
      const avsToken = extractAvsToken(html);
      if (!avsToken) {
        debugLog(
          'player page no avsToken attempt=' +
            attempt +
            ' HTTP=' +
            playerRes.status +
            ' html=' +
            html.length,
        );
        if (attempt === 3) {
          debugLog('Cloudflare cần tương tác, hiển thị trang xác minh…');
          overlay.style.visibility = 'visible';
          overlay.style.opacity = '1';
          overlay.style.pointerEvents = 'auto';
        }
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        continue;
      }
      debugLog(
        'token ok attempt=' +
          attempt +
          ' len=' +
          avsToken.length +
          ' html=' +
          html.length,
      );
      overlay.style.visibility = 'hidden';
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';

      const m3u8Url =
        baseUrl +
        '/playlist/' +
        videoHash +
        '/playlist.m3u8?token=' +
        encodeURIComponent(avsToken);
      const m3u8Res = await nativeFetch(
        m3u8Url,
        Object.assign({ Referer: playerUrl }, bypassHeaders()),
      );
      const m3u8Text = m3u8Res.text;
      debugLog('playlist HTTP=' + m3u8Res.status + ' size=' + m3u8Text.length);

      const decrypted = await processEncryptedM3u8(
        m3u8Text,
        m3u8Res.headers || {},
        avsToken,
      );
      if (decrypted && decrypted.trim()) {
        const segCount = decrypted
          .split('\n')
          .filter(l => l.trim().startsWith('http')).length;
        debugLog('decrypt OK, ' + segCount + ' segments');
        const playable = await inlineSegmentKeys(decrypted, playerUrl);
        cleanupIframe(iframe);
        return {
          type: 'sources',
          sources: [{ file: buildM3u8DataUri(playable), type: 'hls' }],
        };
      }
      debugLog('decrypt FAILED attempt=' + attempt);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      debugLog('attempt ' + attempt + ' error: ' + message);
    }
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  cleanupIframe(iframe);
  throw new Error('Giải mã googleapis thất bại.');
}
