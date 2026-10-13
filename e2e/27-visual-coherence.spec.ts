import { finishRaceEntry } from './race-entry.ts';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { visualCoherenceGPU } from './fixtures/visual-coherence.ts';
import { readPresentationReport } from '../src/rendering/presentation-review.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';

test.use({ video: { mode: 'on', size: { width: 960, height: 600 } } });

test('27H.5 GPU: damp surfaces, clearcoat ripples and precipitation share reversible scene lighting', async ({
  page,
}, info) => {
  const bundled = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/visual-coherence.ts'),
        name: 'VisualCoherenceProbe',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in output)) throw new Error('Missing coherence fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing coherence fixture entry');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setContent('<!doctype html><title>Isolated visual-coherence GPU contracts</title>');
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as {
        VisualCoherenceProbe: { visualCoherenceGPU: typeof visualCoherenceGPU };
      }
    ).VisualCoherenceProbe.visualCoherenceGPU(),
  );
  for (const capture of result.captures)
    await info.attach(`27h5-fixture-${capture.name}.png`, {
      body: Buffer.from(capture.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('27h5-gpu-contracts.json', {
    body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.dry.nonzero).toBeGreaterThan(1000);
  expect(result.wet.energy).toBeLessThan(result.dry.energy * 0.96);
  expect(result.wet.hash).toBe(result.held.hash);
  expect(result.wet.hash).toBe(result.rewoundWet.hash);
  expect(result.dry.hash).toBe(result.restoredDry.hash);
  expect(result.ripple.hash).not.toBe(result.movingRipple.hash);
  expect(result.movingRipple.hash).toBe(result.pausedRipple.hash);
  expect(result.ripple.hash).toBe(result.rewoundRipple.hash);
  expect(result.quietWater.hash).toBe(result.quietHeld.hash);
  expect(result.unlit.energy).toBe(0);
  expect(result.unlitRestored.energy).toBe(0);
  expect(result.warm.nonzero).toBeGreaterThan(5);
  expect(result.cool.nonzero).toBeGreaterThan(5);
  expect(result.warm.rgb[0]).toBeGreaterThan(result.warm.rgb[2]);
  expect(result.cool.rgb[2]).toBeGreaterThan(result.cool.rgb[0]);
  expect(result.floodlit.energy).toBeGreaterThan(result.unlit.energy + 100);
  expect(result.resourcesAfter).toEqual(result.resourcesBefore);
  const conditions = result.captures.filter((c) => c.name.startsWith('surface-'));
  expect(conditions).toHaveLength(5);
  expect(new Set(conditions.map((c) => c.hash)).size).toBe(5);
  for (const capture of conditions) expect(capture.nonzero).toBeGreaterThan(1000);
});

// Normal application startup, real UI input, existing autonomous driver and the
// existing full-lap evidence recorder. No injected frames, time acceleration,
// screenshot-only fixtures, state overrides or rewritten completion labels.
const drives = [
  { workload: 'clear-day', weather: 'clear', lighting: 'day', camera: 'cockpit' },
  { workload: 'sunset', weather: 'clear', lighting: 'sunset', camera: 'pod' },
  { workload: 'wet-day', weather: 'rain', lighting: 'day', camera: 'chase' },
  { workload: 'wet-night', weather: 'rain', lighting: 'night', camera: 'trackside' },
] as const;
test.describe('27H.5 ordinary application full-lap evidence', () => {
  for (const drive of drives)
    test(`${drive.workload}: full ${drive.camera} lap, held views and replay weather`, async ({
      page,
    }, info) => {
      // This NEW full-lap test includes the recorder's existing ten-minute limit;
      // no previous test's assertion, timeout or workflow budget is changed.
      test.setTimeout(780000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      const read = () => page.evaluate(() => window.apexDiagnostics());
      const capture = async (name: string) => {
        const session = await page.context().newCDPSession(page);
        try {
          const { data } = await session.send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false,
            optimizeForSpeed: true,
          });
          const image = Buffer.from(data, 'base64');
          expect(image.length).toBeGreaterThan(10000);
          expect(image.readUInt32BE(16)).toBe(page.viewportSize()!.width);
          expect(image.readUInt32BE(20)).toBe(page.viewportSize()!.height);
          await info.attach(`27h5-${drive.workload}-${name}.png`, {
            body: image,
            contentType: 'image/png',
          });
        } finally {
          await session.detach();
        }
      };
      await page.goto('/?dev');
      await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
      await page.selectOption('#mode', 'practice');
      await page.selectOption('#opponents', '0');
      await page.selectOption('#weather', drive.weather);
      await page.selectOption('#compound', drive.weather === 'rain' ? 'wet' : 'medium');
      await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await finishRaceEntry(page);
      await expect.poll(async () => (await read()).state, { timeout: 90000 }).toBe('driving');
      if (drive.lighting !== 'day') {
        await page.keyboard.press('Escape');
        await expect
          .poll(async () => (await read()).workerPause)
          .toMatchObject({ pending: false, paused: true });
        await page.locator('#modal [data-action="academy"]').click();
        await page.locator(`#modal [data-action="lighting:${drive.lighting}"]`).click();
        await expect.poll(async () => (await read()).renderer?.lighting).toBe(drive.lighting);
        await page.locator('#modal [data-action="modalClose"]').click();
        await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
      }
      for (let i = 0; i < 4 && (await read()).renderer?.camera !== drive.camera; i++) {
        await page.keyboard.press('c');
        await expect
          .poll(async () => {
            const d = await read();
            return d.renderer?.presentedCamera === d.renderer?.requestedCamera;
          })
          .toBe(true);
      }
      await expect.poll(async () => (await read()).renderer?.presentedCamera).toBe(drive.camera);
      await page.keyboard.press('g');
      await expect.poll(async () => (await read()).auto).toBe(true);
      await expect
        .poll(async () => (await read()).frame?.[carBase(0) + F.SPEED])
        .toBeGreaterThan(5);
      await page.keyboard.press('Escape');
      await expect
        .poll(async () => (await read()).workerPause)
        .toMatchObject({ pending: false, paused: true });
      const before = await read();
      expect(before.renderer?.graphics.autoExposure).toBe(true);
      expect(before.renderer?.graphics.localFog).toBe(true);
      expect(before.renderer?.weatherPresentation.roadMaterials).toBeGreaterThanOrEqual(2);
      expect(before.renderer?.weatherPresentation.materialRoles.fabric).toBeGreaterThan(0);
      await page.locator('#modal [data-action="visualReview"]').click();
      await page
        .locator('#reviewMachine')
        .fill('Hosted Chromium validation; not physical target-hardware acceptance');
      await page.selectOption('#reviewWorkload', drive.workload);
      await page.selectOption('#reviewMode', 'full-lap');
      await page.getByRole('button', { name: 'RESUME & RECORD REVIEW', exact: true }).click();
      await expect.poll(async () => (await read()).presentationReview.state).toBe('recording');
      await expect
        .poll(
          async () => {
            const d = await read();
            if (d.presentationReview.state === 'interrupted')
              throw new Error(d.presentationReview.reason ?? 'Review interrupted');
            if (errors.length) throw new Error(errors.join('\n'));
            return d.presentationReview.state;
          },
          { timeout: 600000, intervals: [1000, 2000] },
        )
        .toBe('complete');
      const complete = await read();
      // Retain the presented-frame/GPU evidence even when the next assertion
      // fails; previously the eight-frame failures never reached JSON export.
      await info.attach(`27h5-${drive.workload}-completion-diagnostics.json`, {
        body: JSON.stringify(complete, null, 2),
        contentType: 'application/json',
      });
      expect(complete.presentationReview.progressM).toBeGreaterThanOrEqual(
        complete.frame![H.LENGTH],
      );
      // A full lap must complete with actual submitted frames, even on Mesa llvmpipe;
      // retain the measured count and all distance/physics/evidence assertions.
      expect(complete.presentationReview.frames).toBeGreaterThanOrEqual(8);
      await capture('full-lap-complete');
      await page.keyboard.press('Escape');
      await expect
        .poll(async () => (await read()).workerPause)
        .toMatchObject({ pending: false, paused: true });
      const paused = await read();
      await page.locator('#modal [data-action="visualReview"]').click();
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'EXPORT FRAME JSON', exact: true }).click();
      const download = await downloading,
        path = info.outputPath(`27h5-${drive.workload}-full-lap.json`);
      await download.saveAs(path);
      const body = await readFile(path);
      const report = readPresentationReport(JSON.parse(body.toString()));
      expect(report.state).toBe('complete');
      expect(report.context.camera).toBe(drive.camera);
      expect(report.progressM).toBeGreaterThanOrEqual(report.context.trackLength);
      await info.attach(`27h5-${drive.workload}-full-lap.json`, {
        body,
        contentType: 'application/json',
      });
      await page.locator('#modal [data-action="modalClose"]').click();
      await page.getByRole('button', { name: 'WATCH REPLAY', exact: true }).click();
      await expect(page.locator('#replayBar')).toBeVisible();
      if ((await read()).replayPlaying) await page.locator('#replayPlay').click();
      const seek = async (seconds: number) => {
        await page.locator('#replaySeek').evaluate((element, value) => {
          (element as HTMLInputElement).value = String(value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }, seconds);
        await expect.poll(async () => (await read()).replaySeekPending).toBe(false);
        await expect.poll(async () => (await read()).replayPosition).toBe(seconds);
        return read();
      };
      const first = await seek(0.75),
        forward = await seek(4.5),
        rewind = await seek(0.75);
      expect(rewind.renderer?.weatherPresentation).toEqual(first.renderer?.weatherPresentation);
      expect(forward.renderer!.weatherPresentation.time).toBeGreaterThan(
        first.renderer!.weatherPresentation.time,
      );
      expect(rewind.frame?.[H.TICK]).toBe(paused.frame?.[H.TICK]);
      for (let i = 0; i < 4; i++) {
        const view = (await read()).renderer!.presentedCamera;
        await capture(`replay-${view}`);
        await page.locator('#replayBar [data-action="camera"]').click();
        await expect.poll(async () => (await read()).renderer!.presentedCamera).not.toBe(view);
      }
      const final = await read();
      expect(final.renderer?.automaticExposure.failedReads).toBe(0);
      expect(final.recordingWarnings).toEqual([]);
      expect(errors).toEqual([]);
      await info.attach(`27h5-${drive.workload}-application.json`, {
        body: JSON.stringify(
          {
            before,
            complete,
            paused,
            first,
            forward,
            rewind,
            final,
            evidenceBoundary:
              'Real autonomous-drive full-lap traversal and recorded-frame replay. Requires human visual/reference review; software-GPU timings are not minimum-PC certification.',
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    });
});
