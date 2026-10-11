import { finishRaceEntry } from './race-entry.ts';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import type { surveyA32 } from './fixtures/a32-pit-jacks.ts';
import manifest from '../src/rendering/a32-pit-jacks.manifest.json' with { type: 'json' };

test('A32 loads the retained GLB before ordinary practice entry', async ({ page }, info) => {
  const errors: string[] = [],
    loads: number[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.url().includes('aurel-a32-pit-jacks.glb')) loads.push(r.status());
  });
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  const loaded = await page.evaluate(() => window.apexDiagnostics());
  expect(loaded.renderer?.pitPersonnel.pitJacks).toMatchObject({
    assetId: 'A32',
    instances: 0,
    sha256: manifest.sha256,
  });
  expect(loaded.renderer?.pitPersonnel.wheelGuns?.assetId).toBe('A31');
  expect(loads).toEqual([200]);
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await finishRaceEntry(page);
  await expect
    .poll(() => page.evaluate(() => window.apexDiagnostics().state), { timeout: 90000 })
    .toBe('driving');
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => window.apexDiagnostics().workerPause))
    .toMatchObject({ pending: false, paused: true });
  await info.attach('a32-normal-startup.json', {
    body: JSON.stringify(loaded, null, 2),
    contentType: 'application/json',
  });
  await info.attach('a32-practice.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(errors).toEqual([]);
});
for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A32 actual car contact and moving service render in ${lighting}`, async ({
    page,
  }, info) => {
    // Nine full production captures and the physical service traversal exceed
    // the default five-minute test watchdog on hosted Mesa. All rendering,
    // mechanics and GPU acceptance checks remain strict.
    test.setTimeout(900000);
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      weather: lighting === 'night' ? 'rain' : 'clear',
      seed: 1887,
    });
    sim.autoPlayer = true;
    sim.cars[0].pitRequested = true;
    const samples: number[][] = [];
    let next = 0.3;
    for (let tick = 0; tick < 250 * 120; tick++) {
      sim.step(1 / 120);
      const car = sim.cars[0];
      if (car.pitPhase >= 2 && car.pitPhase <= 5 && car.pitClock >= next) {
        samples.push(Array.from(sim.makeFrame()));
        next += 0.28;
      }
      // Retain every original sample, then include the fully withdrawn jacks
      // before the unchanged 5.2-second minimum release. These are real frames.
      if (car.pitPhase === 5 && car.pitClock >= 5.15) {
        samples.push(Array.from(sim.makeFrame()));
        break;
      }
    }
    expect(samples.length).toBeGreaterThanOrEqual(16);
    const o = carBase(0),
      raised = samples.find((f) => f[o + F.JACK_HEIGHT] > 0.18)!;
    expect(raised).toBeDefined();
    for (let wheel = 0; wheel < 4; wheel++)
      expect(raised[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LOAD]).toBeLessThan(50);
    const result = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/a32-pit-jacks.ts'),
          name: 'A32Survey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (!('output' in output)) throw new Error('Missing A32 fixture output');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing A32 fixture');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.route('**/a32-survey', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>A32 circuit inspection</title>',
      }),
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/a32-survey');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      async ({ samples, lighting }) =>
        (window as unknown as { A32Survey: { surveyA32: typeof surveyA32 } }).A32Survey.surveyA32(
          samples,
          lighting,
        ),
      { samples, lighting },
    );
    for (const shot of report.images) {
      const png = Buffer.from(shot.image.split(',')[1], 'base64');
      expect(png.readUInt32BE(16)).toBe(1280);
      expect(png.readUInt32BE(20)).toBe(720);
      await info.attach(`a32-${lighting}-${shot.name}.png`, {
        body: png,
        contentType: 'image/png',
      });
      expect(shot.pixels.nonBlackFraction).toBeGreaterThan(0.2);
      expect(shot.pixels.range).toBeGreaterThan(30);
      expect(shot.addedCalls).toBeGreaterThan(0);
      expect(shot.addedCalls).toBeLessThanOrEqual(32);
    }
    await info.attach(`a32-${lighting}.json`, {
      body: JSON.stringify(
        { ...report, images: report.images.map(({ image: _image, ...row }) => row) },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(report.images).toHaveLength(9);
    expect(report.sourceUnchanged).toBe(true);
    expect(report.rewindSame).toBe(true);
    expect(report.heldUploadStable).toBe(true);
    for (const state of report.states) {
      expect(state.pitJacks?.instances).toBe(2);
      expect(state.pitJacks?.drawBatches).toBeLessThanOrEqual(8);
      expect(state.wheelGuns?.instances).toBe(4);
      expect(state.actors).toBe(15);
      expect(state.unreachableArms).toBe(0);
      expect(state.maxGripError).toBeLessThan(0.0001);
    }
    for (const c of report.contacts) {
      expect(c.error).toBeLessThan(0.00001);
      expect(c.floorError).toBeLessThan(0.00001);
    }
    // A pad must contact the car while loaded/lowering, but must follow its
    // clearance route once lowered. Neither requirement may disappear silently.
    for (const role of ['front', 'rear'] as const) {
      const contacts = report.contacts.filter((c) => c.role === role);
      const attached = contacts.filter((c) => c.state === 'contact');
      const withdrawing = contacts.filter((c) => c.state === 'withdrawing');
      expect(attached.length).toBeGreaterThan(0);
      expect(attached.some((c) => c.height > 0.18)).toBe(true);
      expect(attached.some((c) => c.phase === 5 && c.height > 1e-6)).toBe(true);
      for (const c of attached) expect(c.carContactError).toBeLessThan(0.00001);
      expect(withdrawing.length).toBeGreaterThan(0);
      for (const c of withdrawing) {
        expect(c.phase).toBe(5);
        expect(c.height).toBeLessThanOrEqual(1e-6);
        expect(c.clock).toBeGreaterThan(4.72);
        expect(Math.sign(c.observedOffset)).toBe(role === 'front' ? 1 : -1);
        expect(Math.abs(c.observedOffset - c.expectedOffset)).toBeLessThan(0.00001);
      }
      expect(withdrawing.some((c) => Math.abs(c.observedOffset) > 1.54999)).toBe(true);
    }
    expect(report.before).toEqual(report.after);
    expect(report.glError).toBe(0);
    expect(report.contextLost).toBe(false);
    expect(errors).toEqual([]);
  });
}
