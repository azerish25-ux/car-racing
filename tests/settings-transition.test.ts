import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  graphicsSettingsChanged,
  runSettingsChange,
  yieldBrowserTask,
  type SettingsChange,
  type SettingsPhase,
} from '../src/core/settings-transition.ts';
import type { GraphicsOptions } from '../src/rendering/options.ts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function scenario(overrides: Partial<SettingsChange> = {}) {
  const events: string[] = [];
  const phases: SettingsPhase[] = [];
  const change: SettingsChange = {
    cancelled: () => false,
    phase: (phase) => { phases.push(phase); events.push(phase); },
    yieldControl: async () => { events.push('yield'); },
    prepare: async () => { events.push('prepare'); return true; },
    apply: () => { events.push('apply'); },
    save: async () => { events.push('save'); },
    ...overrides,
  };
  return { change, events, phases };
}
const graphics: GraphicsOptions = {
  resolutionScale: 1, textureSize: 512, shadowSize: 1024,
  reflections: 'environment', mirrorQuality: 'medium', particleDensity: 0.65,
  vegetationDensity: 1, crowd: true, bloom: true, autoExposure: true,
  localFog: true, motionBlur: 0, antialias: true, anisotropy: 8,
  msaa: 2, ambientOcclusion: true, filmGrade: true,
  temporalAA: false, lensEffects: true, cockpitFov: 54,
  ssr: false, taaSharpen: 0, aoTemporal: false, toneMapper: 'aces',
  physicalBloom: false, chromaticAberration: false, lightShafts: false,
  shadowCascades: 2, replayDof: false,
};
const before = { quality: 'medium' as const, graphics };

test('equal graphics do not rebuild for object identity or property order', () => {
  const reordered = Object.fromEntries(Object.entries(graphics).reverse()) as unknown as GraphicsOptions;
  assert.equal(graphicsSettingsChanged(before, { ...before, graphics: reordered }), false);
});
test('a different quality label is not ignored', () => {
  assert.equal(graphicsSettingsChanged(before, { ...before, quality: 'low' }), true);
});
const alternatives: GraphicsOptions = {
  resolutionScale: 0.75, textureSize: 256, shadowSize: 512,
  reflections: 'local', mirrorQuality: 'low', particleDensity: 0.5,
  vegetationDensity: 0.5, crowd: false, bloom: false, autoExposure: false,
  localFog: false, motionBlur: 0.2, antialias: false, anisotropy: 4,
  msaa: 0, ambientOcclusion: false, filmGrade: false,
  temporalAA: true, lensEffects: false, cockpitFov: 62,
  ssr: true, taaSharpen: 0.5, aoTemporal: true, toneMapper: 'agx',
  physicalBloom: true, chromaticAberration: true, lightShafts: true,
  shadowCascades: 3, replayDof: true,
};
for (const key of Object.keys(graphics) as (keyof GraphicsOptions)[]) {
  test(`detects a custom ${key} change under the same quality label`, () => {
    const modified = { ...graphics, [key]: alternatives[key] };
    assert.equal(graphicsSettingsChanged(before, { ...before, graphics: modified }), true);
  });
}
test('preserves task, preparation, application, transaction ordering', async () => {
  const { change, events } = scenario();
  assert.deepEqual(await runSettingsChange(change), { saved: true });
  assert.deepEqual(events, ['preparing', 'yield', 'prepare', 'applying', 'apply', 'saving', 'save', 'idle']);
});
test('does not prepare or apply synchronously inside the click task', async () => {
  const boundary = deferred<void>();
  const { change, events } = scenario({ yieldControl: () => boundary.promise });
  const result = runSettingsChange(change);
  assert.deepEqual(events, ['preparing']);
  boundary.resolve();
  assert.deepEqual(await result, { saved: true });
});
test('does not apply while graphics preparation is pending', async () => {
  const ready = deferred<boolean>();
  const { change, events } = scenario({ prepare: () => ready.promise });
  const result = runSettingsChange(change);
  await Promise.resolve();
  assert.equal(events.includes('apply'), false);
  ready.resolve(true);
  assert.deepEqual(await result, { saved: true });
});
test('does not signal completion before the durable transaction commits', async () => {
  const durable = deferred<void>();
  const { change, phases } = scenario({ save: () => durable.promise });
  let complete = false;
  const result = runSettingsChange(change).then((value) => { complete = true; return value; });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(phases.at(-1), 'saving');
  assert.equal(complete, false);
  durable.resolve();
  assert.deepEqual(await result, { saved: true });
  assert.equal(phases.at(-1), 'idle');
});
for (const point of ['before', 'yield', 'prepare', 'apply', 'save'] as const) {
  test(`cancellation at ${point} suppresses stale completion`, async () => {
    let stopped = point === 'before';
    let applied = 0, saved = 0;
    const { change, phases } = scenario({
      cancelled: () => stopped,
      yieldControl: async () => { if (point === 'yield') stopped = true; },
      prepare: async () => { if (point === 'prepare') stopped = true; return true; },
      apply: () => { applied++; if (point === 'apply') stopped = true; },
      save: async () => { saved++; if (point === 'save') stopped = true; },
    });
    assert.equal(await runSettingsChange(change), null);
    assert.equal(applied, point === 'apply' || point === 'save' ? 1 : 0);
    assert.equal(saved, point === 'save' ? 1 : 0);
    assert.equal(phases.at(-1), 'idle');
  });
}
test('false preparation does not apply or persist a partial transition', async () => {
  const { change, events } = scenario({ prepare: async () => false });
  assert.equal(await runSettingsChange(change), null);
  assert.equal(events.includes('apply'), false);
  assert.equal(events.includes('save'), false);
});
for (const point of ['yieldControl', 'prepare', 'apply'] as const) {
  test(`${point} failure propagates rather than claiming a storage failure`, async () => {
    const fault = new Error(`${point} failed`);
    const fail = () => { throw fault; };
    const { change, events, phases } = scenario({ [point]: fail });
    await assert.rejects(runSettingsChange(change), (error) => error === fault);
    assert.equal(events.includes('save'), false);
    assert.equal(phases.at(-1), 'idle');
  });
}
for (const error of [new Error('Quota exceeded'), 'write denied', null]) {
  test(`storage rejection ${String(error)} remains explicit session-only success`, async () => {
    const { change, events } = scenario({ save: async () => { throw error; } });
    assert.deepEqual(await runSettingsChange(change), {
      saved: false, error: error instanceof Error ? error.message : String(error),
    });
    assert.equal(events.filter((event) => event === 'apply').length, 1);
  });
}
test('rejection after teardown does not notify a replacement application', async () => {
  let stopped = false;
  const { change } = scenario({
    cancelled: () => stopped,
    save: async () => { stopped = true; throw new Error('late abort'); },
  });
  assert.equal(await runSettingsChange(change), null);
});
test('browser yield waits for a task rather than resolving as a microtask', async () => {
  let completed = false;
  const pending = yieldBrowserTask().then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  await pending;
  assert.equal(completed, true);
});
