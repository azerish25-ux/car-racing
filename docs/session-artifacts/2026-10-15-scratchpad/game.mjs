import { chromium } from '/home/user/Experiment-3/node_modules/@playwright/test/index.mjs';
const out = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/';
const machine = process.argv[2] ?? 'gpr1';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log('pageerror', e.message);
});
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console error', m.text());
});
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', ...a);
await page.goto('http://127.0.0.1:4174/?dev');
await page.locator('#menu').waitFor({ state: 'visible', timeout: 300000 });
log('menu');
await page.locator('#mode').selectOption('practice');
await page.locator('#opponents').selectOption('3');
await page.locator('#vehicle').selectOption(machine);
log('rules', await page.locator('#sessionRules').textContent());
await page.evaluate(() => document.getElementById('sessionForm').requestSubmit());
const state = async () => (await page.evaluate(() => window.apexDiagnostics())).state;
for (let i = 0; i < 600; i++) {
  const s = await state();
  if (s === 'driving') break;
  if (await page.locator('#raceBriefing').isVisible().catch(() => false))
    await page.getByRole('button', { name: 'GO STRAIGHT TO LIGHTS', exact: true }).click({ force: true });
  await page.waitForTimeout(1000);
}
log('state', await state());
await page.keyboard.press('g');
await page.waitForTimeout(25000);
const shot = async (name) => {
  await page.screenshot({ path: `${out}game-${machine}-${name}.png` });
  log('shot', name);
};
await shot('chase');
await page.keyboard.press('c');
await page.waitForTimeout(4000);
await shot('cockpit');
await page.keyboard.press('c');
await page.waitForTimeout(4000);
await shot('pod');
await page.keyboard.press('c');
await page.waitForTimeout(4000);
await shot('trackside');
const d = await page.evaluate(() => {
  const x = window.apexDiagnostics();
  return { state: x.state, fps: x.renderer?.fps, calls: x.renderer?.calls };
});
log('diag', JSON.stringify(d), 'errors', errors.length);
await browser.close();
