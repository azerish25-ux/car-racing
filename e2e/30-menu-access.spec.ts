import { MENU_STARTUP_TIMEOUT_MS } from './menu-startup.ts';
import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { mountMenuAccess } from './fixtures/menu-access.ts';

test.use({ actionTimeout: 15000 });

test('27H.6 menu access: real interface keeps all actions reachable with mouse and keyboard', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/menu-access.ts'), name: 'MenuAccess', formats: ['iife'] },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing menu fixture output');
  const script = result.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing menu fixture script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<!doctype html><title>Production menu component accessibility</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addScriptTag({ content: script.code });
  const measurements = [];
  for (const [width, height] of [
    [320, 320],
    [375, 667],
    [640, 400],
    [800, 600],
    [1024, 600],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      (window as unknown as { MenuAccess: { mountMenuAccess: typeof mountMenuAccess } })
        .MenuAccess.mountMenuAccess();
    });
    const body = page.locator('.menu-body');
    const bounds = await body.boundingBox();
    const header = await page.locator('.masthead').boundingBox();
    const footer = await page.locator('.menu-footer').boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(footer!.y);
    // Include the native scroll region and discipline navigation, and exclude
    // the hidden MX controls. Traverse the complete real Tab order once.
    const count = await page.evaluate(() => {
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          '#menu button, #menu select, #menu input, #menu a[href], #menu [tabindex]',
        ),
      ).filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.matches(':disabled') &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== 'hidden',
      );
      controls.forEach((element, index) => {
        element.dataset.menuKeyboardProbe = String(index);
      });
      return controls.length;
    });
    const controls = page.locator('#menu [data-menu-keyboard-probe]');
    expect(count).toBeGreaterThan(0);
    await controls.first().focus();
    const visited = new Set<number>();
    for (let i = 0; i < count; i++) {
      const active = page.locator('#menu :focus');
      await expect(active).toHaveCount(1);
      const index = await active.getAttribute('data-menu-keyboard-probe');
      expect(index).not.toBeNull();
      expect(visited.has(Number(index))).toBe(false);
      visited.add(Number(index));
      const rect = await active.boundingBox();
      expect(rect!.y).toBeGreaterThanOrEqual(bounds!.y - 1);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
      await page.keyboard.press('Tab');
    }
    expect([...visited].sort((a, b) => a - b)).toEqual(
      Array.from({ length: count }, (_, index) => index),
    );
    // Native wheel input must reach the menu rather than the canvas underneath.
    if (height <= 600) {
      await page.locator('#mode').focus();
      await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 40);
      await page.mouse.wheel(0, 1000);
      await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    }
    const buttons = page.locator('#menu .menu-actions button');
    await expect(buttons).toHaveCount(9);
    // Developer tools are not rendered for players.
    await expect(page.locator('#menu .dev-tools')).toHaveCount(0);
    await expect(page.locator('#buildIdentity')).toBeHidden();
    for (const button of await buttons.all()) {
      const action = await button.getAttribute('data-action');
      await button.click();
      await expect(page.locator('#menuAccessEvents')).toContainText(`${action};`);
      if (action === 'settings') {
        await page.locator('[name=quality]').selectOption('low');
        await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
        await expect(page.locator('#modal')).toBeHidden();
        await expect(page.locator('#menuAccessEvents')).toContainText('apply:low;');
        await button.click();
        await expect(page.locator('[name=quality]')).toHaveValue('low');
        await page.getByRole('button', { name: 'CANCEL', exact: true }).click();
      }
    }
    await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
    await expect(page.locator('#menuAccessEvents')).toContainText('start:race;');
    await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
    measurements.push({ width, height, bounds, controls: await controls.count() });
  }
  expect(errors).toEqual([]);
  await info.attach('menu-access-components.json', {
    body: JSON.stringify({ boundary: 'DOM interface only; no race or hardware claim', measurements }),
    contentType: 'application/json',
  });
});

test('27H.6 menu access: 640x400 settings persist and the normal paused grid starts', async ({
  page,
}, info) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 640, height: 400 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
  const settings = page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true });
  await settings.click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await expect(page.locator('#modal')).toBeHidden();
  await page.reload();
  await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
  await settings.click();
  await expect(page.locator('[name=quality]')).toHaveValue('low');
  await page.getByRole('button', { name: 'CANCEL', exact: true }).click();
  await page.selectOption('#mode', 'race');
  await page.selectOption('#opponents', '3');
  await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.apexDiagnostics().state)).toBe('paused');
  await expect
    .poll(() => page.evaluate(() => window.apexDiagnostics().workerPause))
    .toMatchObject({ pending: false, paused: true });
  expect(errors).toEqual([]);
  await info.attach('menu-access-paused-grid.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
