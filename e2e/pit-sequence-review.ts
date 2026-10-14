import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { graphicsPreset } from '../src/rendering/options.ts';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { H, F, carBase } from '../src/simulation/protocol.ts';
import type { SessionReviewReport } from '../src/core/session-review.ts';
import { PitSequence, type PitSequenceSample } from './fixtures/pit-sequence.ts';

const diagnostics = (page: Page) => page.evaluate(() => window.apexDiagnostics());
/** Start this explicitly Low-quality functional case with an ordinary saved
 * preference, instead of compiling an unrelated Medium scene before the test.
 * The garage UI still applies and verifies the same final settings below. */
export async function configurePitStartup(page: Page) {
  const url = '**/__pit_test_settings__';
  await page.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Saved Low preferences</title>',
    }),
  );
  await page.goto('/__pit_test_settings__');
  await page.evaluate(
    (settings) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('apex-formula', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('saved');
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Settings database blocked'));
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('saved', 'readwrite');
          tx.objectStore('saved').put(settings, 'settings');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error ?? new Error('Settings write aborted'));
          };
        };
      }),
    validateSettings({
      ...DEFAULT_SETTINGS,
      quality: 'low',
      graphics: { ...graphicsPreset('low'), resolutionScale: 0.5 },
    }),
  );
  await page.unroute(url);
}

export async function armPitObservations(page: Page) {
  await page.getByRole('button', { name: 'SESSION 146 EVIDENCE', exact: true }).click();
  await page.locator('#sessionReviewer').fill('Automated pit sequence; not human acceptance');
  await page
    .locator('#sessionReviewMachine')
    .fill('Software GPU; live worker followed by recorded quarter-speed replay');
  await page.getByRole('button', { name: 'ARM FROM PADDOCK', exact: true }).click();
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    });
    const body = Buffer.from(data, 'base64');
    expect(body.length).toBeGreaterThan(10000);
    await info.attach(name, { body, contentType: 'image/png' });
  } finally {
    await cdp.detach();
  }
}
async function seek(page: Page, seconds: number) {
  const requested = await page.locator('#replaySeek').evaluate((element, value) => {
    const input = element as HTMLInputElement;
    const step = Number(input.step),
      min = Number(input.min),
      max = Number(input.max);
    if (!(step > 0) || value < min || value > max)
      throw new Error('Replay evidence outside recording');
    const target = Number((min + Math.ceil((value - min) / step - 1e-9) * step).toFixed(8));
    input.value = String(target);
    if (input.valueAsNumber !== target) throw new Error('Replay control rejected valid step');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return target;
  }, seconds);
  await expect.poll(async () => (await diagnostics(page)).replaySeekPending).toBe(false);
  await expect.poll(async () => (await diagnostics(page)).replayPosition).toBe(requested);
  const start = (await diagnostics(page)).replayStart;
  await expect
    .poll(async () => (await diagnostics(page)).renderer?.pitState.time)
    .toBeCloseTo(start + requested, 3);
}

/** A software GPU cannot guarantee a frame inside the short live removal phase.
 * Record the real worker stop first, then inspect one continuous quarter-speed
 * playback. Never inject snapshots, modify physics, weaken the live recorder,
 * or label this functional replay as live-performance acceptance. */
export async function verifyRecordedPitSequence(page: Page, info: TestInfo, errors: string[]) {
  await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).state).toBe('driving');
  await page.keyboard.press('p');
  const readLive = () =>
    page.evaluate(
      ({ H, F, b }) => {
        const d = window.apexDiagnostics(),
          frame = d.frame;
        return {
          state: d.state,
          time: frame?.[H.TIME] ?? 0,
          cars: frame?.[H.CARS],
          stops: frame?.[b + F.PIT_STOPS],
          inPit: frame?.[b + F.IN_PIT],
          retired: frame?.[b + F.RETIRED],
          speed: frame?.[b + F.SPEED] ?? 0,
        };
      },
      { H, F, b: carBase(0) },
    );
  await expect
    .poll(
      async () => {
        if (errors.length) throw new Error(errors.join('\n'));
        const d = await readLive();
        if (d.retired || d.state === 'results')
          throw new Error('Live race ended before completed pit exit');
        return d.stops === 1 && d.inPit === 0 && d.speed > 5;
      },
      { timeout: 360000, intervals: [250, 500] },
    )
    .toBe(true);
  const exit = await readLive();
  expect(exit.cars).toBe(8);
  // Record beyond the required exit: a slider cannot advance past recorded EOF.
  await expect.poll(async () => (await readLive()).time).toBeGreaterThan(exit.time + 1);
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await diagnostics(page)).workerPause)
    .toMatchObject({ pending: false, paused: true });
  const frozen = await diagnostics(page);
  expect(frozen.auto).toBe(true);
  expect(frozen.renderer?.graphics.resolutionScale).toBe(0.5);
  expect(frozen.renderer?.presentedCamera).toBe('chase');
  await page.getByRole('button', { name: 'SESSION 146 EVIDENCE', exact: true }).click();
  await page.getByRole('button', { name: 'STOP OBSERVATIONS', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'EXPORT SESSION JSON', exact: true }).click();
  const download = await pending,
    path = info.outputPath('pit-live-worker.json');
  await download.saveAs(path);
  const body = await readFile(path, 'utf8'),
    report = JSON.parse(body) as SessionReviewReport;
  await info.attach('pit-live-worker.json', { body, contentType: 'application/json' });
  expect(report.identity.source).toBe(frozen.buildIdentity.fingerprint);
  expect(report.autopilotObserved).toBe(true);
  expect(report.section146Accepted).toBe(false);
  expect(report.humanVerified).toBe(false);
  const phaseColumn = report.columns.indexOf('player_pit_phase');
  const timeColumn = report.columns.indexOf('simulation_time');
  const stopColumn = report.columns.indexOf('player_pit_stops');
  for (const column of [phaseColumn, timeColumn, stopColumn])
    expect(column).toBeGreaterThanOrEqual(0);
  const phases = new Set(report.rows.map((row) => row[phaseColumn]));
  for (const phase of [1, 2, 3, 4, 5, 6])
    expect(phases.has(phase), `Live worker phase ${phase}`).toBe(true);
  expect(report.rows.at(-1)![stopColumn]).toBe(1);
  const entry = report.rows.find((row) => row[phaseColumn] === 1)!;
  const approachTime = entry[timeColumn] - 2;
  await page.locator('#modal [data-action="modalClose"]').click();
  await page.getByRole('button', { name: 'WATCH REPLAY', exact: true }).click();
  await expect(page.locator('#replayBar')).toBeVisible();
  if ((await diagnostics(page)).replayPlaying) await page.locator('#replayPlay').click();
  const recorded = await diagnostics(page);
  expect(approachTime).toBeGreaterThanOrEqual(recorded.replayStart);
  expect(recorded.replayStart + recorded.replaySeconds).toBeGreaterThan(exit.time + 0.5);
  const [speed] = await page.locator('#replaySpeed').selectOption({ label: '¼×' });
  expect(Number(speed)).toBe(0.25);
  await seek(page, approachTime - recorded.replayStart);
  await screenshot(page, info, 'pit-replay-approach.png');
  const sequence = new PitSequence();
  const observe = async () => {
    const d = await page.evaluate(
      ({ tick }) => {
        const d = window.apexDiagnostics(),
          r = d.renderer!;
        return {
          state: d.state,
          workerTick: d.frame?.[tick],
          workerPause: d.workerPause,
          playing: d.replayPlaying,
          pending: d.replaySeekPending,
          sample: {
            ...r.pitState,
            crewActors: r.pitPersonnel.actors,
            crews: r.pitPersonnel.crews,
          },
          camera: r.presentedCamera,
          drawCalls: r.drawCalls,
          cars: r.rivalCars.length,
        };
      },
      { tick: H.TICK },
    );
    if (errors.length) throw new Error(errors.join('\n'));
    expect(d.state).toBe('replay');
    expect(d.workerPause).toMatchObject({ pending: false, paused: true });
    expect(d.workerTick).toBe(frozen.frame![H.TICK]);
    expect(d.pending).toBe(false);
    expect(d.camera).toBe('chase');
    expect(d.cars).toBe(8);
    expect(d.drawCalls).toBeGreaterThan(0);
    sequence.observe(d.sample);
    return d;
  };
  await observe();
  const started = Date.now();
  await page.locator('#replayPlay').click();
  try {
    await expect
      .poll(
        async () => {
          const d = await observe();
          if (!d.playing && !sequence.complete)
            throw new Error('Replay stopped before qualified pit exit');
          return sequence.complete;
        },
        { timeout: 360000, intervals: [100, 250] },
      )
      .toBe(true);
  } finally {
    await info.attach('pit-continuous-replay-sequence.json', {
      body: JSON.stringify(
        {
          version: 1,
          evidence: 'recorded-replay-functional-pit-sequence',
          source: report.identity.source,
          playbackRate: 0.25,
          elapsedWallMs: Date.now() - started,
          complete: sequence.complete,
          stages: sequence.stages,
          samples: sequence.samples,
          livePerformanceAccepted: false,
          visualAccepted: false,
          humanVerified: false,
          configuration: {
            viewport: page.viewportSize(),
            graphics: frozen.renderer?.graphics,
            opponents: 7,
          },
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
  await page.locator('#replayPlay').click();
  expect(sequence.stages).toEqual([
    'entry',
    'arrival',
    'removal',
    'installation',
    'clearance',
    'release',
    'exit',
  ]);
  expect(sequence.samples.length).toBeGreaterThan(10);
  expect(Date.now() - started).toBeGreaterThanOrEqual(30000);
  await screenshot(page, info, 'pit-replay-exit.png');
  // Matching stills AFTER sequence qualification: screenshot readback cannot
  // starve the critical removal interval. These seeks never count as continuity.
  for (const [name, phase] of [
    ['removal', 3],
    ['installation', 4],
  ] as const) {
    const sample = sequence.samples.find(
      (s: PitSequenceSample) =>
        s.phase === phase &&
        s.jackHeight > 0.1 &&
        s.wheelOffsets.every((offset) => offset > 0) &&
        s.crewActors === 15,
    )!;
    expect(sample).toBeDefined();
    await seek(page, sample.time - recorded.replayStart);
    const displayed = (await diagnostics(page)).renderer!;
    expect(displayed.pitState.phase).toBe(phase);
    expect(displayed.pitState.jackHeight).toBeGreaterThan(0.1);
    expect(displayed.pitState.wheelOffsets.every((offset) => offset > 0)).toBe(true);
    expect(displayed.pitPersonnel.actors).toBe(15);
    await screenshot(page, info, `pit-replay-${name}-four-wheels-and-crew.png`);
  }
  expect((await diagnostics(page)).recordingWarnings).toEqual([]);
  expect(errors).toEqual([]);
}
