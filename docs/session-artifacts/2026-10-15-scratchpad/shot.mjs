import { chromium } from '/home/user/Experiment-3/node_modules/playwright-core/index.mjs';
const out = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/shots';
const url = process.env.URL ?? 'http://127.0.0.1:5199/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 800), height: Number(process.env.H ?? 450) } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
const t0 = Date.now();
const stamp = (label) => console.log(((Date.now() - t0) / 1000).toFixed(1), label);
await page.goto(url);
await page.waitForSelector('#menu:not([hidden])', { timeout: 240000 });
stamp('menu');
if (process.env.PRE) console.log('PRE', await page.evaluate(process.env.PRE));
await page.selectOption('#mode', 'festival');
await page.evaluate(() => document.getElementById('sessionForm').requestSubmit());
const watch = setInterval(async () => {
  try {
    stamp(await page.evaluate(() => document.getElementById('loadingText')?.textContent ?? ''));
  } catch {}
}, 10000);
try {
  await page.waitForSelector('#festivalHud', { timeout: Number(process.env.HUD_TIMEOUT ?? 240000) });
  await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, { timeout: 400000 });
} catch (e) {
  console.log('FAILED waiting', e.message.split('\n')[0]);
  console.log(logs.slice(-60).join('\n'));
  await page.screenshot({ path: `${out}/fail.png`, timeout: 240000 }).catch(() => {});
  await browser.close();
  process.exit(1);
}
clearInterval(watch);
stamp('festival');
await page.waitForTimeout(Number(process.env.WAIT ?? 4000));
await page.screenshot({ path: `${out}/f1.png`, timeout: 240000 });
stamp('shot1');
const steps = (process.env.STEPS ?? '').split(',').filter(Boolean);
let n = 2;
for (const step of steps) {
  const [kind, arg, ms] = step.split(':');
  if (kind === 'hold') {
    await page.keyboard.down(arg);
    await page.waitForTimeout(Number(ms));
    await page.keyboard.up(arg);
  } else if (kind === 'press') await page.keyboard.press(arg);
  else if (kind === 'wait') await page.waitForTimeout(Number(arg));
  else if (kind === 'click') await page.click(arg, { timeout: 120000 });
  else if (kind === 'shot') {
    await page.screenshot({ path: `${out}/f${n++}.png`, timeout: 240000 });
    stamp(`shot${n - 1}`);
  } else if (kind === 'eval') console.log(await page.evaluate(arg));
}
console.log(logs.slice(-30).join('\n'));
await browser.close();
