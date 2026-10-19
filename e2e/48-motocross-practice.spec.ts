import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

test('solo landing targets, held-brake guidance and autopilot exclusion use the visible production HUD', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motocross-interface.ts'),
        name: 'MotocrossInterface',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing motocross UI fixture output');
  const script = output.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing motocross UI fixture script');
  await page.setContent('<!doctype html><title>Motocross solo practice HUD review</title>');
  // Vite emits imported CSS separately from the IIFE. Use the production
  // stylesheet and embedded fonts so the layout assertion measures the game.
  for (const asset of output.output)
    if (asset.type === 'asset' && asset.fileName.endsWith('.css'))
      await page.addStyleTag({ content: String(asset.source) });
  await page.addScriptTag({ content: script.code });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
      const total = circuit === 'valley-ridge-mx' ? 5 : 4;
      await page.evaluate(
        (circuit) => window.MotocrossInterface.mountMotocrossHud(circuit, 1, 'practice'),
        circuit,
      );
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() =>
          [...document.fonts].some(
            (font) => font.family.includes('Saira Variable') && font.status === 'loaded',
          ),
        ),
      ).toBe(true);
      const hud = page.locator('.mx-ride-hud');
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('ground'));
      await expect(hud).toContainText(`TARGETS 0/${total}`);
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('air'));
      await page.evaluate(() =>
        window.MotocrossInterface.sampleMotocrossPractice('flight', false, true),
      );
      await expect(hud).toContainText('RELEASE THE BRAKE');
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('flight'));
      await expect(hud).not.toContainText('RELEASE THE BRAKE');
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('contact'));
      await expect(hud).not.toContainText('TARGET LANDED');
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('settled'));
      await expect(hud).toContainText('TARGET LANDED');
      await expect(hud).toContainText(`1/${total} LANDING TARGETS`);
      const text = await hud.textContent();
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('settled'));
      expect(await hud.textContent()).toBe(text);
      // Watching earlier footage must not erase the live practice checklist.
      await page.evaluate(() =>
        window.MotocrossInterface.sampleMotocrossPractice('ground', false, false, true),
      );
      await expect(hud).not.toContainText('LANDING TARGETS');
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('settled'));
      await expect(hud).toContainText(`TARGETS 1/${total}`);
      const layout = await hud.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, right: box.right, overflow: node.scrollWidth - node.clientWidth };
      });
      expect(layout.x).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(width);
      expect(layout.overflow).toBeLessThanOrEqual(1);
      await info.attach(`${circuit}-practice-targets-${width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await page.evaluate(
        (circuit) => window.MotocrossInterface.mountMotocrossHud(circuit, 1, 'practice'),
        circuit,
      );
      for (const stage of ['ground', 'air', 'flight', 'contact', 'settled'] as const) {
        await page.evaluate(
          (stage) => window.MotocrossInterface.sampleMotocrossPractice(stage, true, true),
          stage,
        );
        await expect(hud).not.toContainText('RELEASE THE BRAKE');
      }
      await expect(page.locator('.mx-ride-hud')).not.toContainText('TARGET LANDED');
      // The ordinary last-jump card temporarily replaces the approach
      // heading. Inspect the retained checklist after that card expires.
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('riding'));
      await expect(page.locator('.mx-ride-hud')).toContainText(`TARGETS 0/${total}`);
    }
  }
  expect(errors).toEqual([]);
});
