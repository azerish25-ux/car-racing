import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type * as Probe from './fixtures/probe-radiance.ts';

const read = (page: Page) => page.evaluate(() => window.apexDiagnostics());
async function capture(page: Page, info: TestInfo, name: string) {
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    });
    const png = Buffer.from(data, 'base64');
    expect(png.length).toBeGreaterThan(10000);
    expect(png.readUInt32BE(16)).toBe(1440);
    expect(png.readUInt32BE(20)).toBe(900);
    await info.attach(`${name}.png`, { body: png, contentType: 'image/png' });
  } finally {
    await session.detach();
  }
}

test('local night radiance is not attenuated twice and rewind does not accumulate reflections', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/probe-radiance.ts'),
        name: 'ProbeRadiance',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing fixture chunk');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>Controlled scene radiance inspection</title>');
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate(() =>
    (window as unknown as { ProbeRadiance: typeof Probe }).ProbeRadiance.probeRadianceGPU(),
  );
  for (const image of result.captures)
    await info.attach(`${image.name}.png`, {
      body: Buffer.from(image.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('probe-radiance.json', {
    contentType: 'application/json',
    body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
  });
  const find = (name: string) => {
    const value = result.captures.find((image) => image.name === name);
    if (!value) throw new Error(`Missing image ${name}`);
    return value;
  };
  const correct = find('night-local-radiance'),
    control = find('double-attenuation-control');
  expect(correct.mean).toBeGreaterThan(10);
  expect(correct.mean).toBeGreaterThan(control.mean * 1.5);
  expect(correct.gain).toBe(1);
  for (const name of ['held-radiance', 'held-again', 'history-free-recapture', 'rewound-lamp']) {
    const image = find(name);
    expect(image.hash).toBe(correct.hash);
    expect(image.calls).toBe(correct.calls);
    expect(image.triangles).toBe(correct.triangles);
    expect(image.visibleSky).toBe(1);
  }
  expect(find('moved-lamp').hash).not.toBe(correct.hash);
  expect(result.updatesAfter).toBe(result.updatesBefore);
  expect(result.after).toEqual(result.before);
  expect(result.probeSky.length).toBeGreaterThanOrEqual(12);
  expect(result.probeSky.every((value) => value === result.expectedSkyGain)).toBe(true);
  expect(result.mainSky.length).toBeGreaterThan(0);
  expect(result.mainSky.every((value) => value === 1)).toBe(true);
  expect(result.restoredMaps).toBe(true);
  expect(result.restoredGains).toEqual([result.expectedSkyGain, result.expectedSkyGain]);
  expect(result.glError).toBe(0);
  expect(errors).toEqual([]);
});

test('normal-resolution eight-car night inspection follows the selected car and restores a held race', async ({
  page,
}, info) => {
  test.setTimeout(600000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('.presentation-details > summary').click();
  await page.locator('[name=graphics_reflections]').selectOption('local');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await expect(page.locator('#modal')).toBeHidden();
  await page.selectOption('#mode', 'race');
  await page.selectOption('#laps', '5');
  await page.selectOption('#opponents', '7');
  await page.selectOption('#weather', 'rain');
  await page.selectOption('#compound', 'wet');
  await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
  // Cold full-grid initialization under software rasterization can outlast the
  // generic 60 s expectation; do not accept anything short of a real pause.
  await expect.poll(async () => (await read(page)).state, { timeout: 180000 }).toBe('paused');
  await expect
    .poll(async () => (await read(page)).workerPause)
    .toMatchObject({ pending: false, paused: true });
  await page.locator('#modal [data-action="academy"]').click();
  const daytime = await read(page);
  await page.locator('#modal [data-action="lighting:night"]').click();
  await expect.poll(async () => (await read(page)).renderer?.lighting).toBe('night');
  await page.locator('#modal [data-action="modalClose"]').click();
  await page.getByRole('button', { name: 'PHOTO STUDIO', exact: true }).click();
  await expect.poll(async () => (await read(page)).state).toBe('photo');
  await page.selectOption('#photo-view', 'chase');
  await expect.poll(async () => (await read(page)).renderer?.localProbeActive).toBe(true);
  // Requested lighting changes before the GPU can present it. The first capture
  // must witness actual night lamps and a fresh scene probe, not a daytime buffer
  // carrying a newly selected 'night' label while the render queue is busy.
  await expect
    .poll(async () => (await read(page)).presentation?.frames ?? 0)
    .toBeGreaterThan(daytime.presentation!.frames);
  await expect.poll(async () => (await read(page)).renderer?.venueLighting.nearbyLights).toBe(4);
  await expect
    .poll(async () => (await read(page)).renderer?.reflectionProbeUpdates ?? 0)
    .toBeGreaterThan(daytime.renderer!.reflectionProbeUpdates);
  const first = await read(page);
  expect(first.renderer!.graphics.resolutionScale).toBe(1);
  expect(first.renderer!.reflectionIntensity).toBe(1);
  expect(first.renderer!.visibleSkyIntensity).toBe(1);
  await capture(page, info, 'night-eight-car-local-reflections');
  await page.selectOption('#photoTarget', '1');
  await page.selectOption('#photo-view', 'cockpit');
  await expect.poll(async () => (await read(page)).renderer?.reflectionSubject).toBe(1);
  await expect.poll(async () => (await read(page)).renderer?.driverPose?.car).toBe(1);
  await expect
    .poll(async () => (await read(page)).renderer?.mirrorUpdates ?? 0)
    .toBeGreaterThan(first.renderer!.mirrorUpdates);
  const other = await read(page);
  expect(other.photoTime).toBe(first.photoTime);
  expect(other.renderer!.reflectionIntensity).toBe(1);
  expect(other.renderer!.visibleSkyIntensity).toBe(1);
  await capture(page, info, 'night-second-car-cockpit');
  await page.selectOption('#photoTarget', '0');
  await page.selectOption('#photo-view', 'chase');
  await expect.poll(async () => (await read(page)).renderer?.reflectionSubject).toBe(0);
  const returned = await read(page);
  expect(returned.photoTime).toBe(first.photoTime);
  expect(returned.renderer!.reflectionIntensity).toBe(1);
  await capture(page, info, 'night-returned-player');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await read(page)).state).toBe('paused');
  await expect
    .poll(async () => (await read(page)).workerPause)
    .toMatchObject({ pending: false, paused: true });
  await info.attach('night-photo-ownership.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        boundary:
          'Actual production scene at 1440x900; software-GPU evidence, not physical hardware or human driving approval',
        first,
        other,
        returned,
      },
      null,
      2,
    ),
  });
  expect(errors).toEqual([]);
});
