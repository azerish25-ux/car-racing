import { expect, test } from '@playwright/test';
import { mod } from '../src/core/math.ts';
import { F, H, O, R, OFFROAD_BASE, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { LANDING_RULES } from '../src/simulation/offroad/riding-feedback.ts';
import { MENU_STARTUP_TIMEOUT_MS } from './menu-startup.ts';

/** Normal production app and worker. Every change uses visible controls or
 * player key bindings; apexDiagnostics is observed without modifying state. */
test('real motocross player entry, eight-rider gate, riding, cameras, pause and venue switch', async ({
  page,
}, info) => {
  // Cold boot, two complete venue builds and observed riding on the software
  // GPU have separate readiness budgets; this is a functional, bounded run.
  test.setTimeout(1200000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const diag = () => page.evaluate(() => window.apexDiagnostics());
  const capture = async (name: string) => {
    const path = info.outputPath(name);
    await page.screenshot({ path });
    await info.attach(name, { path, contentType: 'image/png' });
    console.info(`[MX journey] Captured ${name}`);
  };
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
  // Software GPUs can spend the whole riding budget on a production frame.
  // An explicit opt-in exercises the same visible settings flow while the
  // separate bike/world fixtures retain their full rendering checks.
  const quality = process.env.APEX_MOTOCROSS_JOURNEY_QUALITY;
  if (quality) {
    if (!['low', 'medium', 'high', 'ultra'].includes(quality))
      throw new Error(`Unsupported motocross journey quality: ${quality}`);
    await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
    await expect(page.locator('#settingsForm')).toBeVisible();
    await page.locator('[name=quality]').selectOption(quality);
    await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
    await expect(page.locator('#modal')).toBeHidden({ timeout: MENU_STARTUP_TIMEOUT_MS });
    await expect.poll(async () => (await diag()).settingsTransition.busy).toBe(false);
    console.info(`[MX journey] Selected ${quality} through the production settings form`);
  }
  const reports = [];
  const o = carBase(0);
  for (const [circuit, entry, machine] of [
    ['valley-ridge-mx', 'OUTDOOR MX', 'mx450'],
    ['arena-nord-sx', 'STADIUM SX', 'mx250'],
  ] as const) {
    console.info(`[MX journey] Selecting ${circuit} and ${machine}`);
    await page.getByRole('button', { name: entry, exact: true }).click();
    await page.locator('#vehicle').selectOption(machine);
    await expect
      .poll(async () => {
        const state = await diag();
        return state.menuPreview?.machine;
      })
      .toBe(machine);
    const before = (await diag()).presentation!.frames;
    // The initial Aurel frame may still own the software GPU when the menu
    // becomes interactive. Require the selected-machine redraw to complete,
    // using the same bounded cold-start budget as the visible menu itself.
    await expect
      .poll(async () => (await diag()).presentation?.frames ?? 0, {
        timeout: MENU_STARTUP_TIMEOUT_MS,
        message: `${circuit}: selected-machine showroom frame is submitted`,
      })
      .toBeGreaterThan(before);
    await capture(`${circuit}-actual-menu.png`);
    console.info(`[MX journey] Preparing the complete ${circuit} session`);
    await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
    // The normal loader prepares every chase/shadow/reflection pass. Keep
    // those production checks intact while allowing software compilation its
    // own bounded readiness interval; this is not a load-time benchmark.
    await expect(page.locator('#raceBriefing')).toBeVisible({ timeout: 300000 });
    console.info(`[MX journey] ${circuit} is prepared at the held eight-rider gate`);
    const initialized = await diag();
    expect(initialized.options.circuit).toBe(circuit);
    expect(initialized.frame?.[H.CARS]).toBe(8);
    expect(initialized.frame?.[H.TICK]).toBe(0);
    expect(initialized.frame?.[H.SC_PHASE]).toBe(0);
    expect(initialized.auto).toBe(false);
    for (let rider = 0; rider < 8; rider++)
      expect(
        initialized.frame![carBase(rider) + RACE_BASE + R.VEHICLE],
        `${circuit}: initialized rider ${rider} uses the selected machine`,
      ).toBe(vehicleIndex(machine));
    await expect(page.locator('#raceBriefing')).toContainText('RIDERS');
    await page.getByRole('button', { name: 'GO TO THE GATE', exact: true }).click();
    await expect.poll(async () => (await diag()).state).toBe('driving');
    await expect(page.locator('.mx-ride-hud')).toBeVisible();
    await capture(`${circuit}-actual-gate.png`);
    await expect.poll(async () => (await diag()).frame?.[H.PHASE] ?? 0).toBe(2);
    // Exercise the real player throttle before handing the observed run to
    // the game's explicitly enabled AI demonstration.
    await page.keyboard.down('w');
    await expect
      .poll(async () => (await diag()).frame?.[o + F.SPEED] ?? 0, { timeout: 30000 })
      .toBeGreaterThan(3);
    const human = await diag();
    expect(human.auto).toBe(false);
    expect(human.frame?.[o + F.THROTTLE]).toBeGreaterThan(0.2);
    await page.keyboard.up('w');
    await page.keyboard.press('g');
    await expect.poll(async () => (await diag()).auto).toBe(true);
    const aiStart = (await diag()).frame!,
      aiStartedAt = aiStart[H.TIME],
      length = aiStart[H.LENGTH];
    expect(length).toBeGreaterThan(0);
    type RideObservation = {
      tick: number;
      time: number;
      s: number;
      progressM: number;
      speed: number;
      airborne: boolean;
      airTime: number;
      landingSpeed: number;
      landingPitch: number;
      safetyCarPhase: number;
      presentedTime: number;
    };
    const observations: RideObservation[] = [];
    let previousS = aiStart[o + F.S],
      previousTick = aiStart[H.TICK],
      progressM = 0,
      maxAirTime = 0,
      maxSafetyCarPhase = 0;
    let landing: RideObservation | null = null;
    await expect
      .poll(
        async () => {
          const d = await diag(),
            frame = d.frame!;
          if (frame[H.TICK] !== previousTick) {
            const s = frame[o + F.S];
            // The gate is just before S=0. Preserve signed progress through
            // that wrap; backwards movement cannot count as forward travel.
            progressM += mod(s - previousS + length / 2, length) - length / 2;
            previousS = s;
            previousTick = frame[H.TICK];
            const sample: RideObservation = {
              tick: frame[H.TICK],
              time: frame[H.TIME],
              s,
              progressM,
              speed: frame[o + F.SPEED],
              airborne: frame[o + OFFROAD_BASE + O.AIRBORNE] > 0.5,
              airTime: frame[o + OFFROAD_BASE + O.AIR_TIME],
              landingSpeed: frame[o + OFFROAD_BASE + O.LANDING_SPEED],
              landingPitch: frame[o + OFFROAD_BASE + O.LANDING_PITCH],
              safetyCarPhase: frame[H.SC_PHASE],
              presentedTime: d.presentation?.time ?? 0,
            };
            maxSafetyCarPhase = Math.max(maxSafetyCarPhase, sample.safetyCarPhase);
            observations.push(sample);
            maxAirTime = Math.max(maxAirTime, sample.airTime);
            // AIR_TIME persists after touchdown, so slow presentation need
            // not catch the short AIRBORNE=true edge to prove a real flight.
            if (
              !landing &&
              !sample.airborne &&
              sample.airTime > LANDING_RULES.minimumAirTime &&
              sample.landingSpeed > 0.05 &&
              Number.isFinite(sample.landingPitch)
            )
              landing = sample;
          }
          return {
            ridingInterval: frame[H.TIME] - aiStartedAt >= 20,
            forwardProgress: progressM >= 100,
            qualifyingFlight: maxAirTime > LANDING_RULES.minimumAirTime,
            recordedTouchdown: landing !== null,
            renderedRiding: (d.presentation?.time ?? 0) - aiStartedAt >= 10,
          };
        },
        {
          timeout: 180000,
          intervals: [200, 250, 500],
          message: `${circuit}: real course progress, qualifying flight, touchdown and rendered riding`,
        },
      )
      .toEqual({
        ridingInterval: true,
        forwardProgress: true,
        qualifyingFlight: true,
        recordedTouchdown: true,
        renderedRiding: true,
      });
    const ridden = await diag();
    expect(
      maxSafetyCarPhase,
      `${circuit}: motocross retains local cautions without a pace car`,
    ).toBe(0);
    expect(ridden.frame![H.SC_PHASE]).toBe(0);
    expect(ridden.frame!.every(Number.isFinite)).toBe(true);
    expect(ridden.options.vehicles?.every((id) => id === machine)).toBe(true);
    expect(ridden.presentation!.frames).toBeGreaterThan(initialized.presentation!.frames);
    console.info(`[MX journey] ${circuit} has real course progress, flight and touchdown`);
    await capture(`${circuit}-actual-chase.png`);
    await page.keyboard.press('c');
    await expect.poll(async () => (await diag()).renderer?.camera).toBe('cockpit');
    await capture(`${circuit}-actual-onboard.png`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'RESUME SESSION', exact: true })).toBeVisible();
    await expect.poll(async () => (await diag()).workerPause.pending).toBe(false);
    const paused = await diag();
    expect(paused.frame![H.SC_PHASE]).toBe(0);
    await capture(`${circuit}-actual-pause.png`);
    const held = await diag();
    expect(held.workerPause.paused).toBe(true);
    expect(held.frame![H.TICK]).toBe(paused.frame![H.TICK]);
    reports.push({
      circuit,
      machine,
      mode: 'normal application, player throttle followed by explicitly enabled AI demonstration',
      requestedQuality: quality ?? 'saved/default',
      human: {
        time: human.frame![H.TIME],
        speed: human.frame![o + F.SPEED],
        throttle: human.frame![o + F.THROTTLE],
        auto: human.auto,
      },
      aiStartedAt,
      progressM,
      maxAirTime,
      maxSafetyCarPhase,
      landing,
      observations,
      final: { frame: ridden.frame, renderer: ridden.renderer, presentation: ridden.presentation },
      pausedTick: held.frame![H.TICK],
    });
    await info.attach(`${circuit}-journey.json`, {
      body: JSON.stringify(reports[reports.length - 1], null, 2),
      contentType: 'application/json',
    });
    await page.getByRole('button', { name: 'RETURN TO PADDOCK', exact: true }).click();
    await expect(page.locator('#menu')).toBeVisible();
    await expect.poll(async () => (await diag()).menuPreview?.time).toBe(0);
    await expect.poll(async () => (await diag()).presentation?.time).toBe(0);
    console.info(`[MX journey] ${circuit} returned to its selected-machine paddock`);
  }
  expect(errors).toEqual([]);
  await info.attach('motocross-production-journey.json', {
    body: JSON.stringify(
      {
        graphicsBackend:
          'Reported separately by browser-backend.json; no physical hardware FPS certification',
        reports,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
