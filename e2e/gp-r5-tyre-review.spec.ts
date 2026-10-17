import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureGpTyreConditions } from './fixtures/gp-r5-tyre-review.ts';

test('GP R5: actual slick, intermediate and wet tyre shader holds and rewinds with constant geometry/resources', async ({
  page,
}, info) => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/gp-r5-tyre-review.ts'),
        name: 'GpTyreReview',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw Error('Missing tyre fixture output');
  const chunk = output.output.find((e) => e.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw Error('Missing tyre fixture JavaScript');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setContent('<!doctype html><title>GP production tyre state review</title>');
  await page.addScriptTag({ content: chunk.code });
  const review = await page.evaluate(() =>
    (
      window as unknown as {
        GpTyreReview: { captureGpTyreConditions: typeof captureGpTyreConditions };
      }
    ).GpTyreReview.captureGpTyreConditions(),
  );
  expect(errors).toEqual([]);
  expect(review.captures).toHaveLength(6);
  for (const c of review.captures) {
    await info.attach(`${c.name}.png`, {
      body: Buffer.from(c.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    expect(c.glError).toBe(0);
    expect(c.geometryUnchanged).toBe(true);
    expect(c.resources).toEqual(review.prepared);
    expect(c.calls).toBeLessThan(4);
  }
  const hashes = review.captures.map((c) => c.hash);
  expect(new Set(hashes.slice(0, 4)).size).toBe(4);
  expect(hashes[3]).toBe(hashes[4]);
  expect(hashes[0]).toBe(hashes[5]);
  expect(review.captures.map((c) => c.drainage)).toEqual([0, 0, 1, 2, 2, 0]);
  await info.attach('tyre-conditions.json', {
    body: JSON.stringify(review, (k, v) => (k === 'image' ? undefined : v), 2),
    contentType: 'application/json',
  });
});
