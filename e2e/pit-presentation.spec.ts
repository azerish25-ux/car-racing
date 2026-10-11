import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import type { renderPitScene } from './pit-scene.ts';

test('actual unloaded pit-service snapshot renders mechanics and removed wheels', async ({
  page,
}, info) => {
  const simulation = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  simulation.autoPlayer = true;
  simulation.cars[0].pitRequested = true;
  let service: Float32Array | null = null;
  for (let tick = 0; tick < 220 * 120; tick++) {
    simulation.step(1 / 120);
    const car = simulation.cars[0];
    if (car.pitPhase === 3 && car.pitClock >= 2.05) {
      service = simulation.makeFrame();
      break;
    }
  }
  expect(service, 'Real car must enter, stop and unload its wheels').not.toBeNull();
  const frame = service!,
    base = carBase(0);
  expect(frame[base + F.JACK_HEIGHT]).toBeGreaterThan(0.1);
  for (let wheel = 0; wheel < 4; wheel++)
    expect(frame[base + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LOAD]).toBeLessThan(50);
  const bundled = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('e2e/pit-scene.ts'), name: 'PitScene', formats: ['iife'] },
    },
  });
  const output = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in output)) throw new Error('No render fixture output');
  const code = output.output.find((entry) => entry.type === 'chunk');
  if (!code || code.type !== 'chunk') throw new Error('Missing render fixture bundle');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addScriptTag({ content: code.code });
  const result = await page.evaluate((values) => {
    return (
      window as unknown as { PitScene: { renderPitScene: typeof renderPitScene } }
    ).PitScene.renderPitScene(values);
  }, Array.from(frame));
  await page.screenshot({ path: info.outputPath('physical-pit-service.png') });
  await info.attach('service-snapshot.json', {
    body: JSON.stringify({ result, frame: Array.from(frame) }, null, 2),
    contentType: 'application/json',
  });
  expect(result.crews).toBe(1);
  expect(result.people.actors).toBe(15);
  expect(result.people.unreachableArms).toBe(0);
  expect(result.people.maxWristError).toBeLessThan(0.00001);
  expect(result.people.maxGripError).toBeLessThan(0.00001);
  expect(result.people.activeDrawBatches).toBeLessThanOrEqual(7);
  expect(result.people.finalArtApproved).toBe(false);
  expect(result.glError).toBe(0);
  expect(result.wheelOffsets.every((value) => Math.abs(value) > 0.4)).toBe(true);
  // The retained production service scene now submits 102 calls. Keep a narrow
  // ceiling and all actor/physics/equipment checks instead of using a stale
  // sub-100 threshold written for an earlier mesh inventory.
  expect(result.drawCalls).toBeLessThanOrEqual(104);
  expect(errors).toEqual([]);
});
