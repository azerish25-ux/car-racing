import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { mountCareerHub } from './fixtures/career-hub.ts';

test.use({ actionTimeout: 15000 });

/** DOM-only: the production menu, career screens and CSS, no renderer. */
test('career hub: CAREER entry, keyboard reach, licences, dealership, garage and recovery', async ({
  page,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/career-hub.ts'), name: 'CareerHub', formats: ['iife'] },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing career fixture output');
  const script = result.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing career fixture script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent('<!doctype html><title>Career hub DOM-only</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addScriptTag({ content: script.code });
  await page.evaluate(() => {
    (
      window as unknown as { CareerHub: { mountCareerHub: typeof mountCareerHub } }
    ).CareerHub.mountCareerHub();
  });
  const log = page.locator('#careerEvents');
  const loaner = (await log.getAttribute('data-loaner')) ?? '';
  expect(loaner).not.toBe('');
  const hub = page.locator('#modal .career-hub');
  // CAREER leads the paddock actions and opens from the keyboard.
  const first = page.locator('#menu .menu-actions button').first();
  await expect(first).toHaveText('CAREER');
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(hub).toBeVisible();
  await expect(hub.locator('[data-discipline]')).toHaveCount(4);
  await expect(hub.locator('[data-discipline="circuit-cars"] .career-state')).toHaveText('OPEN');
  // Disciplines without machines/venues are honestly marked, with reasons.
  for (const id of ['road-bikes', 'off-road', 'festival']) {
    const card = hub.locator(`[data-discipline="${id}"]`);
    if ((await card.locator('.career-state').textContent()) === 'COMING')
      await expect(card.locator('.career-reasons li').first()).toContainText('registered yet');
  }
  // Opening focuses the current section; every control is then reachable with
  // Tab, in document order, without leaving the dialog.
  await expect(hub.getByRole('button', { name: 'Disciplines', exact: true })).toBeFocused();
  const buttons = hub.locator('button');
  const controls = await buttons.count();
  await buttons.first().focus();
  const reached = new Set<string>();
  for (let i = 0; i < controls; i++) {
    const action = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return active?.closest('#modal') ? (active.dataset.action ?? '') : 'outside';
    });
    expect(action).not.toBe('outside');
    expect(action).toBe(await buttons.nth(i).getAttribute('data-action'));
    reached.add(action);
    if (i < controls - 1) await page.keyboard.press('Tab');
  }
  for (const page_ of ['hub', 'events', 'licences', 'garage', 'dealership'])
    expect(reached.has(`career:page:${page_}`)).toBe(true);
  // Licences: the braking test opens on a loaned machine; START logs a solo practice.
  await hub.getByRole('button', { name: 'Licences', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-career-page="licences"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Licences', exact: true })).toBeFocused();
  const braking = page.locator('[data-licence="braking"]');
  await expect(braking.locator('.career-thresholds')).toContainText('GOLD ≤ 1.5 m');
  await braking.getByRole('button', { name: 'START TEST' }).click();
  await expect(page.locator('.career-briefing h2')).toHaveText('Braking marker');
  await page.locator('.career-briefing').getByRole('button', { name: 'START TEST' }).click();
  await expect(log).toContainText(`start:practice:${loaner}:licence:1;`);
  // Dealership: buy the touring car, then it is active in the garage.
  await page.locator('.career-briefing').getByRole('button', { name: 'BACK' }).click();
  await expect(page.locator('[data-career-page="licences"]')).toBeVisible();
  await page.getByRole('button', { name: 'Dealership', exact: true }).click();
  const tc1 = page.locator('#modal [data-vehicle="tc1"]');
  await tc1.getByRole('button', { name: /^BUY FOR/ }).click();
  await expect(page.locator('#careerSaveStatus')).toContainText('Bought');
  await expect(tc1.locator('.career-state')).toHaveText('OWNED');
  await page.getByRole('button', { name: 'Garage', exact: true }).click();
  await expect(page.locator('#modal [data-vehicle="tc1"] .career-state')).toHaveText('ACTIVE');
  await page.getByRole('button', { name: 'SAVE CURRENT GARAGE SETUP AS PRESET' }).click();
  await expect(page.locator('#careerSaveStatus')).toContainText('Preset saved');
  await expect(page.getByRole('button', { name: 'PRESET 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Events: the recovery series is open and starts a four-car race.
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  const recovery = page.locator('.career-event[data-kind="recovery"]').first();
  await expect(recovery.locator('.career-state')).toHaveText('OPEN');
  await recovery.getByRole('button', { name: 'ENTER CLUB MEETING' }).click();
  await expect(log).toContainText(`start:race:${loaner}:race:4;`);
  // Locked events state what they need.
  const locked = page.locator('.career-event[data-status="locked"]').first();
  await expect(locked.locator('.career-reasons li').first()).toBeVisible();
  // A championship card lists its calendar: every round's venue and weather.
  const season = page.locator('.career-event[data-kind="championship"]').first();
  await expect(season.locator('.career-calendar li').first()).toContainText('R1');
  // The dealership never sells a machine that cannot race here: such a card
  // says what is missing and has no BUY button.
  await page.getByRole('button', { name: 'Dealership', exact: true }).click();
  const unsold = page.locator('#modal .career-vehicle[data-status="coming"]');
  for (let i = 0; i < (await unsold.count()); i++) {
    await expect(unsold.nth(i).getByRole('button', { name: /^BUY FOR/ })).toHaveCount(0);
    await expect(unsold.nth(i).locator('.career-reasons li').first()).toBeVisible();
  }
  // Reduced motion: no transition remains on career controls.
  await page.evaluate(() => (document.documentElement.dataset.reducedMotion = 'true'));
  const duration = await page
    .locator('#modal nav button')
    .first()
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
  // Narrow viewport: no horizontal overflow inside the hub.
  await page.setViewportSize({ width: 375, height: 667 });
  const overflow = await page.locator('#modal').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
