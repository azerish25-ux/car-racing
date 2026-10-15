import { chromium } from '/home/user/Experiment-3/node_modules/@playwright/test/index.mjs';
// In-game check (DOM-level input so a starved frame loop cannot stall the clicks).
const out = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/cat-agent/';
const machine = process.argv[2] ?? 'gt10m';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const t0 = Date.now();
const log = (s) => console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', s);
await page.goto('http://127.0.0.1:4291/?dev', { timeout: 600000 });
await page.locator('#menu').waitFor({ state: 'visible', timeout: 240000 });
log('menu');
const set = (sel, value) =>
  page.evaluate(
    ([sel, value]) => {
      const n = document.querySelector(sel);
      n.value = value;
      n.dispatchEvent(new Event('input', { bubbles: true }));
      n.dispatchEvent(new Event('change', { bubbles: true }));
      return n.value;
    },
    [sel, value],
  );
const click = (text) =>
  page.evaluate((text) => {
    const b = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim().startsWith(text) && b.offsetParent,
    );
    b?.click();
    return !!b;
  }, text);
log(`mode ${await set('#mode', 'practice')} opp ${await set('#opponents', '3')} vehicle ${await set('#vehicle', machine)}`);
log('rules: ' + (await page.locator('#sessionRules').textContent()));
log('enter ' + (await click('ENTER CIRCUIT')));
let state;
for (let i = 0; i < 400; i++) {
  state = await page.evaluate(() => window.apexDiagnostics?.()?.state);
  if (state === 'driving') break;
  await click('GO STRAIGHT TO LIGHTS');
  await page.waitForTimeout(1500);
}
log('state ' + state);
await page.keyboard.press('g');
await page.waitForTimeout(15000);
const d = await page.evaluate(() => {
  const x = window.apexDiagnostics?.();
  return { state: x?.state, vehicles: x?.renderer?.vehicleBodies ?? null, speed: x?.frame?.[0] };
});
log(JSON.stringify(d));
await page.screenshot({ path: `${out}game-${machine}-1.png`, timeout: 180000 }).catch((e) => log('shot1 ' + e.message.slice(0, 60)));
log('shot 1');
await page.keyboard.press('c');
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}game-${machine}-2.png`, timeout: 180000 }).catch((e) => log('shot2 ' + e.message.slice(0, 60)));
log('shot 2');
console.log('errors', JSON.stringify(errors.slice(0, 10)));
await browser.close();
