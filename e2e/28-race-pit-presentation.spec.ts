import { PIT_ROLE_ACTIONS } from '../src/rendering/pit-role-performance.ts';
import { CREW_PERFORMANCE } from '../src/rendering/crew-performance.ts';
import { finishRaceEntry } from './race-entry.ts';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { H, F, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { readPresentationReport } from '../src/rendering/presentation-review.ts';
import { readPerformanceReport } from '../src/core/performance.ts';
import type { SessionReviewReport } from '../src/core/session-review.ts';
import { PIT_SERVICE_RADIUS } from '../src/rendering/pit-presentation.ts';
import { recordedPitMoment } from './fixtures/pit-replay-selection.ts';

test.use({ video: { mode: 'on', size: { width: 960, height: 600 } } });
const machine = 'Hosted Chromium software GPU; not physical hardware acceptance';
const read = (page: Page) => page.evaluate(() => window.apexDiagnostics());
const pause = async (page: Page) => {
  if ((await read(page)).state === 'driving') await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await read(page)).workerPause)
    .toMatchObject({ pending: false, paused: true });
};
const back = (page: Page) => page.locator('#modal [data-action="modalClose"]').click();
const resume = (page: Page) =>
  page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
async function image(page: Page, info: TestInfo, name: string) {
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    });
    const body = Buffer.from(data, 'base64');
    expect(body.length).toBeGreaterThan(10000);
    expect(body.readUInt32BE(16)).toBe(page.viewportSize()!.width);
    expect(body.readUInt32BE(20)).toBe(page.viewportSize()!.height);
    await info.attach(`27h6-${name}.png`, { body, contentType: 'image/png' });
  } finally {
    await session.detach();
  }
}
async function exported(page: Page, info: TestInfo, button: string, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = await pending,
    path = info.outputPath(name);
  await download.saveAs(path);
  const body = await readFile(path, 'utf8');
  await info.attach(name, { body, contentType: 'application/json' });
  return JSON.parse(body);
}
async function start(
  page: Page,
  weather: 'clear' | 'rain',
  camera: 'chase' | 'trackside',
  night = false,
  holdOnGrid = false,
) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // A grid sequence needs adjacent presented frames less than one second apart.
  // Use an explicit small Low workload on the software GPU for this one case;
  // wet full-lap and pit replay retain the default viewport and graphics.
  if (holdOnGrid) await page.setViewportSize({ width: 640, height: 400 });
  await page.goto('/?dev');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  if (holdOnGrid) {
    await page
      .getByRole('button', { name: 'GARAGE & SETTINGS', exact: true })
      .click({ timeout: 15000 });
    await page.locator('[name=quality]').selectOption('low');
    await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
    await expect(page.locator('#modal')).toBeHidden();
  }
  await page.getByRole('button', { name: 'SESSION 146 EVIDENCE', exact: true }).click();
  await page.locator('#sessionReviewer').fill('27H.6 automation; human acceptance remains open');
  await page.locator('#sessionReviewMachine').fill(machine);
  await page.getByRole('button', { name: 'ARM FROM PADDOCK', exact: true }).click();
  if (process.env.PIT_TEAM_CIRCUIT)
    await page.locator('#circuit').selectOption(process.env.PIT_TEAM_CIRCUIT);
  await page.locator('#mode').selectOption('race');
  await page.locator('#laps').selectOption('5');
  await page.locator('#opponents').selectOption('7');
  await page.locator('#weather').selectOption(weather);
  await page.locator('#compound').selectOption(weather === 'rain' ? 'wet' : 'medium');
  await page
    .getByRole('button', {
      name: holdOnGrid ? 'PREPARE GRID START PAUSED' : 'ENTER CIRCUIT',
      exact: true,
    })
    .click();
  if (!holdOnGrid) await finishRaceEntry(page);
  await expect
    .poll(async () => (await read(page)).state, { timeout: 90000 })
    .toBe(holdOnGrid ? 'paused' : 'driving');
  if (holdOnGrid) {
    await expect
      .poll(async () => (await read(page)).workerPause)
      .toMatchObject({ pending: false, paused: true });
    expect((await read(page)).frame![H.PHASE]).toBeLessThan(2);
  }
  await expect.poll(async () => (await read(page)).frame?.[H.CARS]).toBe(8);
  if (night) {
    await pause(page);
    await page.locator('#modal [data-action="academy"]').click();
    await page.locator('#modal [data-action="lighting:night"]').click();
    await expect.poll(async () => (await read(page)).renderer?.lighting).toBe('night');
    await back(page);
    await resume(page);
  }
  for (let i = 0; i < 4 && (await read(page)).renderer?.presentedCamera !== camera; i++) {
    if (holdOnGrid) await page.getByRole('button', { name: 'CHANGE CAMERA', exact: true }).click();
    else await page.keyboard.press('c');
    await expect
      .poll(async () => {
        const d = await read(page);
        return d.renderer?.presentedCamera === d.renderer?.requestedCamera;
      })
      .toBe(true);
  }
  await expect.poll(async () => (await read(page)).renderer?.presentedCamera).toBe(camera);
  return errors;
}
async function auto(page: Page) {
  if ((await read(page)).state === 'paused')
    await page.getByRole('button', { name: 'AI DRIVER', exact: true }).click();
  else await page.keyboard.press('g');
  await expect.poll(async () => (await read(page)).auto).toBe(true);
}
async function record(
  page: Page,
  workload: 'grid-start' | 'wet-night',
  mode: 'timed-scene' | 'full-lap',
) {
  await pause(page);
  await page.locator('#modal [data-action="visualReview"]').click();
  await page.locator('#reviewMachine').fill(machine);
  await page.locator('#reviewWorkload').selectOption(workload);
  await page.locator('#reviewMode').selectOption(mode);
  await page.getByRole('button', { name: 'RESUME & RECORD REVIEW', exact: true }).click();
  await expect.poll(async () => (await read(page)).presentationReview.state).toBe('recording');
}
async function sessionReport(page: Page, info: TestInfo, name: string) {
  await pause(page);
  await page.getByRole('button', { name: 'SESSION 146 EVIDENCE', exact: true }).click();
  await page.getByRole('button', { name: 'STOP OBSERVATIONS', exact: true }).click();
  const report = (await exported(
    page,
    info,
    'EXPORT SESSION JSON',
    `27h6-${name}-session.json`,
  )) as SessionReviewReport;
  expect(report.identity.source).toMatch(/^[a-f0-9]{64}$/);
  expect(report.autopilotObserved).toBe(true);
  expect(report.section146Accepted).toBe(false);
  expect(report.humanVerified).toBe(false);
  expect(report.rows.length).toBeGreaterThan(5);
  await back(page);
  return report;
}
async function performance(page: Page, info: TestInfo, name: string) {
  await pause(page);
  await page.getByRole('button', { name: 'PERFORMANCE CAPTURE', exact: true }).click();
  await page.locator('#profileMachine').fill(machine);
  await page
    .locator('#profileWorkload')
    .fill(`27H.6 ${name}; eight cars; graphics and viewport recorded in context`);
  await page.getByRole('button', { name: 'RESUME & CAPTURE', exact: true }).click();
  // No screenshots, camera/settings/driver changes or per-frame diagnostics in this window.
  await expect
    .poll(async () => (await read(page)).performanceCapture.state, {
      timeout: 120000,
      intervals: [2000],
    })
    .toBe('complete');
  await pause(page);
  await page.getByRole('button', { name: 'PERFORMANCE CAPTURE', exact: true }).click();
  const report = readPerformanceReport(
    await exported(page, info, 'EXPORT PERFORMANCE JSON', `27h6-${name}-performance.json`),
  );
  expect(report.state).toBe('complete');
  expect(report.summary.elapsedMs).toBeGreaterThanOrEqual(30000);
  // Software rendering may produce exactly five complete performance windows.
  expect(report.summary.samples).toBeGreaterThanOrEqual(5);
  expect(report.summary.averageDrawCalls).toBeGreaterThan(0);
  expect(report.context.source).toMatch(/^[a-f0-9]{64}$/);
  await back(page);
  return report;
}
async function replay(page: Page) {
  await page.getByRole('button', { name: 'WATCH REPLAY', exact: true }).click();
  await expect(page.locator('#replayBar')).toBeVisible();
  if ((await read(page)).replayPlaying) await page.locator('#replayPlay').click();
}
async function seek(page: Page, seconds: number) {
  // Service observations are arbitrary simulation instants; the real range
  // control accepts centisecond steps. Request a legal step and still assert
  // exact acknowledgement, rather than compare with an unrepresentable value.
  const requested = await page.locator('#replaySeek').evaluate((element, value) => {
    const input = element as HTMLInputElement,
      step = Number(input.step),
      min = Number(input.min),
      max = Number(input.max);
    if (!(step > 0) || !(max >= min) || !Number.isFinite(value))
      throw new Error('Invalid replay range');
    // Round up: a step below an observation can present the previous replay
    // frame (1/15 s earlier), which may belong to the previous pit phase.
    const units = Math.max(
        0,
        Math.min(Math.floor((max - min) / step), Math.ceil((value - min) / step - 1e-9)),
      ),
      target = Number((min + units * step).toFixed(8));
    input.value = String(target);
    if (input.valueAsNumber !== target) throw new Error('Replay control rejected its valid step');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return target;
  }, seconds);
  await expect.poll(async () => (await read(page)).replaySeekPending).toBe(false);
  await expect.poll(async () => (await read(page)).replayPosition).toBe(requested);
  // The range can acknowledge before a GPU-deferred frame is submitted. Observe
  // the decoded/presented replay, not the still-paused live worker's d.frame.
  const absoluteTime = (await read(page)).replayStart + requested;
  await expect
    .poll(async () => (await read(page)).renderer?.pitState.time)
    .toBeCloseTo(absoluteTime, 3);
  return read(page);
}

test('27H.6 low-preset populated start: real lights, moving pack, continuous video and frame distribution', async ({
  page,
}, info) => {
  test.setTimeout(480000);
  const errors = await start(page, 'clear', 'trackside', false, true);
  const heldGrid = await read(page);
  await auto(page);
  const configuredGrid = await read(page);
  expect(configuredGrid.state).toBe('paused');
  expect(configuredGrid.frame![H.TICK]).toBe(heldGrid.frame![H.TICK]);
  expect(configuredGrid.frame![H.TIME]).toBe(heldGrid.frame![H.TIME]);
  expect(configuredGrid.frame![H.PHASE]).toBeLessThan(2);
  await record(page, 'grid-start', 'timed-scene');
  await expect.poll(async () => (await read(page)).frame?.[H.PHASE], { timeout: 90000 }).toBe(2);
  await expect
    .poll(async () => (await read(page)).frame?.[carBase(0) + F.SPEED])
    .toBeGreaterThan(5);
  await image(page, info, 'populated-start');
  await expect
    .poll(async () => (await read(page)).presentationReview.state, { timeout: 120000 })
    .toBe('complete');
  await pause(page);
  await page.locator('#modal [data-action="visualReview"]').click();
  const frames = readPresentationReport(
    await exported(page, info, 'EXPORT FRAME JSON', '27h6-grid-frames.json'),
  );
  expect(frames.state).toBe('complete');
  expect(frames.context.camera).toBe('trackside');
  expect(frames.context.mode).toBe('timed-scene');
  expect(frames.racing?.summary.gridLaunched).toBe(true);
  const configuration = JSON.parse(frames.context.configuration);
  // The UI viewport and the Low preset's 75% drawing buffer are different.
  expect(page.viewportSize()).toEqual({ width: 640, height: 400 });
  expect(configuration.pixelRatio).toBe(await page.evaluate(() => devicePixelRatio));
  expect(configuration.graphics.resolutionScale).toBe(0.75);
  const ratio = Math.min(configuration.pixelRatio, 1.5) * 0.75;
  expect(configuration.width).toBe(Math.floor(640 * ratio));
  expect(configuration.height).toBe(Math.floor(400 * ratio));
  const buffer = await page.locator('#world').evaluate((canvas) => ({
    width: (canvas as HTMLCanvasElement).width,
    height: (canvas as HTMLCanvasElement).height,
  }));
  expect(buffer).toEqual({ width: configuration.width, height: configuration.height });
  expect(configuration.session.opponents).toBe(7);
  await back(page);
  await performance(page, info, 'dry-grid-continuation');
  const report = await sessionReport(page, info, 'grid');
  const phases = new Set(report.rows.map((row) => row[report.columns.indexOf('phase')]));
  expect(phases.has(1)).toBe(true);
  expect(phases.has(2)).toBe(true);
  const live = await read(page);
  expect(live.frame?.[H.CARS]).toBe(8);
  for (let id = 0; id < 8; id++) expect(live.frame?.[carBase(id) + F.RETIRED]).toBe(0);
  expect(live.renderer?.pitPersonnel.poseReuses).toBeGreaterThan(0);
  await info.attach('27h6-grid-application.json', {
    body: JSON.stringify(live),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('27H.6 wet-night traffic: actual following, full lap, spray, replay and measured frame intervals', async ({
  page,
}, info) => {
  test.setTimeout(900000);
  const errors = await start(page, 'rain', 'chase', true);
  // Give rivals a real, recorded head start through ordinary controls. Do not
  // move cars, inject a snapshot or change the simulation rate to stage a duel.
  await page.keyboard.down('ArrowDown');
  await expect.poll(async () => (await read(page)).frame?.[H.PHASE], { timeout: 90000 }).toBe(2);
  await expect
    .poll(
      async () => {
        const f = (await read(page)).frame;
        if (!f) return false;
        return Array.from({ length: 7 }, (_, n) => {
          const ds = (f[carBase(n + 1) + F.S] - f[carBase(0) + F.S] + f[H.LENGTH]) % f[H.LENGTH];
          return ds > 5 && ds < 45;
        }).some(Boolean);
      },
      { timeout: 90000, intervals: [100, 250] },
    )
    .toBe(true);
  await page.keyboard.up('ArrowDown');
  await auto(page);
  await record(page, 'wet-night', 'full-lap');
  let following: Awaited<ReturnType<typeof read>> | null = null;
  await expect
    .poll(
      async () => {
        const d = await read(page),
          f = d.frame;
        if (!f || f[carBase(0) + F.SPEED] < 5) return false;
        const close = Array.from({ length: 7 }, (_, n) => {
          const o = carBase(n + 1),
            p = carBase(0),
            ds = (f[o + F.S] - f[p + F.S] + f[H.LENGTH]) % f[H.LENGTH];
          const water = [2, 3].some((w) => f[o + WHEEL_BASE + w * WHEEL_STRIDE + W.WATER] > 0);
          return (
            ds > 3 &&
            ds < 45 &&
            Math.abs(f[o + F.Y] - f[p + F.Y]) < 3 &&
            f[o + F.SPEED] > 5 &&
            water
          );
        }).some(Boolean);
        if (close && (d.presentation?.particles.active[0] ?? 0) > 0) following = d;
        return following !== null;
      },
      { timeout: 240000, intervals: [250, 500] },
    )
    .toBe(true);
  await image(page, info, 'wet-night-following');
  await info.attach('27h6-actual-wet-following.json', {
    body: JSON.stringify(following),
    contentType: 'application/json',
  });
  await expect
    .poll(
      async () => {
        const d = await read(page);
        if (errors.length || d.presentationReview.state === 'interrupted')
          throw new Error(errors.join('\n') || d.presentationReview.reason || 'Interrupted');
        return d.presentationReview.state;
      },
      { timeout: 600000, intervals: [2000] },
    )
    .toBe('complete');
  await pause(page);
  await page.locator('#modal [data-action="visualReview"]').click();
  const frames = readPresentationReport(
    await exported(page, info, 'EXPORT FRAME JSON', '27h6-wet-night-full-lap.json'),
  );
  expect(frames.state).toBe('complete');
  expect(frames.progressM).toBeGreaterThanOrEqual(frames.context.trackLength);
  await back(page);
  await performance(page, info, 'wet-night-traffic');
  await sessionReport(page, info, 'wet-night');
  await replay(page);
  const first = await seek(page, 2),
    forward = await seek(page, 7),
    rewind = await seek(page, 2);
  expect(rewind.renderer?.weatherPresentation).toEqual(first.renderer?.weatherPresentation);
  expect(forward.renderer!.weatherPresentation.time).toBeGreaterThan(
    first.renderer!.weatherPresentation.time,
  );
  for (let i = 0; i < 4; i++) {
    const view = (await read(page)).renderer!.presentedCamera;
    await image(page, info, `wet-replay-${view}`);
    await page.locator('#replayBar [data-action="camera"]').click();
    await expect.poll(async () => (await read(page)).renderer!.presentedCamera).not.toBe(view);
  }
  expect((await read(page)).recordingWarnings).toEqual([]);
  expect(errors).toEqual([]);
});

test('27H.6 populated pit journey: approach, real service, exit and complete replay crew framing', async ({
  page,
}, info) => {
  test.setTimeout(900000);
  const wetNight = process.env.PIT_TEAM_NIGHT === '1';
  const errors = await start(page, wetNight ? 'rain' : 'clear', 'trackside', wetNight);
  await auto(page);
  await page.keyboard.press('p');
  await expect
    .poll(
      async () => {
        const d = await read(page),
          f = d.frame;
        if (errors.length) throw new Error(errors.join('\n'));
        return f && f[carBase(0) + F.PIT_STOPS] === 1 && f[carBase(0) + F.IN_PIT] === 0;
      },
      { timeout: 660000, intervals: [500, 1000] },
    )
    .toBe(true);
  await image(page, info, 'pit-exit');
  const afterExit = await read(page);
  expect(afterExit.frame?.[H.CARS]).toBe(8);
  expect(afterExit.frame?.[carBase(0) + F.RETIRED]).toBe(0);
  // A pit-exit observation is not the end of the recorded replay: the last
  // service-playback check needs another 5.5 s after service began. Let the
  // unmodified worker drive and record beyond that point before pausing.
  // Previously the recording stopped ~0.18 s short of the asserted timestamp,
  // so replay naturally reached its end and could never advance further.
  const pitExitTime = afterExit.frame![H.TIME];
  await expect
    .poll(
      async () => {
        const d = await read(page);
        if (errors.length) throw new Error(errors.join('\n'));
        if (d.frame?.[carBase(0) + F.RETIRED] !== 0)
          throw new Error('Player retired before post-pit replay evidence');
        return d.frame?.[H.TIME] ?? -Infinity;
      },
      { timeout: 90000, intervals: [250, 500] },
    )
    .toBeGreaterThan(pitExitTime + 1);
  const report = await sessionReport(page, info, 'pit');
  const phaseColumn = report.columns.indexOf('player_pit_phase'),
    timeColumn = report.columns.indexOf('simulation_time');
  const phases = new Set(report.rows.map((row) => row[phaseColumn]));
  for (const phase of [1, 2, 3, 4, 5, 6])
    expect(phases.has(phase), `Observed pit phase ${phase}`).toBe(true);
  // Worker observations locate service inside the real recorded replay. The
  // playback slider uses seconds relative to replay.start, not wall time.
  const removal = report.rows.filter((row) => row[phaseColumn] === 3);
  expect(removal.length).toBeGreaterThan(0);
  // Middle of the observed removal phase. When only one row was observed (a
  // forced snapshot on the phase's first replay tick) this is that row.
  const anchorTime = (removal[0][timeColumn] + removal[removal.length - 1][timeColumn]) / 2;
  await replay(page);
  const startTime = (await read(page)).replayStart;
  const anchor = await seek(page, anchorTime - startTime);
  expect(anchor.renderer?.pitState.phase).toBe(3);
  const removalTime = recordedPitMoment(anchor.renderer!.pitState, 'removal'),
    installTime = recordedPitMoment(anchor.renderer!.pitState, 'installation');
  await info.attach('27h6-pit-replay-selection.json', {
    body: JSON.stringify({
      anchorTime,
      observed: anchor.renderer!.pitState,
      removalTime,
      installTime,
    }),
    contentType: 'application/json',
  });
  const held = await seek(page, removalTime - startTime);
  await expect.poll(async () => (await read(page)).renderer?.pitPersonnel.actors).toBe(15);
  await expect.poll(async () => (await read(page)).renderer?.broadcastFramingFits).toBe(true);
  const service = await read(page);
  if (process.env.CREW_BASELINE !== '1') {
    expect(service.renderer!.pitPersonnel.crewAsset).toBe(CREW_PERFORMANCE.runtimeSHA256);
    expect(service.renderer!.pitPersonnel.authoredGunAction).toBe('gun_service');
    expect(service.renderer!.pitPersonnel.authoredRoles).toEqual(
      Object.fromEntries(
        Object.entries(PIT_ROLE_ACTIONS).map(([role, spec]) => [role, spec.action]),
      ),
    );
    expect(service.renderer!.pitPersonnel.unreachableFeet).toBe(0);
    expect(service.renderer!.pitPersonnel.unsupportedActors).toBe(0);
    expect(service.renderer!.pitPersonnel.unreachableArms).toBe(0);
    expect(service.renderer!.pitPersonnel.maxWristError).toBeLessThan(1e-5);
    expect(service.renderer!.pitPersonnel.maxGripError).toBeLessThan(1e-5);
  }
  expect(service.renderer?.raceComposition.kind).toBe('pit');
  expect(service.renderer!.broadcastSubjectRadius).toBeCloseTo(PIT_SERVICE_RADIUS, 6);
  // Read the lens actually used for this recorded service, not only a geometric
  // fits flag. Telephoto inspection must also retain the authored near cloth.
  expect(service.renderer!.broadcastSubjectScreenFraction).toBeGreaterThan(0.68);
  expect(service.renderer!.broadcastSubjectScreenFraction).toBeLessThanOrEqual(0.73);
  expect(service.renderer!.pitPersonnel.nearActors).toBeGreaterThanOrEqual(15);
  expect(service.renderer!.broadcastFov).toBeLessThan(24);
  expect(service.renderer!.broadcastSubjectSampleCount).toBe(9);
  expect(service.renderer!.broadcastSubjectWithinRange).toBe(true);
  // Boundaries are probes, not an artistic approval or proof of every actor pixel.
  expect(service.renderer!.broadcastVisibleSubjectSamples).toBeGreaterThan(0);
  expect(service.renderer!.broadcastVisibleSubjectSamples).toBeLessThanOrEqual(9);
  expect(service.renderer?.pitState.phase).toBe(3);
  expect(Math.max(...service.renderer!.pitState.wheelOffsets)).toBeGreaterThan(0);
  await image(page, info, 'pit-removal-full-crew');
  const builds = service.renderer!.pitPersonnel.poseBuilds,
    reuses = service.renderer!.pitPersonnel.poseReuses;
  // A held replay deliberately submits no frames. Request an ordinary resize
  // redraw of the same recorded instant before testing pose-cache reuse.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width - 1, height: viewport.height });
  await expect
    .poll(async () => (await read(page)).renderer!.pitPersonnel.poseReuses)
    .toBeGreaterThan(reuses);
  const redrawn = await read(page);
  expect(redrawn.renderer!.pitPersonnel.poseBuilds).toBe(builds);
  expect(redrawn.replayPlaying).toBe(false);
  expect(redrawn.replayPosition).toBe(held.replayPosition);
  expect(redrawn.frame?.[H.TICK]).toBe(held.frame?.[H.TICK]);
  await page.setViewportSize(viewport);
  const installation = await seek(page, installTime - startTime);
  expect(installation.renderer?.pitState.phase).toBe(4);
  expect(Math.max(...installation.renderer!.pitState.wheelOffsets)).toBeGreaterThan(0);
  await image(page, info, 'pit-installation-full-crew');
  // Observe the complete recorded service through ordinary replay controls.
  // Exact phase instants are keyed from the real observed service, never written
  // into worker snapshots. Baseline/candidate use the same camera and moments.
  const serviceStart = anchor.renderer!.pitState.time - anchor.renderer!.pitState.clock;
  const teamSurvey = [];
  for (const clock of [0.4, 1.2, 2, 2.7, 3.9, 4.85, 5.15]) {
    const at = await seek(page, serviceStart + clock - startTime);
    const state = at.renderer!.pitState,
      team = at.renderer!.pitPersonnel;
    expect(team.actors).toBeGreaterThanOrEqual(15);
    if (process.env.CREW_BASELINE !== '1') {
      expect(team.unreachableArms).toBe(0);
      expect(team.unreachableFeet).toBe(0);
      expect(team.unsupportedActors).toBe(0);
      expect(team.maxWristError).toBeLessThan(1e-5);
      if (clock >= 4.85) expect(state.jackHeight).toBeLessThan(1e-5);
    }
    teamSurvey.push({ clock, state, team, rendering: at.renderer });
    await image(page, info, `pit-team-${clock}`);
    expect(at.frame?.[H.TICK]).toBe(held.frame?.[H.TICK]);
  }
  await info.attach('pit-team-matched-survey.json', {
    body: JSON.stringify(teamSurvey),
    contentType: 'application/json',
  });
  // The recording must actually contain the desired post-service timestamp.
  // This is a data-coverage gate, not a relaxed playback assertion. Failing
  // here produces a useful explanation instead of waiting 120 s at EOF.
  const recorded = await read(page);
  const requiredEnd = serviceStart + 5.5;
  expect(
    recorded.replayStart + recorded.replaySeconds,
    'Recorded session ends before the post-service playback checkpoint',
  ).toBeGreaterThan(requiredEnd + 0.1);
  await seek(page, serviceStart - 0.2 - startTime);
  await page.locator('#replayPlay').click();
  await expect
    .poll(
      async () => {
        const state = await read(page);
        const replayedTime = state.renderer!.pitState.time;
        if (!state.replayPlaying && replayedTime <= requiredEnd)
          throw new Error(
            `Replay stopped at ${replayedTime}s before recorded service checkpoint ${requiredEnd}s`,
          );
        return replayedTime;
      },
      { timeout: 120000, intervals: [500] },
    )
    .toBeGreaterThan(requiredEnd);
  await page.locator('#replayPlay').click();
  expect((await read(page)).replayPlaying).toBe(false);
  const rewind = await seek(page, removalTime - startTime);
  expect(rewind.renderer?.pitState).toEqual(held.renderer?.pitState);
  expect(rewind.frame?.[H.TICK]).toBe(held.frame?.[H.TICK]);
  for (let i = 0; i < 4; i++) {
    const view = (await read(page)).renderer!.presentedCamera;
    await image(page, info, `pit-replay-${view}`);
    await page.locator('#replayBar [data-action="camera"]').click();
    await expect.poll(async () => (await read(page)).renderer!.presentedCamera).not.toBe(view);
  }
  await info.attach('27h6-pit-application.json', {
    body: JSON.stringify({
      afterExit,
      service,
      rewind,
      boundary:
        'Actual menu/input/worker/replay journey. No state injection. Software GPU; human artwork and hardware approval remain open.',
    }),
    contentType: 'application/json',
  });
  expect((await read(page)).recordingWarnings).toEqual([]);
  expect(errors).toEqual([]);
});

test('27H.6 GPU material: a damp film retains aggregate while deep standing water levels it', async ({
  page,
}, info) => {
  const { build } = await import('vite');
  const { resolve } = await import('node:path');
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/road-film.ts'),
        name: 'RoadFilmProbe',
        formats: ['iife'],
      },
    },
  });
  const bundle = Array.isArray(built) ? built[0] : built;
  if (!('output' in bundle)) throw new Error('Missing road probe output');
  const entry = bundle.output.find((item) => item.type === 'chunk');
  if (!entry || entry.type !== 'chunk') throw new Error('Missing road probe entry');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setContent(
    '<!doctype html><title>Isolated production-road GPU probe; not gameplay</title>',
  );
  await page.addScriptTag({ content: entry.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as {
        RoadFilmProbe: { roadFilmGPU: typeof import('./fixtures/road-film.ts').roadFilmGPU };
      }
    ).RoadFilmProbe.roadFilmGPU(),
  );
  for (const capture of result.captures.filter((c) => !c.name.startsWith('held-')))
    await info.attach(`27h6-material-${capture.name}.png`, {
      body: Buffer.from(capture.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('27h6-road-film-controls.json', {
    body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value)),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(result.error).toBe(0);
  for (const capture of [
    result.dry,
    result.damp,
    result.puddle,
    result.dampCoat,
    result.puddleCoat,
  ])
    expect(capture.saturated, 'Diagnostic normal encoding must not clip').toBe(0);
  expect(result.dry.detail).toBeGreaterThan(result.damp.detail);
  expect(result.damp.detail).toBeGreaterThan(result.puddle.detail * 2);
  expect(result.dampCoat.detail).toBeGreaterThan(result.puddleCoat.detail + 1);
  expect(result.dampCoat.hash).toBe(result.restored.hash);
  // Observe the compiled physical material, not only a shader-string assertion.
  // Eightfold diagnostic encoding resolves water's ~2% F0 in 8-bit pixels.
  const waterF0 = ((1.333 - 1) / (1.333 + 1)) ** 2;
  expect(Math.abs(result.filmFresnel.mean / 8 - waterF0)).toBeLessThan(1 / (255 * 8));
  expect(result.dampRoughness.mean).toBeGreaterThan(result.puddleRoughness.mean);
  expect(result.puddleRoughness.mean).toBeGreaterThanOrEqual(0.0525 - 1 / 255);
  expect(result.dampRoughness.saturated).toBe(0);
  expect(result.puddleRoughness.saturated).toBe(0);
  const footprint = result.lampFootprint;
  expect(footprint.dryPoint.hash).toBe(footprint.dryFinite.hash);
  expect(footprint.wetPoint.hash).not.toBe(footprint.wetFinite.hash);
  expect(footprint.finiteRoughness.mean).toBeGreaterThan(footprint.pointRoughness.mean + 1 / 255);
  expect(footprint.finiteRoughness.mean).toBeLessThan(0.33);
  expect(footprint.restoredRoughness.hash).toBe(footprint.pointRoughness.hash);
  expect(result.before).toEqual(result.after);
  expect(
    new Set(result.captures.filter((c) => c.name.startsWith('held-')).map((c) => c.hash)).size,
  ).toBe(1);
});
