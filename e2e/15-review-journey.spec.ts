import { finishRaceEntry } from './race-entry.ts';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readPresentationReport } from '../src/rendering/presentation-review.ts';
const diag = (page: Page) => page.evaluate(() => window.apexDiagnostics());
async function ready(page: Page) {
  await page.goto('/?dev');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  // Functional UI journey, not the high-fidelity visual acceptance suite.
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#modal')).toBeHidden();
}
test('reference capture uses the actual production PNG and can be unlinked without overwriting its audit', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await page.getByRole('button', { name: 'REFERENCE REVIEW', exact: true }).click();
  await page.locator('#referenceSearch').fill('002');
  await page.locator('[data-reference="2"] summary').click();
  await page.locator('[data-action="reference:2"]').click();
  await expect(page.locator('#photoReference')).toContainText('Reference 002 linked');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'DOWNLOAD PNG', exact: true }).click();
  const download = await pending,
    path = await download.path();
  expect(download.suggestedFilename()).toMatch(/^apex-reference-002-[0-9a-f]{12}-\d+\.png$/);
  const png = await readFile(path!);
  await expect(page.locator('#photoStatus')).toContainText('exported and hashed', {
    timeout: 90000,
  });
  await page.getByRole('button', { name: 'UNLINK REFERENCE', exact: true }).click();
  await expect(page.locator('#photoReference')).toContainText('Unlinked PNG');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'REFERENCE REVIEW', exact: true }).click();
  const auditPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'EXPORT ALL 100 COMPARISONS' }).click();
  const auditPath = await (await auditPending).path();
  const text = await readFile(auditPath!, 'utf8'),
    audit = JSON.parse(text);
  expect(audit.decisions).toHaveLength(100);
  const row = audit.decisions.find((r: { id: number }) => r.id === 2);
  expect(row.status).toBe('needs-work');
  expect(row.capture.source).toBe(audit.source);
  expect(row.capture.imageHash).toBe(createHash('sha256').update(png).digest('hex'));
  expect(row.capture.imageFile).toBe(download.suggestedFilename());
  await info.attach('production-reference-counterpart.png', {
    body: png,
    contentType: 'image/png',
  });
  await info.attach('production-reference-audit.json', {
    body: text,
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
test('live review exports every observed frame and interrupts on a real viewport change', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await page.locator('#mode').selectOption('practice');
  await page.locator('#opponents').selectOption('0');
  await page.getByRole('button', { name: /ENTER CIRCUIT/ }).click();
  await finishRaceEntry(page);
  await expect.poll(async () => (await diag(page)).state, { timeout: 90000 }).toBe('driving');
  await page.keyboard.press('g');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'FULL-LAP VISUAL REVIEW', exact: true }).click();
  await page.locator('#reviewMachine').fill('CI software renderer, not consumer hardware');
  await page.locator('#reviewWorkload').selectOption('other');
  await page.locator('#reviewMode').selectOption('timed-scene');
  await page.getByRole('button', { name: 'RESUME & RECORD REVIEW' }).click();
  await expect
    .poll(async () => (await diag(page)).presentationReview.state, { timeout: 90000 })
    .toBe('complete');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'FULL-LAP VISUAL REVIEW', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'EXPORT FRAME JSON', exact: true }).click();
  const path = await (await pending).path(),
    raw = await readFile(path!, 'utf8');
  const report = readPresentationReport(JSON.parse(raw));
  expect(report.context.mode).toBe('timed-scene');
  expect(report.state).toBe('complete');
  expect(report.summary.elapsedMs).toBeGreaterThanOrEqual(30000);
  expect(report.rows.length).toBeGreaterThan(5);
  expect(report.summary.averageDrawCalls).toBeGreaterThan(0);
  expect(report.summary.visualAccepted).toBe(false);
  expect(report.context.source).toMatch(/^[a-f0-9]{64}$/);
  await info.attach('actual-ui-review.json', { body: raw, contentType: 'application/json' });
  await page.locator('#reviewWorkload').selectOption('other');
  await page.getByRole('button', { name: 'RESUME & RECORD REVIEW' }).click();
  await page.setViewportSize({ width: 1300, height: 800 });
  await expect.poll(async () => (await diag(page)).presentationReview.state).toBe('interrupted');
  expect((await diag(page)).presentationReview.reason).toBe('Viewport changed');
  expect(errors).toEqual([]);
});
