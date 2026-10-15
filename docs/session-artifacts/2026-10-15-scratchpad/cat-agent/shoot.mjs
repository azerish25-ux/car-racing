import { chromium } from '/home/user/Experiment-3/node_modules/@playwright/test/index.mjs';
// usage: shoot.mjs <name> <query> [<name> <query> ...]
const out = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/cat-agent/';
const args = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
page.on('console', (m) => console.log('console', m.text()));
page.on('pageerror', (e) => console.log('pageerror', e.message));
for (let i = 0; i < args.length; i += 2) {
  const [name, query] = [args[i], args[i + 1]];
  await page.goto(`http://127.0.0.1:5287/test-results/body-preview/index.html?${query}`, { timeout: 600000 });
  await page.waitForFunction(() => window.previewReady, null, { timeout: 600000 });
  const info = await page.evaluate(() => window.previewReady);
  console.log(name, JSON.stringify(info));
  await page.screenshot({ path: `${out}${name}.png` });
}
await browser.close();
