import {
  armPitObservations,
  configurePitStartup,
  verifyRecordedPitSequence,
} from './pit-sequence-review.ts';
import { finishRaceEntry } from './race-entry.ts';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { H } from '../src/simulation/protocol.ts';
import { REVIEW_START_SLOTS, REVIEW_CIRCUITS } from '../src/rendering/race-review.ts';
import {
  readPresentationReport,
  type ReviewWorkload,
  type ReviewCamera,
} from '../src/rendering/presentation-review.ts';

// Sequence qualification rejects gaps above one second. CI's software rasterizer
// cannot sample that sequence at the default 1440x900 viewport, even on Low.
// Use an explicit, recorded functional workload; do not change opponents, event
// thresholds, simulation rate or the independent default-quality full-lap suite.
test.use({
  viewport: { width: 640, height: 400 },
  video: { mode: 'on', size: { width: 640, height: 400 } },
});
const diag = (page: Page) => page.evaluate(() => window.apexDiagnostics());
async function pause(page: Page) {
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await diag(page)).workerPause)
    .toMatchObject({ pending: false, paused: true });
}
async function capture(page: Page, info: TestInfo, name: string) {
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    });
    const image = Buffer.from(data, 'base64');
    expect(image.length).toBeGreaterThan(10000);
    await info.attach(`27h6-${name}.png`, { body: image, contentType: 'image/png' });
  } finally {
    await session.detach();
  }
}
const drives: {
  workload: ReviewWorkload;
  weather: 'clear' | 'rain';
  lighting: 'day' | 'night';
  camera: ReviewCamera;
  opponents: '7' | '11';
}[] = [
  { workload: 'grid-start', weather: 'clear', lighting: 'day', camera: 'chase', opponents: '11' },
  { workload: 'close-racing', weather: 'clear', lighting: 'day', camera: 'pod', opponents: '7' },
  {
    workload: 'wet-following',
    weather: 'rain',
    lighting: 'day',
    camera: 'cockpit',
    opponents: '7',
  },
  {
    workload: 'wet-following',
    weather: 'rain',
    lighting: 'night',
    camera: 'trackside',
    opponents: '7',
  },
  { workload: 'pit-service', weather: 'clear', lighting: 'day', camera: 'chase', opponents: '7' },
];
for (const drive of drives)
  test(`27H.6 ${drive.workload} ${drive.lighting}: low-preset populated race and ${drive.camera} evidence`, async ({
    page,
  }, info) => {
    // These NEW cases include a real lap to the legal pit entry and the existing
    // ten-minute recorder ceiling. Existing CI budgets/retries/assertions remain.
    test.setTimeout(780000);
    const resolutionScale =
      drive.camera === 'cockpit' || drive.workload === 'pit-service' ? 0.5 : 0.75;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    if (drive.workload === 'pit-service') await configurePitStartup(page);
    await page.goto('/?dev');
    await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
    // Functional populated-race evidence on CI's software GPU. The original high-
    // fidelity full-lap suite remains unchanged; these files are not art approval.
    await page
      .getByRole('button', { name: 'GARAGE & SETTINGS', exact: true })
      .click({ timeout: 15000 });
    await page.locator('[name=quality]').selectOption('low');
    if (drive.weather === 'rain' || resolutionScale === 0.5) {
      await page.locator('.presentation-details > summary').click();
      if (drive.weather === 'rain') {
        // Low disables particles; real leader-attributed spray must remain present.
        await page.locator('[name=graphics_particleDensity]').press('End');
        await expect(page.locator('[name=graphics_particleDensity]')).toHaveValue('1');
      }
      if (resolutionScale === 0.5) {
        // Retain the documented functional workload scale. Pit sequence coverage
        // must not depend on lowering it again to catch short live phases.
        await page.locator('[name=graphics_resolutionScale]').press('Home');
        await expect(page.locator('[name=graphics_resolutionScale]')).toHaveValue('0.5');
      }
    }
    await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
    await expect(page.locator('#modal')).toBeHidden();
    if (drive.workload === 'pit-service') await armPitObservations(page);
    await page.selectOption('#mode', 'race');
    await page.selectOption('#laps', '5');
    await page.selectOption('#opponents', drive.opponents);
    await page.selectOption('#weather', drive.weather);
    await page.selectOption('#compound', drive.weather === 'rain' ? 'wet' : 'medium');
    // Select ordinary menu inputs shared with the headless session regression.
    // Wet following uses Vellamar explicitly: the default Aurel back-grid field
    // now separates too soon after launch for every slow recording phase.
    // Keep eight cars, real driving/spray, and the original qualification gates.
    const startSlot = REVIEW_START_SLOTS[drive.workload],
      circuit = REVIEW_CIRCUITS[drive.workload];
    if (startSlot) await page.selectOption('#startSlot', startSlot);
    if (circuit) {
      await page.selectOption('#circuit', circuit);
      await expect(page.locator('#circuit')).toHaveValue(circuit);
    }
    // All event reviews begin from the ordinary held grid. A running start lets
    // slow browser setup advance the opponents before the player's AI and camera
    // are ready. No vehicle is repositioned and simulation timing is unchanged.
    const pausedStart = true;
    await page
      .getByRole('button', {
        name: pausedStart ? 'PREPARE GRID START PAUSED' : 'ENTER CIRCUIT',
        exact: true,
      })
      .click();
    if (!pausedStart) await finishRaceEntry(page);
    await expect
      .poll(async () => (await diag(page)).state, { timeout: 90000 })
      .toBe(pausedStart ? 'paused' : 'driving');
    if (pausedStart) {
      await expect
        .poll(async () => (await diag(page)).workerPause)
        .toMatchObject({ pending: false, paused: true });
      await page.getByRole('button', { name: 'AI DRIVER', exact: true }).click();
      for (let i = 0; i < 4 && (await diag(page)).renderer?.camera !== drive.camera; i++) {
        await page.getByRole('button', { name: 'CHANGE CAMERA', exact: true }).click();
        await expect
          .poll(async () => {
            const r = (await diag(page)).renderer;
            return r?.presentedCamera === r?.requestedCamera;
          })
          .toBe(true);
      }
      await expect
        .poll(async () => (await diag(page)).renderer?.presentedCamera)
        .toBe(drive.camera);
    } else {
      await page.keyboard.press('g');
      for (let i = 0; i < 4 && (await diag(page)).renderer?.camera !== drive.camera; i++) {
        await page.keyboard.press('c');
        await expect
          .poll(async () => {
            const r = (await diag(page)).renderer;
            return r?.presentedCamera === r?.requestedCamera;
          })
          .toBe(true);
      }
      await pause(page);
    }
    expect((await diag(page)).auto).toBe(true);
    if (drive.lighting === 'night') {
      await page.locator('#modal [data-action="academy"]').click();
      await page.locator('#modal [data-action="lighting:night"]').click();
      await expect.poll(async () => (await diag(page)).renderer?.lighting).toBe('night');
      await page.locator('#modal [data-action="modalClose"]').click();
    }
    const before = await diag(page);
    expect(before.renderer?.warmupPitPasses).toBeGreaterThanOrEqual(2);
    expect(before.frame![H.CARS]).toBe(Number(drive.opponents) + 1);
    expect(before.renderer?.graphics.particleDensity).toBe(drive.weather === 'rain' ? 1 : 0);
    expect(before.renderer?.presentedCamera).toBe(drive.camera);
    expect(before.renderer?.graphics.resolutionScale).toBe(resolutionScale);
    if (pausedStart) {
      expect(before.state).toBe('paused');
      expect(before.workerPause).toMatchObject({ pending: false, paused: true });
      expect(before.frame![H.TIME]).toBe(0);
      expect(before.frame![H.TICK]).toBe(0);
      expect(before.frame![H.PHASE]).toBeLessThan(2);
      // Capture the cold scene before release rather than synchronously grabbing
      // a PNG during the first advancing following sequence. Continuous video
      // still covers the entire live run and qualified/complete PNGs are retained.
      await capture(page, info, `${drive.workload}-${drive.lighting}-prepared-grid`);
      const held = await diag(page);
      expect(held.frame![H.TIME]).toBe(before.frame![H.TIME]);
      expect(held.frame![H.TICK]).toBe(before.frame![H.TICK]);
      await info.attach(`27h6-${drive.workload}-${drive.lighting}-prepared-grid.json`, {
        body: JSON.stringify(held, null, 2),
        contentType: 'application/json',
      });
    }
    // Live event reviews stay strict. The pit functional case instead observes
    // a real recorded stop at the normal quarter-speed replay setting.
    if (drive.workload === 'pit-service') {
      await verifyRecordedPitSequence(page, info, errors);
      return;
    }
    await page.getByRole('button', { name: 'FULL-LAP VISUAL REVIEW', exact: true }).click();
    await page
      .locator('#reviewMachine')
      .fill(
        resolutionScale === 0.5
          ? `Hosted 640x400 Low + 50% render + ${drive.weather === 'rain' ? 'full spray' : 'full crew'}; software GPU only`
          : 'Hosted 640x400 Low + workload particles; software GPU only',
      );
    await page.selectOption('#reviewWorkload', drive.workload);
    await page.selectOption('#reviewMode', 'timed-scene');
    await page.getByRole('button', { name: 'RESUME & RECORD REVIEW', exact: true }).click();
    await expect.poll(async () => (await diag(page)).presentationReview.state).toBe('recording');
    const seen = new Set<string>();
    await expect
      .poll(
        async () => {
          const d = await diag(page),
            r = d.presentationReview;
          if (errors.length) throw new Error(errors.join('\n'));
          if (r.state === 'interrupted') {
            await info.attach('interrupted-race-diagnostics.json', {
              body: JSON.stringify(d, null, 2),
              contentType: 'application/json',
            });
            throw new Error(r.reason ?? 'Review interrupted');
          }
          const event = r.racing;
          const stage = event?.qualified ? 'qualified' : 'running';
          if (stage && !seen.has(stage)) {
            seen.add(stage);
            if (drive.workload !== 'wet-following' || stage !== 'running')
              await capture(page, info, `${drive.workload}-${drive.lighting}-${stage}`);
            await info.attach(`27h6-${drive.workload}-${drive.lighting}-${stage}.json`, {
              body: JSON.stringify(d, null, 2),
              contentType: 'application/json',
            });
          }
          return r.state;
        },
        { timeout: 610000, intervals: [250, 500, 1000] },
      )
      .toBe('complete');
    await capture(page, info, `${drive.workload}-${drive.lighting}-complete`);
    await pause(page);
    await page.getByRole('button', { name: 'FULL-LAP VISUAL REVIEW', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'EXPORT FRAME JSON', exact: true }).click();
    const file = await pending,
      path = info.outputPath(`${drive.workload}-${drive.lighting}.json`);
    await file.saveAs(path);
    const raw = await readFile(path),
      report = readPresentationReport(JSON.parse(raw.toString()));
    expect(report.state).toBe('complete');
    expect(report.context.racingEvidence).toBe(1);
    expect(report.context.workload).toBe(drive.workload);
    expect(report.racing?.summary.qualified).toBe(true);
    expect(report.summary.elapsedMs).toBeGreaterThanOrEqual(30000);
    expect(report.summary.visualAccepted).toBe(false);
    expect(report.rows.length).toBeGreaterThan(10);
    expect(report.rows.every((row) => row[3] > 0)).toBe(true);
    const configuration = JSON.parse(report.context.configuration);
    expect(configuration.auto).toBe(true);
    // The UI viewport and this explicitly configured drawing buffer are different.
    expect(page.viewportSize()).toEqual({ width: 640, height: 400 });
    expect(configuration.pixelRatio).toBe(await page.evaluate(() => devicePixelRatio));
    expect(configuration.graphics.resolutionScale).toBe(resolutionScale);
    const ratio = Math.min(configuration.pixelRatio, 1.5) * resolutionScale;
    expect(configuration.width).toBe(Math.floor(640 * ratio));
    expect(configuration.height).toBe(Math.floor(400 * ratio));
    const buffer = await page.locator('#world').evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    }));
    expect(buffer).toEqual({ width: configuration.width, height: configuration.height });
    if (circuit) expect(configuration.session.circuit).toBe(circuit);
    expect(configuration.session.opponents).toBe(Number(drive.opponents));
    expect(configuration.graphics.particleDensity).toBe(drive.weather === 'rain' ? 1 : 0);
    if (pausedStart) expect(report.context.startTime).toBe(0);
    if (drive.workload === 'wet-following') {
      expect(report.racing!.summary.gridLaunched).toBe(true);
      expect(report.racing!.summary.wetFollowingSeconds).toBeGreaterThanOrEqual(3);
    }
    await info.attach(`27h6-${drive.workload}-${drive.lighting}-frame-report.json`, {
      body: raw,
      contentType: 'application/json',
    });
    // Replay the genuinely recorded session, retaining its weather and camera.
    await page.locator('#modal [data-action="modalClose"]').click();
    await page.getByRole('button', { name: 'WATCH REPLAY', exact: true }).click();
    await expect(page.locator('#replayBar')).toBeVisible();
    await capture(page, info, `${drive.workload}-${drive.lighting}-recorded-replay`);
    expect(errors).toEqual([]);
  });
