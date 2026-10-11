import { finishRaceEntry } from './race-entry.ts';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../src/rendering/workshop-equipment.manifest.json' with { type: 'json' };
import type { captureWorkshop } from './fixtures/workshop-equipment.ts';

test('A36 normal startup retains four authored workshop props through practice and pause', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  const read = () => page.evaluate(() => window.apexDiagnostics());
  const loaded = await read();
  expect(loaded.renderer?.environmentAssets.garage?.workshop).toMatchObject({
    assetId: 'A36',
    loaded: true,
    attached: true,
    instances: 4,
    sha256: manifest.sha256,
    finalArtApproved: false,
  });
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  await page.getByRole('button', { name: /^ENTER CIRCUIT/ }).click();
  await finishRaceEntry(page);
  await expect.poll(async () => (await read()).state, { timeout: 90000 }).toBe('driving');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await read()).workerPause)
    .toMatchObject({ pending: false, paused: true });
  const paused = await read();
  expect(paused.renderer?.environmentAssets.garage?.workshop).toMatchObject({
    assetId: 'A36',
    loaded: true,
    instances: 4,
    sha256: manifest.sha256,
  });
  await info.attach('a36-startup.json', {
    body: JSON.stringify({ loaded, paused }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

for (const wet of [false, true]) {
  test(`A36 full production garage survey, ${wet ? 'wet day and night' : 'dry day and sunset'}`, async ({
    page,
  }, info) => {
    // Ten production garage captures under wet/day/night software rendering
    // can exceed Playwright's generic five-minute watchdog.
    test.setTimeout(900000);
    const bundled = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/workshop-equipment.ts'),
          name: 'WorkshopSurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(bundled) ? bundled[0] : bundled;
    if (!('output' in output)) throw new Error('Missing A36 fixture output');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing A36 fixture code');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/__a36_fixture', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>A36 production garage inspection</title>',
      }),
    );
    await page.goto('/__a36_fixture');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      async (wet) =>
        (
          window as unknown as { WorkshopSurvey: { captureWorkshop: typeof captureWorkshop } }
        ).WorkshopSurvey.captureWorkshop(wet),
      wet,
    );
    mkdirSync('test-results/a36-evidence', { recursive: true });
    for (const image of report.images) {
      const png = Buffer.from(image.image.split(',')[1], 'base64');
      expect(png.readUInt32BE(16)).toBe(1280);
      expect(png.readUInt32BE(20)).toBe(720);
      writeFileSync(`test-results/a36-evidence/${image.view}.png`, png);
      await info.attach(`${image.view}.png`, { body: png, contentType: 'image/png' });
      if (!image.view.endsWith('moving-end')) {
        expect(image.addedCalls).toBeGreaterThan(0);
        expect(image.addedCalls).toBeLessThanOrEqual(4); // Main view plus existing shadow passes.
      }
    }
    const receipt = { ...report, images: report.images.map(({ image: _image, ...row }) => row) };
    writeFileSync(
      `test-results/a36-evidence/${wet ? 'wet' : 'dry'}-report.json`,
      JSON.stringify(receipt, null, 2),
    );
    await info.attach(`a36-${wet ? 'wet' : 'dry'}.json`, {
      body: JSON.stringify(receipt, null, 2),
      contentType: 'application/json',
    });
    expect(report.images).toHaveLength(10);
    expect(report.garage.workshop).toMatchObject({
      assetId: 'A36',
      loaded: true,
      attached: true,
      instances: 4,
      drawBatches: 1,
      finalArtApproved: false,
    });
    expect(report.neighbouringAssets.overhead?.loaded).toBe(true);
    expect(report.neighbouringAssets.blankets).not.toBeNull();
    expect(report.neighbouringAssets.tyreStorage).not.toBeNull();
    expect(report.frameUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    for (const survey of report.surveys) {
      expect(survey.after).toEqual(survey.before);
      expect(survey.lods).toEqual([0, 1, 2, 0]);
      expect(survey.glError).toBe(0);
    }
    expect(errors).toEqual([]);
  });
}
