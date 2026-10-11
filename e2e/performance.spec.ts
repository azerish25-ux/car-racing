import { finishRaceEntry } from './race-entry.ts';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readPerformanceReport } from '../src/core/performance.ts';

test('performance capture exports real frames and a second dialog never reuses detached controls', async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?dev');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#modal')).toBeHidden();
  await page.locator('#mode').selectOption('practice');
  await page.locator('#opponents').selectOption('0');
  await page.getByRole('button', { name: /ENTER CIRCUIT/ }).click();
  await finishRaceEntry(page);
  await expect.poll(() => page.evaluate(() => window.apexDiagnostics().state), { timeout: 60000 })
    .toBe('driving');
  await page.keyboard.press('g');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'PERFORMANCE CAPTURE', exact: true }).click();
  await page.locator('#profileMachine').fill('CI SwiftShader — not consumer GPU certification');
  await page.locator('#profileWorkload').fill('seeded solo practice, AI, chase');
  await page.getByRole('button', { name: 'RESUME & CAPTURE', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.apexDiagnostics().performanceCapture.state),
    { timeout: 90000 }).toBe('complete');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'PERFORMANCE CAPTURE', exact: true }).click();
  await expect(page.locator('#profileMachine')).toHaveValue('CI SwiftShader — not consumer GPU certification');
  await expect(page.locator('#profileStatus')).toContainText('COMPLETE');
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
  await info.attach('software-rendered-performance.json', { body: text, contentType: 'application/json' });

  // A real viewport change interrupts the next capture; it must not silently
  // compare different pixel budgets or keep the previous completed report.
  await page.getByRole('button', { name: 'RESUME & CAPTURE', exact: true }).click();
  await page.setViewportSize({ width: 1300, height: 800 });
  await expect.poll(() => page.evaluate(() => window.apexDiagnostics().performanceCapture.state))
    .toBe('interrupted');
  expect(errors).toEqual([]);
});
