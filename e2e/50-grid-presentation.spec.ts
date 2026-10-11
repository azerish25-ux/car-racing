import { test, expect } from '@playwright/test';
import { H } from '../src/simulation/protocol.ts';

// Real menu, worker, renderer and DOM controls; no simulation writes or debug
// teleporting. Software-rendered captures do not certify consumer hardware.
test.use({ viewport: { width: 960, height: 600 } });
test('pre-race performance holds physics, seeks actual crew poses and hands control to the start', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const diag = () => page.evaluate(() => window.apexDiagnostics());
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('medium');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await page.selectOption('#mode', 'race');
  await page.selectOption('#opponents', '3');
  await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
  // A paused acknowledgement can predate the session's first frame. Wait for
  // the actual paused grid before preserving the immutable comparison snapshot.
  await expect.poll(async () => (await diag()).state).toBe('paused');
  await expect.poll(async () => (await diag()).frame?.[H.TICK] ?? -1).toBe(0);
  await expect
    .poll(async () => (await diag()).workerPause)
    .toMatchObject({ paused: true, pending: false });
  const before = (await diag()).frame;
  expect(before).not.toBeNull();
  await page.getByRole('button', { name: 'PRE-RACE PRESENTATION', exact: true }).click();
  await expect(page.locator('#gridPresentation')).toBeVisible();
  await expect.poll(async () => (await diag()).state).toBe('pregame');
  await page.getByRole('button', { name: 'PLAY PREPARATION', exact: true }).click();
  await expect.poll(async () => (await diag()).gridPresentation.time).toBeGreaterThan(0.2);
  await page.getByRole('button', { name: 'PAUSE PREPARATION', exact: true }).click();
  expect((await diag()).gridPresentation.playing).toBe(false);
  expect((await diag()).frame).toEqual(before);
  for (const [time, phase] of [
    [10, 'inspect'],
    [14, 'gather'],
    [30, 'carry'],
    [38, 'clear'],
  ] as const) {
    await page.locator('#gridPresentationSeek').evaluate((element, value) => {
      const input = element as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, String(time));
    await expect.poll(async () => (await diag()).renderer?.gridPerformance?.phase).toBe(phase);
    const d = await diag();
    expect(d.frame).toEqual(before);
    expect(d.frame?.[H.TICK]).toBe(0);
    expect(d.workerPause.paused).toBe(true);
    for (const c of d.renderer!.gridPerformance!.contacts) {
      expect(c.arms).toBe(true);
      expect(c.feet).toBe(true);
      expect(c.gripError).toBeLessThan(0.001);
    }
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await info.attach(`grid-${phase}.png`, {
      body: Buffer.from(data, 'base64'),
      contentType: 'image/png',
    });
    await cdp.detach();
  }
  await page.getByRole('button', { name: 'BACK TO GRID MENU', exact: true }).click();
  await expect.poll(async () => (await diag()).state).toBe('paused');
  expect((await diag()).frame).toEqual(before);
  await page.getByRole('button', { name: 'PRE-RACE PRESENTATION', exact: true }).click();
  await page.locator('#gridPresentationStart').click();
  await expect.poll(async () => (await diag()).state).toBe('driving');
  await expect.poll(async () => (await diag()).frame?.[H.TIME] ?? 0).toBeGreaterThan(1);
  expect((await diag()).renderer?.gridPerformance?.parked).toBe(true);
  // The grid is clear once racing: the crews have gone to the garages.
  expect((await diag()).renderer?.gridPerformance?.actors).toBe(0);
  await expect(page.locator('#gridPresentation')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await diag()).state).toBe('paused');
  await expect(
    page.getByRole('button', { name: 'PRE-RACE PRESENTATION', exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
