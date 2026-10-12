import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type * as Hero from './fixtures/phase27c-hero.ts';
import type * as Crowd from './fixtures/phase27c-crowd.ts';
import type * as Venue from './fixtures/phase27c-venue.ts';

async function fixture(page: Page, file: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const built = await build({ configFile: false, logLevel: 'error',
    build: { write: false, lib: { entry: resolve(`e2e/fixtures/${file}.ts`), name: 'Phase27Fixture', formats: ['iife'] } } });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('No Phase 27C fixture output');
  const chunk = output.output.find((part) => part.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('No Phase 27C fixture script');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent('<!doctype html><title>APEX Phase 27C production-component evidence</title>');
  await page.addScriptTag({ content: chunk.code });
  return errors;
}
async function image(info: TestInfo, name: string, data: string) {
  await info.attach(`${name}.png`, { body: Buffer.from(data.split(',')[1], 'base64'), contentType: 'image/png' });
}

test('Phase 27C: production hero geometry and material close views', async ({ page }, info) => {
  const errors = await fixture(page, 'phase27c-hero');
  const result = await page.evaluate(() => (window as unknown as { Phase27Fixture: typeof Hero }).Phase27Fixture.capturePhase27Hero());
  for (const shot of result.captures) await image(info, shot.view, shot.image);
  await info.attach('hero-metrics.json', { body: JSON.stringify({ ...result, errors,
    captures: result.captures.map(({ image: _image, ...stats }) => stats) }, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]); expect(result.glError).toBe(0); expect(result.sourceUnchanged).toBe(true);
  expect(result.captures).toHaveLength(7);
  expect(result.captures.every((shot) => shot.triangles > 10000 && shot.image.length > 50000)).toBe(true);
  expect(await page.locator('canvas').count()).toBe(0);
});

test('Phase 27C: actual crowd colour/depth shaders freeze and rewind exactly', async ({ page }, info) => {
  const errors = await fixture(page, 'phase27c-crowd');
  const result = await page.evaluate(() => (window as unknown as { Phase27Fixture: typeof Crowd }).Phase27Fixture.capturePhase27Crowd());
  for (const shot of result.captures) await image(info, shot.view, shot.image);
  await info.attach('crowd-metrics.json', { body: JSON.stringify({ ...result, errors,
    captures: result.captures.map(({ image: _image, ...stats }) => stats) }, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]); expect(result.glError).toBe(0);
  expect(result.pauseExact).toBe(true); expect(result.rewindExact).toBe(true); expect(result.visibleMovement).toBe(true);
  expect(result.memoryAfter).toEqual(result.memoryBefore);
  expect(result.handoff.activeLevels).toBe(2); expect(result.handoff.farLevels).toBe(1);
  expect(result.handoff.rewindExact).toBe(true);
  // The revised close-range spectator sculpt adds detail without changing the mid/far tiers.
  expect([result.midTriangles, result.farTriangles]).toEqual([1328, 638]);
  expect(result.nearTriangles).toBeGreaterThan(result.midTriangles);
  expect(result.nearTriangles).toBeLessThanOrEqual(6600);
  expect(await page.locator('canvas').count()).toBe(0);
});

for (const options of [
  { weather: 'clear', night: false }, { weather: 'rain', night: false }, { weather: 'rain', night: true },
] as const) {
  test(`Phase 27C: real-lap circuit survey ${options.weather} / ${options.night ? 'night' : 'day'}`, async ({ page }, info) => {
    const errors = await fixture(page, 'phase27c-venue');
    const meta = await page.evaluate((options) =>
      (window as unknown as { Phase27Fixture: typeof Venue }).Phase27Fixture.beginPhase27Venue(options), options);
    const captures: Omit<ReturnType<typeof Venue.capturePhase27VenueView>, 'image'>[] = [];
    try {
      expect(meta.cameras).toEqual(Array.from({ length: 20 }, (_, i) => i)); expect(meta.serviceAreas).toBe(6);
      for (let i = 0; i < meta.views; i++) {
        const capture = await page.evaluate((index) =>
          (window as unknown as { Phase27Fixture: typeof Venue }).Phase27Fixture.capturePhase27VenueView(index), i);
        await image(info, capture.view, capture.image);
        const { image: _image, ...metrics } = capture; captures.push(metrics);
        expect(capture.glError).toBe(0); expect(capture.sourceUnchanged).toBe(true); expect(capture.waterUnchanged).toBe(true);
        if (i < 20) expect(capture.activeCamera).toBe(i);
        expect(capture.image.length).toBeGreaterThan(50000);
      }
      expect(errors).toEqual([]);
    } finally {
      await info.attach('venue-metrics.json', { body: JSON.stringify({ meta, options, captures, errors }, null, 2), contentType: 'application/json' });
      await page.evaluate(() => (window as unknown as { Phase27Fixture: typeof Venue }).Phase27Fixture.endPhase27Venue());
    }
    expect(await page.locator('canvas').count()).toBe(0);
  });
}
