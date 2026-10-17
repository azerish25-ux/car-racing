import { MENU_STARTUP_TIMEOUT_MS } from './menu-startup.ts';
import { finishRaceEntry } from './race-entry.ts';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import manifest from '../src/rendering/hero-garage.manifest.json' with { type: 'json' };
import type { captureHeroGarage } from './fixtures/hero-garage.ts';

test('A22 normal startup loads one authored garage and retains it through practice entry', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
  const read = () => page.evaluate(() => window.apexDiagnostics());
  const loaded = await read();
  expect(loaded.renderer?.environmentAssets.garage).toMatchObject({
    loaded: true,
    assetId: 'A22',
    revision: manifest.revision,
    sha256: manifest.sha256,
    bay: 5,
    finalArtApproved: false,
  });
  expect(loaded.renderer?.environmentAssets.garage?.sockets).toHaveLength(9);
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await finishRaceEntry(page);
  await expect.poll(async () => (await read()).state, { timeout: 90000 }).toBe('driving');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await read()).workerPause)
    .toMatchObject({ pending: false, paused: true });
  const paused = await read();
  expect(paused.renderer?.environmentAssets.garage).toMatchObject({
    loaded: true,
    assetId: 'A22',
    sha256: manifest.sha256,
    bay: 5,
  });
  await info.attach('a22-startup.json', {
    body: JSON.stringify({ loaded, paused }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A22 real-circuit garage views remain bounded in ${lighting}`, async ({ page }, info) => {
    const bytes = readFileSync('public/models/aurel-hero-garage-bay.glb');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
    const bundle = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/hero-garage.ts'),
          name: 'GarageSurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(bundle) ? bundle[0] : bundle;
    if (!('output' in output)) throw new Error('Missing garage fixture output');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing garage fixture code');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent('<!doctype html><title>A22 retained circuit inspection</title>');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      async ({ encoded, lighting }) =>
        (
          window as unknown as { GarageSurvey: { captureHeroGarage: typeof captureHeroGarage } }
        ).GarageSurvey.captureHeroGarage(encoded, lighting, lighting === 'night'),
      {
        encoded: bytes.toString('base64'),
        lighting,
      },
    );
    for (const shot of report.images) {
      const png = Buffer.from(shot.image.split(',')[1], 'base64');
      expect(png.readUInt32BE(16)).toBe(1280);
      expect(png.readUInt32BE(20)).toBe(720);
      await info.attach(`a22-${lighting}-${shot.view}.png`, {
        body: png,
        contentType: 'image/png',
      });
      expect(shot.addedCalls).toBeGreaterThan(0);
      expect(shot.addedCalls).toBeLessThanOrEqual(48);
    }
    await info.attach(`a22-${lighting}.json`, {
      body: JSON.stringify(
        {
          ...report,
          images: report.images.map(({ image: _image, ...row }) => row),
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(report.images).toHaveLength(3);
    expect(report.garage).toMatchObject({ assetId: 'A22', loaded: true, bay: 5, lod: 0 });
    expect(report.sourceUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    expect(report.replacedLegacyBay).toBe(true);
    expect(report.after).toEqual(report.before);
    expect(report.glError).toBe(0);
    expect(errors).toEqual([]);
  });
}
