import { finishRaceEntry } from './race-entry.ts';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import type { surveyA33 } from './fixtures/a33-spare-wheel-set.ts';

test('A33 ships in normal startup and survives entry, pause and garage registration', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  const loaded = await page.evaluate(() => window.apexDiagnostics());
  expect(loaded.renderer?.pitPersonnel.spareWheels).toMatchObject({
    assetId: 'A33',
    capacity: 96,
    instances: 0,
  });
  expect(loaded.renderer?.environmentAssets.garage?.spareWheels).toMatchObject({
    assetId: 'A33',
    instances: 4,
  });
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
  const paused = await page.evaluate(() => window.apexDiagnostics());
  expect(paused.renderer?.pitPersonnel.spareWheels.assetId).toBe('A33');
  await info.attach('a33-startup.json', {
    body: JSON.stringify({ loaded, paused }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A33 real service motion, replay and stored wheels render in ${lighting}`, async ({
    page,
  }, info) => {
    // Full production scene capture on Mesa may take longer than the default
    // five-minute Playwright watchdog. Preserve all samples and assertions.
    test.setTimeout(720000);
    const simulation = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      weather: lighting === 'night' ? 'rain' : 'clear',
      seed: 1887,
    });
    simulation.autoPlayer = true;
    simulation.cars[0].pitRequested = true;
    const samples: number[][] = [];
    let next = 0.3;
    for (let tick = 0; tick < 250 * 120; tick++) {
      simulation.step(1 / 120);
      const c = simulation.cars[0];
      if (c.pitPhase >= 2 && c.pitPhase <= 5 && c.pitClock >= next) {
        samples.push(Array.from(simulation.makeFrame()));
        next += 0.28;
        if (next > 4.9) break;
      }
    }
    expect(samples.length).toBeGreaterThanOrEqual(16);
    const o = carBase(0),
      unloaded = samples.find((f) => f[o + F.PIT_PHASE] === 3 && f[o + F.PIT_CLOCK] > 1.7)!;
    expect(unloaded).toBeDefined();
    for (let w = 0; w < 4; w++)
      expect(unloaded[o + WHEEL_BASE + w * WHEEL_STRIDE + W.LOAD]).toBeLessThan(50);
    expect(samples[samples.length - 1][H.TIME]).toBeGreaterThan(samples[0][H.TIME] + 4);
    const result = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/a33-spare-wheel-set.ts'),
          name: 'A33Survey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (!('output' in output)) throw new Error('Missing A33 fixture output');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing A33 fixture');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.route('**/a33-survey', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>A33 real-scene survey</title>',
      }),
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/a33-survey');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      async ({ samples, lighting }) =>
        (window as unknown as { A33Survey: { surveyA33: typeof surveyA33 } }).A33Survey.surveyA33(
          samples,
          lighting,
        ),
      { samples, lighting },
    );
    for (const shot of report.images) {
      const png = Buffer.from(shot.image.split(',')[1], 'base64');
      expect(png.readUInt32BE(16)).toBe(1280);
      expect(png.readUInt32BE(20)).toBe(720);
      await info.attach(`a33-${lighting}-${shot.name}.png`, {
        body: png,
        contentType: 'image/png',
      });
    }
    await info.attach(`a33-${lighting}.json`, {
      body: JSON.stringify(
        { ...report, images: report.images.map(({ image: _image, ...rest }) => rest) },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(report.images).toHaveLength(5);
    expect(report.sourceUnchanged).toBe(true);
    expect(report.rewindSame).toBe(true);
    expect(report.heldUploadStable).toBe(true);
    expect(
      report.observations.every(
        (r) => r.spareWheels.instances === 4 && r.spareWheels.activeBatches === 1,
      ),
    ).toBe(true);
    expect(
      report.observations.every((r) => r.unreachableArms === 0 && r.maxGripError < 0.0001),
    ).toBe(true);
    expect(report.storage).toMatchObject({ assetId: 'A33', instances: 4 });
    expect(report.before).toEqual(report.after);
    expect(report.glError).toBe(0);
    expect(errors).toEqual([]);
  });
}
