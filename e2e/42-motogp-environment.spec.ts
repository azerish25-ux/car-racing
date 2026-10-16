import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { captureCircuitSurfaces } from './fixtures/motogp-environment-review.ts';

test('GP surface references: real ribbon shaders, single tyre rubber, wet holds and bounded family switches on WebGL2', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motogp-environment-review.ts'),
        name: 'MotoGPEnvironment',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing environment fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing environment fixture chunk');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const assets: Record<string, string> = {};
  for (const layer of ['asphalt', 'concrete', 'lawn', 'meadow'])
    for (const role of ['color', 'normal', 'orm']) {
      const path = `assets/third-party/ground/ground-${layer}/ground-${layer}_${role}.webp`;
      assets[path] =
        `data:image/webp;base64,${readFileSync(resolve('public', path)).toString('base64')}`;
    }
  await page.setContent(
    '<!doctype html><title>Controlled GP production surface inspection</title>',
  );
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate(
    (assets) =>
      (
        window as unknown as {
          MotoGPEnvironment: { captureCircuitSurfaces: typeof captureCircuitSurfaces };
        }
      ).MotoGPEnvironment.captureCircuitSurfaces(assets),
    assets,
  );
  for (const capture of result.captures)
    await info.attach(`${capture.name}.png`, {
      body: Buffer.from(capture.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('environment-material-metrics.json', {
    contentType: 'application/json',
    body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
  });
  expect(errors).toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.scanned.scanned).toBe(4);
  expect(result.scanned.hex).toBe(true);
  const find = (name: string) => {
    const capture = result.captures.find((entry) => entry.name === name);
    if (!capture) throw new Error(`Missing surface capture ${name}`);
    return capture;
  };
  for (const capture of result.captures) {
    expect(capture.nonzero).toBeGreaterThan(300000);
    expect(capture.calls).toBeLessThan(70);
    expect(capture.triangles).toBeLessThan(100000);
    expect(capture.rubber.cachedLayers).toBe(2);
  }
  expect(find('apex-bike-dry').hash).not.toBe(find('apex-car-dry').hash);
  expect(find('apex-bike-dry').hash).toBe(find('apex-bike-held').hash);
  expect(find('apex-bike-dry').hash).not.toBe(find('apex-bike-wet').hash);
  expect(find('apex-bike-wet').hash).toBe(find('apex-bike-wet-held').hash);
  expect(find('apex-bike-dry').hash).toBe(find('apex-bike-rewound').hash);
  expect(find('launch-bike').hash).not.toBe(find('launch-car').hash);
  expect(find('launch-bike').hash).toBe(find('launch-bike-restored').hash);
  // Camera changes legitimately upload additional culled ribbon geometries;
  // family/held/wet/rewind operations at each fixed camera may not accumulate.
  for (const name of [
    'apex-bike-dry',
    'apex-car-dry',
    'apex-bike-held',
    'apex-bike-wet',
    'apex-bike-wet-held',
    'apex-bike-rewound',
  ])
    expect(find(name).resources).toEqual(result.before);
  expect(find('launch-bike').resources).toEqual(find('launch-bike-restored').resources);
});
