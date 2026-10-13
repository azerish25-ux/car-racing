import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { surveyAurelVegetation } from './fixtures/aurel-vegetation.ts';
import { requireOperationsInspectionBudget } from '../scripts/operations-render-budget.ts';
import { requireInfrastructureRenderBudget } from '../scripts/infrastructure-render-budget.ts';

for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A51-A54 ${lighting} full production landscape, cockpit and stable camera cycles`, async ({
    page,
  }, info) => {
    // Keep the complete production evidence workload (including night rain);
    // this is a browser watchdog, not an application FPS allowance.
    test.setTimeout(1200000);
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/aurel-vegetation.ts'),
          name: 'VegetationSurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing vegetation observer');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('No vegetation observer code');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/vegetation-survey', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Aurel vegetation production survey</title>',
      }),
    );
    await page.goto('/vegetation-survey');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      (l) =>
        (
          window as unknown as {
            VegetationSurvey: { surveyAurelVegetation: typeof surveyAurelVegetation };
          }
        ).VegetationSurvey.surveyAurelVegetation(l),
      lighting,
    );
    for (const image of [...report.images, report.cockpit])
      await info.attach(`${lighting}-${image.name}.png`, {
        body: Buffer.from(image.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    const data = {
      ...report,
      errors,
      images: report.images.map(({ image: _image, ...m }) => m),
      cockpit: { name: report.cockpit.name, stats: report.cockpit.stats },
    };
    await writeFile(info.outputPath('vegetation-report.json'), JSON.stringify(data, null, 2));
    await info.attach('vegetation-report.json', {
      body: JSON.stringify(data, null, 2),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
    expect(report.glError).toBe(0);
    expect(report.contextLost).toBe(false);
    expect(report.sourceUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    expect(report.identitiesUnchanged).toBe(true);
    for (const memory of report.memories) expect(memory).toEqual(report.memoryBefore);
    expect(report.detail.trees).toBeGreaterThan(1800);
    expect(report.detail.orchard).toBeGreaterThan(40);
    expect(report.detail.instances).toBeLessThan(440);
    expect(report.detail.finalArtApproved).toBe(false);
    expect(report.images).toHaveLength(20);
    expect(report.mipmaps.length).toBeGreaterThan(7);
    expect(report.mipmaps.at(-1)).toEqual({ width: 1, height: 1 });
    for (const c of report.comparisons) expect(c.changedPixels).toBeGreaterThan(500);
    for (const image of report.images) {
      expect(image.range).toBeGreaterThan(30);
      requireOperationsInspectionBudget(image, image.passes);
    }
    const stats = report.cockpit.stats;
    requireInfrastructureRenderBudget(
      lighting,
      { name: 'normal-cockpit', calls: stats.drawCalls, triangles: stats.triangles },
      stats.drawBreakdown,
    );
  });
}
