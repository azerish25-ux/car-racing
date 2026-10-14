import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { raceHudLayout, gridPreparationControls } from './fixtures/race-hud-layout.ts';

test('Race-Day V2 DOM-only: lower-corner telemetry clears the road, lights and timing', async ({
  page,
}, info) => {
  const bundled = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/race-hud-layout.ts'),
        name: 'RaceHudFixture',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in result)) throw new Error('Missing HUD fixture build');
  const script = result.output.find((o) => o.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing HUD fixture entry');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<!doctype html><title>DOM-only racing HUD layout</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addScriptTag({ content: script.code });
  const measurements = [];
  for (const viewport of [
    { width: 1280, height: 680 },
    { width: 1280, height: 720 },
    { width: 1280, height: 900 },
    { width: 1366, height: 768 },
    { width: 1440, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ])
    for (const camera of ['cockpit', 'pod', 'chase', 'trackside'] as const)
      for (const scale of [0.8, 1, 1.35])
        for (const guidance of [false, true]) {
          await page.setViewportSize(viewport);
          await page.evaluate(
            ({ camera, scale, guidance }) => {
              (
                window as unknown as { RaceHudFixture: { raceHudLayout: typeof raceHudLayout } }
              ).RaceHudFixture.raceHudLayout(camera, scale, guidance);
            },
            { camera, scale, guidance },
          );
          const rectangles = await page.evaluate(() => {
            const rect = (selector: string) => {
              const r = document.querySelector(selector)!.getBoundingClientRect();
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
            };
            return {
              instruments: rect('.instruments'),
              timing: rect('.timing'),
              minimap: rect('.minimap'),
              lap: rect('.lap-panel'),
              lights: rect('.start-sequence'),
              resources: rect('.resources'),
              pedals: rect('.pedals'),
            };
          });
          expect(rectangles.timing.bottom).toBeLessThan(rectangles.minimap.top);
          const a = rectangles.instruments;
          // V2 intentionally moves instruments below the driving sightline.
          // Keep every camera, scale, guidance, data and overflow assertion.
          expect(a.top).toBeGreaterThan(viewport.height * 0.5);
          expect(a.bottom).toBeLessThanOrEqual(viewport.height - 48);
          // F1-style binocular cluster: a bottom-centre band, not the right half.
          expect(a.left).toBeGreaterThan(viewport.width * 0.3);
          expect(a.right).toBeLessThan(viewport.width * 0.7);
          expect(a.right).toBeLessThanOrEqual(viewport.width - 10);
          expect(rectangles.lights.bottom).toBeLessThan(a.top);
          expect(rectangles.lap.bottom).toBeLessThan(a.top);
          expect(rectangles.resources.right).toBeLessThanOrEqual(a.right + 0.1);
          await expect(page.locator('#speed')).toHaveText('162');
          await expect(page.locator('#battery')).toBeVisible();
          await expect(page.locator('#fuel')).toBeVisible();
          await expect(page.locator('#rpm')).toBeVisible();
          measurements.push({ viewport, camera, scale, guidance, rectangles });
        }
  // The smallest compact layout scrolls all twelve real rows without sending
  // navigation keydowns to the driving listener; keyup must still release it.
  await page.setViewportSize({ width: 1280, height: 680 });
  await page.evaluate(() => {
    (
      window as unknown as { RaceHudFixture: { raceHudLayout: typeof raceHudLayout } }
    ).RaceHudFixture.raceHudLayout('chase', 1.35, true);
    const log = document.createElement('output');
    log.id = 'keyEvents';
    log.hidden = true;
    document.body.append(log);
    for (const type of ['keydown', 'keyup'])
      window.addEventListener(type, (event) => {
        log.textContent += `${type}:${(event as KeyboardEvent).key};`;
      });
  });
  const timing = page.getByRole('complementary', { name: 'Live race classification' });
  await expect(page.locator('.tower-row')).toHaveCount(12);
  await timing.focus();
  await page.keyboard.press('End');
  await expect.poll(() => timing.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('#keyEvents')).toHaveText('keyup:End;');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#keyEvents')).toHaveText('keyup:End;keyup:ArrowUp;');
  await page.keyboard.press('Escape');
  await expect(page.locator('#keyEvents')).toHaveText(
    'keyup:End;keyup:ArrowUp;keydown:Escape;keyup:Escape;',
  );
  // Resize the SAME production UI after scrolling. Retained rows and sticky
  // heading remain reachable; a stylesheet breakpoint must not rebuild a race.
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 1280, height: 680 },
  ]) {
    await page.setViewportSize(viewport);
    await timing.focus();
    await page.keyboard.press('End');
    // Native End scrolling is asynchronous; wait for its geometric result,
    // rather than measuring the first animation frame after the key event.
    await expect
      .poll(() =>
        timing.evaluate(
          (e) =>
            e.querySelector('.tower-row:last-child')!.getBoundingClientRect().bottom -
            e.getBoundingClientRect().bottom,
        ),
      )
      .toBeLessThanOrEqual(1);
    const bounds = await timing.evaluate((e) => {
      const r = e.getBoundingClientRect(),
        header = e.querySelector('.panel-heading')!.getBoundingClientRect(),
        last = e.querySelector('.tower-row:last-child')!.getBoundingClientRect(),
        map = document.querySelector('.minimap')!.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        headerTop: header.top,
        lastTop: last.top,
        lastBottom: last.bottom,
        mapTop: map.top,
      };
    });
    expect(bounds.headerTop).toBeGreaterThanOrEqual(bounds.top);
    expect(bounds.lastTop).toBeGreaterThan(bounds.top);
    expect(bounds.lastBottom).toBeLessThanOrEqual(bounds.bottom + 1);
    expect(bounds.bottom).toBeLessThan(bounds.mapTop);
    await expect(page.locator('.tower-row')).toHaveCount(12);
    await page.keyboard.press('Home');
    await expect.poll(() => timing.evaluate((e) => e.scrollTop)).toBe(0);
  }
  await info.attach('27h6-hud-layout-observations.json', {
    body: JSON.stringify(
      {
        boundary: 'DOM fixture, not gameplay or a 3D image-quality judgement',
        measurements,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await info.attach('27h6-hud-dom-only.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.evaluate(() => {
    (
      window as unknown as {
        RaceHudFixture: { gridPreparationControls: typeof gridPreparationControls };
      }
    ).RaceHudFixture.gridPreparationControls();
  });
  await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
  const prepared = JSON.parse(await page.locator('#gridPreparationResult').innerText());
  expect(prepared.holdOnGrid).toBe(true);
  expect(prepared.options).not.toHaveProperty('holdOnGrid');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  const entered = JSON.parse(await page.locator('#gridPreparationResult').innerText());
  expect(entered.holdOnGrid).toBe(false);
  expect(entered.options).toEqual(prepared.options);
  expect(errors).toEqual([]);
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 640, height: 400 },
  { width: 800, height: 600 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
])
  test(`27H.6 DOM-only: menu controls are reachable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    test.setTimeout(45000);
    // Fail on an inaccessible control, not at the end of a race-length budget.
    page.setDefaultTimeout(5000);
    const bundled = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/race-hud-layout.ts'),
          name: 'RaceHudFixture',
          formats: ['iife'],
        },
      },
    });
    const result = Array.isArray(bundled) ? bundled[0] : bundled;
    if (!('output' in result)) throw new Error('Missing menu fixture build');
    const chunk = result.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing menu fixture entry');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.setContent('<!doctype html><title>DOM-only menu navigation</title>');
    await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
    await page.addScriptTag({ content: chunk.code });
    await page.evaluate(() => {
      (
        window as unknown as {
          RaceHudFixture: {
            menuNavigation: typeof import('./fixtures/race-hud-layout.ts').menuNavigation;
          };
        }
      ).RaceHudFixture.menuNavigation();
    });
    const region = page.getByRole('region', { name: 'Race setup and tools' });
    const state = () =>
      page
        .locator('#menuNavigationResult')
        .textContent()
        .then((s) => JSON.parse(s!));
    const bounds = () =>
      region.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          headerBottom: document.querySelector('.masthead')!.getBoundingClientRect().bottom,
          footerTop: document.querySelector('.menu-footer')!.getBoundingClientRect().top,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          pointerEvents: getComputedStyle(element).pointerEvents,
        };
      });
    const initial = await bounds();
    expect(initial.top).toBeGreaterThanOrEqual(initial.headerBottom + 8);
    expect(initial.bottom).toBeLessThanOrEqual(initial.footerTop - 8);
    expect(initial.scrollWidth).toBeLessThanOrEqual(initial.clientWidth);
    expect(initial.pointerEvents).toBe('auto');
    if (viewport.height <= 640) {
      expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);
      const box = (await region.boundingBox())!;
      // Native input over the scrollable region (not a JavaScript scroll assignment).
      await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
      await page.mouse.wheel(0, 10000);
      await expect.poll(() => region.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    }
    await region.focus();
    await page.keyboard.press('Home');
    await expect.poll(() => region.evaluate((e) => e.scrollTop)).toBe(0);
    await page.keyboard.press('End');
    if (initial.scrollHeight > initial.clientHeight)
      await expect.poll(() => region.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('Home');
    await expect.poll(() => region.evaluate((e) => e.scrollTop)).toBe(0);
    // Nine selects (circuit first, machine last), two start controls, then
    // settings: focus must scroll each into view.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement;
        const a = active.getBoundingClientRect();
        const body = document.querySelector('.menu-body')!.getBoundingClientRect();
        return {
          inMenu: !!active.closest('.menu-body'),
          top: a.top,
          bottom: a.bottom,
          bodyTop: body.top,
          bodyBottom: body.bottom,
        };
      });
      expect(focused.inMenu).toBe(true);
      expect(focused.top).toBeGreaterThanOrEqual(focused.bodyTop - 1);
      expect(focused.bottom).toBeLessThanOrEqual(focused.bodyBottom + 1);
    }
    const settings = page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true });
    await expect(settings).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#settingsForm')).toBeVisible();
    await page.locator('[name=quality]').selectOption('low');
    await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
    await expect(page.locator('#modal')).toBeHidden();
    expect((await state()).appliedQuality).toBe('low');
    await settings.click();
    await expect(page.locator('[name=quality]')).toHaveValue('low');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    // Player entries only: developer tools are absent without ?dev.
    for (const name of ['REFERENCE REVIEW', 'SESSION 146 EVIDENCE'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    for (const [name, action] of [
      ['CONTROLS', 'controls'],
      ['CHAMPIONSHIP', 'championship'],
      ['TEAM HQ', 'team'],
      ['PHOTO / LIVERY', 'photo'],
      ['DRIVING ACADEMY', 'academy'],
    ]) {
      await page.getByRole('button', { name, exact: true }).click();
      expect((await state()).action).toBe(action);
      if (action === 'controls')
        await page.getByRole('button', { name: 'UNDERSTOOD', exact: true }).click();
    }
    await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
    expect(await state()).toMatchObject({ starts: 1, held: false });
    await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
    expect(await state()).toMatchObject({ starts: 2, held: true });
    // A user can resize after scrolling/opening settings; no reload or state injection.
    await page.setViewportSize({ width: 640, height: 400 });
    await settings.click();
    await expect(page.locator('[name=quality]')).toHaveValue('low');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await info.attach('menu-navigation.json', {
      body: JSON.stringify(
        {
          viewport,
          initial,
          resized: await bounds(),
          state: await state(),
          boundary: 'Production DOM/CSS component; no WebGL, persistent save or racing acceptance.',
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await info.attach('menu-navigation.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    expect(errors).toEqual([]);
  });
