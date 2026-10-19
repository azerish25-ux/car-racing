import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { captureMotocrossWorld } from './fixtures/motocross-world-review.ts';
import type { captureMotocrossTerrainControls } from './fixtures/motocross-terrain-controls.ts';

test('MX and SX production terrain loads photographed soil with correct macros and reversible wetness on WebGL2', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motocross-world-review.ts'),
        name: 'MotocrossWorld',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing motocross world fixture output');
  const script = output.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing motocross world fixture script');
  // Give the isolated scene the application's real origin so KTX2 workers
  // and all photographed assets resolve through the normal shipped loader.
  await page.route('**/motocross-world-review.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Motocross production scene with photographed-soil GPU checks</title>',
    }),
  );
  await page.goto('/motocross-world-review.html');
  await page.addScriptTag({ content: script.code });
  for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
    for (const view of ['riding', 'venue'] as const) {
      const samples = await page.evaluate(
        ({ circuit, view }) =>
          (
            window as unknown as {
              MotocrossWorld: { captureMotocrossWorld: typeof captureMotocrossWorld };
            }
          ).MotocrossWorld.captureMotocrossWorld(circuit, view),
        { circuit, view },
      );
      for (const [i, sample] of samples.entries()) {
        expect(sample.glError).toBe(0);
        expect(sample.sourceUnchanged).toBe(true);
        expect(sample.hash).not.toBe(0);
        expect(sample.bikes).toBe(8);
        expect(sample.terrainCells).toBeGreaterThan(50);
        expect(sample.soilHooks).toContain('mx-groomed-soil-v2');
        expect(sample.soilScans.active).toBe(true);
        expect(sample.soilScans.macro).toBe('dryEarth');
        expect(sample.soilScans.compiledMacroSampler).toBe('apexScanDryEarthC');
        expect(sample.soilScans.slots).toContain(sample.soilScans.macro);
        expect(sample.soilScans.store.failed).toEqual([]);
        for (const slot of sample.soilScans.slots)
          expect(sample.soilScans.store.resident).toContain(slot);
        expect(sample.calls).toBeLessThan(2000);
        expect(sample.resources).toEqual(samples[0].resources);
        if (i < 2 || i === 4)
          await info.attach(`${circuit}-${view}-${sample.label}.png`, {
            body: Buffer.from(sample.image.split(',')[1], 'base64'),
            contentType: 'image/png',
          });
      }
      expect(samples[0].hash).not.toBe(samples[1].hash);
      expect(samples[1].hash).toBe(samples[2].hash);
      expect(samples[0].hash).toBe(samples[3].hash);
      expect(samples[0].hash).toBe(samples[5].hash);
      expect(samples[0].terrainCasters).toBeGreaterThan(0);
      expect(samples[4].terrainCasters).toBe(0);
      expect(samples[0].shadowWork.calls).toBeGreaterThan(samples[4].shadowWork.calls);
      expect(samples[0].shadowWork.triangles).toBeGreaterThan(samples[4].shadowWork.triangles);
      expect(samples[0].calls).toBe(samples[4].calls);
      await info.attach(`${circuit}-${view}-metrics.json`, {
        body: JSON.stringify(samples, (key, value) => (key === 'image' ? undefined : value), 2),
        contentType: 'application/json',
      });
    }
  }
  expect(errors).toEqual([]);
});

for (const filter of ['native', 'production'] as const) {
  test(`MX and SX terrain preserves lit slopes and real jump shadows with ${filter} filtering`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/motocross-terrain-controls.ts'),
          name: 'MotocrossTerrain',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing terrain control fixture output');
    const script = output.output.find((item) => item.type === 'chunk');
    if (!script || script.type !== 'chunk')
      throw new Error('Missing terrain control fixture script');
    await page.route('**/motocross-terrain-controls.html', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Production motocross terrain controls</title>',
      }),
    );
    await page.goto('/motocross-terrain-controls.html');
    await page.addScriptTag({ content: script.code });
    for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
      const result = await page.evaluate(
        ({ circuit, filter }) =>
          (
            window as unknown as {
              MotocrossTerrain: {
                captureMotocrossTerrainControls: typeof captureMotocrossTerrainControls;
              };
            }
          ).MotocrossTerrain.captureMotocrossTerrainControls(circuit, filter),
        { circuit, filter },
      );
      // Attach the original pixels and numerical observations before asserting,
      // so a failed control remains independently diagnosable.
      for (const sample of result.samples.filter(
        (_, index) => index === 0 || index === 1 || index === 3,
      ))
        await info.attach(`${circuit}-${filter}-${sample.label}.png`, {
          body: Buffer.from(sample.image.split(',')[1], 'base64'),
          contentType: 'image/png',
        });
      for (const boundary of result.boundaries)
        await info.attach(`${circuit}-${filter}-${boundary.image.label}.png`, {
          body: Buffer.from(boundary.image.image.split(',')[1], 'base64'),
          contentType: 'image/png',
        });
      await info.attach(`${circuit}-${filter}-terrain-controls.json`, {
        body: JSON.stringify(
          result,
          (key, value) => (key === 'image' && typeof value === 'string' ? undefined : value),
          2,
        ),
        contentType: 'application/json',
      });
      expect(result.sourceUnchanged).toBe(true);
      expect(result.productionFilterInstalled).toBe(filter === 'production');
      expect(result.lit.count).toBeGreaterThanOrEqual(10);
      expect(result.occluded.count).toBeGreaterThanOrEqual(8);
      expect(result.lit.meanAbsoluteChange).toBeLessThan(0.025);
      expect(result.occluded.medianDarkening).toBeGreaterThan(0.04);
      expect(result.hooks).toContain('mx-terrain-receiver-plane-v1');
      expect(result.scans.failed).toEqual([]);
      for (const sample of result.samples) {
        expect(sample.glError).toBe(0);
        expect(sample.resources).toEqual(result.samples[0].resources);
        expect(sample.calls).toBe(result.samples[0].calls);
      }
      expect(result.samples[0].hash).toBe(result.samples[2].hash);
      expect(result.samples[3].hash).toBe(result.samples[4].hash);
      expect(result.samples[0].hash).toBe(result.samples[5].hash);
      expect(result.samples[0].hash).not.toBe(result.samples[1].hash);
      expect(result.samples[0].hash).not.toBe(result.samples[3].hash);
      expect(result.samples[0].shadowWork.calls).toBeGreaterThan(0);
      expect(result.samples[1].shadowWork.calls).toBe(0);
      expect(result.samples[0].shadowWork.triangles).toBeGreaterThan(0);
      expect(result.samples[1].shadowWork.triangles).toBe(0);
      for (const boundary of result.boundaries) {
        expect(boundary.crossingSpreadM).toBeGreaterThan(0.15);
        expect(boundary.crossingSpreadM).toBeLessThan(2.5);
        for (const site of boundary.samples)
          expect(Math.abs(site.fraction - 0.5)).toBeLessThan(0.04);
        expect(boundary.image.glError).toBe(0);
      }
    }
    expect(errors).toEqual([]);
  });
}
