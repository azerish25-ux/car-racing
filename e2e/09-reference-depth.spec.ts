import { test, expect, type Page } from '@playwright/test';
const diag = (page: Page) => page.evaluate(() => window.apexDiagnostics());
async function ready(page: Page) {
  await page.goto('/?dev');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
}
async function input(page: Page, selector: string, value: string) {
  await page.locator(selector).evaluate((node, value) => {
    (node as HTMLInputElement).value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
// These require the REAL WebGL application. They are never replaced with the
// separately named DOM/Canvas2D fixture when GPU creation is unavailable.
test('reference depth: survey, focus and headquarters render without advancing the held scene', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const original = await diag(page);
  await page.getByRole('button', { name: 'REFERENCE REVIEW', exact: true }).click();
  const entry = page.locator('[data-reference="1"]');
  await entry.locator('summary').click();
  await entry.locator('[data-action="reference:1"]').click();
  await expect
    .poll(async () => (await diag(page)).renderer!.geometrySurvey.count)
    .toBeGreaterThan(0);
  expect((await diag(page)).renderer!.geometrySurvey.active).toBe(true);
  await info.attach('001-actual-geometry-split.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.locator('#photo-depthOfField').check();
  await page.locator('#photo-focusMode').selectOption('manual');
  await input(page, '#photo-focusDistance', '17');
  await expect.poll(async () => (await diag(page)).renderer!.photoFocus.focus).toBe(17);
  expect((await diag(page)).renderer!.photoFocus.enabled).toBe(true);
  await page.locator('#photoBackdrop').selectOption('headquarters');
  await expect.poll(async () => (await diag(page)).renderer!.photo!.backdrop).toBe('headquarters');
  expect((await diag(page)).renderer!.geometrySurvey.active).toBe(false);
  expect((await diag(page)).frame).toEqual(original.frame);
  await info.attach('016-original-workshop-with-focus.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  expect((await diag(page)).renderer!.photoFocus.enabled).toBe(false);
  expect((await diag(page)).renderer!.photo).toBeNull();
  expect((await diag(page)).frame).toEqual(original.frame);
  expect(errors).toEqual([]);
});

test('reference depth: independent decals and audio options survive the real application reload', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await page.getByRole('button', { name: 'PHOTO / LIVERY', exact: true }).click();
  for (const [id, text, side] of [
    ['1', 'NORTH', 'left'],
    ['6', 'SOUTH', 'right'],
  ]) {
    await page.locator('[data-decal="slot"]').selectOption(id);
    await page.locator('[data-decal="enabled"]').check();
    await page.locator('[data-decal="text"]').fill(text);
    await page.locator('[data-decal="side"]').selectOption(side);
  }
  await page.locator('#saveLivery').click();
  await expect(page.locator('#photoStatus')).toContainText('Livery saved');
  const saved = (await diag(page)).team.livery;
  expect(saved.decals?.map((r) => [r.id, r.text, r.side])).toEqual([
    [1, 'NORTH', 'left'],
    [6, 'SOUTH', 'right'],
  ]);
  await info.attach('031-actual-car-decal-editor.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name="cue_enabled"]').check();
  await page.locator('[name="cue_invertStereo"]').check();
  await input(page, '[name="cue_lookahead"]', '55');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  expect((await diag(page)).team.livery).toEqual(saved);
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await expect(page.locator('[name="cue_enabled"]')).toBeChecked();
  await expect(page.locator('[name="cue_invertStereo"]')).toBeChecked();
  await expect(page.locator('[name="cue_lookahead"]')).toHaveValue('55');
  expect(errors).toEqual([]);
});
