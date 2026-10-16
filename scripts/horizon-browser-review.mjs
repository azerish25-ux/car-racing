/** Real festival worker/input/rendering journey. Run against `npm run dev`,
 * or a production review build that includes e2e/fixtures/horizon-session.html.
 * Still frames pause GPU submissions after boot; simulation and real input
 * continue normally. This is functional evidence, not a frame-rate benchmark. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const baseURL = process.env.HORIZON_REVIEW_URL ?? 'http://127.0.0.1:5173';
const output = resolve(process.env.HORIZON_REVIEW_OUTPUT ?? 'test-results/horizon-review');
const quality = process.env.HORIZON_REVIEW_QUALITY ?? 'low';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(300000);
const errors = [],
  failedAssets = [],
  steps = [];
let phase = 'load',
  sourceIdentity = null,
  renderer = null;
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('response', (response) => {
  if (response.status() >= 400)
    failedAssets.push({ status: response.status(), url: response.url() });
});
const state = () => page.evaluate(() => window.horizonReview.state());
const pass = (name, details = {}) => {
  steps.push({ name, passed: true, ...details });
  console.log('PASS', name, JSON.stringify(details));
};
async function draw() {
  await page.evaluate(() => window.horizonReview.draw());
  // Readback drains the software GPU queue before Chromium captures the DOM.
  await page.evaluate(() => window.horizonReview.image());
}
async function capture(name) {
  await draw();
  await page.screenshot({ path: resolve(output, `${name}.png`), timeout: 90000 });
}
try {
  const identityResponse = await page.request.get(`${baseURL}/BUILD_IDENTITY.json`);
  if (identityResponse.ok()) {
    try {
      sourceIdentity = await identityResponse.json();
    } catch {
      /* Development server has no build identity. */
    }
  }
  await page.goto(
    `${baseURL}/e2e/fixtures/horizon-session.html?quality=${quality}&vehicle=tc1&capture=1&frames=1`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.horizonReview?.state().draws >= 1);
  const initial = await state();
  assert.equal(initial.status.vehicleId, 'tc1');
  assert(initial.status.discovered.includes('harbour-welcome'));
  assert(
    initial.status.discovered.length < 16,
    'This journey must use natural discoveries, not a fully unlocked save.',
  );
  renderer = await page.evaluate(() => {
    const gl = document.querySelector('#world').getContext('webgl2');
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
  });
  pass('real session boot and natural harbour discovery', {
    discoveries: initial.status.discovered,
    renderer,
  });

  phase = 'manual driving';
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.horizonReview.state().status.speedKmh > 15, undefined, {
    timeout: 20000,
  });
  await page.keyboard.up('w');
  const moving = await state();
  await draw();
  await page.keyboard.down('s');
  await page.waitForFunction(() => window.horizonReview.state().status.speedKmh < 1, undefined, {
    timeout: 20000,
  });
  await page.keyboard.up('s');
  const stopped = await state();
  const distance = Math.hypot(
    stopped.player.x - initial.player.x,
    stopped.player.z - initial.player.z,
  );
  assert(distance > 3);
  assert.equal(stopped.status.autopilot, false);
  pass('keyboard throttle, rendered movement and braking', {
    distanceM: distance,
    movingKmh: moving.status.speedKmh,
    stoppedKmh: stopped.status.speedKmh,
  });

  phase = 'map and pause';
  await page.keyboard.press('t');
  await page.locator('#festMap').waitFor({ state: 'visible' });
  assert.equal((await state()).paused, true);
  await page.locator('[data-fest="mapFilter"][data-value="races"]').click();
  await page.locator('[data-fest="mapSelect"][data-value="coast-to-summit"]').click();
  assert.equal(
    await page.locator('#festMapDetail [data-fest="travel"]').count(),
    0,
    'Undiscovered events must not allow fast travel.',
  );
  await capture('journey-map');
  await page.keyboard.press('Escape');
  await page.locator('#festMenu').waitFor({ state: 'visible' });
  pass('world map route preview, discovery gate and return to pause menu');

  phase = 'photo';
  await page.locator('[data-fest="photo"]').click();
  await page.locator('#festPhoto').waitFor({ state: 'visible' });
  const photoStart = await state();
  await page.locator('[data-fest="photoRight"]').click();
  await page.locator('[data-fest="photoRight"]').click();
  await capture('journey-photo');
  const photoEnd = await state();
  assert.equal(photoEnd.paused, true);
  assert(
    Math.hypot(...photoEnd.position.map((value, index) => value - photoStart.position[index])) > 1,
  );
  assert(Math.abs(photoEnd.status.time - photoStart.status.time) < 0.3);
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => !window.horizonReview.state().paused && !window.horizonReview.state().photo,
  );
  pass('paused photo orbit and Escape return', {
    cameraTravelM: Math.hypot(
      ...photoEnd.position.map((value, index) => value - photoStart.position[index]),
    ),
  });

  phase = 'garage round trip';
  for (const vehicle of ['apx01', 'rh3', 'tc1']) {
    await page.keyboard.press('Escape');
    await page.locator(`[data-fest="vehicle"][data-value="${vehicle}"]`).click();
    await page.waitForFunction(
      (id) => window.horizonReview.state().status.vehicleId === id,
      vehicle,
    );
    await draw();
    assert.equal((await state()).paused, false);
  }
  pass('garage Formula to road-car round trip through real worker and renderer');

  phase = 'travel and event entry';
  await page.keyboard.press('Escape');
  await page.locator('#festMenu [data-fest="travel"][data-value="harbour-welcome"]').click();
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => window.horizonReview.state().status.card?.id === 'harbour-welcome',
  );
  await draw();
  await page.locator('#festCard [data-fest="start"]').click();
  await page.waitForFunction(() =>
    ['countdown', 'running'].includes(window.horizonReview.state().status.mode),
  );
  await page.keyboard.press('g');
  await page.waitForFunction(
    () =>
      window.horizonReview.state().status.mode === 'running' &&
      window.horizonReview.state().status.autopilot,
  );
  await capture('journey-event');
  pass('discovered-event travel, start card, countdown, real rivals and route presentation');

  phase = 'race to result';
  let finished = false;
  for (let check = 0; check < 40; check++) {
    const current = await state();
    if (current.status.mode === 'finished') {
      finished = true;
      break;
    }
    console.log(
      'RACE',
      JSON.stringify({
        elapsed: current.status.event?.elapsed,
        progress: current.status.event?.progress,
        mode: current.status.mode,
      }),
    );
    await page.waitForTimeout(10000);
  }
  assert(finished, 'Harbour race must finish within the bounded review window.');
  const resultState = await state();
  assert.equal(resultState.results.length, 1);
  const result = resultState.results[0];
  assert.equal(result.eventId, 'harbour-welcome');
  assert.equal(result.completed, true);
  assert.equal(result.assisted, true, 'Autopilot verification must be marked assisted.');
  await capture('journey-results');
  pass('one typed completed result and visible results card', { result });
  await page.locator('#festResults [data-fest="continue"]').click();
  await page.waitForFunction(() => window.horizonReview.state().status.mode === 'free');
  await draw();
  pass('results Continue returns to free roam');

  phase = 'exit';
  await page.keyboard.press('Escape');
  const beforeExit = await state();
  await page.locator('[data-fest="exit"]').click();
  await page.waitForFunction(() => window.horizonReview.state().exited);
  const exited = await state();
  assert.equal(await page.locator('#festivalHud').count(), 0);
  assert.equal(exited.ready, false);
  assert(exited.memory.geometries < beforeExit.memory.geometries);
  pass('session exit removes HUD, terminates session and releases geometry', {
    before: beforeExit.memory,
    after: exited.memory,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(failedAssets, []);
  phase = 'complete';
} catch (error) {
  steps.push({ name: phase, passed: false, error: error.stack ?? String(error) });
  console.error('FAILED', phase, error);
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(output, 'journey.json'),
    JSON.stringify(
      {
        version: 1,
        completed: phase === 'complete',
        sourceIdentity,
        renderer,
        quality,
        viewport: { width: 960, height: 540 },
        methodology:
          'Real FestivalSession, workers, InputController and renderer. Natural initial discoveries. GPU submissions held between deliberate rendered states for software-GPU readback; no simulation acceleration. Manual keyboard launch/brake; race completion uses explicitly assisted production autopilot. This is not a hardware performance test.',
        errors,
        failedAssets,
        steps,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
