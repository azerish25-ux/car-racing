/** Real Festival browser checks. Software rendering is not target-device FPS.
 * Baseline/candidate cameras, viewports, presets and frame counts are identical.
 * Fixed-camera inspections change only the camera, pause and visible UI. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { browserBackend, requireBrowserBackend } from './browser-backend.ts';
import { SOLVANE } from '../src/simulation/open-world/region-data.ts';

// Fail before launching Chromium if catalogue edits invalidate these journeys.
assert.equal(SOLVANE.events.find((e) => e.id === 'coast-to-summit')?.kind, 'road-race');
assert.equal(SOLVANE.events.find((e) => e.id === 'kestrel-drift')?.kind, 'drift-zone');

const candidate = process.env.SOLVANE_R2_CANDIDATE === '1';
const base = process.env.HORIZON_REVIEW_URL ?? 'http://127.0.0.1:5173';
const output = resolve(process.env.HORIZON_REVIEW_OUTPUT ?? 'test-results/solvane-r2');
const selected = process.env.SOLVANE_R2_VIEW ?? 'all';
const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.HORIZON_REVIEW_EXECUTABLE || undefined,
  headless: backend.headless,
  args: ['--no-sandbox', ...backend.args],
});
const report = {
  candidate,
  source: process.env.HORIZON_REVIEW_IDENTITY
    ? JSON.parse(await readFile(process.env.HORIZON_REVIEW_IDENTITY, 'utf8'))
    : null,
  browser: browser.version(),
  backend: backend.name,
  notHardwarePerformance: true,
  views: [],
  errors: [],
  failedAssets: [],
  warnings: [],
};
const configs = [
  { id: 'low-drive', quality: 'low', lighting: 'day', weather: 'clear' },
  {
    id: 'street-construction',
    quality: 'medium',
    lighting: 'day',
    weather: 'clear',
    position: [560, 8.3, -2605],
    target: [567.6, 7.9, -2591.8],
  },
  {
    id: 'night-rain',
    quality: 'medium',
    lighting: 'night',
    weather: 'rain',
    position: [552, 7, -2602],
    target: [583, 5, -2602],
  },
];
if (!['all', 'pace', ...configs.map((c) => c.id)].includes(selected))
  throw Error('Unknown R2 view');
let activePage = null;
function observe(page, id) {
  activePage = page;
  report.phase = id;
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => report.errors.push({ id, message: e.message }));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push({ id, message: m.text() });
    if (m.type() === 'warning') report.warnings.push({ id, message: m.text() });
  });
  page.on('response', (r) => {
    if (r.status() >= 400) report.failedAssets.push({ id, url: r.url(), status: r.status() });
  });
}
async function state(page) {
  return page.evaluate(() => window.horizonReview.state());
}
async function draw(page) {
  await page.evaluate(() => window.horizonReview.draw());
  await page.evaluate(() => window.horizonReview.image());
}
async function identify(page) {
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector('#world').getContext('webgl2'),
      e = gl.getExtension('WEBGL_debug_renderer_info');
    return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  });
  requireBrowserBackend(backend.name, renderer);
  return renderer;
}
async function save() {
  await writeFile(resolve(output, 'review.json'), JSON.stringify(report, null, 2) + '\n');
}
try {
  for (const c of configs.filter((c) => selected === 'all' || c.id === selected)) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    observe(page, c.id);
    await page.goto(
      `${base}/e2e/fixtures/horizon-session.html?quality=${c.quality}&vehicle=eh3&lighting=${c.lighting}&weather=${c.weather}&capture=1&frames=1`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.horizonReview?.state().draws >= 1);
    const renderer = await identify(page);
    if (c.position) {
      await page.evaluate(
        ({ position, target }) => window.horizonReview.inspect(position, target),
        c,
      );
      await page.addStyleTag({
        content: '#app > :not(canvas):not(#loading) { visibility: hidden !important; }',
      });
    }
    for (let i = 0; i < (c.lighting === 'night' ? 9 : 3); i++) {
      await page.waitForTimeout(85);
      await draw(page);
    }
    const s = await state(page);
    assert.equal(s.details?.loaded, true, 'preserve the existing detail kit');
    if (candidate) {
      assert.equal(s.street?.loaded, true, 'new street geometry must really be loaded');
      assert(s.street.planned > 300);
      assert(s.street.draws <= 15);
      if (c.id === 'low-drive') {
        assert.equal(s.street.nearInstances, 0);
        assert(s.contacts.patches > 0, 'ground contact should be visible for the grounded player');
        assert(s.contacts.triangles <= 320);
        assert.equal(s.contacts.draws, 1);
      } else assert(s.street.nearInstances + s.street.farInstances > 0);
      if (c.lighting === 'night') assert(s.lampSockets.length > 0);
    }
    await page.screenshot({ path: resolve(output, c.id + '.png'), timeout: 120000 });
    report.views.push({
      ...c,
      kind: c.position ? 'paused fixed-camera inspection' : 'production chase and HUD',
      renderer,
      state: s,
    });
    console.log(
      'R2_VIEW',
      c.id,
      JSON.stringify({ street: s.street, contacts: s.contacts, render: s.render }),
    );
    await save();
    await page.close();
  }
  if (candidate && (selected === 'all' || selected === 'pace')) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    observe(page, 'pace');
    // Coast to Summit is a race with a Start card and a real bend in its
    // initial advisory horizon. Drift zones are drive-through activities: they
    // never show race cards. See the separate keyboard drift-entry check below.
    // Uses a declared discovered save and real fast travel; no pose injection.
    await page.goto(
      `${base}/e2e/fixtures/horizon-session.html?quality=low&vehicle=tc1&lighting=day&weather=rain&discovered=all&travel=coast-to-summit&capture=1&frames=1`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.horizonReview?.state().draws >= 1);
    const renderer = await identify(page);
    await page.waitForFunction(
      () => window.horizonReview.state().status.card?.id === 'coast-to-summit',
    );
    await draw(page);
    await page.locator('#festCard [data-fest="start"]').click();
    await page.waitForFunction(() =>
      ['countdown', 'running'].includes(window.horizonReview.state().status.mode),
    );
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(150);
      await draw(page);
    }
    let s = await state(page);
    assert(s.pace, 'the actual upcoming harbour bend must produce an advisory');
    assert.equal(s.pace.wet, true);
    await page.locator('#festPace').waitFor({ state: 'visible' });
    const metrics = [];
    for (const width of [960, 390]) {
      await page.setViewportSize({ width, height: 540 });
      await draw(page);
      const layout = await page.evaluate(() => {
        const ids = ['festPace', 'festEvent', 'festRoad'];
        return ids.map((id) => {
          const e = document.getElementById(id),
            r = e.getBoundingClientRect();
          return {
            id,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            hidden: e.hidden,
            text: e.textContent,
          };
        });
      });
      const cue = layout[0];
      assert(
        cue.x >= 0 && cue.y >= 0 && cue.x + cue.width <= width + 1 && cue.y + cue.height <= 540,
      );
      const overlaps = (a, b) =>
        !a.hidden &&
        !b.hidden &&
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y;
      assert(
        !overlaps(cue, layout[1]) && !overlaps(cue, layout[2]),
        'advice must not overlap event or road panels',
      );
      await page.screenshot({ path: resolve(output, `pace-${width}.png`), timeout: 120000 });
      metrics.push({ width, layout });
    }
    await page.keyboard.press('Escape');
    await draw(page);
    await page.locator('#festPace').waitFor({ state: 'hidden' });
    await page.locator('#festMenu [data-fest="resume"]').click();
    await draw(page);
    await page.locator('#festPace').waitFor({ state: 'visible' });
    await page.evaluate(() => window.horizonReview.command({ type: 'cancel' }));
    await page.waitForFunction(() => window.horizonReview.state().status.mode === 'free');
    await draw(page);
    await page.locator('#festPace').waitFor({ state: 'hidden' });
    s = await state(page);
    assert.equal(s.pace, null);
    const before = s.memory;
    await page.keyboard.press('Escape');
    await page.locator('#festMenu [data-fest="exit"]').click();
    await page.waitForFunction(() => window.horizonReview.state().exited);
    const after = await state(page);
    assert.equal(after.street, null);
    assert.equal(after.contacts, null);
    assert(after.memory.geometries < before.geometries);
    assert.equal(after.pace, null);
    report.views.push({
      id: 'pace',
      kind: 'real event entry, responsive advice, pause/resume/cancel/exit',
      renderer,
      metrics,
      beforeExit: before,
      afterExit: after,
    });
    console.log('R2_PACE', JSON.stringify({ metrics, before, after: after.memory }));
    await save();
    await page.close();

    // Kestrel is a drive-through drift zone, not a race-card event. Enter it
    // with the real keyboard and brake before rendering the inspection frame.
    const drift = await browser.newPage({ viewport: { width: 960, height: 540 } });
    observe(drift, 'drift-entry');
    await drift.goto(
      `${base}/e2e/fixtures/horizon-session.html?quality=low&vehicle=tc1&lighting=day&weather=rain&discovered=all&travel=kestrel-drift&capture=1&frames=1`,
      { waitUntil: 'domcontentloaded' },
    );
    await drift.locator('#loading').waitFor({ state: 'hidden' });
    await drift.waitForFunction(() => window.horizonReview?.state().draws >= 1);
    const driftRenderer = await identify(drift);
    const parked = await state(drift);
    assert.equal(parked.status.card, null, 'drift zones do not have a Start card');
    assert.equal(parked.status.mode, 'free');
    await drift.keyboard.down('w');
    try {
      await drift.waitForFunction(
        () => {
          const s = window.horizonReview.state();
          return s.status.mode === 'running' && s.status.event?.id === 'kestrel-drift';
        },
        undefined,
        { timeout: 20000 },
      );
    } finally {
      await drift.keyboard.up('w');
    }
    const entered = await state(drift);
    assert.equal(entered.status.autopilot, false);
    await drift.keyboard.down('s');
    try {
      await drift.waitForFunction(
        () => window.horizonReview.state().status.speedKmh < 1,
        undefined,
        { timeout: 20000 },
      );
    } finally {
      await drift.keyboard.up('s');
    }
    await draw(drift);
    const stopped = await state(drift);
    const distanceM = Math.hypot(
      stopped.player.x - parked.player.x,
      stopped.player.z - parked.player.z,
    );
    assert(distanceM > 1, 'drive-through entry requires measured physical movement');
    assert.equal(stopped.status.event?.id, 'kestrel-drift');
    assert.equal(stopped.pace?.wet, true);
    await drift.locator('#festPace').waitFor({ state: 'visible' });
    await drift.screenshot({ path: resolve(output, 'drift-entry.png'), timeout: 120000 });
    await drift.evaluate(() => window.horizonReview.command({ type: 'cancel' }));
    await drift.waitForFunction(() => window.horizonReview.state().status.mode === 'free');
    await draw(drift);
    assert.equal((await state(drift)).pace, null);
    await drift.locator('#festPace').waitFor({ state: 'hidden' });
    await drift.keyboard.press('Escape');
    await drift.locator('#festMenu [data-fest="exit"]').click();
    await drift.waitForFunction(() => window.horizonReview.state().exited);
    const disposed = await state(drift);
    assert.equal(disposed.street, null);
    assert.equal(disposed.contacts, null);
    report.views.push({
      id: 'drift-entry',
      kind: 'keyboard drive-through start, brake, cancel and exit',
      renderer: driftRenderer,
      distanceM,
      entryKmh: entered.status.speedKmh,
      stoppedKmh: stopped.status.speedKmh,
      cue: stopped.pace,
      afterExit: disposed,
    });
    await save();
    await drift.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedAssets, []);
  assert(
    !report.warnings.some((w) =>
      /street detail fallback|authored detail fallback/i.test(w.message),
    ),
  );
  report.completed = true;
} catch (error) {
  report.failure = String(error.stack ?? error);
  // Preserve actual worker/HUD state on failure instead of only a timeout.
  if (activePage && !activePage.isClosed()) {
    let timer;
    try {
      report.failureState = await Promise.race([
        state(activePage),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Diagnostic state timed out')), 5000);
        }),
      ]);
    } catch (diagnostic) {
      report.diagnosticFailure = String(diagnostic);
    } finally {
      clearTimeout(timer);
    }
  }
  throw error;
} finally {
  await save();
  await browser.close();
}
