import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { cabinRenderCost } from './fixtures/cabin-render-cost.ts';

/** Records what a catalogue cockpit submits on a full grid at the low and
 * medium tiers, next to the Formula cockpit in the same grid frame, and holds
 * the cabin-cost gates in the real renderer: the low tier draws no rival
 * cabin detail and the rear-view feeds run for the catalogue cockpit. A
 * measurement run (about ten minutes on SwiftShader), so it is opt-in:
 * CABIN_COST=1 npx playwright test e2e/cabin-render-cost.spec.ts. The unit
 * gates are in tests/vehicle-cabins.test.ts. */
test.skip(process.env.CABIN_COST !== '1', 'Opt-in measurement: set CABIN_COST=1');
test('catalogue cockpit cabin and mirror-feed cost on a full grid', async ({ page }, info) => {
  test.setTimeout(900000);
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/cabin-render-cost.ts'),
        name: 'CabinCostProbe',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing cabin-cost fixture');
  const chunk = result.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing cabin-cost code');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.text().startsWith('[cabin-cost')) console.log(m.text());
  });
  await page.route('**/cabin-cost-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Catalogue cockpit cabin cost</title>',
    }),
  );
  await page.setViewportSize({ width: 480, height: 270 });
  await page.goto('/cabin-cost-fixture');
  await page.addScriptTag({ content: chunk.code });
  const report = await page.evaluate(() =>
    (
      window as unknown as { CabinCostProbe: { cabinRenderCost: typeof cabinRenderCost } }
    ).CabinCostProbe.cabinRenderCost(),
  );
  await info.attach('cabin-render-cost.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  console.log(JSON.stringify(report.rows));
  expect(errors).toEqual([]);
  expect(report.glError).toBe(0);
  const row = (machine: string, quality: string) =>
    report.rows.find((r) => r.machine === machine && r.quality === quality)!;
  for (const quality of ['low', 'medium']) {
    const gt = row('gt8f', quality),
      formula = row('apx01', quality);
    expect(gt.cars).toBe(12);
    expect(gt.bodies).toBe(12);
    expect(formula.bodies).toBe(0);
    expect(gt.mirrorFrames).toBe(3);
    // The followed car's own cabin is always detailed and its feeds run.
    expect(gt.ownDetail).toBe(true);
    expect(gt.mirrorFrames).toBeGreaterThan(0);
    expect(formula.mirrorFrames).toBeGreaterThan(0);
  }
  // Low tier: no rival cabin detail at all, however close.
  expect(row('gt8f', 'low').rivalDetail).toBe(0);
  // Medium keeps it for the cars right around the grid slot.
  expect(row('gt8f', 'medium').rivalDetail).toBeGreaterThan(0);
});
