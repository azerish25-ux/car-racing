import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureWetRace } from './fixtures/wet-presentation.ts';

test('rain is directional geometry with fog, occlusion and near-plane safety', async ({
  page,
}, info) => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve('e2e/fixtures/wet-presentation.ts'),
        name: 'APEXWeatherTest',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Missing rain fixture bundle');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing rain fixture entry');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setContent('<!doctype html><title>Rain projection GPU oracle</title>');
  await page.addScriptTag({ content: chunk.code });
  const measured = await page.evaluate(() =>
    (
      window as unknown as {
        APEXWeatherTest: {
          verifyRainStreakGPU: typeof import('./fixtures/wet-presentation.ts').verifyRainStreakGPU;
        };
      }
    ).APEXWeatherTest.verifyRainStreakGPU(),
  );
  const { verticalImage, ...metrics } = measured;
  await info.attach('rain-gpu-metrics.json', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  await info.attach('isolated-rain-streak.png', {
    body: Buffer.from(verticalImage.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
  expect(measured.vertical.changed).toBeGreaterThan(5);
  expect(measured.vertical.height).toBeGreaterThan(measured.vertical.width * 3);
  expect(measured.wind.covariance).toBeLessThan(-10);
  expect(measured.rolled.width).toBeGreaterThan(measured.rolled.height * 3);
  expect(measured.fogged.energy).toBeLessThan(measured.vertical.energy * 0.1);
  for (const field of ['occluded', 'near', 'behind', 'cleared'] as const)
    expect(measured[field].changed, field).toBe(0);
  expect(measured.glError).toBe(0);
  expect(errors).toEqual([]);
});

test('wet race presentation survives moving frames and held chase, cockpit and trackside review', async ({
  page,
}, info) => {
  // Nineteen high-quality wet frames and three held production-camera reviews
  // are GPU-limited on hosted SwiftShader. This is an evidence timeout, not a
  // frame-time or performance acceptance threshold; retain every assertion.
  test.setTimeout(900000);
  const bundled = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/wet-presentation.ts'),
        name: 'WetRaceProbe',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in output)) throw new Error('Missing wet race fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing wet race fixture entry');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.text().startsWith('[wet-probe]')) console.info(m.text());
  });
  await page.setViewportSize({ width: 960, height: 540 });
  await page.setContent('<!doctype html><title>Phase 27 dynamic wet-race review</title>');
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as { WetRaceProbe: { captureWetRace: typeof captureWetRace } }
    ).WetRaceProbe.captureWetRace(),
  );
  for (const capture of result.captures)
    await info.attach(`wet-${capture.view}.png`, {
      body: Buffer.from(capture.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('wet-race-metrics.json', {
    body: JSON.stringify(
      {
        ...result,
        errors,
        captures: result.captures.map(({ image: _image, ...metrics }) => metrics),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.finite).toBe(true);
  expect(result.sourceUnchanged).toBe(true);
  expect(result.speed).toBeGreaterThan(5);
  expect(result.rain).toBeGreaterThan(0);
  expect(result.held.active[0]).toBeGreaterThan(0);
  expect(result.held.active[3]).toBeGreaterThan(0);
  expect(result.after).toEqual(result.held);
  expect(result.captures).toHaveLength(3);
  for (const capture of result.captures) {
    expect(capture.draws).toBeGreaterThan(10);
    expect(capture.triangles).toBeGreaterThan(10000);
    expect(capture.image.length).toBeGreaterThan(20000);
  }
});
