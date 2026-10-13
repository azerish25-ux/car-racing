import { finishRaceEntry } from './race-entry.ts';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import type { surveyA31 } from './fixtures/a31-wheel-gun.ts';

test('A31 loads the real GLB before normal practice entry', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const loads: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('aurel-wheel-gun.glb')) loads.push(r.status().toString());
  });
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  const loaded = await page.evaluate(() => window.apexDiagnostics());
  expect(loaded.renderer?.pitPersonnel.wheelGuns).toMatchObject({
    assetId: 'A31',
    capacity: 48,
    instances: 0,
  });
  expect(loads).toEqual(['200']);
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
  await info.attach('a31-startup.json', {
    body: JSON.stringify(loaded, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A31 real wheel-gun contact, replay and worktop tools render in ${lighting}`, async ({
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
          entry: resolve('e2e/fixtures/a31-wheel-gun.ts'),
          name: 'A31Survey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (!('output' in output)) throw new Error('Missing A31 fixture output');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing A31 fixture');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.route('**/a31-survey', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>A31 real-scene survey</title>',
      }),
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/a31-survey');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      async ({ samples, lighting }) =>
        (window as unknown as { A31Survey: { surveyA31: typeof surveyA31 } }).A31Survey.surveyA31(
          samples,
          lighting,
        ),
      { samples, lighting },
    );
    for (const shot of report.images) {
      const png = Buffer.from(shot.image.split(',')[1], 'base64');
      expect(png.readUInt32BE(16)).toBe(1280);
      expect(png.readUInt32BE(20)).toBe(720);
      await info.attach(`a31-${lighting}-${shot.name}.png`, {
        body: png,
        contentType: 'image/png',
      });
    }
    await info.attach(`a31-${lighting}.json`, {
      body: JSON.stringify(
        { ...report, images: report.images.map(({ image: _image, ...rest }) => rest) },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(report.images).toHaveLength(9);
    expect(report.sourceUnchanged).toBe(true);
    expect(report.rewindSame).toBe(true);
    expect(report.heldUploadStable).toBe(true);
    expect(
      report.states.every((r) => r.wheelGuns?.instances === 4 && r.wheelGuns.drawBatches <= 9),
    ).toBe(true);
    expect(report.states.every((r) => r.unreachableArms === 0 && r.maxGripError < 0.0001)).toBe(
      true,
    );
    expect(report.errors.length).toBeGreaterThanOrEqual(4);
    for (const e of report.errors) {
      expect(e.position).toBeLessThan(0.002);
      expect(e.axis).toBeLessThan((0.5 * Math.PI) / 180);
      expect(e.radialClearance).toBeGreaterThan(0.0009);
    }
    expect(report.storage).toMatchObject({ assetId: 'A31', instances: 2 });
    expect(report.before).toEqual(report.after);
    expect(report.glError).toBe(0);
    expect(errors).toEqual([]);
  });
}
