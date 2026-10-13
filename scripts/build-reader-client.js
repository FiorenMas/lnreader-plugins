import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
// Compile only the Electron adapter. The copied reader dist is served directly.
await build({
  absWorkingDir: root,
  entryPoints: ['src/lib/reader-client.ts'],
  outfile: path.join(root, 'public/static/reader-client.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome138',
  plugins: [
    {
      name: 'copied-reader',
      setup(builder) {
        builder.onResolve({ filter: /novel-reader\/index\.js$/ }, () => ({
          path: './novel-reader/index.js',
          external: true,
        }));
      },
    },
  ],
});
