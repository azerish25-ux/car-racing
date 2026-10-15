// Load the temporary scan-check.html harness in Chromium and print its log.
import { createRequire } from 'node:module';
const repo = '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-2';
const need = createRequire(`${repo}/package.json`);
const { chromium } = need('@playwright/test');
const url = process.argv[2];
const backend = process.argv[3] ?? 'swiftshader';
const args =
  backend === 'mesa'
    ? ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog'];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: backend !== 'mesa',
  args,
});
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text().slice(0, 2000)}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url);
const deadline = Date.now() + 20 * 60 * 1000;
let last = '';
while (Date.now() < deadline) {
  const text = await page.$eval('#log', (e) => e.textContent ?? '');
  if (text !== last) {
    const fresh = text.slice(last.length);
    console.log(fresh);
    for (const m of fresh.matchAll(/SHOT (\S+) (\S+)/g)) {
      const data = await page.evaluate((k) => window[k], `shot_${m[1]}_${m[2]}`);
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${process.env.OUT ?? '.'}/${m[1]}-${m[2]}.png`, Buffer.from(data.split(',')[1], 'base64'));
    }
    last = text;
  }
  if (text.includes('DONE') || text.includes('FAILED')) break;
  await new Promise((r) => setTimeout(r, 2000));
}
await browser.close();
