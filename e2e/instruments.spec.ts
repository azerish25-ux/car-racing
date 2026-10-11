import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { verifyInstrumentCanvas } from './fixtures/instruments.ts';

test('actual cockpit canvas refreshes after hitches, shifts and replay rewinds', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve('e2e/fixtures/instruments.ts'),
        name: 'InstrumentOracle',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Missing instrument fixture');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing instrument fixture entry');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>Instrument canvas oracle</title>');
  await page.addScriptTag({ content: chunk.code });
  const measured = await page.evaluate(() =>
    (
      window as unknown as {
        InstrumentOracle: { verifyInstrumentCanvas: typeof verifyInstrumentCanvas };
      }
    ).InstrumentOracle.verifyInstrumentCanvas(),
  );
  expect(measured.first.changed).toBe(true);
  expect(measured.hitch.changed).toBe(true);
  expect(measured.hitch.text).toContain('158 KM/H');
  expect(measured.gear.changed).toBe(true);
  // The display now draws the lap/position header before the central gear.
  // Require the actual gear glyph without assuming the obsolete draw order.
  expect(measured.gear.text).toContain('3');
  expect(measured.paused.changed).toBe(false);
  expect(measured.rewind.changed).toBe(true);
  expect(measured.rewind.text).toContain('72 KM/H');
  expect(measured.brightPixels).toBeGreaterThan(100);
  expect(measured.articulated.phase).toBeCloseTo(6 + 100 / 15, 5);
  expect(measured.articulated.hubHeight).toBeCloseTo(-0.2, 5);
  expect(measured.articulated.steer).toBeCloseTo(0.22, 5);
  expect(measured.articulated.camber).toBeCloseTo(-0.05, 5);
  expect(measured.articulated.steeringWheel).toBeCloseTo(-0.44, 5);
  expect(measured.controls.ledCount).toBe(10);
  expect(measured.controls.buttonCount).toBe(6);
  expect(measured.controls.paddleCount).toBe(2);
  expect(measured.controls.pausedUpload).toBe(true);
  expect(measured.controls.off).toEqual(Array(10).fill(0x20292a));
  expect(measured.controls.on).toEqual(Array.from({ length: 10 }, (_, i) => i < 5 ? 0x6fec9b : i < 8 ? 0xed6540 : 0xaabef8));
  expect(measured.controls.buttonColours).toEqual([0xe65739, 0x56b8a6, 0xe6c254, 0xe65739, 0x56b8a6, 0xe6c254]);
  measured.controls.ledPositions.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(-0.071 + i * 0.016, 6);
    expect(p[1]).toBeCloseTo(0.074, 6); expect(p[2]).toBeCloseTo(-0.018, 6);
  });
  measured.controls.buttonPositions.forEach((p, i) => {
    const k = i % 3, side = i < 3 ? -1 : 1;
    expect(p[0]).toBeCloseTo(side * (0.117 + (k % 2) * 0.026), 6);
    expect(p[1]).toBeCloseTo(0.037 - k * 0.028, 6); expect(p[2]).toBeCloseTo(-0.027, 6);
  });
  expect(errors).toEqual([]);
  await info.attach('instrument-canvas.json', {
    body: JSON.stringify(measured),
    contentType: 'application/json',
  });
});
