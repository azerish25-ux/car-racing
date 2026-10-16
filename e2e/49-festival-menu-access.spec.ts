import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { mountFestivalMenu, mountFestivalResults } from './fixtures/festival-menu-access.ts';

type Fixture = {
  mountFestivalMenu: typeof mountFestivalMenu;
  mountFestivalResults: typeof mountFestivalResults;
};
type FestivalWindow = {
  FestivalMenu: Fixture;
  festivalHarness: ReturnType<typeof mountFestivalMenu>;
};

test.use({ actionTimeout: 15000 });

async function load(page: import('@playwright/test').Page) {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/festival-menu-access.ts'),
        name: 'FestivalMenu',
        formats: ['iife'],
      },
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

async function mount(page: import('@playwright/test').Page, options: { card?: boolean } = {}) {
  await load(page);
  return page.evaluate((options) => {
    const scope = window as unknown as FestivalWindow;
    scope.festivalHarness = scope.FestivalMenu.mountFestivalMenu(options);
    return scope.festivalHarness.events;
  }, options);
}

/** Standard controller input through the real input/HUD polling paths. A
 * repeated call with the same buttons represents a held button, not a click. */
async function pad(page: import('@playwright/test').Page, pressed: number[]) {
  return page.evaluate((pressed) => {
    const gamepad = {
      id: 'Festival DOM controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: performance.now(),
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, index) => ({
        pressed: pressed.includes(index),
        touched: pressed.includes(index),
        value: Number(pressed.includes(index)),
      })),
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [gamepad] });
    return (window as unknown as FestivalWindow).festivalHarness.frame();
  }, pressed);
}

async function tapPad(page: import('@playwright/test').Page, button: number) {
  await pad(page, []);
  return pad(page, [button]);
}

test('festival menu access: every pause-menu action is reachable with the keyboard', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await load(page);
  await page.evaluate(() =>
    (window as unknown as { FestivalMenu: Fixture }).FestivalMenu.mountFestivalMenu(),
  );
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
  await expect(menu.getByRole('button', { name: 'Traffic off', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(menu.getByRole('button', { name: 'Traffic on', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
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

test('festival results: CONTINUE takes a normal mouse click while status keeps arriving', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await load(page);
  await page.evaluate(() =>
    (window as unknown as { FestivalMenu: Fixture }).FestivalMenu.mountFestivalResults(),
  );
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

test('festival map: filters, event selection and keyboard focus survive redraws', async ({
  page,
}) => {
  const events = await mount(page);
  const map = page.locator('#festMap'),
    menu = page.locator('#festMenu');
  // The driving shortcut pauses the simulation and focuses the map itself.
  await page.keyboard.press('t');
  await expect(map).toBeVisible();
  const close = map.getByRole('button', { name: 'CLOSE', exact: true });
  await expect(close).toBeFocused();
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: true, throttle: 0 });
  const eventIds = () =>
    map
      .locator('[data-fest="mapSelect"]')
      .evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.value));
  expect(await eventIds()).toEqual(events.map((event) => event.id));
  const races = map.getByRole('button', { name: 'Races', exact: true });
  await races.focus();
  await page.keyboard.press('Space');
  await expect(races).toHaveAttribute('aria-pressed', 'true');
  await expect(races).toBeFocused();
  expect(await eventIds()).toEqual(events.filter((event) => event.race).map((event) => event.id));
  const undiscovered = events.find((event) => event.race && !event.discovered)!;
  const preview = map.locator(`[data-fest="mapSelect"][data-value="${undiscovered.id}"]`);
  await preview.focus();
  await page.keyboard.press('Enter');
  await expect(preview).toHaveAttribute('aria-pressed', 'true');
  await expect(preview).toBeFocused();
  await expect(page.locator('#festMapDetail h3')).toHaveText(undiscovered.name);
  await expect(page.locator('#festMapDetail')).toContainText('Drive near the marker');
  await expect(page.locator('#festMapDetail [data-fest="travel"]')).toHaveCount(0);
  // A discovered event has a real travel action; a preview never grants it.
  await map.getByRole('button', { name: 'All', exact: true }).click();
  const discovered = events.find((event) => event.discovered)!;
  await map.locator(`[data-fest="mapSelect"][data-value="${discovered.id}"]`).click();
  await expect(page.locator('#festMapDetail [data-fest="travel"]')).toHaveAttribute(
    'data-value',
    discovered.id,
  );
  await map.getByRole('button', { name: 'Skills', exact: true }).click();
  expect(await eventIds()).toEqual(events.filter((event) => !event.race).map((event) => event.id));
  await expect(map.getByRole('button', { name: 'Skills', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Tab is trapped inside the top overlay in both directions.
  const last = map.locator('button:visible').last();
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(map).toBeHidden();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'RESUME', exact: true })).toBeFocused();
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: true });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.keyboard.down('w');
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: false, throttle: 1 });
  await page.keyboard.up('w');
});

test('festival photo: keyboard return cannot activate the race card behind the controls', async ({
  page,
}) => {
  await mount(page, { card: true });
  const photo = page.locator('#festPhoto'),
    log = page.locator('#festivalEvents');
  await page.keyboard.press('Escape');
  await page.locator('#festMenu').getByRole('button', { name: 'PHOTO MODE', exact: true }).click();
  await expect(photo).toBeVisible();
  const back = photo.locator('[data-fest="photoClose"]');
  await expect(back).toBeFocused();
  // Native button activation must not also run the event's Enter shortcut.
  await page.keyboard.press('Enter');
  await expect(photo).toBeHidden();
  await expect(log).not.toContainText('start:');
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: false, photoOpen: false });
  await page.keyboard.press('Escape');
  await page.locator('#festMenu').getByRole('button', { name: 'PHOTO MODE', exact: true }).click();
  await photo.getByRole('button', { name: 'Orbit camera left' }).click();
  await photo.getByRole('button', { name: 'Orbit camera right' }).click();
  await expect(log).toContainText('orbit:-1;orbit:1;');
  await photo.getByRole('button', { name: 'HIDE CONTROLS', exact: true }).click();
  const show = photo.getByRole('button', { name: 'SHOW CONTROLS', exact: true });
  await expect(show).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(show).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(photo).toBeHidden();
  await expect(log).not.toContainText('start:');
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: false, photoOpen: false });
});

test('festival gamepad: D-pad, accept and back use fresh presses across map and photo transitions', async ({
  page,
}) => {
  await mount(page);
  const menu = page.locator('#festMenu'),
    map = page.locator('#festMap'),
    photo = page.locator('#festPhoto');
  await pad(page, []);
  await pad(page, [9]);
  await expect(menu).toBeVisible();
  await pad(page, [9]);
  await expect(menu).toBeVisible();
  await tapPad(page, 13);
  const reset = menu.getByRole('button', { name: 'RESET TO ROAD', exact: true });
  await expect(reset).toBeFocused();
  await pad(page, [13]);
  await expect(reset).toBeFocused();
  await tapPad(page, 13);
  await tapPad(page, 13);
  await expect(menu.getByRole('button', { name: 'WORLD MAP', exact: true })).toBeFocused();
  await tapPad(page, 0);
  await expect(map).toBeVisible();
  await expect(map.getByRole('button', { name: 'CLOSE', exact: true })).toBeFocused();
  await pad(page, [0]);
  await expect(map).toBeVisible();
  await tapPad(page, 1);
  await expect(map).toBeHidden();
  await expect(menu).toBeVisible();
  // Holding Back after closing the map cannot also resume the game.
  await pad(page, [1]);
  await expect(menu).toBeVisible();
  expect(await tapPad(page, 1)).toMatchObject({ paused: false });
  await expect(menu).toBeHidden();
  await tapPad(page, 9);
  for (let step = 0; step < 4; step++) await tapPad(page, 13);
  await expect(menu.getByRole('button', { name: 'PHOTO MODE', exact: true })).toBeFocused();
  expect(await tapPad(page, 0)).toMatchObject({ paused: true, photoOpen: true });
  await expect(photo).toBeVisible();
  await pad(page, [0]);
  await expect(photo).toBeVisible();
  expect(await tapPad(page, 1)).toMatchObject({ paused: false, photoOpen: false });
  await expect(photo).toBeHidden();
});

test('festival menus remain usable when browser policy denies gamepad access', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => {
        throw new DOMException('Gamepad access denied by browser policy', 'SecurityError');
      },
    });
    (window as unknown as FestivalWindow).festivalHarness.frame();
  });
  await page.keyboard.press('Escape');
  await page.locator('#festMenu').getByRole('button', { name: 'WORLD MAP', exact: true }).click();
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: true });
  await expect(page.locator('#festMap')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: false });
  expect(errors).toEqual([]);
});
