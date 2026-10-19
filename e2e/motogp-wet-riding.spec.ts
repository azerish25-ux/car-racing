import { expect, test } from '@playwright/test';
import { PARTICLE_KIND } from '../src/rendering/effects.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { finishRaceEntry } from './race-entry.ts';
import { MENU_STARTUP_TIMEOUT_MS } from './menu-startup.ts';

// Actual menu, worker and circuit renderer. Low plus full particle density is
// selected through the settings UI; no simulation snapshots are injected.
// Detailed contact geometry, per-wheel birth positions and held pixels have
// separate WebGL gates in gp-contact-effects.spec.ts.
test.use({ viewport: { width: 1280, height: 800 } });

test('GP wet practice renders live two-tyre spray, advances normally and holds on pause', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const diag = () => page.evaluate(() => window.apexDiagnostics());
  const capture = async (name: string) => {
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path });
    await info.attach(`${name}.png`, { path, contentType: 'image/png' });
  };

  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.locator('.presentation-details > summary').click();
  await page.locator('[name=graphics_particleDensity]').press('End');
  await expect(page.locator('[name=graphics_particleDensity]')).toHaveValue('1');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await expect(page.locator('#modal')).toBeHidden();
  await page.selectOption('#circuit', 'poggio-alto');
  await page.selectOption('#vehicle', 'gpr1');
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '3');
  await page.selectOption('#weather', 'rain');
  await page.selectOption('#compound', 'wet');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await finishRaceEntry(page);
  await expect(page.locator('#hud')).toHaveAttribute('data-bike', 'true');
  const entered = await diag();
  expect(entered.options).toMatchObject({
    mode: 'practice',
    circuit: 'poggio-alto',
    opponents: 3,
    weather: 'rain',
    compound: 'wet',
    vehicles: Array(4).fill('gpr1'),
  });
  expect(entered.renderer?.graphics.particleDensity).toBe(1);
  expect(entered.frame![H.CARS]).toBe(4);

  await page.keyboard.press('g');
  await expect.poll(async () => (await diag()).auto).toBe(true);
  await expect.poll(async () => (await diag()).frame?.[carBase(0) + F.SPEED]).toBeGreaterThan(15);
  await expect
    .poll(async () => (await diag()).presentation?.particles.active[PARTICLE_KIND.SPRAY])
    .toBeGreaterThan(0);
  const moving = await diag();
  await expect
    .poll(async () => (await diag()).presentation?.time)
    .toBeGreaterThan(moving.presentation!.time + 2);
  await expect(page.locator('#gpRiderState')).toHaveText('RIDING');
  await expect(page.locator('#gpCraft')).toBeVisible();
  await expect.poll(async () => (await diag()).renderer?.presentedCamera).toBe('chase');
  const chase = await diag();
  const front = carBase(0) + WHEEL_BASE,
    rear = front + 2 * WHEEL_STRIDE;
  expect(chase.frame![front + W.WATER]).toBeGreaterThan(0);
  expect(chase.frame![rear + W.WATER]).toBeGreaterThan(0);
  expect(chase.presentation!.particles.active[PARTICLE_KIND.SPRAY]).toBeGreaterThan(0);
  expect(chase.presentation!.particles.contactCapacity).toBe(3600);
  for (let id = 0; id < 4; id++) {
    const o = carBase(id);
    expect(chase.frame![o + F.SPEED]).toBeGreaterThan(0);
    expect(chase.frame![o + BIKE_BASE + B.STATE]).toBe(0);
    expect(chase.frame![o + F.RETIRED]).toBe(0);
  }
  await capture('gp-live-wet-chase');
  await page.keyboard.press('c');
  await expect.poll(async () => (await diag()).renderer?.presentedCamera).toBe('cockpit');
  await capture('gp-live-wet-cockpit');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'RESUME SESSION', exact: true })).toBeVisible();
  await expect
    .poll(async () => (await diag()).workerPause)
    .toMatchObject({ paused: true, pending: false });
  const acknowledged = await diag();
  // The receipt freezes the worker. The renderer still has to present the
  // final interpolated snapshot before its effect clock can be held.
  await expect
    .poll(async () => (await diag()).presentation?.time)
    .toBe(acknowledged.frame![H.TIME]);
  const paused = await diag();
  await expect
    .poll(async () => (await diag()).presentation?.frames)
    .toBeGreaterThan(paused.presentation!.frames + 1);
  await capture('gp-live-wet-pause');
  const held = await diag();
  expect(held.frame![H.TICK]).toBe(paused.frame![H.TICK]);
  expect(held.presentation!.time).toBe(paused.presentation!.time);
  expect(held.presentation!.particles).toEqual(paused.presentation!.particles);
  for (const key of ['elapsed', 'resets', 'boundedCatchups', 'omittedSeconds'] as const)
    expect(held.presentation![key]).toBe(paused.presentation![key]);
  await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
  await expect
    .poll(async () => (await diag()).frame?.[H.TICK])
    .toBeGreaterThan(paused.frame![H.TICK] + 60);
  expect(errors).toEqual([]);
  await info.attach('gp-live-wet-diagnostics.json', {
    body: JSON.stringify(
      {
        workload: 'Actual four-rider wet GP-R1 practice; low preset with particle density 1',
        entered,
        chase,
        acknowledged,
        paused,
        held,
        errors,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
