import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { mountFestivalMenu } from './fixtures/festival-menu-access.ts';

test.use({ actionTimeout: 15000 });

test('festival menu access: every pause-menu action is reachable with the keyboard', async ({ page }) => {
  test.setTimeout(120000);
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
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.setContent('<!doctype html><title>Festival menu accessibility</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addStyleTag({ content: await readFile('src/ui/festival-hud.css', 'utf8') });
  await page.addScriptTag({ content: script.code });
  await page.evaluate(() => {
    (window as unknown as { FestivalMenu: { mountFestivalMenu: typeof mountFestivalMenu } }).FestivalMenu.mountFestivalMenu();
  });
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
  // Machine, travel and autopilot are reachable too.
  await tabTo('On');
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
