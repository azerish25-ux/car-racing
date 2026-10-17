import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { captureMotocrossWorld } from './fixtures/motocross-world-review.ts';

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
        expect(sample.soilHooks).toContain('mx-groomed-soil-v1');
        expect(sample.soilScans.active).toBe(true);
        expect(sample.soilScans.macro).toBe(circuit === 'valley-ridge-mx' ? 'forest' : 'dryEarth');
        expect(sample.soilScans.compiledMacroSampler).toBe(
          circuit === 'valley-ridge-mx' ? 'apexScanForestC' : 'apexScanDryEarthC',
        );
        expect(sample.soilScans.slots).toContain(sample.soilScans.macro);
        expect(sample.soilScans.store.failed).toEqual([]);
        for (const slot of sample.soilScans.slots)
          expect(sample.soilScans.store.resident).toContain(slot);
        expect(sample.calls).toBeLessThan(2000);
        expect(sample.resources).toEqual(samples[0].resources);
        if (i < 2)
          await info.attach(`${circuit}-${view}-${sample.label}.png`, {
            body: Buffer.from(sample.image.split(',')[1], 'base64'),
            contentType: 'image/png',
          });
      }
      expect(samples[0].hash).not.toBe(samples[1].hash);
      expect(samples[1].hash).toBe(samples[2].hash);
      expect(samples[0].hash).toBe(samples[3].hash);
      await info.attach(`${circuit}-${view}-metrics.json`, {
        body: JSON.stringify(samples, (key, value) => (key === 'image' ? undefined : value), 2),
        contentType: 'application/json',
      });
    }
  }
  expect(errors).toEqual([]);
});
