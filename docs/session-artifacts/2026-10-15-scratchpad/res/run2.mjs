import { build } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/node_modules/vite/dist/node/index.js';
import { chromium } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/node_modules/playwright/index.mjs';
const built = await build({ configFile: false, logLevel: 'error', build: { write: false, cssCodeSplit: false, lib: { entry: '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/res/fixture.ts', name: 'Fx', formats: ['iife'] } } });
const result = Array.isArray(built) ? built[0] : built;
const code = result.output.find((o) => o.type === 'chunk').code;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.setContent('<!doctype html><title>res</title>');
await page.addScriptTag({ content: code });
await page.evaluate(() => window.Fx.mount());
await page.waitForSelector('[data-fest="continue"]');
const N = 20;
for (const hold of [0, 40, 80]) {
  const before = await page.evaluate(() => window.log.length);
  for (let i = 0; i < N; i++) {
    let box = null; while (!box) box = await page.locator('[data-fest="continue"]').boundingBox().catch(() => null);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    if (hold) await page.waitForTimeout(hold);
    await page.mouse.up();
    await page.waitForTimeout(30);
  }
  const n = (await page.evaluate(() => window.log.length)) - before;
  console.log('hold', hold, 'ms: CONTINUE clicks registered', n, 'of', N);
}
await browser.close();
