// Open the served app, print console errors/warnings and time to the menu.
import { createRequire } from 'node:module';
const repo = '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-2';
const need = createRequire(`${repo}/package.json`);
const { chromium } = need('@playwright/test');
const url = process.argv[2];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const t0 = Date.now();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning')
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s ${m.type()}] ${m.text().slice(0, 1500)}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url);
try {
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 8 * 60 * 1000 });
  console.log(`menu after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const d = await page.evaluate(() => window.apexDiagnostics?.().renderer?.scannedGround ?? null);
  console.log(JSON.stringify(d));
} catch (e) {
  console.log(`no menu: ${e.message}`);
  console.log(await page.evaluate(() => document.body.innerText.slice(0, 2000)));
}
await browser.close();
