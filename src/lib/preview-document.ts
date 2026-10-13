import type { Plugin } from '@/types/plugin';

import type {
  ReaderConfig,
  VideoType,
} from '../../public/static/novel-reader/index.js';

type PreviewDocumentOptions = {
  chapter: Plugin.ChapterContent;
  title?: string;
  chapterPath: string;
  pluginId: string;
  sourceBaseUrl: string;
  customCSS?: string;
  customJS?: string;
  dark?: boolean;
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] as string,
  );
const staticUrl = (relative: string) =>
  new URL('/public/static/' + relative, window.location.origin).href;

/** Uses the app's built runtime and public config, with Electron implementing host actions. */
export function buildPreviewDocument({
  chapter,
  title = 'Chapter Preview',
  chapterPath,
  pluginId,
  sourceBaseUrl,
  customCSS,
  customJS,
  dark,
}: PreviewDocumentOptions): string {
  const metadata = new DOMParser().parseFromString(chapter.html, 'text/html');
  const meta = (name: string) =>
    metadata.querySelector<HTMLMetaElement>('meta[name="nekori-' + name + '"]')
      ?.content ?? '';
  const type = meta('video-type');
  if (type && !['m3u8', 'mpd', 'video-file', 'iframe'].includes(type))
    throw new Error('Unsupported video type: ' + type);
  const config: ReaderConfig = {
    documentId: crypto.randomUUID(),
    mode: 'reader',
    novel: { id: pluginId, name: title, path: '' },
    chapter: { id: '1', name: title, path: chapterPath, progress: 0 },
    nextChapter: null,
    chapters: [],
    autoSaveInterval: 5000,
    proxyEndpoint: 'lnproxy://proxy',
    strings: {
      close: 'Close',
      retry: 'Retry',
      copy: 'Copy',
      nextChapter: 'Next chapter',
    },
    runtime: {
      editing: false,
      infinite: false,
      textSelectionBlocked: false,
      forcedLowercase: false,
      menuVisible: false,
      immersive: false,
      ttsState: 'stopped',
      loadingChapter: false,
      loadingNext: false,
      noMoreChapters: false,
    },
    ui: {
      bionicEnabled: false,
      ttsEnabled: false,
      labels: { tts: 'TTS', imageClose: 'Close image' },
    },
    context: { sourceBaseUrl, sourceId: pluginId },
    ...(chapter.type === 'video'
      ? {
          player: {
            mode: 'playback' as const,
            proxyEndpoint: 'lnproxy://proxy',
            video: {
              path: chapterPath,
              progress: 0,
              direct: meta('video-mode') === 'direct',
              type: type ? (type as VideoType) : undefined,
              url: meta('video-url'),
              poster: meta('video-poster'),
              thumbnailsVtt: meta('video-thumbnails'),
              disableProgress: !!metadata.querySelector(
                '#nekori-video-disable-progress',
              ),
              debug: meta('debug-mode') === 'true',
            },
          },
        }
      : {}),
  };
  config.chapters = [config.chapter];
  const assets = 'novel-reader/';
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' +
    escapeHtml(title) +
    '</title>' +
    '<link rel="stylesheet" href="' +
    staticUrl(assets + 'styles/reader.css') +
    '">' +
    '<style>:root { --reader-font-size: 18px; --reader-font-family: system-ui; --reader-line-height: 1.6; --reader-margin-top: 16px; --reader-margin-bottom: 16px; --reader-margin-left: 16px; --reader-margin-right: 16px; --reader-text-align: start; --reader-user-select: text; --reader-text-color: ' +
    (dark ? '#e5e7eb' : '#1f2937') +
    '; --reader-background-color: ' +
    (dark ? '#0b0f19' : '#ffffff') +
    '; --md-sys-color-primary: #8252ff; --md-sys-color-error: ' +
    (dark ? '#ffb4ab' : '#ba1a1a') +
    '; }</style>' +
    (chapter.type === 'video'
      ? '<script src="' +
        staticUrl(assets + 'vendor/hls.min.js') +
        '"></script><script src="' +
        staticUrl(assets + 'vendor/videojs.min.js') +
        '"></script>'
      : '') +
    (customCSS
      ? '<link rel="stylesheet" href="' + staticUrl(customCSS) + '">'
      : '') +
    '<script id="nekori-reader-config" type="application/json">' +
    JSON.stringify(config).replace(/</g, '\u003c') +
    '</script></head><body>' +
    '<main id="nekori-reader" class="nekori-reader" data-nekori-reader-root><nekori-chapter class="nekori-chapter" data-nekori-chapter-id="1" data-nekori-chapter-path="' +
    escapeHtml(chapterPath) +
    '">' +
    chapter.html +
    '</nekori-chapter></main>' +
    (customJS
      ? '<script id="nekori-source-script" type="application/json" data-src="' +
        staticUrl(customJS) +
        '"></script>'
      : '') +
    '<script type="module" src="' +
    staticUrl('reader-client.js') +
    '"></script></body></html>'
  );
}
