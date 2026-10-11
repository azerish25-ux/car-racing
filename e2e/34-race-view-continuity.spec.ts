import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import manifest from '../src/rendering/apx01-driver.manifest.json' with { type: 'json' };
import type { raceViewContinuity } from './fixtures/race-view-continuity.ts';

test('current-camera car detail and active wheel poses survive immediate cuts and long-lens review', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/race-view-continuity.ts'),
        name: 'RaceViewProbe',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing race-view fixture');
  const chunk = result.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing race-view code');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // A same-origin blank fixture document gives the unchanged production asset
  // loaders their ordinary secure-context fetch and SHA-256 implementation.
  await page.route('**/race-view-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Controlled production race-view continuity</title>',
    }),
  );
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto('/race-view-fixture');
  await page.addScriptTag({ content: chunk.code });
  const report = await page.evaluate(() =>
    (
      window as unknown as { RaceViewProbe: { raceViewContinuity: typeof raceViewContinuity } }
    ).RaceViewProbe.raceViewContinuity(),
  );
  for (const row of report.rows)
    await info.attach(`${row.name}.png`, {
      body: Buffer.from(row.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('race-view-continuity.json', {
    body: JSON.stringify(report, (k, v) => (k === 'image' ? undefined : v), 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(report.glError).toBe(0);
  expect(report.sourceUnchanged).toBe(true);
  expect(report.authored).toMatchObject({ loaded: true, sha256: manifest.sha256, joints: 9 });
  expect(report.staleDecisionDifferences).toBeGreaterThan(0);
  expect(report.after).toEqual(report.before);
  expect(report.geometryAfter).toEqual(report.geometryBefore);
  // The updated view-distance policy may begin on either medium or far
  // camera hardware; zoom and closed-path return levels remain exact, as do
  // every subsequent cycle's per-view level and memory budgets.
  expect(report.warmup[0].cameraHardwareLevel).toBeGreaterThanOrEqual(1);
  expect(report.warmup[0].cameraHardwareLevel).toBeLessThanOrEqual(2);
  expect(report.warmup.slice(1).map((row) => row.cameraHardwareLevel)).toEqual([2, 0, 1]);
  expect(report.cycles).toHaveLength(8);
  for (const cycle of report.cycles) {
    expect(cycle.memory).toEqual(report.before);
    expect(cycle.levels).toEqual(cycle.expected);
  }
  expect(report.rows).toHaveLength(5);
  for (const row of report.rows) {
    expect(row.memory, row.name).toEqual(report.before);
    expect(row.levels, row.name).toEqual(row.expected);
    expect(row.levels[row.follow]).toBe(0);
    expect(row.calls).toBeGreaterThan(10);
    expect(row.image.length).toBeGreaterThan(10000);
    expect(
      row.wheels.every(
        (wheels) => wheels.length === 4 && wheels.every((p) => p.every(Number.isFinite)),
      ),
    ).toBe(true);
  }
  expect(report.rows[1].levels[0]).toBe(2);
  expect(report.rows[1].wheels).toEqual(report.rows[2].wheels);
  expect(report.rows[0].wheels).toEqual(report.rows[4].wheels);
});

test('loading compiles the actual first-service colour variant without concealing the lazy-buffer negative control', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/race-view-continuity.ts'),
        name: 'RaceViewProbe',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing cold-service fixture');
  const chunk = result.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing cold-service code');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setContent('<!doctype html><title>Cold first-service shader variants</title>');
  await page.addScriptTag({ content: chunk.code });
  const reports = await page.evaluate(async () => {
    const probe = (
      window as unknown as {
        RaceViewProbe: {
          coldPitPrograms: typeof import('./fixtures/race-view-continuity.ts').coldPitPrograms;
        };
      }
    ).RaceViewProbe;
    return [await probe.coldPitPrograms(false), await probe.coldPitPrograms(true)];
  });
  for (const report of reports) {
    await info.attach(`cold-service-${report.preallocate ? 'prepared' : 'lazy-control'}.png`, {
      body: Buffer.from(report.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    expect(report.sourceUnchanged).toBe(true);
    expect(report.glError).toBe(0);
    expect(report.emptyActors).toBe(0);
    expect(report.nearActors).toBe(15);
    expect(report.midActors).toBe(15);
    expect(report.before).toBeGreaterThan(0);
    expect(report.held).toBe(report.mid);
    expect(report.after).toEqual(report.memory);
    expect(report.image.length).toBeGreaterThan(10000);
  }
  await info.attach('cold-service-programs.json', {
    body: JSON.stringify(reports, (k, v) => (k === 'image' ? undefined : v), 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(reports[0].first).toBeGreaterThan(reports[0].before);
  expect(reports[1].first).toBe(reports[1].before);
  expect(reports[1].mid).toBe(reports[1].before);
});
