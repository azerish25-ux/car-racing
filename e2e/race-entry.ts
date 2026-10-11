import { expect, type Page } from '@playwright/test';

/** Explicit player route for older driving/rendering tests. It does not change
 * preferences, inject simulation data, or auto-dismiss the new pregame test. */
export async function finishRaceEntry(page: Page) {
  await expect
    .poll(
      async () => {
        const d = await page.evaluate(() => window.apexDiagnostics());
        if (d.state === 'driving') return 'driving';
        return (await page.locator('#raceBriefing').isVisible()) ? 'briefing' : d.state;
      },
      { timeout: 180000 },
    )
    .toMatch(/^(driving|briefing)$/);
  if (await page.locator('#raceBriefing').isVisible())
    await page.getByRole('button', { name: 'GO STRAIGHT TO LIGHTS', exact: true }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.apexDiagnostics())).state, {
      timeout: 180000,
    })
    .toBe('driving');
}
