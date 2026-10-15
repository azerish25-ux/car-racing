import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { REFERENCES } from '../src/ui/reference-catalogue.ts';
import type * as Fixture from './fixtures/phase27e.ts';
async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/phase27e.ts'), name: 'Phase27E', formats: ['iife'] },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('No Phase 27E bundle');
  const chunk = output.output.find((part) => part.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('No Phase 27E script');
  await page.setContent('<!doctype html><title>Phase 27E production-component regressions</title>');
  await page.addScriptTag({ content: chunk.code });
  return errors;
}
test('actual rear-signal uniforms tint nearby spray and freeze/rewind without mutating its pool', async ({
  page,
}, info) => {
  const errors = await load(page);
  const result = await page.evaluate(() =>
    (window as unknown as { Phase27E: typeof Fixture }).Phase27E.signalSprayGPU(),
  );
  await info.attach('rear-signal-spray.png', {
    body: Buffer.from(result.image.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
  await info.attach('rear-signal-metrics.json', {
    body: JSON.stringify({ ...result, image: undefined, errors }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.sourceUnchanged).toBe(true);
  // Bounded rain-light in-scatter (SPRAY_SIGNAL): clearly tinted, never
  // painted red; an LED's increment is capped at half the puff's ambient.
  expect(result.on[0]).toBeGreaterThan(result.off[0] * 1.25);
  expect(result.on[0]).toBeLessThan(result.off[0] * 2);
  expect(result.on[0] - result.off[0]).toBeGreaterThan((result.on[1] - result.off[1]) * 3);
  expect(result.distant).toEqual(result.off);
  expect(result.pauseExact).toBe(true);
  expect(result.rewindExact).toBe(true);
  expect(result.draws).toBe(1);
  expect(result.triangles).toBe(2);
});
test('reference comparison UI requires a real capture and explicit reviewer without hiding original routes', async ({
  page,
}) => {
  const errors = await load(page);
  const setup = await page.evaluate(() =>
    (window as unknown as { Phase27E: typeof Fixture }).Phase27E.beginReferenceEvidenceUI(),
  );
  expect(setup.rows).toBe(100);
  const id = 1,
    row = page.locator(`[data-reference="${id}"]`);
  await row.locator('summary').click();
  await page.locator(`#qualityChoice${id}`).selectOption('accepted');
  await page.locator(`#qualityReviewer${id}`).fill('Test reviewer');
  await page.locator(`#qualityNotes${id}`).fill('Controlled test comparison');
  await page.locator(`[data-audit-save="${id}"]`).click();
  await expect(page.locator(`#qualityMessage${id}`)).toContainText('capture');
  const capture = {
    source: setup.source,
    referenceHash: REFERENCES[0].sha256,
    imageHash: createHash('sha256')
      .update(Buffer.from(setup.png.split(',')[1], 'base64'))
      .digest('hex'),
    imageFile: 'apex-reference-001-fixture.png',
    capturedAt: new Date().toISOString(),
    simulationTime: 1,
    width: 64,
    height: 64,
    view: '{"scope":"2D UI fixture, not game art"}',
  };
  await page.evaluate(
    ({ id, capture }) =>
      (window as unknown as { Phase27E: typeof Fixture }).Phase27E.attachReferenceEvidence(
        id,
        capture,
      ),
    { id, capture },
  );
  await page.locator(`[data-audit-save="${id}"]`).click();
  await expect(page.locator(`#qualityState${id}`)).toHaveText('ACCEPTED');
  expect(
    await page.evaluate(
      (id) =>
        (window as unknown as { Phase27E: typeof Fixture }).Phase27E.readReferenceEvidence(id)
          .status,
      id,
    ),
  ).toBe('accepted');
  await expect(row.locator('[data-action="reference:1"]')).toBeVisible();
  await page.locator('#referenceSearch').fill('095');
  await expect(page.locator('#referenceCount')).toHaveText('1 / 100');
  expect(errors).toEqual([]);
});
test('optional review video uses the real browser encoder and reports unsupported encoders explicitly', async ({
  page,
}, info) => {
  const errors = await load(page);
  const result = await page.evaluate(() =>
    (window as unknown as { Phase27E: typeof Fixture }).Phase27E.reviewVideoProbe(),
  );
  if (result.supported) {
    expect(result.state).toBe('ready');
    expect(result.encodedBytes).toBeGreaterThan(1000);
    expect(result.requestedFrames).toBe(20);
    await info.attach('review-video-encoder-fixture.webm', {
      body: Buffer.from(result.video.split(',')[1], 'base64'),
      contentType: 'video/webm',
    });
  } else {
    expect(result.state).toBe('unavailable');
    expect(result.reason).toBeTruthy();
  }
  await info.attach('video-lifecycle.json', {
    body: JSON.stringify({ ...result, video: undefined, errors }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(result.capturesAudio).toBe(false);
  expect(result.encodedFrameCount).toBeNull();
  expect(await page.locator('canvas').count()).toBe(0);
});
for (const night of [false, true]) {
  test(`full production renderer feeds real review metrics in wet ${night ? 'night' : 'day'} frames`, async ({
    page,
  }, info) => {
    const errors = await load(page);
    await page.setViewportSize({ width: 960, height: 540 });
    const result = await page.evaluate(
      (night) =>
        (window as unknown as { Phase27E: typeof Fixture }).Phase27E.reviewRendererProbe(night),
      night,
    );
    for (const capture of result.captures)
      await info.attach(`${capture.view}.png`, {
        body: Buffer.from(capture.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    await info.attach('rendered-review.json', {
      body: JSON.stringify(
        { ...result, errors, captures: result.captures.map(({ image: _image, ...rest }) => rest) },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
    expect(result.glError).toBe(0);
    expect(result.unchanged).toBe(true);
    expect(result.report.rows).toHaveLength(24);
    expect(result.report.state).toBe('interrupted');
    expect(result.report.reason).toContain('not a full-lap');
    expect(result.report.summary.visualAccepted).toBe(false);
    expect(result.report.summary.maximumDrawCalls).toBeGreaterThan(50);
    expect(result.signalSources).toBe(2);
    expect(result.metrics.rig).toBeGreaterThanOrEqual(0);
    expect(result.metrics.exposure).toBeGreaterThan(0);
    expect(result.captures).toHaveLength(4);
    expect(await page.locator('canvas').count()).toBe(0);
  });
}
