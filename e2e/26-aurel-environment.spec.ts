import { MENU_STARTUP_TIMEOUT_MS } from './menu-startup.ts';
import { finishRaceEntry } from './race-entry.ts';
import { expect, test } from '@playwright/test';

test('27H.4 normal startup constructs the upgraded districts and retained event hall', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
  const read = () => page.evaluate(() => window.apexDiagnostics());
  const loaded = await read();
  const environment = loaded.renderer?.environmentAssets;
  if (!environment?.frontage)
    throw new Error('A21 frontage diagnostics are unavailable at startup');
  expect(environment.source).toBe('constructed-runtime-groups');
  expect(environment.startFinish).toMatchObject({ stands: 2, boards: 1, finalArtApproved: false });
  expect(Number.isSafeInteger(environment.startFinish.boardUpdates)).toBe(true);
  expect(environment.districts.map((d) => d.kind)).toEqual([
    'club',
    'terrace',
    'works',
    'concourse',
  ]);
  for (const district of environment.districts) {
    expect(district.revision).toBe('27H.4-constructed-venue-v1');
    expect(district.position.every(Number.isFinite)).toBe(true);
    expect(district.finalArtApproved).toBe(false);
  }
  expect(loaded.renderer?.venueLighting.landmark).toBeDefined();
  expect(loaded.renderer?.broadcastSolidOccluders).toBeLessThanOrEqual(256);
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await finishRaceEntry(page);
  await expect.poll(async () => (await read()).state, { timeout: 90000 }).toBe('driving');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await read()).workerPause)
    .toMatchObject({ pending: false, paused: true });
  const paused = await read();
  const pausedEnvironment = paused.renderer?.environmentAssets;
  if (!pausedEnvironment?.frontage)
    throw new Error('A21 frontage diagnostics are unavailable after practice entry');

  if (!environment.garage?.overheadServices || !environment.garage.workshop)
    throw new Error('A22 garage and attached service diagnostics are unavailable');

  // Entering the circuit moves the camera from the menu framing and therefore
  // legitimately changes A21's distance-based LODs. Keep every static asset
  // identity field strict while accepting only the documented dynamic counters.
  // A18 must repaint for the new session: its lifetime update count is not an
  // immutable asset identifier. No other start/finish field is exempted.
  expect(pausedEnvironment).toEqual({
    ...environment,
    startFinish: { ...environment.startFinish, boardUpdates: expect.any(Number) },
    // The garage, overhead rig and workshop also select camera-dependent LODs.
    // Preserve their source IDs, sockets and all other immutable identity data.
    garage: {
      ...environment.garage,
      lod: expect.any(Number),
      triangles: expect.any(Number),
      overheadServices: {
        ...environment.garage.overheadServices,
        lod: expect.any(Number),
        triangles: expect.any(Number),
      },
      workshop: {
        ...environment.garage.workshop,
        lod: expect.any(Number),
        triangles: expect.any(Number),
      },
    },
    frontage: {
      ...environment.frontage,
      chunks: environment.frontage.chunks.map((chunk) => ({
        ...chunk,
        lod: expect.any(Number),
        triangles: expect.any(Number),
      })),
      triangles: expect.any(Number),
    },
  });
  for (const asset of [
    pausedEnvironment.garage,
    pausedEnvironment.garage?.overheadServices,
    pausedEnvironment.garage?.workshop,
  ]) {
    expect(Number.isInteger(asset?.lod)).toBe(true);
    expect(asset?.lod).toBeGreaterThanOrEqual(0);
    expect(asset?.lod).toBeLessThanOrEqual(2);
    expect(asset?.triangles).toBeGreaterThan(0);
  }
  expect(Number.isSafeInteger(pausedEnvironment.startFinish.boardUpdates)).toBe(true);
  expect(pausedEnvironment.startFinish.boardUpdates).toBeGreaterThanOrEqual(
    environment.startFinish.boardUpdates,
  );
  // Observe actual rendered frames after the worker's pause acknowledgement.
  // The new session must have painted, then a held frame must stop repainting.
  // No sleeps, simulation writes, changed deadlines or retries are involved.
  const heldBoard = await page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const sample = () => {
      const d = window.apexDiagnostics();
      return {
        state: d.state,
        frame: d.frame,
        updates: d.renderer?.environmentAssets.startFinish.boardUpdates,
        paused: d.workerPause.paused,
        pending: d.workerPause.pending,
      };
    };
    await frame();
    await frame();
    const before = sample();
    await frame();
    await frame();
    return { before, after: sample() };
  });
  expect(heldBoard.before).toMatchObject({ state: 'paused', paused: true, pending: false });
  expect(heldBoard.before.frame).not.toBeNull();
  expect(heldBoard.before.updates).toBeGreaterThan(environment.startFinish.boardUpdates);
  expect(heldBoard.after).toEqual(heldBoard.before);
  for (const chunk of pausedEnvironment.frontage.chunks) {
    expect(Number.isInteger(chunk.lod)).toBe(true);
    expect(chunk.lod).toBeGreaterThanOrEqual(0);
    expect(chunk.lod).toBeLessThanOrEqual(2);
    expect(chunk.triangles).toBeGreaterThan(0);
  }
  expect(pausedEnvironment.frontage.triangles).toBe(
    pausedEnvironment.frontage.chunks.reduce((total, chunk) => total + chunk.triangles, 0),
  );
  await info.attach('27h4-normal-startup.json', {
    body: JSON.stringify(
      {
        loaded,
        paused,
        heldBoard,
        evidenceBoundary: 'Startup integration only; not full-lap art acceptance.',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    });
    const image = Buffer.from(data, 'base64');
    expect(image.readUInt32BE(16)).toBe(page.viewportSize()!.width);
    expect(image.readUInt32BE(20)).toBe(page.viewportSize()!.height);
    await info.attach('27h4-normal-startup.png', { body: image, contentType: 'image/png' });
  } finally {
    await session.detach();
  }
  expect(errors).toEqual([]);
});
