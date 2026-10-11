import { test, expect, type Page } from '@playwright/test';
import { H, F, carBase } from '../src/simulation/protocol.ts';
const diag = (page: Page) => page.evaluate(() => window.apexDiagnostics());
async function ready(page: Page) {
  await page.goto('/?dev');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
}
async function inspect(page: Page, id: number) {
  await page.getByRole('button', { name: 'REFERENCE REVIEW', exact: true }).click();
  const entry = page.locator(`[data-reference="${id}"]`);
  await entry.locator('summary').click();
  await entry.locator(`[data-action="reference:${id}"]`).click();
}
/** Observe completed production frames, not the selected lighting label alone.
 * Keep input live but reject a continuously rendered menu behind the preview. */
async function heldAcademy(page: Page) {
  const held = await page.evaluate(async () => {
    const before = window.apexDiagnostics();
    for (let callback = 0; callback < 8; callback++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const after = window.apexDiagnostics();
    return {
      before: before.presentation!.frames,
      after: after.presentation!.frames,
      inputBefore: before.inputPolls,
      inputAfter: after.inputPolls,
      frameBefore: before.frame,
      frameAfter: after.frame,
      covered: after.presentation!.menuCovered,
      state: after.state,
    };
  });
  expect(held.state).toBe('menu');
  expect(held.covered).toBe(true);
  expect(held.after).toBe(held.before);
  expect(held.inputAfter).toBeGreaterThan(held.inputBefore);
  expect(held.frameAfter).toEqual(held.frameBefore);
  return held;
}
test('reference continuation: native showroom and grid views preserve the held simulation', async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const original = await diag(page);
  await inspect(page, 5);
  await expect(page.locator('#photoBackdrop')).toHaveValue('studio');
  await expect.poll(async () => (await diag(page)).renderer!.photo!.backdrop).toBe('studio');
  await expect(page.locator('#photoStatus')).toContainText('REFERENCE 005');
  await info.attach('reference-005-native-showroom.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  const held = await diag(page);
  expect(held.frame).toEqual(original.frame);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  expect((await diag(page)).renderer!.photo).toBeNull();
  await inspect(page, 47);
  await expect.poll(async () => (await diag(page)).renderer!.gridPreparation.blankets).toBe(4);
  await info.attach('reference-047-grid-blankets.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  expect((await diag(page)).frame).toEqual(original.frame);
  expect(errors).toEqual([]);
});
test('reference continuation: night and guide controls are real, reversible and non-physical', async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const original = await diag(page);
  await inspect(page, 79);
  await expect(page.locator('.driving-academy')).toBeVisible();
  await expect.poll(async () => (await diag(page)).renderer!.venueLighting.nearbyLights).toBe(4);
  expect((await diag(page)).renderer!.night).toBe(true);
  const night = await heldAcademy(page);
  await info.attach('reference-079-night-preview-held.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.locator('[data-action="guide:full"]').click();
  expect((await diag(page)).renderer!.guide.mode).toBe('full');
  await expect.poll(async () => (await diag(page)).presentation!.frames).toBe(night.after + 1);
  const guide = await heldAcademy(page);
  await page.locator('[data-action="modalClose"]').click();
  await info.attach('reference-079-original-night-venue.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect((await diag(page)).frame).toEqual(original.frame);
  const academy = page.getByRole('button', { name: 'DRIVING ACADEMY', exact: true });
  await academy.evaluate((button) => {
    button.addEventListener(
      'click',
      () => {
        document.body.dataset.academyOpenFrames = String(
          window.apexDiagnostics().presentation!.frames,
        );
      },
      { capture: true, once: true },
    );
  });
  await academy.click();
  // Opening the Academy requests one preview. Wait for its completed frame,
  // including GPU backpressure, before observing the following control action.
  const beforeOpen = await page.evaluate(() => Number(document.body.dataset.academyOpenFrames));
  await expect.poll(async () => (await diag(page)).presentation!.frames).toBe(beforeOpen + 1);
  await heldAcademy(page);
  const dayControl = page.locator('[data-action="lighting:day"]');
  await dayControl.evaluate((button) => {
    button.addEventListener(
      'click',
      () => {
        document.body.dataset.lightingPreviewFrames = String(
          window.apexDiagnostics().presentation!.frames,
        );
      },
      { capture: true, once: true },
    );
  });
  await dayControl.click();
  await expect.poll(async () => (await diag(page)).renderer!.venueLighting.nearbyLights).toBe(0);
  expect((await diag(page)).renderer!.night).toBe(false);
  const day = await heldAcademy(page);
  const beforeDay = await page.evaluate(() => Number(document.body.dataset.lightingPreviewFrames));
  expect(day.after).toBe(beforeDay + 1);
  expect((await diag(page)).frame).toEqual(original.frame);
  expect((await diag(page)).frame![H.WATER]).toBe(original.frame![H.WATER]);
  await info.attach('reference-079-preview-ownership.json', {
    body: JSON.stringify({ night, guide, day }),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
test('reference continuation: explicit programme replacement, live chevrons and no replay awards', async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await page.getByRole('button', { name: 'DRIVING ACADEMY', exact: true }).click();
  await page.locator('[data-action="academy:start"]').click();
  await expect(page.getByRole('heading', { name: 'Replace the current session?' })).toBeVisible();
  expect((await diag(page)).state).toBe('menu');
  await page.locator('[data-action="academy:confirm"]').click();
  await expect.poll(async () => (await diag(page)).state, { timeout: 90000 }).toBe('driving');
  expect((await diag(page)).options).toMatchObject({
    mode: 'practice',
    opponents: 0,
    compound: 'medium',
    weather: 'clear',
  });
  await expect.poll(async () => (await diag(page)).renderer!.guide.markers).toBe(64);
  await expect(page.locator('#programmeHud')).toContainText('BANK A CLEAN LAP');
  await info.attach('reference-037-live-guidance.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('g');
  await expect
    .poll(async () => (await diag(page)).frame![carBase(0) + F.SPEED], { timeout: 60000 })
    .toBeGreaterThan(10);
  const progress = (await diag(page)).practiceProgramme;
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'WATCH REPLAY', exact: true }).click();
  await expect.poll(async () => (await diag(page)).state).toBe('replay');
  await expect(page.locator('#programmeHud')).toContainText('AWARDS PAUSED');
  expect((await diag(page)).practiceProgramme).toEqual(progress);
  expect(errors).toEqual([]);
});
