import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { surveyStartFinish } from './fixtures/start-finish.ts';
import { H } from '../src/simulation/protocol.ts';

// Baseline keeps the same rendering, frame and image checks; only assertions
// for newly introduced diagnostics are conditional in matched comparison runs.
const baseline = process.env.VENUE_BASELINE === '1';

for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`Aurel start-finish: production ${lighting} architecture, audience, screen and rewind`, async ({
    page,
  }, info) => {
    test.setTimeout(420000);
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/start-finish.ts'),
          name: 'VenueSurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing venue fixture output');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing venue survey code');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/venue-survey', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Aurel venue survey</title>',
      }),
    );
    await page.goto('/venue-survey');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      (lighting) =>
        (
          window as unknown as { VenueSurvey: { surveyStartFinish: typeof surveyStartFinish } }
        ).VenueSurvey.surveyStartFinish(lighting),
      lighting,
    );
    for (const image of report.images)
      await info.attach(`venue-${lighting}-${image.name}.png`, {
        body: Buffer.from(image.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    await info.attach(`venue-${lighting}.json`, {
      body: JSON.stringify(
        { ...report, images: report.images.map(({ image: _image, ...r }) => r), errors },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
    expect(report.offline).toBe(false);
    expect(report.glError).toBe(0);
    expect(report.contextLost).toBe(false);
    expect(report.sourceUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    expect(report.heldBoardStable).toBe(true);
    expect(report.rewindMaxError).toBe(0);
    expect(report.before).toEqual(report.after);
    if (!baseline) {
      expect(report.venue).toMatchObject({ stands: 2, boards: 1, finalArtApproved: false });
      expect(report.far!.detailLevels.every((g) => g.level === 2)).toBe(true);
      expect(report.marshal.active).toBeGreaterThan(0);
      expect(report.marshal.gripError).toBeLessThan(0.00001);
      expect(report.marshal.unreachable).toBe(0);
      expect(report.boardSurface).toMatchObject({ width: 1024, height: 512, dynamic: true });
      expect(report.boardSurface!.samples).toBe(4096);
      expect(report.boardSurface!.changed).toBeGreaterThan(200);
      expect(report.boardSurface!.peakDelta).toBeGreaterThan(60);
    }
    expect(report.images).toHaveLength(6);
    for (const image of report.images) {
      expect(image.lit, image.name).toBeGreaterThan(0.2);
      expect(image.range, image.name).toBeGreaterThan(30);
      expect(image.calls).toBeLessThan(1800);
    }
  });
}

test('Aurel venue ships through ordinary menu, held grid, camera changes and start', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const diag = () => page.evaluate(() => window.apexDiagnostics());
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  expect((await diag()).renderer!.environmentAssets.startFinish).toMatchObject({
    stands: 2,
    boards: 1,
  });
  await page.selectOption('#mode', 'race');
  await page.selectOption('#opponents', '11');
  await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
  // A cold 12-car grid on a software rasterizer is GPU-process bound (shader
  // JIT plus the chase/cockpit warm-up draws): the same 180 s budget as the
  // other full-grid cases (53-a61-rival, 32-race-clarity). Measured locally on
  // Mesa llvmpipe, 53b6130 (last green) and b509815 take the same work -
  // byte-identical shader sources, 1331 draws / 9.41 M triangles, ~70-90 s
  // GPU-process CPU - and both straddle 60 s (54-87 s). Only a real paused
  // grid at tick 0 is accepted.
  await expect.poll(async () => (await diag()).state, { timeout: 180000 }).toBe('paused');
  await expect.poll(async () => (await diag()).frame?.[H.TICK] ?? -1).toBe(0);
  const before = (await diag()).frame;
  await page.getByRole('button', { name: 'CHANGE CAMERA', exact: true }).click();
  expect((await diag()).frame).toEqual(before);
  await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
  await expect.poll(async () => (await diag()).frame?.[H.TIME] ?? 0).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await diag()).state).toBe('paused');
  await info.attach('venue-held-race.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect((await diag()).renderer!.environmentAssets.startFinish).toMatchObject({
    stands: 2,
    boards: 1,
  });
  expect(errors).toEqual([]);
});

test('A45 explicit signal controls compile colour and directional/point shadows with held grips', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/start-finish.ts'),
        name: 'VenueSurvey',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw Error('Missing signal output');
  const chunk = output.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw Error('Missing signal shader probe');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setContent('<!doctype html><title>Explicit marshal signal shader controls</title>');
  await page.addScriptTag({ content: chunk.code });
  const report = await page.evaluate(() =>
    (
      window as unknown as {
        VenueSurvey: {
          probeMarshalShaders: typeof import('./fixtures/start-finish.ts').probeMarshalShaders;
        };
      }
    ).VenueSurvey.probeMarshalShaders(),
  );
  await info.attach('marshal-shader-controls.json', {
    body: JSON.stringify(
      { ...report, samples: report.samples.map(({ image: _image, ...r }) => r), errors },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  for (const sample of report.samples)
    await info.attach(`marshal-signal-control-${sample.signal}.png`, {
      body: Buffer.from(sample.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  expect(errors).toEqual([]);
  expect(report.glError).toBe(0);
  expect(report.contextLost).toBe(false);
  expect(report.samples).toHaveLength(5);
  expect(report.samples[0].flagCount).toBe(0);
  for (const sample of report.samples) {
    expect(sample.active).toBe(2);
    expect(sample.gripError).toBeLessThan(0.00001);
    expect(sample.unreachable).toBe(0);
    expect(sample.sum).toBeGreaterThan(960 * 600 * 255);
  }
  for (const sample of report.samples.slice(1)) expect(sample.flagCount).toBe(1);
  expect(new Set(report.samples.map((s) => s.sum)).size).toBeGreaterThanOrEqual(4);
});
