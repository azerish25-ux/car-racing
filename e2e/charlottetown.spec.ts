import { test, expect } from '@playwright/test';

for (const mode of [
  { id: 'formula', vehicle: 'apx01' },
  { id: 'motogp', vehicle: 'gpr1' },
  { id: 'horizon', vehicle: 'sc7' },
]) {
  test(`Charlottetown ${mode.id}: menu, real worker, driving, map and campus travel`, async ({
    page,
  }, info) => {
    test.setTimeout(300000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const read = () => page.evaluate(() => window.apexDiagnostics().festival);
    await page.goto('/');
    await expect(page.locator('#menu')).toBeVisible({ timeout: 120000 });
    await expect(page.locator('.city-map-modes button')).toHaveCount(3);
    if (mode.id === 'horizon') {
      await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
      await page.locator('[name=quality]').selectOption('high');
      await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
    }
    await page.locator(`[data-action="charlottetown:${mode.id}"]`).click();
    await expect(page.locator('#festivalHud')).toBeVisible({ timeout: 120000 });
    await expect
      .poll(async () => (await read())?.render?.drawCalls ?? 0, { timeout: 120000 })
      .toBeGreaterThan(0);
    const loaded = await read();
    expect(loaded?.region).toBe('charlottetown');
    expect(loaded?.status?.vehicleId).toBe(mode.vehicle);
    expect(loaded?.city?.buildings).toBe(836);
    expect(loaded?.photographicSky).toBe(false);
    expect(loaded?.status?.discovered).toHaveLength(4);
    if (await page.locator('#festCard').isVisible())
      await page.locator('#festCard [data-fest="cancel"]').click();
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
      .poll(async () => (await read())?.status?.road.name, { timeout: 120000 })
      .toBe('Weymouth Street');
    await expect(page.locator('#loading')).toBeHidden({ timeout: 120000 });
    if (await page.locator('#festMenu').isVisible())
      await page.locator('#festMenu [data-fest="resume"]').click();
    if (await page.locator('#festCard').isVisible())
      await page.locator('#festCard [data-fest="cancel"]').click();
    await page.screenshot({ path: info.outputPath(`${mode.id}-college.png`) });
    if (mode.id === 'horizon') {
      await page.keyboard.press('Escape');
      await page.locator('#festMenu [data-fest="lighting"][data-value="night"]').click();
      await page.locator('#festMenu [data-fest="resume"]').click();
      await expect.poll(async () => (await read())?.lighting).toBe('night');
      await page.screenshot({ path: info.outputPath('horizon-college-night.png') });
    }
    await info.attach(`${mode.id}-diagnostics.json`, {
      body: JSON.stringify(await read(), null, 2),
      contentType: 'application/json',
    });
    await page.keyboard.press('Escape');
    await page.locator('#festMenu [data-fest="exit"]').click();
    await expect(page.locator('#festivalHud')).toHaveCount(0);
    await expect(page.locator('#menu')).toBeVisible();
    expect(await read()).toBeNull();
    expect(errors).toEqual([]);
  });
}
