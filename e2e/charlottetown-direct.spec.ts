import { test, expect } from '@playwright/test';

// Keep the original main-menu integration suite. This separately certifies
// the new city-first path: no circuit startup or substitutes for real workers.
for (const mode of [
  { id: 'formula', vehicle: 'apx01' },
  { id: 'motogp', vehicle: 'gpr1' },
  { id: 'horizon', vehicle: 'sc7' },
]) {
  test(`City-first ${mode.id}: launch, drive, campus travel and repeat entry`, async ({
    page,
  }, info) => {
    test.setTimeout(300000);
    const errors: string[] = [],
      requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => requests.push(request.url()));
    const read = () => page.evaluate(() => window.apexDiagnostics().festival);
    await page.goto(`/?map=charlottetown&discipline=${mode.id}`);
    await expect(page.locator('#cityLauncher')).toBeVisible({ timeout: 30000 });
    const button = page.locator(`[data-action="charlottetown:${mode.id}"]`);
    await expect(button).toBeEnabled({ timeout: 30000 });
    expect(await read()).toBeNull();
    await expect(button).toBeFocused();
    if (mode.id === 'horizon') await page.locator('#cityQuality').selectOption('high');
    await button.click();
    await expect(page.locator('#cityLoading')).toBeHidden({ timeout: 120000 });
    await expect(page.locator('#festivalHud')).toBeVisible();
    const loaded = await read();
    expect(loaded?.region).toBe('charlottetown');
    expect(loaded?.status?.vehicleId).toBe(mode.vehicle);
    expect(loaded?.city?.buildings).toBe(836);
    expect(loaded?.photographicSky).toBe(false);
    expect(loaded?.render?.drawCalls).toBeGreaterThan(0);
    expect(loaded?.gpuFrameQueue?.completed).toBeGreaterThan(0);
    expect(loaded?.status?.discovered).toHaveLength(4);
    if (await page.locator('#festCard').isVisible())
      await page.locator('#festCard [data-fest="cancel"]').click();
    const guide = page.locator('#festExplore.city-guide');
    await expect(guide).toBeVisible();
    await expect(guide.locator('[data-city-guide="instruction"]')).toContainText(
      'Right onto Queen Street',
    );
    await guide.locator('button').click();
    await expect(guide.locator('[data-city-guide="destination"]')).toHaveText('TO MALONEY DRIVE');
    await expect(guide.locator('button')).toHaveAttribute('aria-pressed', 'true');
    await guide.locator('button').click();
    await expect(guide.locator('[data-city-guide="destination"]')).toHaveText('TO HOLLAND COLLEGE');
    await page.screenshot({ path: info.outputPath(`${mode.id}-maloney.png`) });
    const start = (await read())!.position!;
    await page.keyboard.down('w');
    await expect
      .poll(
        async () => {
          const p = (await read())?.position;
          return p ? Math.hypot(p.x - start.x, p.z - start.z) : 0;
        },
        { timeout: 45000 },
      )
      .toBeGreaterThan(5);
    await page.keyboard.up('w');
    await page.keyboard.press('Escape');
    await expect(page.locator('#festMenu')).toBeVisible();
    await page.locator('#festMenu [data-fest="map"]').click();
    await expect(page.locator('#festMap')).toBeVisible();
    await page.locator('[data-fest="mapSelect"][data-value="charlottetown-return"]').click();
    await page.locator('#festMapDetail [data-fest="travel"]').click();
    await expect
      .poll(async () => (await read())?.status?.road.name, { timeout: 90000 })
      .toBe('Weymouth Street');
    await expect(page.locator('#cityLoading')).toBeHidden({ timeout: 90000 });
    if (await page.locator('#festMenu').isVisible())
      await page.locator('#festMenu [data-fest="resume"]').click();
    if (await page.locator('#festCard').isVisible())
      await page.locator('#festCard [data-fest="cancel"]').click();
    await expect(guide).toBeVisible();
    await expect(guide).toHaveAttribute('data-state', 'arrived');
    await page.screenshot({ path: info.outputPath(`${mode.id}-campus.png`) });
    await page.keyboard.press('Escape');
    await expect(page.locator('#festMenu')).toBeVisible();
    if (mode.id === 'horizon') {
      await page.locator('#festMenu [data-fest="lighting"][data-value="night"]').click();
      await page.locator('#festMenu [data-fest="resume"]').click();
      await expect.poll(async () => (await read())?.lighting).toBe('night');
      await page.screenshot({ path: info.outputPath('horizon-campus-night.png') });
      await page.keyboard.press('Escape');
    }
    const diagnostics = await read();
    expect(diagnostics?.gpuFrameQueue?.failure).toBeNull();
    await info.attach('city-diagnostics.json', {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: 'application/json',
    });
    await page.locator('#festMenu [data-fest="exit"]').click();
    await expect(page.locator('#festivalHud')).toHaveCount(0);
    await expect(page.locator('#cityLauncher')).toBeVisible();
    expect(await read()).toBeNull();
    // Context/session lifetime and save reuse; Formula must not restore a road car.
    await page.locator('[data-action="charlottetown:formula"]').click();
    await expect(page.locator('#cityLoading')).toBeHidden({ timeout: 120000 });
    await expect.poll(async () => (await read())?.status?.vehicleId).toBe('apx01');
    await page.keyboard.press('Escape');
    await page.locator('#festMenu [data-fest="exit"]').click();
    await expect(page.locator('#cityLauncher')).toBeVisible();
    expect(
      requests.some((url) => /models\/(?:aurel|hero-garage|pit-wall|concrete-barriers)/i.test(url)),
    ).toBe(false);
    expect(errors).toEqual([]);
  });
}
