import { chromium } from '/home/user/Experiment-3/node_modules/@playwright/test/index.mjs';
const out = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/cat-agent/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.env.URL ?? 'http://127.0.0.1:4291/?dev', { timeout: 600000 });
await page.locator('#menu').waitFor({ state: 'visible', timeout: 240000 });
await page.waitForTimeout(3000);
// screenshot skipped
const info = await page.evaluate(() => {
  const b = document.querySelector('[data-action="settings"]');
  const chain = [];
  for (let n = b; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    chain.push(`${n.tagName}#${n.id}.${n.className} d=${cs.display} v=${cs.visibility} o=${cs.opacity} hidden=${n.hidden} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const vehicle = document.querySelector('#vehicle');
  return {
    chain,
    vehicle: vehicle ? vehicle.outerHTML.slice(0, 600) : null,
    rules: document.querySelector('#sessionRules')?.textContent,
  };
});
console.log(JSON.stringify(info, null, 1));
console.log('errors', JSON.stringify(errors));
await browser.close();
