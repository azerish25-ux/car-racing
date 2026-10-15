// Screenshot the vegetation lookdev page with Mesa llvmpipe.
//   xvfb-run -a node shoot.mjs <url-with-query> <out.png> [more url out pairs]
import { createRequire } from 'node:module';
const need = createRequire('/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/package.json');
const { chromium } = need('@playwright/test');
const args = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: false,
  args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'],
});
try {
  for (let i = 0; i < args.length; i += 2) {
    const url = args[i],
      out = args[i + 1];
    const w = Number(new URL(url).searchParams.get('w') ?? 1280),
      h = Number(new URL(url).searchParams.get('h') ?? 720);
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const logs = [];
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(url);
    const t0 = Date.now();
    let status = '';
    while (Date.now() - t0 < 240000) {
      status = await page.evaluate(() => window.__status ?? '');
      if (status === 'ready' || status.startsWith('error')) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: out });
    console.log(out, status, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const l of logs.filter((l) => !/DevTools|Download the React/.test(l)).slice(0, 30)) console.log('  ', l.slice(0, 600));
    await page.close();
  }
} finally {
  await browser.close();
}
