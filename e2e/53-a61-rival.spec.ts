import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { H } from '../src/simulation/protocol.ts';
import { A61_MANIFESTS } from '../src/rendering/a61-rival.ts';

const baseline = process.env.A61_BASELINE === '1';
const scenarios = [
  { circuit: 'aurel', weather: 'clear', lighting: 'day' },
  { circuit: 'vellamar', weather: 'rain', lighting: 'night' },
] as const;
async function slide(page: Page, field: string, value: number) {
  await page.locator(`#photo-${field}`).evaluate((node, next) => {
    const input = node as HTMLInputElement;
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function capture(page: Page, info: TestInfo, name: string) {
  const session = await page.context().newCDPSession(page);
  try {
    const shot = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await info.attach(name, { body: Buffer.from(shot.data, 'base64'), contentType: 'image/png' });
  } finally {
    await session.detach();
  }
}
for (const scenario of scenarios) {
  test(`A61 full-grid rival presentation on ${scenario.circuit} in ${scenario.weather}/${scenario.lighting}`, async ({
    page,
  }, info) => {
    test.setTimeout(600000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const read = () => page.evaluate(() => window.apexDiagnostics());
    await page.goto('/');
    await expect(page.locator('#menu')).toBeVisible({ timeout: 120000 });
    await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
    await page.locator('[name=quality]').selectOption('high');
    await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
    await page.locator('#circuit').selectOption(scenario.circuit);
    await page.locator('#weather').selectOption(scenario.weather);
    await page.locator('#compound').selectOption(scenario.weather === 'rain' ? 'wet' : 'medium');
    await page.locator('#opponents').selectOption('11');
    await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
    await expect.poll(async () => (await read()).state, { timeout: 180000 }).toBe('paused');
    await expect
      .poll(async () => (await read()).workerPause)
      .toMatchObject({ paused: true, pending: false });
    const initial = (await read()).frame!;
    expect(initial[H.TICK]).toBe(0);
    expect(initial[H.CARS]).toBe(12);
    if (!baseline) {
      const renderer = (await read()).renderer!;
      expect(renderer.rivalBodywork?.map((asset) => asset.sha256)).toEqual(
        A61_MANIFESTS.map((m) => m.sha256),
      );
      expect(renderer.rivalCars).toHaveLength(12);
      expect(renderer.rivalCars[0]).toMatchObject({ supplied: true, a61: false });
      expect(renderer.rivalCars.slice(1).every((car) => car.a61 && !car.supplied)).toBe(true);
    }
    await page.locator('#modal [data-action="academy"]').click();
    await page.locator(`#modal [data-action="lighting:${scenario.lighting}"]`).click();
    await expect.poll(async () => (await read()).renderer?.lighting).toBe(scenario.lighting);
    await page.locator('#modal [data-action="modalClose"]').click();
    await page.getByRole('button', { name: 'PHOTO STUDIO', exact: true }).click();
    await page.locator('#photoTarget').selectOption('1');
    await slide(page, 'distance', 8.5);
    await slide(page, 'focalLength', 38);
    await slide(page, 'elevation', 14);
    const observations = [];
    for (const [view, angle] of [
      ['front', 38],
      ['rear', 142],
      ['side', 90],
    ] as const) {
      await slide(page, 'azimuth', angle);
      await expect
        .poll(async () => (await read()).renderer?.photo)
        .toMatchObject({ target: 1, azimuth: angle, distance: 8.5 });
      // Wait for completed presentation work, not a fixed artificial game delay.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.getByRole('button', { name: 'CLEAN FRAME', exact: true }).click();
      await capture(
        page,
        info,
        `${baseline ? 'before' : 'after'}-${scenario.circuit}-${scenario.lighting}-${view}.png`,
      );
      const d = await read();
      expect(d.frame).toEqual(initial);
      expect(d.renderer!.drawCalls).toBeGreaterThan(0);
      expect(Number.isFinite(d.renderer!.triangles)).toBe(true);
      observations.push({ view, renderer: d.renderer });
      await page.getByRole('button', { name: 'SHOW CONTROLS', exact: true }).click();
    }
    await page.getByRole('button', { name: 'RETURN / ESC', exact: true }).click();
    await expect.poll(async () => (await read()).state).toBe('paused');
    await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
    await page.keyboard.press('g');
    await expect
      .poll(async () => (await read()).frame?.[H.TIME] ?? 0, { timeout: 150000 })
      .toBeGreaterThan(12);
    await capture(
      page,
      info,
      `${baseline ? 'before' : 'after'}-${scenario.circuit}-moving-grid.png`,
    );
    const driving = await read();
    expect(driving.state).toBe('driving');
    expect(driving.frame?.every(Number.isFinite)).toBe(true);
    await info.attach(`a61-${scenario.circuit}-${baseline ? 'before' : 'after'}.json`, {
      body: JSON.stringify({ baseline, scenario, observations, driving }, null, 2),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
}
