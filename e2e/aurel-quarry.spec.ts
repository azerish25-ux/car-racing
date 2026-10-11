import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { surveyAurelQuarry } from './fixtures/aurel-quarry.ts';
import { requireOperationsInspectionBudget } from '../scripts/operations-render-budget.ts';
import { requireInfrastructureRenderBudget } from '../scripts/infrastructure-render-budget.ts';

for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A55-A60 ${lighting} full production landscape, cockpit and stable camera cycles`, async ({
    page,
  }, info) => {
    // Night rain under hosted Mesa can outlast 10 minutes while completing the
    // same 80 warmup + 40 measurement frames and physical traversal. This is a
    // browser watchdog, not a graphics, coverage or physics-performance budget.
    test.setTimeout(1200000);
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/aurel-quarry.ts'),
          name: 'QuarrySurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing quarry observer');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('No quarry observer code');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/quarry-survey', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Aurel quarry production survey</title>',
      }),
    );
    await page.goto('/quarry-survey');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      (l) =>
        (
          window as unknown as {
            QuarrySurvey: { surveyAurelQuarry: typeof surveyAurelQuarry };
          }
        ).QuarrySurvey.surveyAurelQuarry(l),
      lighting,
    );
    for (const image of [
      ...report.images,
      report.cockpit,
      ...report.driving.map((d, i) => ({ ...d, name: `physical-drive-${i}` })),
    ])
      await info.attach(`${lighting}-${image.name}.png`, {
        body: Buffer.from(image.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    const data = {
      ...report,
      errors,
      images: report.images.map(({ image: _image, ...m }) => m),
      cockpit: { name: report.cockpit.name, stats: report.cockpit.stats },
      driving: report.driving.map(({ image: _image, ...d }) => d),
    };
    await writeFile(info.outputPath('quarry-report.json'), JSON.stringify(data, null, 2));
    await info.attach('quarry-report.json', {
      body: JSON.stringify(data, null, 2),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
    expect(report.glError).toBe(0);
    expect(report.contextLost).toBe(false);
    expect(report.sourceUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    expect(report.identitiesUnchanged).toBe(true);
    expect(report.sceneGeometryUnchanged).toBe(true);
    expect(report.warmupMemories).toHaveLength(80);
    expect(report.memories).toHaveLength(40);
    expect(report.cameraSequence).toHaveLength(40);
    for (const memory of report.memories) expect(memory).toEqual(report.memoryBefore);
    expect(report.detail.sites).toBeLessThanOrEqual(360);
    expect(report.detail.families['cliff-cut']).toBeGreaterThan(1);
    expect(report.detail.families['cliff-bench']).toBeGreaterThan(3);
    expect(report.detail.chunks).toBeLessThan(60);
    expect(report.detail.geometryBytes).toBeLessThan(16 * 1024 * 1024);
    expect(report.detail.finalArtApproved).toBe(false);
    expect(report.images).toHaveLength(18);
    expect(report.driveCompleted).toBe(true);
    expect(report.driving.length).toBeGreaterThanOrEqual(4);
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
