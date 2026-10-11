import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { H, F, carBase } from '../src/simulation/protocol.ts';

async function load(page: Page) {
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
}
async function capture(page: Page, info: TestInfo, name: string) {
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await info.attach(name, { body: Buffer.from(data, 'base64'), contentType: 'image/png' });
  await cdp.detach();
}
test('Race-Day V2: normal entry, immutable briefing, automatic clearance, race finish and replay', async ({
  page,
}, info) => {
  test.setTimeout(900000);
  await page.setViewportSize({ width: 960, height: 600 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const diag = () => page.evaluate(() => window.apexDiagnostics());
  await load(page);
  await page.selectOption('#laps', '1');
  await page.selectOption('#opponents', '3');
  await page.selectOption('#startSlot', 'midfield');
  await page.selectOption('#compound', 'hard');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await expect(page.locator('#raceBriefing')).toBeVisible({ timeout: 120000 });
  const before = (await diag()).frame!;
  expect(before[H.TICK]).toBe(0);
  await expect(page.locator('#raceBriefing')).toContainText('HARD');
  await expect(page.locator('#raceBriefing')).toContainText(before[carBase(0) + F.FUEL].toFixed(1));
  await capture(page, info, 'race-day-briefing.png');
  await page.getByRole('button', { name: 'WATCH GRID PREPARATION', exact: true }).click();
  await expect(page.locator('.grid-timeline')).toBeHidden();
  await expect.poll(async () => (await diag()).gridPresentation.time).toBeGreaterThan(0.2);
  await page.getByRole('button', { name: 'PAUSE PREPARATION', exact: true }).click();
  expect((await diag()).gridPresentation.playing).toBe(false);
  expect((await diag()).frame).toEqual(before);
  await page.getByRole('button', { name: 'BACK TO BRIEFING', exact: true }).click();
  await expect(page.locator('#raceBriefing')).toBeVisible();
  expect((await diag()).frame).toEqual(before);
  await page.getByRole('button', { name: 'WATCH GRID PREPARATION', exact: true }).click();
  // The actual clock is allowed to run; no debug clock or race writes.
  await expect
    .poll(async () => (await diag()).gridPresentation.time, { timeout: 300000 })
    .toBeGreaterThan(12);
  await capture(page, info, 'race-day-crew-working.png');
  await expect
    .poll(async () => (await diag()).state, { timeout: 420000, intervals: [1500] })
    .toBe('driving');
  expect((await diag()).renderer?.gridPerformance?.parked).toBe(true);
  // The grid is clear once racing: the crews have gone to the garages.
  expect((await diag()).renderer?.gridPerformance?.actors).toBe(0);
  await page.keyboard.press('g');
  await expect.poll(async () => (await diag()).frame?.[H.PHASE], { timeout: 60000 }).toBe(2);
  await capture(page, info, 'race-day-driving-hud.png');
  await expect
    .poll(async () => (await diag()).state, { timeout: 300000, intervals: [1500] })
    .toBe('results');
  await capture(page, info, 'race-day-classification.png');
  await page.getByRole('button', { name: 'WATCH REPLAY', exact: true }).click();
  await expect.poll(async () => (await diag()).state).toBe('replay');
  await page.locator('#replayBar [data-action=replayExit]').click();
  await expect.poll(async () => (await diag()).state).toBe('results');
  await page.locator('#modal [data-action=menu]').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Race-Day V2: Quick Start is saved, skips future briefings, and never replaces paused inspection', async ({
  page,
}) => {
  test.setTimeout(420000);
  await page.setViewportSize({ width: 800, height: 600 });
  await load(page);
  await page.selectOption('#opponents', '0');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await expect(page.locator('#raceBriefing')).toBeVisible({ timeout: 120000 });
  await page.locator('#raceDayQuickStart').check();
  // Read the committed preference, not a fabricated localStorage substitute.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open('apex-formula', 1);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const value = await new Promise<{ quickStart?: boolean }>((resolve, reject) => {
          const r = db.transaction('saved').objectStore('saved').get('settings');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        db.close();
        return value?.quickStart;
      }),
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  await page.selectOption('#opponents', '0');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.apexDiagnostics().state), { timeout: 120000 })
    .toBe('driving');
  await expect(page.locator('#raceBriefing')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).toBeVisible();
  await page.getByRole('button', { name: 'RETURN TO PADDOCK', exact: true }).click();
  await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.apexDiagnostics().state), { timeout: 120000 })
    .toBe('paused');
  expect((await page.evaluate(() => window.apexDiagnostics())).frame?.[H.TICK]).toBe(0);
  await expect(
    page.getByRole('button', { name: 'PRE-RACE PRESENTATION', exact: true }),
  ).toBeVisible();
});
