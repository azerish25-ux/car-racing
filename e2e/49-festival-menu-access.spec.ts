import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { mountFestivalMenu, mountFestivalResults } from './fixtures/festival-menu-access.ts';

type Fixture = { mountFestivalMenu: typeof mountFestivalMenu; mountFestivalResults: typeof mountFestivalResults };

test.use({ actionTimeout: 15000 });

async function load(page: import('@playwright/test').Page) {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/festival-menu-access.ts'), name: 'FestivalMenu', formats: ['iife'] },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing festival fixture output');
  const script = result.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing festival fixture script');
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.setContent('<!doctype html><title>Festival menu accessibility</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addStyleTag({ content: await readFile('src/ui/festival-hud.css', 'utf8') });
  await page.addScriptTag({ content: script.code });
}

test('festival menu access: every pause-menu action is reachable with the keyboard', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await load(page);
  await page.evaluate(() => (window as unknown as { FestivalMenu: Fixture }).FestivalMenu.mountFestivalMenu());
  const log = page.locator('#festivalEvents');
  const menu = page.locator('#festMenu');
  const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  const tabTo = async (label: string) => {
    for (let i = 0; i < 80 && (await focused()) !== label; i++) await page.keyboard.press('Tab');
    expect(await focused()).toBe(label);
  };
  // ESC while driving opens the menu with RESUME focused; driving input is off.
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await expect(log).toContainText('action:pause;pause:true;driving:false;');
  expect(await focused()).toBe('RESUME');
  // Tab moves through the menu (it is not swallowed by the driving input).
  await page.keyboard.press('Tab');
  expect(await focused()).toBe('RESET TO ROAD');
  // Space activates the focused button: time of day keeps the menu open.
  await tabTo('Night');
  await page.keyboard.press('Space');
  await expect(log).toContainText('lighting:night;');
  await expect(menu).toBeVisible();
  // Machine, autopilot, ambient traffic and travel are reachable too; the
  // traffic toggle keeps the menu open.
  await tabTo('On');
  await tabTo('Traffic off');
  await page.keyboard.press('Space');
  await expect(log).toContainText('traffic:false;');
  await expect(menu).toBeVisible();
  // The redrawn menu states the new choice at once (before the worker's
  // next status), so a screen reader hears the right one.
  await expect(menu.getByRole('button', { name: 'Traffic off', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(menu.getByRole('button', { name: 'Traffic on', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await tabTo(
    await page
      .locator('#festMenu [data-fest="travel"]')
      .first()
      .evaluate((button) => button.textContent?.trim() ?? ''),
  );
  // ESC with a menu button focused resumes, and driving input returns.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(log).toContainText('pause:false;driving:true;');
  // EXIT FESTIVAL by keyboard alone.
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await tabTo('EXIT FESTIVAL');
  await page.keyboard.press('Enter');
  await expect(log).toContainText('exit;');
  expect(errors).toEqual([]);
});

test('festival results: CONTINUE takes a normal mouse click while status keeps arriving', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await load(page);
  await page.evaluate(() => (window as unknown as { FestivalMenu: Fixture }).FestivalMenu.mountFestivalResults());
  const button = page.locator('#festResults [data-fest="continue"]');
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  let clicks = 0;
  for (let i = 0; i < 5; i++) {
    // A human click: 150 ms between press and release, across status updates.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    clicks++;
    await expect(page.locator('#festivalEvents')).toHaveText('continue;'.repeat(clicks));
  }
  expect(errors).toEqual([]);
});
