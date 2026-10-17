/** Serve a read-only application checkout and its real installed dependencies.
 * Baseline archives may share node_modules through a symlink. Only those two
 * roots are allowed; Vite's filesystem security checks remain enabled.
 * Archived authoring HTML is documentation, not an application entry point. */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = realpathSync(resolve(process.env.HORIZON_REVIEW_ROOT ?? process.cwd()));
const port = Number(process.env.HORIZON_REVIEW_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('HORIZON_REVIEW_PORT must be an integer between 1024 and 65535');
const dependencies = realpathSync(resolve(root, 'node_modules'));
const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  cacheDir: resolve(root, '.cache/solvane-review'),
  optimizeDeps: { entries: ['index.html', 'e2e/fixtures/horizon-session.html'] },
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    fs: { strict: true, allow: [root, dependencies] },
  },
});
await server.listen();
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => void server.close().then(() => process.exit(0)));
