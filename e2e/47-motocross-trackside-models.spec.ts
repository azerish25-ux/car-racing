import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import { MX_TRACKSIDE_MODELS } from '../src/rendering/offroad/mx-trackside-models.ts';
import type { captureMxTracksideModel } from './fixtures/mx-trackside-model-review.ts';

test('all six production MX trackside models render with complete material batches on WebGL2', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/mx-trackside-model-review.ts'),
        name: 'MxTracksideReview',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('No MX model review bundle');
  const code = output.output.find((item) => item.type === 'chunk');
  if (!code || code.type !== 'chunk') throw new Error('No MX model review code');
  // The production geometry is self-contained; no server or network origin is required.
  await page.setContent(
    '<!doctype html><title>Original MOTOBOUND trackside model inspection</title>',
  );
  await page.addScriptTag({ content: code.code });
  for (const kind of MX_TRACKSIDE_MODELS) {
    const result = await page.evaluate(
      (kind) =>
        (
          window as unknown as {
            MxTracksideReview: { captureMxTracksideModel: typeof captureMxTracksideModel };
          }
        ).MxTracksideReview.captureMxTracksideModel(kind),
      kind,
    );
    expect(result.glError).toBe(0);
    expect(result.parts).toBeGreaterThan(30);
    expect(result.modelDraws).toBeLessThanOrEqual(5);
    expect(result.triangles).toBeGreaterThan(2500);
    expect(result.triangles).toBeLessThan(6002);
    expect(result.image.length).toBeGreaterThan(25000);
    expect(result.bounds.min[1]).toBeCloseTo(0, 5);
    await info.attach(`${kind}-runtime-geometry.png`, {
      body: Buffer.from(result.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    await info.attach(`${kind}-runtime-metrics.json`, {
      body: JSON.stringify({ ...result, image: undefined }),
      contentType: 'application/json',
    });
  }
  expect(errors).toEqual([]);
});
