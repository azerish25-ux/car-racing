import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type * as API from './fixtures/motocross-interface.ts';

declare global {
  interface Window {
    MotocrossInterface: typeof API;
  }
}

test('motocross entry, live race alerts and landing HUD remain usable at small sizes', async ({
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
  if (!('output' in output)) throw new Error('Missing interface fixture output');
  const script = output.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing interface fixture script');
  await page.setContent(
    '<!doctype html><title>Motocross production interface component checks</title>',
  );
  // These are the same stylesheet and variable font imports as main.ts. The
  // library build embeds the fonts so a local component cannot pass only with
  // narrower fallback typography than the actual full app.
  for (const asset of output.output) {
    if (asset.type === 'asset' && asset.fileName.endsWith('.css'))
      await page.addStyleTag({ content: String(asset.source) });
  }
  await page.addScriptTag({ content: script.code });
  await page.evaluate(() => document.fonts.ready);
  const measurements = [];
  const menuMeasurements = [];

  for (const [width, height, scale] of [
    [1280, 800, 1],
    [1280, 800, 1.35],
    [640, 400, 1],
    [375, 667, 1.35],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((scale) => window.MotocrossInterface.mountMotocrossMenu(scale), scale);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() =>
        [...document.fonts].some(
          (font) => font.family.includes('Saira Variable') && font.status === 'loaded',
        ),
      ),
    ).toBe(true);
    const originalLength = await page.locator('#circuitLength').textContent();
    await page.getByRole('button', { name: 'OUTDOOR MX', exact: true }).click();
    await expect(page.locator('#circuit')).toHaveValue('valley-ridge-mx');
    await expect(page.locator('#vehicle')).toHaveValue('mx450');
    await expect(page.locator('.car-label')).toContainText('104 KG MACHINE');
    await expect(page.locator('#menu h1')).toContainText('FLOW.');
    await expect(page.locator('#circuitDrs').locator('..')).toContainText('JUMP FEATURES');
    const menu = await page.evaluate(() => window.MotocrossInterface.measureMotocrossMenu());
    const checkMenu = (layout: typeof menu) => {
      expect(layout.panel.width).toBeCloseTo(layout.form.width, 0);
      expect(layout.panel.x).toBeCloseTo(layout.form.x, 0);
      expect(layout.card.width).toBeCloseTo(layout.form.width, 0);
      expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
      expect(layout.start.form).toBe('sessionForm');
      expect(layout.start.unobscured).toBe(true);
      expect(layout.start.y).toBeGreaterThanOrEqual(layout.scroll.y + layout.scroll.height);
      expect(layout.start.x).toBeGreaterThanOrEqual(0);
      expect(layout.start.y + layout.start.height).toBeLessThanOrEqual(height);
      expect(layout.start.x + layout.start.width).toBeLessThanOrEqual(width);
      expect(layout.start.height).toBeGreaterThanOrEqual(44);
      for (const text of layout.texts) {
        expect(text.overflow, text.text ?? text.selector).toBeLessThanOrEqual(1);
        expect(text.lines, text.text ?? text.selector).toBeLessThanOrEqual(
          text.selector.endsWith(' span') ? 3 : 2,
        );
      }
    };
    checkMenu(menu);
    await info.attach(`motocross-menu-${width}-scale-${scale}.png`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    const fieldMeasurements = [];
    // Native focus must reveal every real select and the paused-start action
    // inside the scrollport. The fixed primary row must never cover a field.
    for (const field of await page.locator('#sessionForm select, #sessionForm .enter').all()) {
      await field.focus();
      const reachable = await field.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const scroller = document.querySelector('.mx-menu-scroll')!.getBoundingClientRect();
        const action = document.querySelector('.mx-start-dock')!.getBoundingClientRect();
        return {
          field: node.id || node.textContent?.trim(),
          top: bounds.top,
          bottom: bounds.bottom,
          scrollTop: scroller.top,
          scrollBottom: scroller.bottom,
          actionTop: action.top,
          unobscured: node.contains(
            document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
          ),
        };
      });
      expect(reachable.top, reachable.field).toBeGreaterThanOrEqual(reachable.scrollTop - 1);
      expect(reachable.bottom, reachable.field).toBeLessThanOrEqual(reachable.scrollBottom + 1);
      expect(reachable.bottom, reachable.field).toBeLessThanOrEqual(reachable.actionTop);
      expect(reachable.unobscured, reachable.field).toBe(true);
      fieldMeasurements.push(reachable);
    }
    await page.locator('#vehicle').focus();
    await info.attach(`motocross-menu-settings-${width}-scale-${scale}.png`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.getByRole('button', { name: /Learn the jumps/ }).click();
    await expect(page.locator('#mode')).toHaveValue('practice');
    await expect(page.locator('#opponents')).toHaveValue('0');
    await expect(page.locator('#mxInterfaceEvents')).not.toContainText('"options"');
    await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
    const events = JSON.parse((await page.locator('#mxInterfaceEvents').textContent()) ?? '[]');
    const started = events.filter((event: { options?: unknown }) => event.options);
    expect(started).toHaveLength(1);
    expect(started[0].options).toMatchObject({
      circuit: 'valley-ridge-mx',
      mode: 'practice',
      opponents: 0,
      vehicles: ['mx450'],
    });
    await page.getByRole('button', { name: 'STADIUM SX', exact: true }).click();
    await page.locator('#vehicle').selectOption('mx250');
    await page.getByRole('button', { name: /Full control/ }).click();
    await expect(page.locator('#assist')).toHaveValue('raw');
    await expect(page.locator('#mode')).toHaveValue('race');
    await expect(page.locator('#vehicle')).toHaveValue('mx250');
    await expect(page.locator('.car-label')).toContainText('97 KG MACHINE');
    const stadiumMenu = await page.evaluate(() => window.MotocrossInterface.measureMotocrossMenu());
    checkMenu(stadiumMenu);
    const preset = page.getByRole('button', { name: /Full control/ });
    await preset.focus();
    await expect(preset).toBeFocused();
    const body = await page.locator('.menu-body').boundingBox();
    const focused = await preset.boundingBox();
    expect(focused!.y).toBeGreaterThanOrEqual(body!.y - 1);
    expect(focused!.y + focused!.height).toBeLessThanOrEqual(body!.y + body!.height + 1);
    expect(await page.locator('#menu .menu-actions button').count()).toBe(9);
    await page.locator('#circuit').selectOption('aurel');
    await expect(page.locator('#circuitLength')).toHaveText(originalLength!);
    await expect(page.locator('.mx-setup')).toBeHidden();
    await expect(page.locator('.mx-menu-scroll, .mx-start-dock')).toHaveCount(0);
    await expect(page.locator('#sessionForm > .enter.primary')).toHaveCount(1);
    expect(
      await page
        .locator('#sessionForm > .enter.primary')
        .evaluate((node) => node.hasAttribute('form')),
    ).toBe(false);
    await page.getByRole('button', { name: 'STADIUM SX', exact: true }).click();
    if (width === 1280 && scale === 1) {
      await page.getByRole('button', { name: 'STADIUM SX', exact: true }).scrollIntoViewIfNeeded();
      await info.attach('motocross-menu-components.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
    menuMeasurements.push({
      width,
      height,
      scale,
      outdoor: menu,
      stadium: stadiumMenu,
      fieldMeasurements,
    });

    const initialized = await page.evaluate(
      ({ scale }) => window.MotocrossInterface.mountMotocrossHud('valley-ridge-mx', scale),
      { scale },
    );
    const hud = page.locator('.mx-ride-hud');
    // One presentation must replace template telemetry, including the desktop
    // F1-derived position field. Sparse GPU frames must not leave old defaults.
    await expect(page.locator('#positionField')).toHaveText(`/ ${initialized.cars}`);
    await expect(page.locator('.f1-pos small')).toHaveText(`/ ${initialized.cars}`);
    await expect(page.locator('#lapLabel')).toHaveText(`LAP 1 / ${initialized.laps}`);
    await expect(page.locator('#fuel')).toHaveText(`${initialized.fuel.toFixed(1)} KG`);
    await expect(hud).toContainText('WAIT FOR THE DROP');
    await expect(page.locator('#startSequence')).toBeHidden();
    await expect(page.locator('.f1-drs')).toBeHidden();
    await expect(page.locator('#battery')).toBeHidden();
    // None of these sampled ticks is divisible by three. Both forward gaps and
    // a short backwards seek have to update in this single presented call.
    const sparseSamples = [];
    for (const tick of [121, 151, 149]) {
      const sample = await page.evaluate(
        (tick) => window.MotocrossInterface.sampleSparseMotocrossHud(tick),
        tick,
      );
      await expect(page.locator('#speed')).toHaveText(String(sample.speed));
      await expect(page.locator('#rpm')).toHaveText(String(sample.rpm));
      sparseSamples.push({ tick, ...sample });
    }
    await page.evaluate(() => window.MotocrossInterface.sampleMotocrossHud('air'));
    await expect(hud).toContainText('0.84 S');
    await expect(hud).toHaveAttribute('data-tone', 'air');
    await page.evaluate(() => window.MotocrossInterface.sampleMotocrossHud('clean'));
    await expect(hud).toHaveAttribute('data-tone', 'clean');
    await page.evaluate(() => window.MotocrossInterface.sampleMotocrossHud('hard'));
    await expect(hud).toHaveAttribute('data-tone', 'heavy');
    await page.evaluate(() => window.MotocrossInterface.sampleMotocrossHud('crash'));
    await expect(hud).toHaveAttribute('data-tone', 'crash');
    await page.evaluate(() => window.MotocrossInterface.sampleMotocrossHud('rewind'));
    await expect(hud).toHaveAttribute('data-tone', 'approach');
    await expect(hud).not.toContainText('0.84 S');
    await page.evaluate(() => window.MotocrossInterface.sampleMotocrossHud('redline'));
    await expect(page.locator('.instruments')).toHaveAttribute('data-redline', 'true');
    for (const state of ['full', 'held'] as const) {
      await page.evaluate(
        (held) => window.MotocrossInterface.showMotocrossRaceAlert(held),
        state === 'held',
      );
      const radio = page.locator('.radio-caption');
      await expect(page.locator('#flag')).toHaveText('DOUBLE YELLOW');
      await expect(page.locator('.offroad-readout')).toBeVisible();
      for (const side of ['left', 'right']) {
        await expect(page.locator(`.proximity-${side}`)).toBeVisible();
        await expect(page.locator(`.proximity-${side}`)).toHaveAttribute(
          'aria-label',
          `Rider ${side}`,
        );
      }
      if (width >= 1280 && height >= 680) {
        await expect(page.locator('.f1-banner')).toBeVisible();
        await expect(page.locator('.f1-banner')).toHaveAttribute(
          'data-state',
          state === 'full' ? 'full' : 'mini',
        );
        await expect(page.locator('.f1-banner')).toContainText('DOUBLE YELLOW');
      } else {
        await expect(page.locator('#raceMessage')).toBeVisible();
        await expect(page.locator('#raceMessage')).toContainText('DOUBLE YELLOW');
      }
      if (state === 'full') {
        await expect(radio).toHaveAttribute('data-speaker', 'RACE CONTROL');
        await expect(radio).toContainText('Double yellow ahead. Slow right down');
        await expect(radio).toHaveCSS('opacity', '1');
        await expect(radio).toBeVisible();
      } else await expect(radio).toBeHidden();

      const layout = await page.evaluate(() => {
        const statuses = [
          '.f1-banner',
          '#raceMessage',
          '.mx-ride-hud',
          '.offroad-readout',
          '.radio-caption',
          '.proximity-left',
          '.proximity-right',
        ];
        return [
          ...statuses,
          '.instruments',
          '.hud-top',
          '.timing',
          '.lap-panel',
          '.touch-controls',
        ].flatMap((selector) => {
          const node = document.querySelector<HTMLElement>(selector);
          if (!node) return [];
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          // Desktop keeps the 1px clipped polite live region; its visible
          // banner is measured instead. Compact mode measures the live message.
          if (
            rect.width <= 1 ||
            rect.height <= 1 ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) === 0
          )
            return [];
          return [
            {
              selector,
              status: statuses.includes(selector),
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              overflow: node.scrollWidth - node.clientWidth,
            },
          ];
        });
      });
      expect(layout.some((node) => node.selector === '.mx-ride-hud')).toBe(true);
      expect(layout.some((node) => node.selector === '.instruments')).toBe(true);
      expect(layout.some((node) => node.selector === '.radio-caption')).toBe(state === 'full');
      for (const node of layout.filter((node) => node.status)) {
        const rect = node.rect;
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
        expect(rect.y + rect.height).toBeLessThanOrEqual(height + 1);
        expect(node.overflow, `${node.selector} text overflows`).toBeLessThanOrEqual(1);
        // Actual rectangles include the external RadioCaption integration and
        // every visible alert, so a fixed offset cannot silently cover telemetry.
        for (const other of layout.filter((other) => other.selector !== node.selector)) {
          const box = other.rect;
          const overlap =
            rect.x < box.x + box.width &&
            rect.x + rect.width > box.x &&
            rect.y < box.y + box.height &&
            rect.y + rect.height > box.y;
          expect(
            overlap,
            `${width}×${height} scale ${scale} ${state}: ${node.selector} overlaps ${other.selector}`,
          ).toBe(false);
        }
      }
      measurements.push({ width, height, scale, state, initialized, sparseSamples, layout });
      await info.attach(`motocross-hud-${state}-${width}-scale-${scale}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
    await page.evaluate(() => window.MotocrossInterface.showMotocrossBriefing());
    await expect(page.locator('#raceBriefing')).toContainText('RIDERS');
    await page.getByRole('button', { name: 'GO TO THE GATE', exact: true }).click();
    await expect(page.locator('#mxInterfaceEvents')).toContainText('raceDaySkip');
    expect(await page.evaluate(() => window.MotocrossInterface.restoreRoadHud())).toEqual({
      radioParent: 'app',
      bannerParent: 'hud',
      statusStacks: 0,
    });
    await expect(page.locator('.radio-caption')).toHaveCSS('position', 'absolute');
  }
  expect(errors).toEqual([]);
  await info.attach('motocross-interface-measurements.json', {
    body: JSON.stringify(
      {
        boundary:
          'Production Interface and real Saira fonts; full-width venue cards, native form action and field reachability; RadioCaption and RadioArbiter with explicitly synthetic HUD/flag snapshots, one-call initial/sparse update and real rectangle checks; no gameplay or GPU performance claim',
        menuMeasurements,
        measurements,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
