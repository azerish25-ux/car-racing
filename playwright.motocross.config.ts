import { chromium, defineConfig } from '@playwright/test';
import { browserBackend } from './scripts/browser-backend.ts';

const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);

/** A separate local port keeps this focused review independent of other
 * running preview servers. The normal CI config also discovers these specs. */
export default defineConfig({
  testDir: './e2e',
  testMatch: [
    '**/*-motocross-*.spec.ts',
    '**/11-phase27c.spec.ts',
    '**/41-motogp-reference.spec.ts',
    '**/42-motogp-environment.spec.ts',
    '**/motorcycle-presentation.spec.ts',
  ],
  globalSetup: './scripts/browser-backend-setup.ts',
  timeout: 300000,
  expect: { timeout: 60000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: 'test-results/motocross',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/motocross' }]],
  use: {
    baseURL: 'http://127.0.0.1:4197',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: backend.headless,
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (backend.name === 'mesa' ? chromium.executablePath() : undefined),
      args: backend.args,
    },
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4197 --strictPort',
    url: 'http://127.0.0.1:4197',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
