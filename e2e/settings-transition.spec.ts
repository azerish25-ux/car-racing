import { MENU_STARTUP_TIMEOUT_MS } from './menu-startup.ts';
import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 15000 });

for (const [width, height] of [[640, 400], [1280, 720]]) {
  test(`settings transition: ${width}x${height} owns its first covered frame and persists quality`, async ({ page }, info) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
    const settings = page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true });
    // Observe the real click before its handler opens the editor. No synthetic
    // click, forced input, altered renderer, or wait-for-timeout retry is used.
    await settings.evaluate((button) => {
      button.addEventListener('click', () => {
        const value = window.apexDiagnostics();
        document.body.dataset.settingsOpenFrames = String(value.presentation?.frames);
        document.body.dataset.settingsOpenPolls = String(value.inputPolls);
      }, { capture: true, once: true });
    });
    await settings.click();
    await expect(page.locator('#settingsForm')).toBeVisible();
    const held = await page.evaluate(async () => {
      for (let i = 0; i < 8; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const value = window.apexDiagnostics();
      return {
        before: Number(document.body.dataset.settingsOpenFrames),
        after: value.presentation?.frames,
        inputBefore: Number(document.body.dataset.settingsOpenPolls),
        inputAfter: value.inputPolls,
        covered: value.presentation?.menuCovered,
      };
    });
    expect(held.after).toBe(held.before);
    expect(held.covered).toBe(true);
    expect(held.inputAfter).toBeGreaterThan(held.inputBefore);
    await page.locator('[name=quality]').selectOption('low');
    await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
    await expect(page.locator('#modal')).toBeHidden({ timeout: 60000 });
    await expect.poll(() => page.evaluate(() => window.apexDiagnostics().settingsTransition))
      .toEqual({ busy: false, phase: 'idle' });
    await page.reload();
    await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
    await settings.click();
    await expect(page.locator('[name=quality]')).toHaveValue('low');
    // Exercise keyboard submission with unchanged graphics as well as the cold
    // pointer transition above. Reload verifies actual persistence, not a toast.
    const submit = page.getByRole('button', { name: 'APPLY & SAVE', exact: true });
    await submit.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#modal')).toBeHidden({ timeout: 60000 });
    expect(errors).toEqual([]);
    await info.attach('settings-transition.json', {
      body: JSON.stringify({ width, height, held, diagnostics: await page.evaluate(() => window.apexDiagnostics()) }),
      contentType: 'application/json',
    });
    await info.attach('settings-saved.png', { body: await page.screenshot(), contentType: 'image/png' });
  });
}
