import { chromium } from '/home/user/Experiment-3/node_modules/@playwright/test/index.mjs';
// In-game check: practice session with a catalogue machine; screenshots after driving.
const out = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/cat-agent/';
const machine = process.argv[2] ?? 'gt10m';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const t0 = Date.now();
const log = (s) => console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', s);
await page.goto(process.env.URL ?? 'http://127.0.0.1:4291/', { timeout: 600000 });
try {
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 240000 });
} catch (e) {
  console.log('menu not visible; errors', JSON.stringify(errors.slice(0, 10)));
  console.log('diag', JSON.stringify(await page.evaluate(() => window.apexDiagnostics?.()?.state)));
  await page.screenshot({ path: `${out}game-nomenu.png` });
  await browser.close();
  process.exit(1);
}
log('menu');
await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
await page.locator('[name=quality]').selectOption('low');
await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
await page.locator('#mode').selectOption('practice');
await page.locator('#opponents').selectOption('3');
await page.locator('#vehicle').selectOption(machine);
const options = await page.locator('#vehicle option').count();
const groups = await page.locator('#vehicle optgroup').count();
log(`machine options ${options} in ${groups} groups; rules: ${await page.locator('#sessionRules').textContent()}`);
await page.getByRole('button', { name: /ENTER CIRCUIT/ }).click();
for (let i = 0; i < 400; i++) {
  const d = await page.evaluate(() => window.apexDiagnostics?.());
  if (d?.state === 'driving') break;
  if (await page.locator('#raceBriefing').isVisible().catch(() => false))
    await page.getByRole('button', { name: 'GO STRAIGHT TO LIGHTS', exact: true }).click();
  await page.waitForTimeout(1000);
}
log('driving');
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}game-${machine}-1.png` });
log('shot 1');
await page.keyboard.press('c');
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}game-${machine}-2.png` });
log('shot 2');
const d = await page.evaluate(() => window.apexDiagnostics?.());
console.log('diag keys', Object.keys(d ?? {}).slice(0, 30).join(','));
console.log('errors', JSON.stringify(errors.slice(0, 10)));
await browser.close();
