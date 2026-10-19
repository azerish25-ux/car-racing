import { expect, test } from '@playwright/test';
import { B, BIKE_BASE, F, H, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { VEHICLE_IDS } from '../src/simulation/vehicles.ts';
import { finishRaceEntry } from './race-entry.ts';
import { MENU_STARTUP_TIMEOUT_MS } from './menu-startup.ts';

// The real menu, worker, production Three.js scene and replay archive. Low is
// selected through the normal settings UI to keep this functional journey
// affordable; visual-detail fixtures and GPU acceptance gates remain separate.
test.use({ viewport: { width: 1280, height: 800 } });

test('GP practice rides through named corner guidance, cockpit, pause and recorded replay', async ({
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
  const guide = () =>
    page.locator('#gpCraft').evaluate((element) => ({
      corner: element.querySelector('#gpCorner')!.textContent,
      distance: element.querySelector('#gpCornerDistance')!.textContent,
      action: element.querySelector('#gpAction')!.textContent,
      advice: element.querySelector('#gpAdvice')!.textContent,
      tow: element.querySelector('#gpTow')!.textContent,
      tone: (element as HTMLElement).dataset.tone,
    }));
  const readableGuide = async () => {
    await expect(page.locator('#gpCraft')).toBeVisible();
    await expect(page.locator('#gpAction')).not.toHaveText('');
    await expect(page.locator('#gpAdvice')).not.toHaveText('');
    const rectangles = await page
      .locator('#gpCraft, #gpCorner, #gpAction, #gpAdvice')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            id: element.id,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
          };
        }),
      );
    for (const rect of rectangles) {
      expect(rect.width, rect.id).toBeGreaterThan(0);
      expect(rect.height, rect.id).toBeGreaterThan(0);
      expect(rect.left, rect.id).toBeGreaterThanOrEqual(0);
      expect(rect.top, rect.id).toBeGreaterThanOrEqual(0);
      expect(rect.right, rect.id).toBeLessThanOrEqual(rect.viewportWidth);
      expect(rect.bottom, rect.id).toBeLessThanOrEqual(rect.viewportHeight);
      expect(rect.scrollWidth, `${rect.id} horizontal clipping`).toBeLessThanOrEqual(
        rect.clientWidth + 1,
      );
    }
    return rectangles;
  };

  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await expect(page.locator('#modal')).toBeHidden();
  await page.selectOption('#circuit', 'poggio-alto');
  await page.selectOption('#vehicle', 'gpr1');
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '3');
  await page.selectOption('#weather', 'clear');
  await page.selectOption('#compound', 'medium');
  await expect(page.locator('.car-label')).toContainText('GP-R1');
  await expect(page.locator('#opponents option[value="3"]')).toHaveText('4 riders');
  await expect(page.locator('#sessionRules')).not.toContainText('Unavailable');
  await expect.poll(async () => (await diag()).menuPreview?.machine).toBe('gpr1');
  await capture('01-gp-poggio-practice-menu');

  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await finishRaceEntry(page);
  await expect(page.locator('#hud')).toHaveAttribute('data-bike', 'true');
  await expect(page.locator('#gpMachine')).toContainText('GP-R1');
  const entered = await diag();
  expect(entered.options).toMatchObject({
    mode: 'practice',
    circuit: 'poggio-alto',
    opponents: 3,
    vehicles: Array(4).fill('gpr1'),
  });
  expect(entered.frame![H.CARS]).toBe(4);
  for (let id = 0; id < 4; id++)
    expect(entered.frame![carBase(id) + RACE_BASE + R.VEHICLE]).toBe(VEHICLE_IDS.indexOf('gpr1'));

  expect(entered.auto).toBe(false);
  let manualLaunch: typeof entered;
  await page.keyboard.down('w');
  try {
    await expect
      .poll(async () => (await diag()).frame?.[carBase(0) + F.THROTTLE], { timeout: 20000 })
      .toBeGreaterThan(0.8);
    await expect
      .poll(async () => (await diag()).frame?.[carBase(0) + F.SPEED], { timeout: 20000 })
      .toBeGreaterThan(3);
    manualLaunch = await diag();
    expect(manualLaunch.auto).toBe(false);
    expect(manualLaunch.usedDemonstration).toBe(false);
    expect(manualLaunch.frame![H.TICK]).toBeGreaterThan(entered.frame![H.TICK]);
  } finally {
    await page.keyboard.up('w');
  }

  await page.keyboard.press('g');
  await expect.poll(async () => (await diag()).auto).toBe(true);
  await expect.poll(async () => (await diag()).frame?.[carBase(0) + F.SPEED]).toBeGreaterThan(15);
  const moving = await diag();
  await expect
    .poll(async () => (await diag()).frame?.[H.TICK])
    .toBeGreaterThan(moving.frame![H.TICK] + 120);
  await expect
    .poll(async () => (await diag()).presentation?.time)
    .toBeGreaterThan(moving.presentation!.time + 1);
  await expect(page.locator('#gpCorner')).toHaveText(/^T\d+ · /);
  await expect(page.locator('#gpCornerDistance')).toHaveText(/^(?:\d+ M TO APEX|EXIT)$/);
  await expect(page.locator('#gpRiderState')).toHaveText('RIDING');
  await expect.poll(async () => (await diag()).renderer?.presentedCamera).toBe('chase');
  const chaseLayout = await readableGuide();
  const cornerFrame = await diag();
  const cornerPosition =
    Math.round((cornerFrame.presentation!.time - cornerFrame.replayStart) * 100) / 100;
  expect(cornerPosition).toBeGreaterThan(1);
  expect(cornerFrame.renderer!.drawCalls).toBeGreaterThan(0);
  expect(cornerFrame.renderer!.triangles).toBeGreaterThan(0);
  for (let id = 0; id < 4; id++) {
    const base = carBase(id);
    expect(cornerFrame.frame![base + F.SPEED]).toBeGreaterThan(0);
    expect(cornerFrame.frame![base + BIKE_BASE + B.STATE]).toBe(0);
    expect(cornerFrame.frame![base + F.RETIRED]).toBe(0);
  }
  await capture('02-gp-moving-chase-guide');

  await page.keyboard.press('c');
  await expect.poll(async () => (await diag()).renderer?.presentedCamera).toBe('cockpit');
  await expect(page.locator('#hud')).toHaveAttribute('data-camera', 'cockpit');
  const cockpitLayout = await readableGuide();
  await capture('03-gp-moving-cockpit-guide');
  await expect.poll(async () => (await diag()).replaySamples).toBeGreaterThan(30);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'RESUME SESSION', exact: true })).toBeVisible();
  await expect
    .poll(async () => (await diag()).workerPause)
    .toMatchObject({ paused: true, pending: false });
  const paused = await diag();
  await capture('04-gp-paused-session');
  expect((await diag()).frame![H.TICK]).toBe(paused.frame![H.TICK]);

  await page.getByRole('button', { name: 'WATCH REPLAY', exact: true }).click();
  await expect.poll(async () => (await diag()).state).toBe('replay');
  await expect(page.locator('#replayBar')).toBeVisible();
  if ((await diag()).replayPlaying) await page.locator('#replayPlay').click();
  await expect.poll(async () => (await diag()).replayPlaying).toBe(false);
  const seek = async (seconds: number) => {
    // Operate the existing range control; no snapshots, scene state or clocks
    // are injected. The application retrieves and presents its recorded data.
    await page.locator('#replaySeek').evaluate((element, position) => {
      (element as HTMLInputElement).value = String(position);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, seconds);
    await expect.poll(async () => (await diag()).replaySeekPending).toBe(false);
    await expect
      .poll(async () => Math.abs((await diag()).replayPosition - seconds))
      .toBeLessThan(0.02);
  };
  await seek(cornerPosition);
  await expect(page.locator('#gpCorner')).toHaveText(/^T\d+ · /);
  const replayLayout = await readableGuide();
  const heldGuide = await guide();
  const heldReplay = await diag();
  await capture('05-gp-recorded-cockpit-guide');
  await seek(Math.max(0, cornerPosition - 4));
  await seek(cornerPosition);
  await expect.poll(guide).toEqual(heldGuide);
  const replayRestored = await diag();
  expect(replayRestored.frame![H.TICK]).toBe(paused.frame![H.TICK]);
  expect(replayRestored.presentation!.time).toBeCloseTo(heldReplay.presentation!.time, 5);
  expect(replayRestored.workerPause).toMatchObject({ paused: true, pending: false });
  expect(replayRestored.replayError).toBeNull();
  expect(replayRestored.recordingWarnings).toEqual([]);

  await page.locator('#replayBar [data-action="replayExit"]').click();
  await expect.poll(async () => (await diag()).state).toBe('paused');
  await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
  await expect.poll(async () => (await diag()).state).toBe('driving');
  await expect
    .poll(async () => (await diag()).frame?.[H.TICK])
    .toBeGreaterThan(paused.frame![H.TICK] + 60);
  await expect(page.locator('#gpCraft')).toBeVisible();
  const resumed = await diag();
  expect(resumed.usedDemonstration).toBe(true);
  expect(errors).toEqual([]);
  await info.attach('gp-riding-flow-diagnostics.json', {
    body: JSON.stringify(
      {
        workload:
          'Actual GP-R1 menu entry, four-rider Poggio Alto practice, manual throttle, AI demonstration and recorded replay',
        manualLaunch,
        chaseLayout,
        cockpitLayout,
        replayLayout,
        cornerPosition,
        heldGuide,
        cornerFrame,
        paused,
        heldReplay,
        replayRestored,
        resumed,
        errors,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
