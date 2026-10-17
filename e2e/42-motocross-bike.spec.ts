import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureMotocrossBike } from './fixtures/motocross-bike-review.ts';

test('Motocross reference R2: production bikes, reachable riding poses and reversible mud on WebGL2', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motocross-bike-review.ts'),
        name: 'MotocrossReview',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing motocross GPU fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing motocross GPU fixture chunk');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>Motocross production-model GPU review</title>');
  await page.addScriptTag({ content: chunk.code });
  const capture = (options: {
    id: string;
    detail: 'high' | 'mid' | 'far';
    view?: string;
    samples?: Parameters<typeof captureMotocrossBike>[3];
  }) =>
    page.evaluate(
      (c) =>
        (
          window as unknown as {
            MotocrossReview: { captureMotocrossBike: typeof captureMotocrossBike };
          }
        ).MotocrossReview.captureMotocrossBike(c.id, c.detail, c.view, c.samples),
      options,
    );
  const attach = async (name: string, result: ReturnType<typeof captureMotocrossBike>[number]) => {
    await info.attach(`${name}.png`, {
      body: Buffer.from(result.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    await info.attach(`${name}-metrics.json`, {
      body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
      contentType: 'application/json',
    });
    expect(result.glError).toBe(0);
    expect(result.finiteGeometry).toBe(true);
    expect(result.hash).not.toBe(0);
    expect(result.calls).toBeLessThan(200);
    expect(result.triangles).toBeLessThan(130000);
    expect(result.bounds.min.y).toBeGreaterThan(-0.006);
    for (const contact of result.contacts) {
      // Bone endpoints carry a deliberate 2 cm wrist/ankle offset; anything
      // beyond 3 cm is lost reach rather than that geometric inset.
      expect(contact.handError).toBeLessThan(0.03);
      expect(contact.ankleError).toBeLessThan(0.03);
    }
  };
  for (const id of ['mx450', 'mx250']) {
    const triangles: number[] = [];
    for (const detail of ['high', 'mid', 'far'] as const) {
      const [result] = await capture({ id, detail });
      await attach(`${id}-${detail}`, result);
      triangles.push(result.triangles);
      expect(result.bounds.max.z - result.bounds.min.z).toBeLessThan(2.55);
    }
    expect(triangles[0]).toBeGreaterThan(triangles[1]);
    expect(triangles[1]).toBeGreaterThan(triangles[2]);
  }
  for (const [name, view, sample] of [
    ['standing-side', 'side', { standing: 1, body: 0.6 }],
    ['braced-front', 'front', { standing: 1, body: -0.8, steer: 0.12 }],
    ['inside-foot-dab', 'front', { dab: 1, lean: 0.55, steer: 0.12 }],
    ['rear-components', 'rear', { standing: 0.45 }],
    ['helmet-and-gear', 'helmet', {}],
  ] as const) {
    const [result] = await capture({ id: 'mx450', detail: 'high', view, samples: [sample] });
    await attach(name, result);
  }
  for (const id of ['mx250', 'mx450']) {
    const samples = await capture({
      id,
      detail: 'high',
      view: 'onboard',
      samples: [
        { speed: 0 },
        { standing: 1, body: 0.7, steer: 0.12, speed: 25 },
        { standing: 1, body: -0.8, brake: 0.9, lean: 0.35, steer: -0.18, speed: 30 },
      ],
    });
    for (const [pose, result] of samples.entries()) {
      await attach(`${id}-production-onboard-${pose}`, result);
      const cockpit = result.cockpit;
      expect(cockpit).not.toBeNull();
      expect(cockpit!.headVisible).toBe(false);
      expect(cockpit!.torsoVisible).toBe(false);
      expect(cockpit!.handsVisible).toEqual([true, true]);
      for (const [x, y] of cockpit!.sleeveEntries)
        expect(y < -0.95 || Math.abs(x) > 0.98).toBe(true);
      expect(cockpit!.visibleControls).toBe(3);
      expect(cockpit!.clearForwardSamples).toBe(15);
      for (const control of cockpit!.controls) {
        const [x, y, z] = control.ndc;
        expect(Math.abs(x)).toBeLessThan(0.95);
        expect(Math.abs(y)).toBeLessThan(0.95);
        expect(z).toBeGreaterThan(-1);
        expect(z).toBeLessThan(1);
      }
    }
  }
  const sequence = await capture({
    id: 'mx450',
    detail: 'high',
    view: 'three-quarter',
    samples: [{}, { mud: 0.9, wet: 0.55 }, { mud: 0.9, wet: 0.55 }, {}],
  });
  for (const [i, result] of sequence.entries()) {
    await attach(`same-instance-mud-${i}`, result);
    expect(result.instance).toBe(sequence[0].instance);
    expect(result.resources).toEqual(sequence[0].resources);
  }
  expect(sequence[0].hash).not.toBe(sequence[1].hash);
  expect(sequence[1].hash).toBe(sequence[2].hash);
  expect(sequence[0].hash).toBe(sequence[3].hash);
  expect(errors).toEqual([]);
});
