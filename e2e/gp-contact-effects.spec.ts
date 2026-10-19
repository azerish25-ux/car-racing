import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type * as Fixture from './fixtures/gp-contact-effects.ts';

declare global {
  interface Window {
    GpContactEffectsFixture: typeof Fixture;
  }
}

test('GP contact effects use two actual tyres, readable moving spray and fixed WebGL resources', async ({
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
        entry: resolve('e2e/fixtures/gp-contact-effects.ts'),
        name: 'GpContactEffectsFixture',
        formats: ['iife'],
      },
    },
  });
  const bundle = Array.isArray(built) ? built[0] : built;
  if (!('output' in bundle)) throw new Error('Missing GP contact effects fixture bundle');
  const script = bundle.output.find((entry) => entry.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing GP contact effects script');
  await page.setContent('<!doctype html><title>GP tyre contact effects</title>');
  await page.addScriptTag({ content: script.code });
  const report = await page.evaluate(() =>
    window.GpContactEffectsFixture.captureGpContactEffects(),
  );
  for (const capture of report.images)
    await info.attach(`${capture.name}.png`, {
      body: Buffer.from(capture.image.slice(capture.image.indexOf(',') + 1), 'base64'),
      contentType: 'image/png',
    });
  const { images: _images, ...metrics } = report;
  await info.attach('gp-contact-effects-metrics.json', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  expect(report.webgl2).toBe(true);
  expect(report.shaderErrors).toEqual([]);
  expect(report.glErrors).toEqual([]);
  expect(errors).toEqual([]);
  expect(report.wetCounts.gp).toBeGreaterThan(10);
  expect(report.wetCounts.gp).toBeLessThan(report.wetCounts.legacy * 0.6);
  expect(new Set(report.wetBirths.map((birth) => birth.wheel))).toEqual(new Set([0, 2]));
  for (const birth of report.wetBirths) {
    expect(birth.plume).toBe(false);
    expect(birth.x).toBeCloseTo(0, 5);
    expect(birth.y).toBeCloseTo(0.035, 5);
    expect(birth.floor).toBeCloseTo(0, 5);
    // GP-R1's actual axle locations, not Formula's ±0.83 / +1.82 / −1.62 m.
    expect(birth.z).toBeCloseTo(birth.wheel === 0 ? 0.7 : -0.75, 5);
  }
  expect(new Set(report.leanBirths.map((birth) => birth.wheel))).toEqual(new Set([0, 2]));
  for (const birth of report.leanBirths) {
    expect(birth.plume).toBe(false);
    expect(birth.y).toBeCloseTo(0.035, 5);
    expect(birth.floor).toBeCloseTo(0, 5);
    expect(Math.abs(birth.x)).toBeLessThan(0.08);
  }
  expect(report.wheelie.contacts).toEqual([2]);
  expect(report.wheelie.spray).toBeGreaterThan(0);
  expect(report.down).toEqual({ births: 0, spray: 0 });
  expect(report.differences.applied.changedPixels).toBeGreaterThan(100);
  expect(report.differences.applied.maxChannelDelta).toBeGreaterThan(8);
  expect(report.differences.held).toEqual({
    maxChannelDelta: 0,
    changedPixels: 0,
    coverageDifferences: 0,
  });
  expect(report.differences.lean.changedPixels).toBeGreaterThan(100);
  expect(report.moving.counts.profiled).toBeGreaterThan(10);
  expect(report.moving.counts.profiled).toBe(report.moving.counts.unprofiled);
  expect(report.moving.rawBytesEqual).toBe(true);
  expect(report.moving.scale).toEqual({ radius: 0.35, opacity: 0.32 });
  expect(report.moving.profileBytes).toBe(3600);
  expect(report.moving.originRange[1] - report.moving.originRange[0]).toBeGreaterThan(10);
  expect(report.moving.difference.changedPixels).toBeGreaterThan(100);
  expect(report.moving.impact.profiled.changedPixels).toBeGreaterThan(100);
  expect(report.moving.impact.profiled.changedPixels).toBeLessThan(
    report.moving.impact.unprofiled.changedPixels,
  );
  expect(report.moving.impact.profiled.channelDifference).toBeLessThan(
    report.moving.impact.unprofiled.channelDifference * 0.7,
  );
  expect(report.moving.draws.profiled).toBe(report.moving.draws.unprofiled);
  expect(report.moving.profileHeld).toBe(true);
  const identicalPixels = { maxChannelDelta: 0, changedPixels: 0, coverageDifferences: 0 };
  expect(report.moving.held).toEqual(identicalPixels);
  expect(report.moving.seek.active.every((count) => count === 0)).toBe(true);
  expect(report.moving.seek.profileCleared).toBe(true);
  expect(report.moving.seek.difference).toEqual(identicalPixels);
  expect(report.nonGp.rawBytesEqual).toBe(true);
  expect(report.nonGp.profileZero).toBe(true);
  expect(report.nonGp.adapterDifference).toEqual(identicalPixels);
  expect(report.nonGp.shaderDifference).toEqual(identicalPixels);
  expect(report.fixedResources).toBe(true);
  expect(report.after).toEqual(report.before);
  expect(report.capacities.contactCapacity).toBe(3600);
});
