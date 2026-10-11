import { finishRaceEntry } from './race-entry.ts';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { SessionReviewReport } from '../src/core/session-review.ts';

test('actual race UI records source-bound session observations and never certifies an automated drive', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?dev');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  // This is a low-cost functional journey. High-fidelity GPU gates are separate.
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name="quality"]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await page.getByRole('button', { name: 'SESSION 146 EVIDENCE', exact: true }).click();
  await page.locator('#sessionReviewer').fill('CI automation — not a human drive');
  await page.locator('#sessionReviewMachine').fill('CI renderer — not Windows hardware acceptance');
  await page.getByRole('button', { name: 'ARM FROM PADDOCK', exact: true }).click();
  await page.locator('#mode').selectOption('race');
  await page.locator('#opponents').selectOption('0');
  await page.getByRole('button', { name: /ENTER CIRCUIT/ }).click();
  await finishRaceEntry(page);
  await expect
    .poll(() => page.evaluate(() => window.apexDiagnostics().state), { timeout: 90000 })
    .toBe('driving');
  await expect
    .poll(() => page.evaluate(() => window.apexDiagnostics().sessionReview.snapshots), {
      timeout: 90000,
    })
    .toBeGreaterThan(2);
  await page.keyboard.press('g'); // The evidence must expose automation, never silently approve it.
  await expect
    .poll(() => page.evaluate(() => window.apexDiagnostics().usedDemonstration), { timeout: 90000 })
    .toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'SESSION 146 EVIDENCE', exact: true }).click();
  await page.getByRole('button', { name: 'STOP OBSERVATIONS', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'EXPORT SESSION JSON', exact: true }).click();
  const download = await pending,
    text = await readFile((await download.path())!, 'utf8');
  const report: SessionReviewReport = JSON.parse(text);
  expect(report.identity.source).toMatch(/^[a-f0-9]{64}$/);
  expect(report.rows.length).toBeGreaterThan(2);
  expect(report.autopilotObserved).toBe(true);
  expect(report.integrityWarnings).toContain('mid-race-pause');
  expect(report.section146Accepted).toBe(false);
  expect(report.humanVerified).toBe(false);
  expect(report.startupCaptured).toBe(false);
  expect(report.audioVideoAttached).toBe(false);
  expect(report.events.some((e) => e.detail === 'autopilot')).toBe(true);
  await info.attach('actual-session-observations.json', {
    body: text,
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
