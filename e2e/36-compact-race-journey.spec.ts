import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { H } from '../src/simulation/protocol.ts';
import { readPerformanceReport } from '../src/core/performance.ts';

// Functional workload on the hosted software GPU, not consumer-PC certification.
// The existing full-lap, wet-following and complete pit suites remain unchanged.
test.use({
  viewport: { width: 640, height: 400 },
  video: { mode: 'on', size: { width: 640, height: 400 } },
});
test('compact race information stays live through a populated dusk drive, measured capture and recorded replay', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const diag = () => page.evaluate(() => window.apexDiagnostics());
  const capture = async (name: string) => {
    const cdp = await page.context().newCDPSession(page);
    try {
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
        optimizeForSpeed: true,
      });
      await info.attach(`${name}.png`, {
        body: Buffer.from(data, 'base64'),
        contentType: 'image/png',
      });
    } finally {
      await cdp.detach();
    }
  };
  await page.goto('/?dev');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await expect(page.locator('#modal')).toBeHidden();
  await page.selectOption('#mode', 'race');
  await page.selectOption('#opponents', '7');
  await page.selectOption('#laps', '5');
  await page.selectOption('#weather', 'clear');
  await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
  await expect
    .poll(async () => (await diag()).workerPause)
    .toMatchObject({ paused: true, pending: false });
  await page.getByRole('button', { name: 'AI DRIVER', exact: true }).click();
  await expect.poll(async () => (await diag()).auto).toBe(true);
  await page.locator('#modal [data-action="academy"]').click();
  await page.locator('#modal [data-action="lighting:sunset"]').click();
  await page.locator('#modal [data-action="modalClose"]').click();
  await expect.poll(async () => (await diag()).renderer?.lighting).toBe('sunset');
  await page.getByRole('button', { name: 'PERFORMANCE CAPTURE', exact: true }).click();
  await page
    .locator('#profileMachine')
    .fill('Hosted 640x400 Low; software GPU, not consumer hardware');
  await page
    .locator('#profileWorkload')
    .fill('Eight-car dusk grid and driving; compact live information panel opened and closed');
  await page.getByRole('button', { name: 'RESUME & CAPTURE', exact: true }).click();
  await expect.poll(async () => (await diag()).state).toBe('driving');
  await expect(page.locator('#fuel')).toBeVisible();
  await expect(page.locator('#battery')).toBeVisible();
  await expect(page.locator('.timing')).toBeHidden();
  await expect.poll(async () => (await diag()).frame?.[H.TIME] ?? 0).toBeGreaterThan(7);
  const before = await diag();
  await page.getByRole('button', { name: 'RACE INFO', exact: true }).click();
  await expect(page.locator('.tower-row')).toHaveCount(8);
  await expect
    .poll(async () => (await diag()).frame?.[H.TIME] ?? 0)
    .toBeGreaterThan(before.frame![H.TIME] + 1);
  expect((await diag()).state).toBe('driving');
  await capture('compact-dusk-live-information');
  await page.getByRole('button', { name: 'CLOSE INFO', exact: true }).click();
  await capture('compact-dusk-driving-view');
  await expect
    .poll(async () => (await diag()).performanceCapture.state, { timeout: 90000 })
    .toBe('complete');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await diag()).workerPause)
    .toMatchObject({ paused: true, pending: false });
  await page.getByRole('button', { name: 'PERFORMANCE CAPTURE', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'EXPORT PERFORMANCE JSON', exact: true }).click();
  const path = await (await download).path();
  expect(path).not.toBeNull();
  const text = await readFile(path!, 'utf8');
  const report = readPerformanceReport(JSON.parse(text));
  expect(report.state).toBe('complete');
  expect(report.summary.elapsedMs).toBeGreaterThanOrEqual(30000);
  expect(report.summary.samples).toBeGreaterThan(5);
  expect(report.summary.averageDrawCalls).toBeGreaterThan(0);
  expect(report.summary.averageTriangles).toBeGreaterThan(0);
  expect(report.summary.averageRenderCPUms).toBeGreaterThan(0);
  expect(report.context.source).toMatch(/^[0-9a-f]{64}$/);
  await info.attach('compact-dusk-whole-application-performance.json', {
    body: text,
    contentType: 'application/json',
  });
  await page.locator('#modal [data-action="modalClose"]').click();
  await page.getByRole('button', { name: 'WATCH REPLAY', exact: true }).click();
  await expect(page.locator('#replayBar')).toBeVisible();
  if ((await diag()).replayPlaying) await page.locator('#replayPlay').click();
  await expect.poll(async () => (await diag()).replayPlaying).toBe(false);
  await expect.poll(async () => (await diag()).replaySeekPending).toBe(false);
  const held = await diag();
  await page.getByRole('button', { name: 'RACE INFO', exact: true }).click();
  await expect(page.locator('.tower-row')).toHaveCount(8);
  await capture('compact-recorded-replay-information');
  const after = await diag();
  expect(after.replayPosition).toBe(held.replayPosition);
  expect(after.workerPause).toMatchObject({ paused: true, pending: false });
  await page.keyboard.press('Escape');
  await expect(page.locator('.race-info-panels')).toBeHidden();
  expect((await diag()).state).toBe('replay');
  await page.locator('#replaySeek').press('Home');
  await expect.poll(async () => (await diag()).replaySeekPending).toBe(false);
  await page.locator('#replayBar [data-action="camera"]').click();
  await expect
    .poll(async () => {
      const r = (await diag()).renderer;
      return r?.presentedCamera === r?.requestedCamera;
    })
    .toBe(true);
  await capture('compact-recorded-replay-camera');
  await page.locator('#replayBar [data-action="replayExit"]').click();
  await expect.poll(async () => (await diag()).state).toBe('paused');
  expect(errors).toEqual([]);
  await info.attach('compact-race-journey-diagnostics.json', {
    body: JSON.stringify(await diag(), null, 2),
    contentType: 'application/json',
  });
});
