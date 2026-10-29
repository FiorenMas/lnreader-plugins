void window
  .nekori!.ready.then(async () => {
    /* eslint-disable */

    /**
     * NguonC - WebView Video Player
     *
     * New flow (streamc r25): plugin POSTs bootstrap and passes the signed
     * playlist URL + video hash. We fetch the playlist via reader.fetch,
     * AES-GCM decrypt it (key = HMAC-SHA256("stream-derive-v1", videoHash)),
     * then feed a blob m3u8 to hls.js.
     *
     * Legacy flow: #player[data-obf] base64 → {sUb, hD}; playlist URL is
     * `${embedOrigin}/${sUb}` and decrypt uses hD as the hash.
     *
     * Fallback: iframe embed.
     */

    const player = window.nekori!.player;
    if (!player) return;

    const dbg = (msg: string) => {
      try {
        player.log('[NGC] ' + msg);
      } catch (_) {
        /* no-op */
      }
    };

    const hexToBytes = (hex: string) => {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
      }
      return bytes;
    };

    const b64Decode = (b64: string) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return bytes;
    };

    async function decryptM3u8(
      encryptedBytes: Uint8Array<ArrayBuffer>,
      ivBytes: Uint8Array<ArrayBuffer>,
      videoHash: string,
    ): Promise<string | null> {
      try {
        const enc = new TextEncoder();
        const hmacKey = await crypto.subtle.importKey(
          'raw',
          enc.encode('stream-derive-v1'),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const hmacResult = await crypto.subtle.sign(
          'HMAC',
          hmacKey,
          enc.encode(videoHash),
        );
        const aesKey = await crypto.subtle.importKey(
          'raw',
          new Uint8Array(hmacResult).slice(0, 32),
          { name: 'AES-GCM' },
          false,
          ['decrypt'],
        );
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: ivBytes },
          aesKey,
          encryptedBytes,
        );
        return new TextDecoder().decode(decrypted);
      } catch {
        return null;
      }
    }

    function createProxyFragLoader(origin: string) {
      return class {
        stats = {
          aborted: false,
          loaded: 0,
          retry: 0,
          total: 0,
          chunkCount: 0,
          bwEstimate: 0,
          loading: { start: 0, first: 0, end: 0 },
          parsing: { start: 0, end: 0 },
          buffering: { start: 0, first: 0, end: 0 },
        };
        constructor() {}
        destroy() {}
        abort() {}
        load(ctx: any, _cfg: any, cbs: any) {
          this.stats.loading.start = performance.now();
          window
            .nekori!.fetch(ctx.url, {
              method: 'GET',
              headers: { Referer: origin },
              referrer: origin,
            })
            .then((resp: any) => {
              if (!resp.ok) throw new Error('HTTP ' + resp.status);
              this.stats.loading.first = performance.now();
              return resp.arrayBuffer();
            })
            .then((buf: any) => {
              this.stats.loading.end = performance.now();
              this.stats.loaded = buf.byteLength;
              this.stats.total = buf.byteLength;
              cbs.onSuccess({ data: buf }, this.stats, ctx, null);
            })
            .catch((err: any) => {
              this.stats.loading.end = performance.now();
              cbs.onError(
                { code: 0, text: err.message },
                ctx,
                null,
                this.stats,
              );
            });
        }
      };
    }

    async function fetchPlaylistText(url: string, referer: string) {
      const resp = await window.nekori!.fetch(url, {
        method: 'GET',
        headers: { Referer: referer },
      });
      if (!resp.ok) throw new Error('playlist HTTP ' + resp.status);
      return resp.text();
    }

    async function decryptIfNeeded(text: string, videoHash: string) {
      if (!text.includes('#ENC-AESGCM')) return text;
      let ivHex = '';
      let encryptedData = '';
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#ENC-AESGCM')) {
          const m = trimmed.match(/iv=([a-fA-F0-9]+)/);
          if (m) ivHex = m[1];
        } else if (trimmed && !trimmed.startsWith('#')) {
          encryptedData = trimmed;
        }
      }
      if (!ivHex || !encryptedData) throw new Error('Invalid m3u8 envelope');
      const decrypted = await decryptM3u8(
        b64Decode(encryptedData),
        hexToBytes(ivHex),
        videoHash,
      );
      if (!decrypted) throw new Error('Decryption failed');
      return decrypted;
    }

    async function playM3u8(m3u8Text: string, refererOrigin: string) {
      dbg('Playing decrypted m3u8 (' + m3u8Text.length + ' chars)');
      const blob = new Blob([m3u8Text], {
        type: 'application/vnd.apple.mpegurl',
      });
      await player!.playHls(URL.createObjectURL(blob), {
        fLoader: createProxyFragLoader(refererOrigin),
      });
    }

    (async () => {
      const container = document.getElementById('nguonc-player-container');
      const embedUrl = container?.getAttribute('data-iframe') || '';
      const playlistUrl = container?.getAttribute('data-playlist') || '';
      const videoHash = container?.getAttribute('data-hash') || '';
      const dataObf = container?.getAttribute('data-obf') || '';
      const embedOrigin = embedUrl ? new URL(embedUrl).origin : '';

      try {
        // New flow: signed playlist URL + hash supplied by the plugin.
        if (playlistUrl) {
          dbg('Fetching playlist…');
          const text = await fetchPlaylistText(playlistUrl, embedUrl);
          const m3u8Text = await decryptIfNeeded(text, videoHash);
          await playM3u8(m3u8Text, embedOrigin);
          return;
        }

        // Legacy flow: data-obf → {sUb, hD} → playlist at origin/sUb.
        if (dataObf) {
          const streamData = JSON.parse(atob(dataObf));
          const m3u8Url = `${embedOrigin}/${streamData.sUb}`;
          dbg('Fetching legacy playlist…');
          const text = await fetchPlaylistText(m3u8Url, embedUrl);
          const m3u8Text = await decryptIfNeeded(text, streamData.hD);
          await playM3u8(m3u8Text, embedOrigin);
          return;
        }

        throw new Error('No stream data');
      } catch (err: any) {
        dbg('Error: ' + (err?.message || err) + ' — falling back to iframe');
        if (embedUrl) {
          await player!.playIframe(embedUrl);
        } else {
          throw err;
        }
      }
    })();
  })
  .catch(error => window.nekori!.error(String(error)));
