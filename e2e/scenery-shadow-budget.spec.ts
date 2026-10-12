import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { sceneryShadowBudget } from './fixtures/scenery-shadow-budget.ts';
import { requireInfrastructureRenderBudget } from '../scripts/infrastructure-render-budget.ts';

for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`scenery shadow budget ${lighting}`, async ({ page }, info) => {
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/scenery-shadow-budget.ts'),
          name: 'ShadowBudget',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing shadow observer');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('No shadow observer code');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/scenery-shadow-survey', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Scenery shadow budget</title>',
      }),
    );
    await page.goto('/scenery-shadow-survey');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      (l) =>
        (
          window as unknown as {
            ShadowBudget: { sceneryShadowBudget: typeof sceneryShadowBudget };
          }
        ).ShadowBudget.sceneryShadowBudget(l),
      lighting,
    );
    const { image, ...data } = report;
    const json = JSON.stringify({ ...data, errors }, null, 2);
    await writeFile(info.outputPath('scenery-shadow-report.json'), json);
    await info.attach('scenery-shadow-report.json', {
      body: json,
      contentType: 'application/json',
    });
    await info.attach(`${lighting}-cockpit.png`, {
      body: Buffer.from(image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    console.log(
      JSON.stringify({
        lighting,
        calls: report.calls,
        triangles: report.triangles,
        passes: report.passes,
        shadowEquivalence: report.shadowEquivalence,
        glErrorStages: report.glErrorStages,
        largestShadowSubmissions: report.shadows.slice(0, 12),
      }),
    );
    expect(errors).toEqual([]);
    expect(report.sourceUnchanged).toBe(true);
    expect(report.glError).toBe(0);
    expect(report.contextLost).toBe(false);
    expect(report.shadowEquivalence.changedBytes).toBe(0);
    expect(report.shadowEquivalence.geometryUnchanged).toBe(true);
    if (lighting === 'night') {
      // The rain-driven player is further back: Three already excludes the
      // stand-55 sphere. The retained r02 night frame had no false-positive
      // batches. Keep this as an exact NO-CHANGE control, not a forced saving.
      expect(report.shadowEquivalence.savedTriangles).toBe(0);
      expect(report.shadowEquivalence.cropped).toEqual(report.shadowEquivalence.uncropped);
    } else {
      expect(report.shadowEquivalence.savedTriangles).toBeGreaterThan(200000);
      expect(report.shadowEquivalence.cropped.calls).toBeLessThan(
        report.shadowEquivalence.uncropped.calls,
      );
    }
    // Independent per-object accounting must cover the entire shadow phase.
    expect(report.shadows.reduce((n, r) => n + r.calls, 0)).toBe(report.passes.shadow.calls);
    expect(report.shadows.reduce((n, r) => n + r.triangles, 0)).toBe(
      report.passes.shadow.triangles,
    );
    requireInfrastructureRenderBudget(
      lighting,
      {
        name: 'normal-cockpit',
        calls: report.calls,
        triangles: report.triangles,
      },
      report.passes,
    );
  });
}
