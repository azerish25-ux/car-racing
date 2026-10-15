import { chromium } from '/home/user/Experiment-3/node_modules/@playwright/test/index.mjs';
const views = process.argv.slice(2);
const out = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => console.log('console', m.text()));
page.on('pageerror', (e) => console.log('pageerror', e.message));
for (const v of views) {
  const [view, bike = 'gpr1'] = v.split(':');
  await page.goto(`http://127.0.0.1:5199/test-results/bike-preview/index.html?view=${view}&bike=${bike}`, { timeout: 600000 });
  await page.waitForFunction(() => window.previewReady, null, { timeout: 600000 });
  const info = await page.evaluate(() => window.previewReady);
  console.log(v, JSON.stringify(info));
  await page.screenshot({ path: `${out}bike-${view}-${bike}.png` });
}
await browser.close();
