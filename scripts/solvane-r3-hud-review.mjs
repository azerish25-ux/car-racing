import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const out = process.env.R3_OUT ?? 'test-results/solvane-r3';
await mkdir(out, { recursive: true });
await build({
  entryPoints: ['e2e/fixtures/solvane-hud-review.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: `${out}/hud-fixture.js`,
});
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [],
  cases = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
try {
  await page.setContent(
    '<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;background:#111d25}#app{position:relative;width:100vw;height:100vh;overflow:hidden}</style></head><body><div id=app></div></body></html>',
  );
  await page.addStyleTag({ content: await readFile(`${out}/hud-fixture.css`, 'utf8') });
  await page.addScriptTag({ content: await readFile(`${out}/hud-fixture.js`, 'utf8') });
  for (const mode of [
    'hold',
    'build',
    'recover',
    'right',
    'none',
    'autopilot',
    'offroad',
    'countdown',
    'finished',
  ]) {
    const state = await page.evaluate((m) => window.hudReview.draw(m), mode);
    const visible = ['hold', 'build', 'recover', 'right'].includes(mode);
    assert.equal(state.visible, visible, mode);
    if (visible) assert.equal(state.action, mode === 'right' ? 'hold' : mode);
    if (mode === 'right') assert.match(state.text, /RIGHT/);
    cases.push({ name: mode, passed: true, state });
  }
  for (const mode of ['menu', 'map', 'photo']) {
    await page.evaluate(() => window.hudReview.draw('hold'));
    const state = await page.evaluate((m) => window.hudReview.overlay(m), mode);
    assert.equal(state.visible, false, `${mode} hides on the same task without a status tick`);
    assert.equal(
      state.activeLabel,
      mode === 'menu' ? 'resume' : mode === 'map' ? 'mapClose' : 'photoClose',
    );
    cases.push({ name: `immediate-${mode}`, passed: true, state });
  }
  for (const [name, width, height] of [
    ['desktop', 1280, 800],
    ['portrait', 390, 844],
    ['compact', 375, 667],
    ['landscape', 844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    const state = await page.evaluate(() => window.hudReview.draw('hold'));
    assert.equal(state.visible, true);
    assert.ok(
      state.card.x >= 0 &&
        state.card.y >= 0 &&
        state.card.right <= width &&
        state.card.bottom <= height,
      `card remains inside ${name}`,
    );
    const overlap = (a, b) =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
    assert.equal(overlap(state.card, state.speed), 0, `speed readout overlap at ${name}`);
    assert.equal(overlap(state.card, state.minimap), 0, `minimap overlap at ${name}`);
    await page.screenshot({ path: `${out}/hud-${name}.png` });
    cases.push({ name: `layout-${name}`, passed: true, state });
  }
  await page.evaluate(() => window.hudReview.dispose());
  assert.equal(await page.locator('#festivalHud').count(), 0);
  cases.push({ name: 'dispose', passed: true });
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    `${out}/hud-review.json`,
    JSON.stringify(
      {
        cases,
        errors,
        passed: cases.length === 17 && !errors.length,
        componentOnly: true,
        syntheticCueCases: true,
        productionHud: true,
        font: 'system fallback (no bundled font in offline fixture)',
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
}
