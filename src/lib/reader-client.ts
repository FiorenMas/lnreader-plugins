import {
  createReader,
  createRuntimeHost,
  type NativeReaderTransport,
  parseEnvelope,
  type ReaderCommandName,
  readReaderConfig,
} from '../../public/static/novel-reader/index.js';

const config = readReaderConfig(document);
let requestId = 0;
const command = (method: ReaderCommandName, payload?: unknown) => {
  transport.onmessage?.({
    data: JSON.stringify({
      protocolVersion: 1,
      documentId: config.documentId,
      kind: 'command',
      requestId: 'dev-' + ++requestId,
      method,
      payload,
    }),
  });
};
const transport: NativeReaderTransport = {
  onmessage: null,
  postMessage(raw) {
    const message = parseEnvelope(raw, config.documentId);
    if (message.kind === 'command') {
      transport.onmessage?.({
        data: JSON.stringify({
          protocolVersion: 1,
          documentId: config.documentId,
          kind: 'result',
          requestId: message.requestId,
          ...(message.method === 'media.requestProtectedPlayback'
            ? { payload: true }
            : {
                error: {
                  code: 'unsupported_request',
                  message:
                    'Unsupported Electron reader request: ' + message.method,
                },
              }),
        }),
      });
    } else if (message.kind === 'event') {
      if (message.method === 'reader.error') {
        const payload = message.payload as { message: string };
        console.error('[Reader]', payload.message);
        command('feedback.show', {
          severity: 'error',
          presentation: 'boundary',
          title: 'Reader error',
          message: payload.message,
          dismissible: true,
        });
      } else if (
        message.method === 'reader.refetch' ||
        message.method === 'feedback.retry'
      ) {
        void window.readerDev
          .refetch()
          .catch(error => window.nekori?.error(String(error)));
      } else if (message.method === 'clipboard.copy') {
        void window.readerDev.copy((message.payload as { text: string }).text);
      } else {
        console.debug('[Reader event]', message.method, message.payload);
      }
    } else if (message.kind === 'result' && message.error) {
      console.error('[Reader command]', message.error);
    }
  },
};
const host = createRuntimeHost({
  root: document.documentElement,
  config,
  transport,
});
const reader = createReader({ root: document.documentElement, host, config });
void reader.ready
  .then(async () => {
    command('anchors.install');
    const scriptUrl = document.querySelector<HTMLScriptElement>(
      '#nekori-source-script',
    )?.dataset.src;
    if (scriptUrl) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error('Unable to load customJS: ' + scriptUrl));
        document.head.append(script);
      });
    }
  })
  .catch(error => reader.error(String(error)));
window.addEventListener('unhandledrejection', event =>
  reader.error(String(event.reason)),
);
window.addEventListener('pagehide', () => reader.dispose(), { once: true });

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    readerDev: { refetch(): Promise<void>; copy(text: string): Promise<void> };
  }
}
