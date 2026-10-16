/* eslint-disable @typescript-eslint/no-this-alias */
import { fetchAjaxPlayer } from './ajax';
import { getAvsUa, resolveGoogleApisCdn } from './google_cdn';
import type { PlayerConfig, ResolvedMedia } from './types';
import { debugLog, initUtils, showError } from './utils';

void window
  .nekori!.ready.then(async () => {
    const AVS_TS_SYNC = 0x47;
    const AVS_TS_PACKET = 188;
    const AVS_TS_SYNC_CHAIN = 8;
    const AVS_MAX_PREFIX = 4096;

    /** Find a wrapped MPEG-TS payload by its packet sync chain. */
    function stripAvsWrapper(ab: ArrayBuffer): ArrayBuffer {
      try {
        const u8 = new Uint8Array(ab);
        if (u8.length < AVS_TS_PACKET * AVS_TS_SYNC_CHAIN) return ab;
        const max = Math.min(u8.length, AVS_MAX_PREFIX);
        for (let i = 0; i <= max; i++) {
          if (u8[i] !== AVS_TS_SYNC) continue;
          let ok = true;
          for (let k = 1; k < AVS_TS_SYNC_CHAIN; k++) {
            const idx = i + k * AVS_TS_PACKET;
            if (idx >= u8.length || u8[idx] !== AVS_TS_SYNC) {
              ok = false;
              break;
            }
          }
          if (ok) {
            if (i > 0) {
              debugLog('[AVS] wrapper strip prefix=' + i + '/' + u8.length);
              return u8.slice(i).buffer;
            }
            return ab;
          }
        }
        debugLog(
          '[AVS] TS sync not found head=' +
            Array.from(u8.slice(0, 12))
              .map(value => value.toString(16).padStart(2, '0'))
              .join(' '),
        );
        return ab;
      } catch {
        return ab;
      }
    }

    function isPlaylistUrl(url: string, context: any): boolean {
      const u = String(url || '');
      const t = String((context && context.type) || '');
      return (
        u.indexOf('blob:') === 0 ||
        u.indexOf('data:') === 0 ||
        /\.m3u8(\?|$)/i.test(u) ||
        t === 'manifest' ||
        t === 'level'
      );
    }

    async function fetchMedia(
      url: string,
      signal?: AbortSignal,
    ): Promise<ArrayBuffer> {
      const isLocal = /^(blob:|data:)/i.test(url);
      // docs/core-player: blob/data → window.fetch; http → reader.fetch
      const fetchFn = isLocal
        ? fetch.bind(window)
        : // @ts-ignore
          window.nekori! && window.nekori!.fetch
          ? // @ts-ignore
            window.nekori!.fetch.bind(window.nekori!)
          : fetch;
      const res = await fetchFn(url, {
        credentials: 'include',
        signal,
        headers: isLocal
          ? undefined
          : {
              Referer: 'https://stream.googleapiscdn.com/',
              'User-Agent': getAvsUa(),
            },
      });
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' for ' + url.slice(0, 120));
      }
      return res.arrayBuffer();
    }

    /**
     * hls.js fLoader — same callback contract as CosplayTele/NguonC.
     * Nekori hls adapter reads stats.chunkCount; onSuccess is (response, stats, ctx, networkDetails).
     */
    function createAvsFragmentLoader() {
      // @ts-ignore
      function AvsFragmentLoader(config) {
        // @ts-ignore
        this._config = config;
        // @ts-ignore
        this.context = null;
        // @ts-ignore
        this.aborted = false;
        // @ts-ignore
        this.controller = null;
        // @ts-ignore
        this.stats = {
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
      }
      // @ts-ignore
      AvsFragmentLoader.prototype.destroy = function () {
        this.abort();
      };
      // @ts-ignore
      AvsFragmentLoader.prototype.abort = function () {
        // @ts-ignore
        this.aborted = true;
        // @ts-ignore
        this.stats.aborted = true;
        // @ts-ignore
        if (this.controller) this.controller.abort();
        // @ts-ignore
        this.controller = null;
      };
      // @ts-ignore
      AvsFragmentLoader.prototype.getResponseData = function (xhr: any) {
        return xhr && xhr.response;
      };
      // @ts-ignore
      AvsFragmentLoader.prototype.load = function (
        context,
        _config,
        callbacks,
      ) {
        const self = this;
        self.context = context;
        self.aborted = false;
        self.stats.aborted = false;
        self.controller = new AbortController();
        const url = (context && context.url) || '';
        const t0 = performance.now();
        self.stats.loading.start = t0;
        self.stats.aborted = false;
        debugLog('[AVS] frag GET ' + String(url).slice(0, 90));

        fetchMedia(url, self.controller.signal)
          .then(buf => {
            if (self.aborted) return;
            self.controller = null;
            self.stats.loading.first = performance.now();
            self.stats.loading.end = performance.now();
            self.stats.chunkCount = 1;
            if (isPlaylistUrl(url, context)) {
              const text = new TextDecoder().decode(buf);
              self.stats.loaded = text.length;
              self.stats.total = text.length;
              callbacks.onSuccess(
                { data: text, url: url },
                self.stats,
                context,
                null,
              );
              return;
            }
            // EXT-X-BYTERANGE: AES-128 data sits after the PNG header; hls.js decrypts it.
            const ranged =
              typeof context.rangeStart === 'number' ||
              typeof context.rangeEnd === 'number';
            const clean = ranged
              ? buf.slice(
                  context.rangeStart || 0,
                  typeof context.rangeEnd === 'number'
                    ? context.rangeEnd
                    : buf.byteLength,
                )
              : stripAvsWrapper(buf);
            debugLog(
              '[AVS] frag bytes=' +
                buf.byteLength +
                (ranged
                  ? ' range=' + context.rangeStart + '-' + context.rangeEnd
                  : '') +
                ' clean=' +
                clean.byteLength,
            );
            self.stats.loaded = clean.byteLength;
            self.stats.total = clean.byteLength;
            callbacks.onSuccess(
              { data: clean, url: url },
              self.stats,
              context,
              null,
            );
          })
          .catch((err: any) => {
            if (self.aborted) return;
            self.controller = null;
            debugLog(
              '[AVS] frag fail ' + String(err && err.message).slice(0, 80),
            );
            self.stats.loading.end = performance.now();
            callbacks.onError(
              { code: 0, text: String(err && err.message) },
              context,
              null,
              self.stats,
            );
          });
      };
      return AvsFragmentLoader;
    }

    function parseConfig(container: HTMLElement): PlayerConfig {
      return {
        mode: container.getAttribute('data-mode') || 'm3u8',
        playerType: container.getAttribute('data-player-type') || 'artplayer',
        debugEnabled: container.getAttribute('data-debug') === '1',
        m3u8: container.getAttribute('data-m3u8'),
        sourcesRaw: container.getAttribute('data-sources'),
        iframeSrc: container.getAttribute('data-iframe'),
        ajaxHash: container.getAttribute('data-hash'),
        ajaxId: container.getAttribute('data-id'),
        ajaxReferer: container.getAttribute('data-referer'),
        ajaxSite: container.getAttribute('data-site'),
        bannerUrl: container.getAttribute('data-banner'),
      };
    }

    async function resolveMedia(config: PlayerConfig): Promise<ResolvedMedia> {
      if (config.m3u8) {
        debugLog('Resolver: direct m3u8.');
        return {
          type: 'sources',
          sources: [{ file: config.m3u8, type: 'hls' }],
        };
      }
      if (config.sourcesRaw) {
        try {
          const sources = JSON.parse(config.sourcesRaw);
          debugLog('Resolver: sources ' + sources.length);
          return { type: 'sources', sources: sources };
        } catch (e) {
          debugLog('Resolver: bad sources json');
        }
      }
      if (config.iframeSrc) {
        if (
          config.iframeSrc.indexOf('googleapiscdn.com') !== -1 &&
          config.mode === 'm3u8'
        ) {
          debugLog('Resolver: googleapis m3u8 decrypt…');
          return await resolveGoogleApisCdn(config.iframeSrc);
        }
        return { type: 'iframe', iframeUrl: config.iframeSrc };
      }
      if (config.ajaxHash && config.ajaxSite) {
        debugLog('Resolver: ajax player…');
        return await fetchAjaxPlayer(config);
      }
      throw new Error('Thiếu thông tin cấu hình video.');
    }

    async function renderMedia(resolved: ResolvedMedia) {
      // @ts-ignore
      if (!window.nekori!.player) return;
      // @ts-ignore
      const player = window.nekori!.player;

      if (resolved.type === 'sources' && resolved.sources) {
        const s = resolved.sources[0];
        const file = (s.file || '').replace(/^&http/, 'http');
        const isHls =
          s.type === 'hls' ||
          file.indexOf('blob:') === 0 ||
          file.indexOf('data:') === 0 ||
          /\.m3u8(\?|$)/i.test(file);
        if (isHls) {
          debugLog('[AVS] playHls ' + file.slice(0, 72));
          // docs.md: hlsJsConfig → Hls constructor. fLoader slices BYTERANGE.
          await player.playHls(file, {
            fLoader: createAvsFragmentLoader(),
            xhrSetup: (xhr: any, url: string) => {
              try {
                if (/googleusercontent|stream\.googleapis/i.test(String(url))) {
                  xhr.setRequestHeader(
                    'Referer',
                    'https://stream.googleapiscdn.com/',
                  );
                }
              } catch {
                //
              }
            },
          });
          return;
        }
        await player.playDirect(file);
        return;
      }

      if (resolved.type === 'iframe' && resolved.iframeUrl) {
        window.nekori!.player!.log(
          '[AVS] playIframe ' + resolved.iframeUrl.slice(0, 80),
        );
        await player.playIframe(resolved.iframeUrl);
        return;
      }

      window.nekori!.player!.log('[AVS] Không có nguồn phát hợp lệ.');
    }

    async function initPlayer() {
      const container = document.getElementById('avs-player-container');
      if (!container) return;

      const config = parseConfig(container);
      initUtils(container);

      try {
        const resolved = await resolveMedia(config);
        await renderMedia(resolved);
      } catch (error: any) {
        debugLog('Pipeline error: ' + (error && error.message));
        showError(error.message || 'Lỗi giải mã video.');
        // Fallback: site iframe player when decrypt/playback fails.
        if (config.iframeSrc) {
          debugLog('Fallback: site iframe player.');
          await renderMedia({ type: 'iframe', iframeUrl: config.iframeSrc });
        }
      }
    }

    await initPlayer();
  })
  .catch(error => window.nekori!.error(String(error)));
