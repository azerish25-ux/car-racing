import { finishRaceEntry } from './race-entry.ts';
import { readFile } from 'node:fs/promises';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { H, carBase, F } from '../src/simulation/protocol.ts';
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
async function evidence(page: Page, info: TestInfo, name: string) {
  await info.attach(`${name}.png`, { body: await page.screenshot(), contentType: 'image/png' });
}
test('reference tools: actual livery pixels persist through save, quality changes and reload', async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await page.getByRole('button', { name: 'PHOTO / LIVERY', exact: true }).click();
  await expect(page.locator('#photoStudio')).toBeVisible();
  await input(page, '#liveryPrimary', '#2266bb');
  await input(page, '#liveryAccent', '#f5d54a');
  await page.locator('#liveryNumber').fill('42');
  await page.locator('#liverySponsor').fill('NORTH STAR');
  await page.locator('#liveryPattern').selectOption('split');
  await page.getByRole('button', { name: 'SAVE LIVERY', exact: true }).click();
  await expect(page.locator('#photoStatus')).toContainText('Livery saved');
  const edited = await diag(page);
  expect(edited.team.livery).toEqual({
    primary: '#2266bb',
    accent: '#f5d54a',
    number: 42,
    sponsor: 'NORTH STAR',
    pattern: 'split',
  });
  expect(edited.renderer!.playerPaint!.primary).toBe('#2266bb');
  for (const flank of edited.renderer!.playerPaint!.flankSizes)
    expect(flank.corner).toEqual([34, 102, 187, 255]);
  await input(page, '#photo-focalLength', '55');
  await input(page, '#photo-distance', '12');
  await evidence(page, info, '01-live-livery-studio');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'DOWNLOAD PNG', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^apex-photo-\d+\.png$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const png = await readFile(path!);
  await info.attach('02-exported-game-canvas.png', { body: png, contentType: 'image/png' });
  const pixels = await page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 36;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0, 64, 36);
    const bytes = context.getImageData(0, 0, 64, 36).data;
    return {
      width: image.width,
      height: image.height,
      colors: new Set(
        Array.from(
          { length: 64 * 36 },
          (_, i) => `${bytes[i * 4]},${bytes[i * 4 + 1]},${bytes[i * 4 + 2]}`,
        ),
      ).size,
    };
  }, png.toString('base64'));
  expect(pixels.colors).toBeGreaterThan(100);
  expect(pixels.width).toBe(edited.renderer!.renderWidth);
  expect(pixels.height).toBe(edited.renderer!.renderHeight);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name="quality"]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  for (const flank of (await diag(page)).renderer!.playerPaint!.flankSizes)
    expect(flank.corner).toEqual([34, 102, 187, 255]);
  await page.reload();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  expect((await diag(page)).team.livery.sponsor).toBe('NORTH STAR');
  expect((await diag(page)).renderer!.playerPaint!.primary).toBe('#2266bb');
  await page.getByRole('button', { name: 'PHOTO / LIVERY', exact: true }).click();
  await input(page, '#liveryPrimary', '#ff0000'); // unsaved preview must not leak out
  await page.getByRole('button', { name: 'RETURN / ESC', exact: true }).click();
  expect((await diag(page)).renderer!.playerPaint!.primary).toBe('#2266bb');
  expect(errors).toEqual([]);
});

test('reference tools: headquarters operations commit real economy and setup changes', async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await page.getByRole('button', { name: 'TEAM HQ', exact: true }).click();
  await expect(page.locator('.team-hub')).toBeVisible();
  await expect.poll(async () => (await diag(page)).presentation?.menuCovered).toBe(true);
  const covered = await diag(page);
  await page.waitForTimeout(250);
  const heldBackdrop = await diag(page);
  expect(heldBackdrop.presentation!.frames).toBe(covered.presentation!.frames);
  expect(heldBackdrop.inputPolls).toBeGreaterThan(covered.inputPolls);
  await evidence(page, info, '03-headquarters');
  await page.getByRole('button', { name: 'Engineering', exact: true }).click();
  await page.getByRole('button', { name: 'COMMISSION STUDY' }).first().click();
  await expect
    .poll(async () => (await diag(page)).team.research)
    .toEqual([{ id: 'traction', remaining: 2 }]);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'ADVANCE ONE WEEK', exact: true }).click();
    await expect.poll(async () => (await diag(page)).team.week).toBe(i + 2);
    await expect(page.locator('.team-hub[aria-busy="true"]')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'APPLY TO NEXT SESSION', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Study setup saved');
  await evidence(page, info, '04-completed-physics-study');
  await page.getByRole('button', { name: 'Personnel', exact: true }).click();
  await page.locator('[data-action="team:staff:engineering:2"]').click();
  await expect.poll(async () => (await diag(page)).team.workforce.engineering).toBe(10);
  await page.locator('[data-action="team:driver:sato"]').click();
  await expect.poll(async () => (await diag(page)).team.driver).toBe('sato');
  await evidence(page, info, '05-driver-contracts-and-workforce');
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  await expect(page.locator('.team-ledger')).toContainText('Mika Sato: signing fee');
  await expect(page.locator('.team-ledger')).toContainText('engineering: recruitment');
  await evidence(page, info, '06-saved-finance-ledger');
  const afterTransactions = await diag(page);
  expect(afterTransactions.presentation!.frames).toBe(heldBackdrop.presentation!.frames);
  const saved = afterTransactions.team;
  await page.reload();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  expect((await diag(page)).team).toEqual(saved);
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  expect(await page.locator('[name="diffPower"]').inputValue()).toBe('0.34');
  expect(await page.locator('[name="rearARB"]').inputValue()).toBe('16500');
  // Merely opening and saving the garage must not overwrite an off-step study value.
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#modal')).toBeHidden();
  await page.reload();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await expect(page.locator('[name="rearARB"]')).toHaveValue('16500');
  await expect(page.locator('[name="diffPower"]')).toHaveValue('0.34');
  expect(errors).toEqual([]);
});

test('reference tools: race and replay photo transitions freeze the displayed frame and never resume secretly', async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name="quality"]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.locator('#mode').selectOption('practice');
  await page.locator('#opponents').selectOption('3');
  await page.getByRole('button', { name: 'ENTER CIRCUIT' }).click();
  await finishRaceEntry(page);
  await expect.poll(async () => (await diag(page)).state, { timeout: 90000 }).toBe('driving');
  await page.keyboard.press('g');
  await expect
    .poll(async () => (await diag(page)).frame![carBase(0) + F.SPEED], { timeout: 90000 })
    .toBeGreaterThan(8);
  // Reaching 8 m/s does not guarantee enterReplay's one-second recording minimum.
  // Wait on recorded simulation time before pausing, not wall time or car speed.
  await expect
    .poll(async () => (await diag(page)).replaySeconds, { timeout: 90000 })
    .toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'PHOTO STUDIO', exact: true }).click();
  await expect.poll(async () => (await diag(page)).state).toBe('photo');
  await page.locator('#photoTarget').selectOption('2');
  await input(page, '#photo-elevation', '40');
  await input(page, '#photo-distance', '18');
  await page.waitForTimeout(500);
  const held = await diag(page);
  await page.waitForTimeout(1100);
  const later = await diag(page);
  expect(later.photoTime).toBe(held.photoTime);
  expect(later.presentation!.time).toBe(held.presentation!.time);
  expect(later.frame![H.TIME]).toBe(held.frame![H.TIME]);
  expect(later.renderer!.photo!.target).toBe(2);
  expect(later.team.rounds).toBe(0);
  await evidence(page, info, '07-frozen-live-grid-composition');
  await page.keyboard.press('Escape');
  expect((await diag(page)).state).toBe('paused');
  await page.getByRole('button', { name: 'WATCH REPLAY', exact: true }).click();
  await expect.poll(async () => (await diag(page)).state).toBe('replay');
  await page.getByRole('button', { name: 'PHOTO STUDIO', exact: true }).click();
  const replayTime = (await diag(page)).replayPosition;
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  const returned = await diag(page);
  expect(returned.state).toBe('replay');
  expect(returned.replayPlaying).toBe(false);
  expect(returned.replayPosition).toBe(replayTime);
  expect(returned.renderer!.photo).toBeNull();
  expect(errors).toEqual([]);
});

test('reference tools: every supplied number is searchable with duplicates and exclusions visible', async ({
  page,
}, info) => {
  await ready(page);
  await page.getByRole('button', { name: 'REFERENCE REVIEW', exact: true }).click();
  await expect(page.locator('[data-reference]')).toHaveCount(100);
  await page.locator('#referenceFilter').selectOption('excluded');
  await expect(page.locator('[data-reference]:visible')).toHaveCount(16);
  await expect(page.locator('#referenceCount')).toHaveText('16 / 100');
  await evidence(page, info, '08-reference-contamination-accounted-for');
  await page.locator('#referenceFilter').selectOption('all');
  await page.locator('#referenceSearch').fill('069');
  await expect(page.locator('[data-reference]:visible')).toHaveCount(1);
  await page.locator('[data-reference="69"] summary').click();
  await expect(page.locator('[data-reference="69"]')).toContainText('absent');
  await page.locator('#referenceSearch').fill('092');
  await page.locator('[data-reference="92"] summary').click();
  await expect(page.locator('[data-reference="92"]')).toContainText(
    'Repeated/variant composition of 004',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await evidence(page, info, '09-mobile-reference-review');
  const fits = await page.locator('#modal').evaluate((e) => e.scrollWidth <= e.clientWidth + 1);
  expect(fits).toBe(true);
});


test('covered menu redraws once on resize and resumes after closing without freezing photo mode', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'TEAM HQ', exact: true }).click();
  await expect.poll(async () => (await diag(page)).presentation?.menuCovered).toBe(true);
  const held = (await diag(page)).presentation!.frames;
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect.poll(async () => (await diag(page)).presentation!.frames).toBe(held + 1);
  await page.waitForTimeout(250);
  expect((await diag(page)).presentation!.frames).toBe(held + 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).toBeHidden();
  await expect.poll(async () => (await diag(page)).presentation!.frames).toBeGreaterThan(held + 1);
  await page.getByRole('button', { name: 'PHOTO / LIVERY', exact: true }).click();
  await expect(page.locator('#photoStudio')).toBeVisible();
  const photo = await diag(page);
  await input(page, '#photo-elevation', '40');
  await expect.poll(async () => (await diag(page)).presentation!.frames).toBeGreaterThan(photo.presentation!.frames);
  expect((await diag(page)).state).toBe('photo');
});
