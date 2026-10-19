import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type * as Fixture from './fixtures/gp-grounding.ts';

declare global {
  interface Window {
    GpGroundingFixture: typeof Fixture;
  }
}

test('GP grounding: real WebGL2 receivers, two tyre footprints and deterministic family changes', async ({
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
        entry: resolve('e2e/fixtures/gp-grounding.ts'),
        name: 'GpGroundingFixture',
        formats: ['iife'],
      },
    },
  });
  const bundle = Array.isArray(built) ? built[0] : built;
  if (!('output' in bundle)) throw new Error('Missing GP grounding fixture bundle');
  const script = bundle.output.find((entry) => entry.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing GP grounding fixture script');
  await page.setContent('<!doctype html><title>Bounded GP grounding material regression</title>');
  await page.addScriptTag({ content: script.code });
  const report = await page.evaluate(() => window.GpGroundingFixture.captureGpGrounding());
  for (const capture of report.images)
    await info.attach(`grounding-${capture.name}.png`, {
      body: Buffer.from(capture.image.slice(capture.image.indexOf(',') + 1), 'base64'),
      contentType: 'image/png',
    });
  const { images: _images, ...metrics } = report;
  await info.attach('gp-grounding-metrics.json', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  expect(report.webgl2).toBe(true);
  expect(report.shaderErrors).toEqual([]);
  expect(report.glErrors).toEqual([]);
  expect(errors).toEqual([]);
  expect(report.bindings.map((entry) => entry.material).sort()).toEqual([
    'MeshPhysicalMaterial',
    'MeshStandardMaterial',
  ]);
  expect(report.bindings.every((entry) => entry.gpUniformsShared)).toBe(true);
  expect(report.before).toEqual({
    geometries: 1,
    textures: 0,
    programs: 2,
    calls: 2,
    triangles: 4,
  });
  expect(report.after).toEqual(report.before);
  expect(report.samples.length).toBeGreaterThanOrEqual(48);
  for (const sample of report.samples) expect(sample.resources).toEqual(report.before);
  expect(report.fixedUniformSlots).toBe(true);
  expect(report.gpState.count).toBe(2);
  expect(report.gpState.shape.slice(0, 2).map((shape) => shape[0])).toEqual([1, 1]);
  for (const probe of report.probes) {
    // Each actual receiver must darken beneath both GP tyres. A passing
    // Standard program cannot hide a broken Physical/instanced program.
    expect(probe.frontDarkness).toBeGreaterThan(8);
    expect(probe.rearDarkness).toBeGreaterThan(8);
    // The Formula tyre witness is open road for GP, dark for the car branch.
    expect(probe.gpAtFormulaTyre).toBe(0);
    expect(probe.formulaAtFormulaTyre).toBeGreaterThan(15);
  }
  expect(report.differences.applied.changedPixels).toBeGreaterThan(150);
  expect(report.differences.applied.maxChannelDelta).toBeGreaterThan(15);
  expect(report.differences.family.changedPixels).toBeGreaterThan(1000);
  expect(report.differences.family.maxChannelDelta).toBeGreaterThan(15);
  expect(report.differences.lean.changedPixels).toBeGreaterThan(150);
  const unchanged = { maxChannelDelta: 0, changedPixels: 0, coverageDifferences: 0 };
  for (const name of ['held', 'rewind', 'restored', 'cleared'] as const)
    expect(report.differences[name]).toEqual(unchanged);
  expect(report.heldState.time).toBe(10);
  expect(report.heldState.dt).toBe(0);
  expect(report.rewindState.time).toBe(10);
  expect(report.rewindState.dt).toBe(0);
  for (const name of ['front', 'rear', 'shape'] as const) {
    expect(report.heldState[name]).toEqual(report.gpState[name]);
    expect(report.rewindState[name]).toEqual(report.gpState[name]);
    for (const slot of report.formulaState[name]) expect(slot).toEqual([0, 0, 0, 0]);
    for (const slot of report.clearedState[name]) expect(slot).toEqual([0, 0, 0, 0]);
  }
  expect(report.clearedState.count).toBe(0);
  expect(report.wheelieState.front.slice(0, 2).map((v) => v[3])).toEqual([0, 0]);
  expect(report.wheelieState.rear.slice(0, 2).map((v) => v[3])).toEqual([1, 1]);
  expect(report.standState.front.slice(0, 2).map((v) => v[3])).toEqual([0, 0]);
  expect(report.standState.rear.slice(0, 2).map((v) => v[3])).toEqual([0, 0]);
});
