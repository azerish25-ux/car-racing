// Quick smoke probe: open the app, wait for the paddock menu, screenshot, dump photo-sky diagnostics.
import { createRequire } from 'node:module';
const repo = '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-1';
const need = createRequire(repo + '/package.json');
const { chromium } = need('@playwright/test');
const [url, out, waitSec = '25', extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: false,
  args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const t0 = Date.now();
await page.goto(url + extra);
await page.waitForSelector('#menu:not([hidden])', { timeout: 15 * 60 * 1000 });
console.log('menu after', (Date.now() - t0) / 1000, 's');
await page.waitForTimeout(Number(waitSec) * 1000);
const diag = await page.evaluate(() => {
  const d = window.apexDiagnostics?.();
  return d?.renderer?.photoSky ?? d?.photoSky ?? Object.keys(d ?? {});
});
console.log(JSON.stringify(diag, null, 1));
await page.addStyleTag({ content: '#app{display:none!important}' });
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
console.log(logs.filter((l) => /error|warn|sky/i.test(l)).slice(0, 30).join('\n'));
await browser.close();
