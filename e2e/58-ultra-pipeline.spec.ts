import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import { finishRaceEntry } from './race-entry.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { graphicsPreset } from '../src/rendering/options.ts';
import type * as Fixture from './fixtures/ultra-pipeline.ts';

/** ULTRA is opt-in: these cases select it explicitly; every other spec keeps
 * its own preset and budgets. Software rendering proves function, not speed. */
let code: string;
test.beforeAll(async () => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/ultra-pipeline.ts'),
        name: 'UltraFixture',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing ULTRA fixture output');
  const chunk = result.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing ULTRA fixture chunk');
  code = chunk.code;
});

test('ULTRA modules compile and run on the controlled set; High runs none of them', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setContent('<!doctype html><title>ULTRA pipeline</title><body></body>');
  await page.addScriptTag({ content: code });
  const run = (preset: 'high' | 'ultra', replay: boolean) =>
    page.evaluate(
      (options) =>
        (window as unknown as { UltraFixture: typeof Fixture }).UltraFixture.capture(options),
      { preset, width: 480, height: 270, frames: 12, rain: replay ? 0 : 12, replay },
    );
  const high = await run('high', false);
  const ultra = await run('ultra', true);
  const { image: _image, ...report } = ultra;
  await info.attach('ultra-pipeline.json', {
    body: JSON.stringify({ high: { ...high, image: undefined }, ultra: report }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  for (const r of [high, ultra]) {
    expect(r.glErrors).toEqual([]);
    expect(r.heldFramesIdentical).toBe(true);
  }
  const h = high.diagnostics,
    u = ultra.diagnostics;
  expect(h.ssr.frames + h.aoTemporal.frames + h.taaSharpen.frames).toBe(0);
  expect(h.shadowCascades.count).toBe(2);
  if (u.capabilities.floatColorBuffer) expect(u.ssr.frames).toBeGreaterThan(0);
  expect(u.aoTemporal.frames).toBeGreaterThan(0);
  expect(u.taaSharpen.frames).toBeGreaterThan(0);
  expect(u.shadowCascades.count).toBe(3);
  expect(u.replayDof.frames).toBeGreaterThan(0);
  expect(u.passes.ssr?.calls ?? 0).toBeGreaterThanOrEqual(u.capabilities.floatColorBuffer ? 8 : 0);
});

test('a saved ULTRA preference loads and runs its modules in a live session', async ({
  page,
}, info) => {
  // A software-rendered ULTRA session takes 10-20 minutes: opt-in so the
  // CI shards keep their existing workload (APEX_ULTRA_LIVE=1 to run it).
  test.skip(!process.env.APEX_ULTRA_LIVE, 'opt-in live ULTRA session (APEX_ULTRA_LIVE=1)');
  // ULTRA at half resolution and a 2048 near map: the software GPU proves
  // function (every module compiles and runs in the real renderer), not speed.
  test.setTimeout(1200000);
  await page.setViewportSize({ width: 800, height: 450 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const url = '**/__ultra_test_settings__';
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Saved ULTRA</title>' }),
  );
  await page.goto('/__ultra_test_settings__');
  await page.evaluate(
    (settings) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('apex-formula', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('saved');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('saved', 'readwrite');
          tx.objectStore('saved').put(settings, 'settings');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    validateSettings({
      ...DEFAULT_SETTINGS,
      quality: 'ultra',
      graphics: { ...graphicsPreset('ultra'), resolutionScale: 0.5, shadowSize: 2048 },
    }),
  );
  await page.unroute(url);
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 300000 });
  await page.locator('#mode').selectOption('practice');
  await page.locator('#opponents').selectOption('0');
  await page.getByRole('button', { name: /ENTER CIRCUIT/ }).click();
  // Software-rendered ULTRA preparation is slower than finishRaceEntry allows.
  await expect
    .poll(
      async () => {
        const d = await page.evaluate(() => window.apexDiagnostics());
        if (d.state === 'driving') return 'driving';
        return (await page.locator('#raceBriefing').isVisible()) ? 'briefing' : d.state;
      },
      { timeout: 600000, intervals: [5000] },
    )
    .toMatch(/^(driving|briefing)$/);
  await finishRaceEntry(page);
  await page.keyboard.press('g');
  await expect
    .poll(
      async () => (await page.evaluate(() => window.apexDiagnostics())).renderer!.ultra.ssr.frames,
      { timeout: 300000 },
    )
    .toBeGreaterThan(3);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.apexDiagnostics())).renderer!.ultra.shadowCascades.count,
      { timeout: 120000 },
    )
    .toBe(3);
  const state = await page.evaluate(() => window.apexDiagnostics());
  const render = state.renderer!;
  await info.attach('ultra-session.json', {
    body: JSON.stringify(
      { graphics: render.graphics, ultra: render.ultra, drawBreakdown: render.drawBreakdown },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('ultra-session.png') });
  expect(render.graphics.ssr).toBe(true);
  expect(render.ultra.preset).toBe('ultra');
  expect(render.ultra.tier).toBe('high');
  expect(render.ultra.unsupported).toEqual([]);
  expect(render.ultra.aoTemporal.enabled).toBe(true);
  expect(render.scenePass.temporalAA.enabled).toBe(true);
  expect(render.ultra.passes.ssr.calls).toBeGreaterThanOrEqual(8);
  expect(errors).toEqual([]);
});
