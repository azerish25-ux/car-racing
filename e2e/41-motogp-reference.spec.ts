import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureBike, captureBikeSequence } from './fixtures/motogp-reference-review.ts';

function expectPrepared(result: ReturnType<typeof captureBike>) {
  expect(result.preparation).toHaveLength(3);
  for (const sample of result.preparation) {
    expect(sample.wet).toBe(false);
    expect(sample.time).toBe(2);
    expect(sample.sourceFrameUnchanged).toBe(true);
  }
  // The second and third identical dry draws must have settled before any
  // measured weather transition; no growing-resource tolerance is introduced.
  expect(result.preparation[2].resources).toEqual(result.preparation[1].resources);
  expect(result.preparation[2].addedPrograms).toEqual([]);
  expect(result.resources).toEqual(result.preparation[2].resources);
}

test('GP reference R1.1: authored LODs, production onboard and same-instance wet rewind on WebGL2', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motogp-reference-review.ts'),
        name: 'MotoGPReview',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing GP GPU fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GP GPU fixture chunk');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent(
    '<!doctype html><title>GP reference R1.1 production-model GPU contracts</title>',
  );
  await page.addScriptTag({ content: chunk.code });
  const cases = [
    { id: 'gpr1', detail: 'high', wet: false },
    { id: 'gpr1', detail: 'mid', wet: false },
    { id: 'gpr1', detail: 'far', wet: false },
    { id: 'gpr2', detail: 'high', wet: false },
    { id: 'gpr1', detail: 'high', wet: true },
    { id: 'gpr1', detail: 'high', wet: false },
  ] as const;
  const hashes: number[] = [],
    triangleCounts: number[] = [];
  for (const [i, c] of cases.entries()) {
    const result = await page.evaluate(
      (c) =>
        (
          window as unknown as { MotoGPReview: { captureBike: typeof captureBike } }
        ).MotoGPReview.captureBike('three-quarter', c.detail, c.id, c.wet),
      c,
    );
    await info.attach(`${i}-${c.id}-${c.detail}-${c.wet ? 'wet' : 'dry'}.png`, {
      body: Buffer.from(result.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    await info.attach(`${i}-metrics.json`, {
      body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
      contentType: 'application/json',
    });
    expectPrepared(result);
    expect(result.glError).toBe(0);
    expect(result.hash).not.toBe(0);
    expect(result.calls).toBeLessThan(220);
    expect(result.triangles).toBeLessThan(110000);
    expect(result.weather.materialRoles.leather).toBeGreaterThan(0);
    expect(result.weather.materialRoles.rubber).toBeGreaterThan(0);
    expect(result.weather.dampness).toBe(c.wet ? 1 : 0);
    hashes.push(result.hash);
    triangleCounts.push(result.triangles);
  }
  // Use the production onboard mount and lens, not a convenient exterior angle.
  for (const id of ['gpr1', 'gpr2', 'sbk1000', 'ss600']) {
    const result = await page.evaluate(
      (id) =>
        (
          window as unknown as { MotoGPReview: { captureBike: typeof captureBike } }
        ).MotoGPReview.captureBike('onboard', 'high', id, false),
      id,
    );
    await info.attach(`${id}-production-onboard.png`, {
      body: Buffer.from(result.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    await info.attach(`${id}-onboard-contract.json`, {
      body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
      contentType: 'application/json',
    });
    expectPrepared(result);
    expect(result.glError).toBe(0);
    expect(result.cockpit?.facing).toBeGreaterThan(0.7);
    expect(result.cockpit?.visibleSamples).toBe(9);
    for (const [x, y, z] of result.cockpit!.corners) {
      expect(Math.abs(x)).toBeLessThan(0.95);
      expect(Math.abs(y)).toBeLessThan(0.95);
      expect(z).toBeGreaterThan(-1);
      expect(z).toBeLessThan(1);
    }
  }
  // A new construction is not evidence of weather reversal. Retain one bike,
  // material set and renderer through wet, held-frame and rewound dry states.
  const sequence = await page.evaluate(() =>
    (
      window as unknown as {
        MotoGPReview: { captureBikeSequence: typeof captureBikeSequence };
      }
    ).MotoGPReview.captureBikeSequence('three-quarter', 'high', 'gpr1', [
      { wet: false, time: 2 },
      { wet: true, time: 10 },
      { wet: true, time: 10 },
      { wet: false, time: 2 },
    ]),
  );
  expect(sequence).toHaveLength(4);
  const samples = [];
  for (const [i, { image, ...sample }] of sequence.entries()) {
    await info.attach(`same-instance-weather-${i}.png`, {
      body: Buffer.from(image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    samples.push(sample);
    expectPrepared({ image, ...sample });
    expect(sample.glError).toBe(0);
    expect(sample.sourceFrameUnchanged).toBe(true);
    expect(sample.instance).toBe(sequence[0].instance);
    expect(sample.resources).toEqual(sequence[0].resources);
  }
  expect(sequence[0].hash).not.toBe(sequence[1].hash);
  expect(sequence[1].hash).toBe(sequence[2].hash);
  expect(sequence[0].hash).toBe(sequence[3].hash);
  await info.attach('same-instance-weather-metrics.json', {
    body: JSON.stringify(samples, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(triangleCounts[0]).toBeGreaterThan(triangleCounts[1]);
  expect(triangleCounts[1]).toBeGreaterThan(triangleCounts[2]);
  expect(hashes[0]).not.toBe(hashes[4]);
  expect(hashes[0]).toBe(hashes[5]);
});
