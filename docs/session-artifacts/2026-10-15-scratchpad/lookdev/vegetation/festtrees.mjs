/**
 * APEX feature showcase, driven through the real application (sibling of
 * live-capture.mjs, same helpers and rules: real menu flow, read-only
 * window.apexDiagnostics(), capture-only stylesheet that hides DOM overlays
 * for clean canvas frames, nothing injected into simulation or renderer).
 *
 *   xvfb-run -a -s '-screen 0 1920x1080x24' node --experimental-transform-types showcase.mjs \
 *       --repo /path/to/checkout --url http://127.0.0.1:PORT/ --out NEW_DIR \
 *       [--size 1280x720] [--preset ultra] [--backend mesa] [--sessions menu,bikes,...]
 *
 * Sessions (each starts from the paddock):
 *   menu      01 EVENTS hub, 01b MACHINE select opened (X screen grab, headed only), 02 CAREER hub
 *   bikes     03 GP-R1 grid at Poggio Alto, live pause leaned into a corner (HUD + clean)
 *   pack      04 multi-class endurance field (HY-9/PR-2/GT-8F/GT-10M/GS-4) at Aurel from the back
 *   truck     05 DX-8 trophy truck on the Pinewood Forest special stage, chase
 *   neon      06 Neon City street circuit at night, GT-10M field
 *   hochwald  07 Hochwald Forest Ring, HF-67 historic formula field
 *   festival  08 Port Ilse golden hour, 09 world map, 09b autopilot drive (HUD)
 *   valley    10 Valley Ridge motocross, MX-450, airborne (live pause, replay fallback)
 *   arena     11 Arena Nord supercross at night, MX-250
 *   kestrel   12 Kestrel rallycross, RCX-6 field
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const repo = resolve(opt('repo', process.cwd()));
const out = opt('out', '');
if (!out) throw new Error('--out NEW_DIRECTORY is required');
const [width, height] = opt('size', '1280x720').split('x').map(Number);
const preset = opt('preset', 'ultra');
const backendName = opt('backend', process.env.DISPLAY ? 'mesa' : 'swiftshader');
const sessionList = opt('sessions', 'menu,bikes,pack,truck,neon,hochwald,festival,valley,arena,kestrel').split(',');
const executablePath = process.env.CHROMIUM_PATH || undefined;
const url = opt('url', '');
if (!url) throw new Error('--url http://127.0.0.1:PORT/ is required (serve.mjs builds and serves the checkout)');
if (!(width > 0 && height > 0)) throw new Error('Invalid --size');
if (!['low', 'medium', 'high', 'ultra'].includes(preset)) throw new Error('Invalid --preset');

const need = createRequire(join(repo, 'package.json'));
const { chromium } = need('@playwright/test');
const protocol = await import(pathToFileURL(join(repo, 'src/simulation/protocol.ts')).href);
const { H, F, B, O, HEADER, CAR_STRIDE, BIKE_BASE, OFFROAD_BASE } = protocol;
const { CIRCUITS } = await import(pathToFileURL(join(repo, 'src/simulation/circuits.ts')).href);

// ---------------------------------------------------------------- browser
const backendArgs =
  backendName === 'mesa'
    ? ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog'];
if (existsSync(out)) throw new Error(`${out} exists: captures go into a NEW directory`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath,
  headless: backendName !== 'mesa',
  args: backendArgs,
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
  acceptDownloads: true,
});
const page = await context.newPage();
const LONG = 20 * 60 * 1000;
page.setDefaultTimeout(LONG);
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)} s]`, ...a);
const manifest = {
  suite: 'APEX feature showcase (live application)',
  url,
  repo,
  size: { width, height },
  preset,
  backend: backendName,
  sessions: sessionList,
  startedAt: new Date().toISOString(),
  shots: [],
  failures: [],
  consoleErrors,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const saveManifest = () => writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
/** The application's error dialog (e.g. a lost WebGL context), or null. */
const errorText = () =>
  page.evaluate(() => (document.querySelector('#modal[open] #errorMessage')?.textContent || null)).catch(() => null);
/** Race a page wait against the application error dialog, so a lost context
 * fails fast instead of waiting out a 20-minute timeout. */
function guard(promise) {
  promise.catch(() => undefined);
  let timer;
  const watcher = new Promise((_, reject) => {
    timer = setInterval(async () => {
      const e = await errorText();
      if (e) reject(new Error(`application error: ${e}`));
    }, 4000);
  });
  return Promise.race([promise, watcher]).finally(() => clearInterval(timer));
}
const wf = (...args) => guard(page.waitForFunction(...args));

// ---------------------------------------------------------------- page helpers
async function click(target) {
  const locator = typeof target === 'string' ? page.locator(target).first() : target;
  await locator.waitFor({ state: 'attached' });
  try {
    await locator.click({ force: true, timeout: 60000 });
  } catch {
    await locator.dispatchEvent('click');
  }
}
async function snap() {
  return page.evaluate(
    ({ H, F, B, O, HEADER, CAR_STRIDE, BIKE_BASE, OFFROAD_BASE }) => {
      const x = window.apexDiagnostics();
      const r = x.renderer;
      const o = {
        state: x.state,
        auto: x.auto,
        frames: x.presentation?.frames ?? 0,
        presentedTime: x.presentation?.time ?? 0,
        replay: {
          position: x.replayPosition,
          playing: x.replayPlaying,
          seekPending: x.replaySeekPending,
          duration: x.replaySeconds,
          start: x.replayStart,
        },
        camera: r?.requestedCamera ?? null,
        presentedCamera: r?.camera ?? null,
        lighting: r?.lighting ?? null,
        settingsBusy: x.settingsTransition.busy,
        error: document.querySelector('#modal[open] #errorMessage')?.textContent || null,
        wall: Date.now(),
      };
      const f = x.frame;
      if (f) {
        o.t = f[H.TIME];
        o.rt = f[H.RACE_TIME];
        o.length = f[H.LENGTH];
        o.cars = [];
        for (let i = 0; i < Math.round(f[H.CARS]); i++) {
          const b = HEADER + i * CAR_STRIDE;
          o.cars.push({
            id: i,
            x: f[b + F.X],
            y: f[b + F.Y],
            z: f[b + F.Z],
            vx: f[b + F.VX],
            vz: f[b + F.VZ],
            speed: f[b + F.SPEED],
            brake: f[b + F.BRAKE],
            s: f[b + F.S],
            lat: f[b + F.LATERAL],
            laps: f[b + F.LAPS],
            inPit: f[b + F.IN_PIT],
            rank: f[b + F.RANK],
            gLat: f[b + F.G_LAT],
            lean: f[b + BIKE_BASE + B.LEAN] ?? 0,
            airborne: f[b + OFFROAD_BASE + O.AIRBORNE] ?? 0,
            airTime: f[b + OFFROAD_BASE + O.AIR_TIME] ?? 0,
          });
        }
      }
      return o;
    },
    { H, F, B, O, HEADER, CAR_STRIDE, BIKE_BASE, OFFROAD_BASE },
  );
}
function gap(a, b, length) {
  let g = (((b.s - a.s) % length) + length) % length;
  if (g > length / 2) g -= length;
  return g;
}
const timeline = [];
async function saveTimeline(name) {
  const rows = timeline.map((x) => ({
    wall: x.wall,
    t: +x.t.toFixed(3),
    rt: +x.rt.toFixed(3),
    state: x.state,
    cars: x.cars.map((c) => [+c.s.toFixed(1), +c.lat.toFixed(2), +c.speed.toFixed(2), +c.lean.toFixed(2), c.airborne, +c.y.toFixed(2)]),
  }));
  await writeFile(join(out, `timeline-${name}.json`), JSON.stringify({ columns: ['s', 'lateral', 'speed', 'lean', 'airborne', 'y'], rows }));
}
async function until(label, predicate, { timeout = LONG, every = 500, giveUp = null } = {}) {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    last = await snap();
    if (last.error) throw new Error(`application error: ${last.error}`);
    if (last.cars) timeline.push(last);
    const hit = last.cars ? predicate(last) : null;
    if (hit) {
      log(`${label}: met (t ${last.t?.toFixed(1)} s, race ${last.rt?.toFixed(1)} s)`);
      return { snap: last, hit };
    }
    if (last.state === 'results' || (last.cars && giveUp?.(last))) break;
    await sleep(every);
  }
  log(`${label}: not met (state ${last?.state}, race ${last?.rt?.toFixed(1)} s)`);
  return { snap: last, hit: null };
}
async function pauseWhen(label, predicate, { verify = predicate, tries = 4, ...options } = {}) {
  for (let i = 1; i <= tries; i++) {
    const r = await until(i > 1 ? `${label} (try ${i})` : label, predicate, options);
    if (!r.hit) return r;
    await pause();
    const held = await snap();
    const ok = held.cars && verify(held);
    if (ok) return { snap: held, hit: ok, met: r.snap };
    const me = held.cars?.[0];
    log(`${label}: held at s ${me?.s.toFixed(0)} m, ${(me?.speed * 3.6).toFixed(0)} km/h, lean ${me?.lean.toFixed(2)}, air ${me?.airborne} no longer matches`);
    if (i < tries) await resume();
  }
  return { snap: null, hit: null };
}
async function waitState(state, timeout = LONG) {
  await wf((s) => window.apexDiagnostics().state === s, state, { timeout, polling: 1000 });
}
async function frames(n = 2) {
  const start = (await snap()).frames;
  await wf(
    ({ start, n }) => window.apexDiagnostics().presentation.frames >= start + n,
    { start, n },
    { timeout: LONG, polling: 1000 },
  );
}
async function pauseMenu() {
  await guard(page.locator('#modal[open] [data-action=resume]').waitFor({ state: 'attached', timeout: 5 * 60 * 1000 }));
}
async function sessionMenu() {
  await guard(page.locator('#modal[open] [data-action=photo]').waitFor({ state: 'attached', timeout: 5 * 60 * 1000 }));
}
async function pause() {
  if ((await snap()).state !== 'driving') return;
  await page.keyboard.press('Escape');
  await waitState('paused');
  await pauseMenu();
}
async function resume() {
  if ((await snap()).state === 'driving') return;
  await pauseMenu();
  await click('#modal [data-action=resume]');
  await waitState('driving');
}
async function lighting(mode) {
  if ((await snap()).lighting === mode) return;
  log(`lighting → ${mode}`);
  await click('#modal [data-action=academy]');
  await click(`#modal [data-action="lighting:${mode}"]`);
  await wf((m) => window.apexDiagnostics().renderer?.lighting === m, mode, { timeout: LONG, polling: 2000 });
  await click('#modal [data-action=modalClose]');
  await pauseMenu();
  await frames(2);
}
async function camera(mode, where = '#modal') {
  for (let i = 0; i < 4; i++) {
    const current = (await snap()).camera;
    if (current === mode) return;
    await click(`${where} [data-action=camera]`);
    await wf(
      (previous) => window.apexDiagnostics().renderer?.requestedCamera !== previous,
      current,
      { timeout: 120000, polling: 250 },
    );
  }
  if ((await snap()).camera !== mode) throw new Error(`camera ${mode} not reached`);
}
async function aiDriver() {
  if ((await snap()).auto) return;
  await click('#modal [data-action=autopilot]');
  await wf(() => window.apexDiagnostics().auto === true, null, { timeout: LONG, polling: 1000 });
}
const CLEAN_CSS =
  '#app, #app *, dialog, dialog * { visibility: hidden !important; } ' +
  '::backdrop { background: transparent !important; backdrop-filter: none !important; }';
async function summary() {
  return page.evaluate(() => {
    const x = window.apexDiagnostics();
    const r = x.renderer;
    const u = r?.ultra;
    return {
      build: x.buildIdentity,
      state: x.state,
      options: x.options && {
        circuit: x.options.circuit,
        mode: x.options.mode,
        laps: x.options.laps,
        opponents: x.options.opponents,
        weather: x.options.weather,
        ruleset: x.options.ruleset,
        vehicles: x.options.vehicles,
      },
      presentedTime: x.presentation?.time,
      replayPosition: x.state === 'replay' ? x.replayPosition : null,
      renderer: r
        ? {
            camera: r.camera,
            requestedCamera: r.requestedCamera,
            lighting: r.lighting,
            renderWidth: r.renderWidth,
            renderHeight: r.renderHeight,
            drawCalls: r.drawCalls,
            triangles: r.triangles,
            ultra: u && { preset: u.preset, tier: u.tier, unsupported: u.unsupported, replayDof: u.replayDof },
          }
        : null,
    };
  });
}
/** Clean canvas PNG (DOM overlays hidden for the screenshot only); `asSeen`
 * also keeps the frame with the HUD / overlays; `ui` keeps only that one. */
async function shoot(id, slug, notes, { asSeen = false, ui = false, festival = false } = {}) {
  const file = `${id}-${slug}.png`;
  const meta = festival ? { festival: true } : await summary().catch(() => ({}));
  const player = festival ? null : (await snap().catch(() => ({}))).cars?.[0];
  if (ui) {
    await page.screenshot({ path: join(out, file), timeout: LONG });
  } else {
    if (asSeen) await page.screenshot({ path: join(out, `${id}-${slug}-hud.png`), timeout: LONG });
    await page.evaluate((css) => {
      const style = document.createElement('style');
      style.id = 'apex-capture-clean';
      style.textContent = css;
      document.head.append(style);
    }, CLEAN_CSS);
    try {
      await page.screenshot({ path: join(out, file), timeout: LONG });
    } finally {
      await page.evaluate(() => document.getElementById('apex-capture-clean')?.remove());
    }
  }
  manifest.shots.push({
    id,
    slug,
    file,
    hud: asSeen ? `${id}-${slug}-hud.png` : null,
    notes,
    player: player && {
      speedKmh: +(player.speed * 3.6).toFixed(1),
      s: +player.s.toFixed(1),
      lap: player.laps,
      leanDeg: +((player.lean * 180) / Math.PI).toFixed(1),
      airborne: player.airborne,
      airTime: +player.airTime.toFixed(2),
    },
    ...meta,
    capturedAt: new Date().toISOString(),
  });
  await saveManifest();
  log(`captured ${file}`);
}
async function attempt(id, fn) {
  try {
    await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message.split('\n')[0] : String(e);
    log(`shot ${id} failed: ${message}`);
    manifest.failures.push({ id, message });
    await saveManifest();
  }
}

// ---------------------------------------------------------------- menu flow
let presetApplied = false;
async function openApp(reload = false) {
  log(`${reload ? 'reload' : 'open'} ${url} (${backendName}, ${width}x${height})`);
  if (reload) await page.reload();
  else await page.goto(url);
  await page.locator('#menu').waitFor({ state: 'visible', timeout: LONG });
  manifest.gl ??= await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
  });
  log(`menu ready on ${manifest.gl}`);
}
/** GARAGE & SETTINGS → render quality (kept by the browser context's storage). */
async function ensurePreset() {
  const current = await page.evaluate(() => window.apexDiagnostics().renderer?.ultra?.preset ?? null).catch(() => null);
  if (presetApplied && current === preset) return;
  await boot();
  presetApplied = true;
}
async function boot() {
  log(`GARAGE & SETTINGS → ${preset}`);
  await click('#menu [data-action=settings]');
  await page.locator('#settingsForm select[name=quality]').selectOption(preset, { force: true });
  await click('#settingsForm button[type=submit]');
  await wf(
    (p) => {
      const x = window.apexDiagnostics();
      return !x.settingsTransition.busy && !document.querySelector('#modal')?.open && x.renderer?.ultra?.preset === p;
    },
    preset,
    { timeout: LONG, polling: 2000 },
  );
  log('preset applied');
}
async function toPaddock() {
  const s = (await snap()).state;
  if (s === 'menu') return;
  if (s === 'replay') await click('#replayBar [data-action=replayExit]');
  if ((await snap()).state === 'driving') await pause();
  await sessionMenu().catch(() => undefined);
  await click('#modal [data-action=menu]');
  await waitState('menu');
}
/** Paddock form → ENTER CIRCUIT → (briefing) GO STRAIGHT TO LIGHTS → paused on the grid. */
async function startRace({ circuit, mode = 'race', laps, weather = 'clear', opponents, start, vehicle }) {
  await toPaddock();
  await ensurePreset();
  log(`session: ${circuit} ${mode} ${laps} laps ${weather} grid ${+opponents + 1} start ${start} machine ${vehicle}`);
  const select = (id, v) => page.locator(`#${id}`).selectOption(String(v), { force: true });
  await select('circuit', circuit);
  await select('mode', mode);
  await select('laps', laps);
  await select('weather', weather);
  await select('opponents', opponents);
  await select('startSlot', start);
  await select('vehicle', vehicle);
  const rules = await page.locator('#sessionRules').textContent();
  log(`rules: ${rules}`);
  await click(page.getByRole('button', { name: /ENTER CIRCUIT/ }));
  await wf(
    () => {
      const x = window.apexDiagnostics();
      return x.state === 'driving' || (x.state === 'paused' && !!document.querySelector('#raceBriefing'));
    },
    null,
    { timeout: LONG, polling: 2000 },
  );
  log('session prepared');
  if (await page.locator('#raceBriefing').count())
    await click(page.getByRole('button', { name: 'GO STRAIGHT TO LIGHTS', exact: true }));
  await waitState('driving');
  await pause();
  return rules;
}
async function replaySeek(position) {
  const s = await snap();
  if (s.replay.playing) {
    await click('#replayPlay');
    await wf(() => !window.apexDiagnostics().replayPlaying, null, { polling: 500 });
  }
  const p = Math.max(0, Math.min(s.replay.duration, position));
  for (const value of [Math.max(0, p - 0.5), p]) {
    const before = (await snap()).frames;
    await page.locator('#replaySeek').fill(String(value.toFixed(2)), { force: true });
    await wf(
      (f) => {
        const x = window.apexDiagnostics();
        return !x.replaySeekPending && x.presentation.frames > f;
      },
      before,
      { timeout: LONG, polling: 1000 },
    );
  }
}
async function enterReplay() {
  await click('#modal [data-action=replay]');
  await waitState('replay');
}
async function exitReplay() {
  await click('#replayBar [data-action=replayExit]');
  await wf(() => window.apexDiagnostics().state !== 'replay', null, { polling: 1000 });
}
const toReplayPosition = (s, t) => t - (s.replay.start || 0);
const near = (s, predicate) => s.cars.slice(1).filter((c) => predicate(c, s.cars[0], s.length));
const ahead = (s, lo, hi) => near(s, (c, me, L) => gap(me, c, L) > lo && gap(me, c, L) < hi).length;
const deg = (r) => (r * 180) / Math.PI;

/** Start → camera → AI driver → resume. */
async function rollOut(cam = 'chase') {
  await camera(cam);
  await aiDriver();
  await resume();
}
/** Live pause on traffic: `minAhead` cars lo..hi m ahead after `after` s of racing
 * (any after `late` s), then a chase frame. */
async function trafficShot(id, slug, notes, { after = 8, lo = 8, hi = 70, minAhead = 2, late = 60, speed = 20, hud = false } = {}) {
  const r = await pauseWhen(
    `${id} ${slug}`,
    (s) => {
      if (s.state !== 'driving' || !(s.rt > after) || s.cars[0].speed < speed) return null;
      const n = ahead(s, lo, hi);
      return n >= minAhead || (s.rt > late && n >= 1) || s.rt > late * 2 ? Math.max(n, -1) || -1 : null;
    },
    { verify: (s) => s.cars[0].speed > speed * 0.6 && (ahead(s, lo * 0.5, hi * 1.3) >= 1 || s.rt > late * 2) },
  );
  if (!r.hit) throw new Error(`${id}: condition not met`);
  await frames(2);
  const n = ahead(r.snap, lo * 0.5, hi * 1.3);
  await shoot(id, slug, `${notes}; ${n} cars ${lo * 0.5}-${hi * 1.3} m ahead when held, ${(r.snap.cars[0].speed * 3.6).toFixed(0)} km/h, race ${r.snap.rt.toFixed(1)} s`, { asSeen: hud });
  return r;
}

// ---------------------------------------------------------------- sessions
async function menuShots() {
  await toPaddock();
  // 01 EVENTS hub: discipline event cards with rules stated before the start.
  await attempt('01', async () => {
    await click('#menu [data-action=events]');
    await page.locator('#modal[open] .event-cards').waitFor({ state: 'visible', timeout: 180000 });
    await sleep(2500);
    await shoot('01', 'events-hub', 'paddock EVENTS hub (event cards with venue, machine, rules)', { ui: true });
    // A second view further down the list (mixed disciplines).
    const cards = await page.locator('#modal .event-card').count();
    manifest.eventCards = cards;
    await page.locator('#modal .event-card').nth(Math.min(cards - 1, 9)).scrollIntoViewIfNeeded().catch(() => undefined);
    await sleep(1500);
    await shoot('01', 'events-hub-scrolled', `EVENTS hub scrolled (${cards} cards)`, { ui: true });
    await click('#modal [data-action=modalClose]');
    await wf(() => !document.querySelector('#modal')?.open, null, { polling: 500 });
  });
  // 01b MACHINE select opened: the native popup is outside the page, so the X
  // screen is grabbed (headed mesa only) and cropped to the viewport.
  await attempt('01b', async () => {
    if (backendName !== 'mesa' || !process.env.DISPLAY) throw new Error('needs a headed browser on X');
    const groups = await page.locator('#vehicle optgroup').count();
    const options = await page.locator('#vehicle option').count();
    manifest.machineSelect = { groups, options };
    await page.locator('#vehicle').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, '01b-menu-before-open.png') });
    const geometry = await page.evaluate(() => ({
      sx: window.screenX,
      sy: window.screenY,
      ow: window.outerWidth,
      oh: window.outerHeight,
      iw: window.innerWidth,
      ih: window.innerHeight,
    }));
    manifest.windowGeometry = geometry;
    await page.locator('#vehicle').click({ timeout: 30000 });
    await sleep(4000);
    execFileSync('import', ['-window', 'root', join(out, '01b-screen.png')], { env: process.env });
    await page.keyboard.press('Escape');
    manifest.shots.push({ id: '01b', slug: 'machine-select-open', file: '01b-screen.png', notes: `MACHINE select opened (${options} options in ${groups} class groups), X root grab`, geometry });
    await saveManifest();
    log(`captured 01b-screen.png (${options} options, ${groups} groups)`);
  });
  // 02 CAREER hub: four disciplines.
  await attempt('02', async () => {
    await click('#menu [data-action=career]');
    await page.locator('#modal[open] [data-discipline]').first().waitFor({ state: 'visible', timeout: 180000 });
    await sleep(2500);
    const states = await page.locator('#modal [data-discipline]').evaluateAll((cards) =>
      cards.map((c) => `${c.getAttribute('data-discipline')}:${c.querySelector('.career-state')?.textContent}`),
    );
    manifest.careerStates = states;
    await shoot('02', 'career-hub', `CAREER hub, discipline states ${states.join(', ')}`, { ui: true });
    await click('#modal [data-action=modalClose]');
    await wf(() => !document.querySelector('#modal')?.open, null, { polling: 500 }).catch(() => undefined);
  });
}

async function bikes() {
  timeline.length = 0;
  await startRace({ circuit: 'poggio-alto', laps: 3, opponents: 7, start: 'midfield', vehicle: 'gpr1' });
  await attempt('03', async () => {
    await rollOut('chase');
    const leaned = (min) => (s) => s.state !== 'paused' && s.cars[0].speed > 15 && Math.abs(s.cars[0].lean) > min;
    const r = await pauseWhen(
      '03 leaned in a corner',
      (s) => {
        if (s.state !== 'driving' || !(s.rt > 6) || !leaned(0.62)(s)) return null;
        return ahead(s, 4, 45) >= 1 || s.rt > 70 ? 1 : null;
      },
      { verify: (s) => s.cars[0].speed > 10 && Math.abs(s.cars[0].lean) > 0.45, tries: 6 },
    );
    if (!r.hit) throw new Error('no leaned moment held');
    await frames(2);
    const me = r.snap.cars[0];
    await shoot('03', 'gpr1-poggio-alto-lean', `GP-R1 motorcycle grid (8), Poggio Alto, live chase camera, lean ${deg(me.lean).toFixed(0)}°, ${(me.speed * 3.6).toFixed(0)} km/h, ${ahead(r.snap, 2, 60)} riders 2-60 m ahead`, { asSeen: true });
    // Same held moment from the trackside camera.
    await camera('trackside');
    await frames(2);
    await shoot('03', 'gpr1-poggio-alto-trackside', 'same held moment, trackside camera');
    await camera('chase');
  });
}

async function pack() {
  timeline.length = 0;
  await startRace({ circuit: 'aurel', laps: 3, opponents: 11, start: 'back', vehicle: 'multiclass' });
  await attempt('04', async () => {
    await rollOut('chase');
    await trafficShot('04', 'multiclass-pack-aurel', 'multi-class endurance grid (HY-9, PR-2, GT-8F, GT-10M, GS-4 x12) at Aurel from the back, live chase camera', {
      after: 4,
      lo: 6,
      hi: 60,
      minAhead: 3,
      late: 40,
      hud: true,
    });
    await camera('trackside');
    await frames(2);
    await shoot('04', 'multiclass-pack-aurel-trackside', 'same held moment, trackside camera');
    await camera('chase');
  });
}

async function truck() {
  timeline.length = 0;
  await startRace({ circuit: 'pinewood-stage', laps: 1, opponents: 3, start: 'pole', vehicle: 'dx8' });
  await attempt('05', async () => {
    await rollOut('chase');
    const r = await pauseWhen(
      '05 trophy truck on the stage',
      (s) => (s.state === 'driving' && s.rt > 14 && s.cars[0].speed > 16 ? 1 : null),
      { verify: (s) => s.cars[0].speed > 8, giveUp: (s) => s.rt > 400 },
    );
    if (!r.hit) throw new Error('truck never at speed');
    await frames(2);
    await shoot('05', 'dx8-trophy-truck-pinewood', `DX-8 trophy truck, Pinewood Forest special stage (gravel), live chase camera, ${(r.snap.cars[0].speed * 3.6).toFixed(0)} km/h`, { asSeen: true });
    // A second moment further into the stage.
    await resume();
    const from = (await snap()).rt;
    const r2 = await pauseWhen(
      '05 later on the stage',
      (s) => (s.state === 'driving' && s.rt > from + 25 && s.cars[0].speed > 14 ? 1 : null),
      { verify: (s) => s.cars[0].speed > 8, giveUp: (s) => s.rt > from + 200 },
    );
    if (r2.hit) {
      await frames(2);
      await shoot('05', 'dx8-trophy-truck-pinewood-2', `later on the stage, ${(r2.snap.cars[0].speed * 3.6).toFixed(0)} km/h`);
    }
  });
}

async function neon() {
  timeline.length = 0;
  await startRace({ circuit: 'neon-city', laps: 3, opponents: 7, start: 'midfield', vehicle: 'gt10m' });
  await attempt('06', async () => {
    await rollOut('chase');
    await trafficShot('06', 'neon-city-night-gt10m', 'NEON CITY street circuit (night by venue), GT-10M field (8), live chase camera', {
      after: 10,
      lo: 8,
      hi: 80,
      minAhead: 1,
      late: 45,
    });
    await camera('trackside');
    await frames(2);
    await shoot('06', 'neon-city-night-trackside', 'same held moment, trackside camera');
    await camera('chase');
  });
}

async function hochwald() {
  timeline.length = 0;
  await startRace({ circuit: 'hochwald', laps: 1, opponents: 7, start: 'midfield', vehicle: 'hf67' });
  await attempt('07', async () => {
    await rollOut('chase');
    await trafficShot('07', 'hochwald-forest-ring-hf67', 'HOCHWALD FOREST RING (catalogue wave 2), HF-67 historic formula field (8), live chase camera', {
      after: 20,
      lo: 8,
      hi: 80,
      minAhead: 1,
      late: 60,
    });
    await camera('trackside');
    await frames(2);
    await shoot('07', 'hochwald-forest-ring-trackside', 'same held moment, trackside camera');
    await camera('chase');
    // Later, deeper in the forest.
    await resume();
    const from = (await snap()).rt;
    const r = await pauseWhen('07 deeper in the forest', (s) => (s.state === 'driving' && s.rt > from + 60 && s.cars[0].speed > 25 ? 1 : null), {
      verify: (s) => s.cars[0].speed > 15,
    });
    if (r.hit) {
      await frames(2);
      await shoot('07', 'hochwald-forest-ring-2', `later on the lap, s ${r.snap.cars[0].s.toFixed(0)} m, ${(r.snap.cars[0].speed * 3.6).toFixed(0)} km/h`);
    }
  });
}

async function festival() {
  await toPaddock();
  await ensurePreset();
  log('session: festival (open world)');
  await page.locator('#mode').selectOption('festival', { force: true });
  await click(page.getByRole('button', { name: /ENTER CIRCUIT/ }));
  await page.locator('#festMenu').waitFor({ state: 'attached', timeout: LONG });
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: LONG });
  log('festival loaded at Port Ilse');
  await sleep(5000);
  const openMenu = async () => {
    await page.keyboard.press('Escape');
    await page.locator('#festMenu').waitFor({ state: 'visible' });
  };
  const setLighting = async (value) => {
    await click(`#festMenu [data-fest=lighting][data-value=${value}]`);
    await wf(
      (v) => document.querySelector(`#festMenu [data-fest=lighting][data-value=${v}]`)?.getAttribute('aria-pressed') === 'true',
      value,
      { timeout: LONG, polling: 2000 },
    );
  };
  await attempt('08', async () => {
    await openMenu();
    await setLighting('sunset');
    await click('#festMenu [data-fest=resume]');
    await sleep(45000);
    await openMenu();
    await sleep(20000);
    await shoot('08', 'festival-port-ilse-golden-hour', 'open-world festival, Port Ilse spawn (town), Golden hour, chase camera, festival menu hidden for the capture', { festival: true });
  });
  await attempt('09', async () => {
    if (await page.locator('#festMenu').isVisible()) await click('#festMenu [data-fest=resume]');
    await sleep(3000);
    // T: the full world map (roads, relief, event markers, player position).
    await page.keyboard.press('KeyT');
    await page.locator('#festMap').waitFor({ state: 'visible', timeout: 120000 });
    await sleep(8000);
    await shoot('09', 'festival-world-map', 'open-world festival world map (T): Solvane region relief, road network, event markers, player at Port Ilse', { ui: true, festival: true });
    await click('#festMap [data-fest=mapClose]');
  });
  // 09b: autopilot to the nearest event marker, day light, HUD visible.
  await attempt('09b', async () => {
    await openMenu();
    await setLighting('day');
    await click('#festMenu [data-fest=autopilot][data-value=on]');
    await click('#festMenu [data-fest=resume]');
    log('festival autopilot on, driving');
    for (let i = 1; i <= 3; i++) {
      await sleep(i === 1 ? 70000 : 50000);
      await page.screenshot({ path: join(out, `09b-festival-drive-${i}-hud.png`), timeout: LONG });
      await page.evaluate((css) => {
        const style = document.createElement('style');
        style.id = 'apex-capture-clean';
        style.textContent = css;
        document.head.append(style);
      }, CLEAN_CSS);
      try {
        await page.screenshot({ path: join(out, `09b-festival-drive-${i}.png`), timeout: LONG });
      } finally {
        await page.evaluate(() => document.getElementById('apex-capture-clean')?.remove());
      }
      const hud = await page.evaluate(() => document.querySelector('#app')?.innerText?.slice(0, 600) ?? '');
      manifest.shots.push({ id: '09b', slug: `festival-drive-${i}`, file: `09b-festival-drive-${i}.png`, hud: `09b-festival-drive-${i}-hud.png`, notes: 'festival autopilot drive, live (not paused), day', hudText: hud });
      await saveManifest();
      log(`captured 09b-festival-drive-${i}.png`);
    }
    await openMenu();
  });
  await attempt('festival-exit', async () => {
    if (!(await page.locator('#festMenu').isVisible())) await openMenu();
    await click('#festMenu [data-fest=exit]');
    await waitState('menu', 5 * 60 * 1000);
  });
}

/** Moto session: live pause in the air (a few tries), then a replay fallback
 * at a polled airborne moment (or the middle of a jump from the survey). */
async function airborneShot(id, slug, notes, circuitId, { budget = 150, liveTries = 3 } = {}) {
  const jumps = CIRCUITS[circuitId].jumps ?? [];
  const live = await pauseWhen(
    `${id} airborne`,
    (s) => (s.state === 'driving' && s.rt > 5 && s.cars[0].airborne > 0 && s.cars[0].airTime < 0.6 ? 1 : null),
    { verify: (s) => s.cars[0].airborne > 0, tries: liveTries, every: 250, giveUp: (s) => s.rt > budget },
  );
  if (live.hit) {
    await frames(2);
    await shoot(id, slug, `${notes}; live pause in flight (air time ${live.snap.cars[0].airTime.toFixed(2)} s, ${ahead(live.snap, 2, 40)} riders 2-40 m ahead)`, { asSeen: true });
    return true;
  }
  // Keep racing to record more airborne samples within the budget.
  if ((await snap()).state === 'paused') await resume();
  await until(`${id} record`, () => null, { every: 250, giveUp: (s) => s.rt > budget });
  if ((await snap()).state === 'driving') await pause();
  await sessionMenu();
  const rows = timeline.filter((s) => s.cars && s.rt > 3);
  // Best polled airborne sample: in flight, most riders close ahead.
  let pick = null;
  for (const s of rows) {
    const me = s.cars[0];
    if (!(me.airborne > 0)) continue;
    const score = ahead(s, 2, 35) * 2 + Math.min(me.airTime, 0.8) + near(s, (c) => c.airborne > 0).length;
    if (!pick || score > pick.score) pick = { t: s.t, score, why: `polled airborne sample (air ${me.airTime.toFixed(2)} s)` };
  }
  if (!pick && jumps.length) {
    // Interpolate the time the player crossed the middle of the longest jump.
    const j = [...jumps].sort((a, b) => b.landing - b.takeoff - (a.landing - a.takeoff))[0];
    const mid = (j.takeoff + j.landing) / 2;
    for (let i = 1; i < rows.length && !pick; i++) {
      const a = rows[i - 1].cars[0], b = rows[i].cars[0];
      if (a.laps === b.laps && a.s < mid && b.s >= mid && b.s - a.s < 60) {
        const f = (mid - a.s) / (b.s - a.s);
        pick = { t: rows[i - 1].t + f * (rows[i].t - rows[i - 1].t), why: `interpolated crossing of ${j.name} mid-flight` };
      }
    }
  }
  if (!pick) throw new Error('no airborne moment recorded');
  const liveState = await snap();
  await enterReplay();
  await camera('chase', '#replayBar');
  const p = toReplayPosition(liveState, pick.t);
  await replaySeek(p);
  await shoot(id, slug, `${notes}; replay fallback: WATCH REPLAY chase camera held at ${p.toFixed(2)} s, ${pick.why}`);
  await camera('trackside', '#replayBar');
  await replaySeek(p);
  await shoot(id, `${slug}-trackside`, `same replay moment, trackside camera`);
  await exitReplay();
  return true;
}

async function valley() {
  timeline.length = 0;
  await startRace({ circuit: 'valley-ridge-mx', laps: 3, opponents: 11, start: 'midfield', vehicle: 'mx450' });
  await attempt('10', async () => {
    await rollOut('chase');
    await airborneShot('10', 'valley-ridge-mx450-airborne', 'Valley Ridge motocross (National), MX-450 gate start, 12 riders', 'valley-ridge-mx');
  });
}

async function arena() {
  timeline.length = 0;
  await startRace({ circuit: 'arena-nord-sx', laps: 3, opponents: 11, start: 'midfield', vehicle: 'mx250' });
  await attempt('11', async () => {
    await rollOut('chase');
    await trafficShot('11', 'arena-nord-supercross-night', 'Arena Nord supercross stadium (night by venue), MX-250 field (12), live chase camera', {
      after: 4,
      lo: 3,
      hi: 35,
      minAhead: 2,
      late: 40,
      speed: 6,
    });
    await resume();
    await airborneShot('11', 'arena-nord-airborne', 'Arena Nord supercross, MX-250', 'arena-nord-sx', { budget: 140, liveTries: 2 });
  });
}

async function kestrel() {
  timeline.length = 0;
  await startRace({ circuit: 'kestrel-rx', laps: 3, opponents: 7, start: 'midfield', vehicle: 'rcx6' });
  await attempt('12', async () => {
    await rollOut('chase');
    await trafficShot('12', 'kestrel-rallycross-rcx6', 'Kestrel rallycross (Joker layout, mixed gravel/asphalt), RCX-6 field (8), live chase camera', {
      after: 5,
      lo: 4,
      hi: 45,
      minAhead: 2,
      late: 40,
      speed: 10,
      hud: true,
    });
    await camera('trackside');
    await frames(2);
    await shoot('12', 'kestrel-rallycross-trackside', 'same held moment, trackside camera');
    await camera('chase');
    await resume();
    const from = (await snap()).rt;
    await trafficShot('12', 'kestrel-rallycross-rcx6-2', 'later in the heat', { after: from + 20, lo: 4, hi: 45, minAhead: 1, late: from + 30, speed: 10 });
  });
}


/** Vegetation look-dev: festival countryside. Seeds the saved festival
 * progress with discovered events (IndexedDB, the app's own save), then fast
 * travels to each and shoots the chase view after the tiles stream in. */
async function festtrees() {
  const { festivalDefaultVehicle } = await import(pathToFileURL(join(repo, 'src/simulation/open-world/session.ts')).href);
  const targets = (process.env.FEST_TARGETS || 'thornwood-rally,valley-sprint,coast-trap').split(',');
  await toPaddock();
  await ensurePreset();
  await page.evaluate(
    ({ discovered, vehicle }) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('apex-formula', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('saved');
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const tx = r.result.transaction('saved', 'readwrite');
          tx.objectStore('saved').put({ version: 1, discovered, best: {}, vehicle }, 'festival:v1');
          tx.oncomplete = () => {
            r.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { discovered: targets, vehicle: festivalDefaultVehicle() },
  );
  log('session: festival trees, discovered', targets.join(','));
  await page.locator('#mode').selectOption('festival', { force: true });
  await click(page.getByRole('button', { name: /ENTER CIRCUIT/ }));
  await page.locator('#festMenu').waitFor({ state: 'attached', timeout: LONG });
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: LONG });
  log('festival loaded');
  await sleep(5000);
  const openMenu = async () => {
    await page.keyboard.press('Escape');
    await page.locator('#festMenu').waitFor({ state: 'visible' });
  };
  let i = 0;
  for (const id of targets) {
    i++;
    await attempt(`13-${i}`, async () => {
      if (!(await page.locator('#festMenu').isVisible())) await openMenu();
      const button = page.locator(`#festMenu [data-fest=travel][data-value="${id}"]`);
      if (!(await button.count())) throw new Error(`no travel button for ${id}`);
      await click(button);
      log(`travelling to ${id}`);
      await sleep(4000);
      await page.locator('#loading').waitFor({ state: 'hidden', timeout: LONG });
      await sleep(Number(process.env.FEST_SETTLE || 50000));
      await openMenu();
      await sleep(15000);
      await shoot('13', `festival-trees-${i}-${id}`, `festival fast travel to ${id}, chase camera, menu hidden for the capture`, { festival: true });
    });
  }
  await attempt('festival-exit', async () => {
    if (!(await page.locator('#festMenu').isVisible())) await openMenu();
    await click('#festMenu [data-fest=exit]');
    await waitState('menu', 5 * 60 * 1000);
  });
}

const RUNS = { menu: menuShots, bikes, pack, truck, neon, hochwald, festival, valley, arena, kestrel, festtrees };
const shotCount = () => manifest.shots.length;
try {
  await openApp();
  for (const name of sessionList) {
    const run = RUNS[name];
    if (!run) throw new Error(`unknown session ${name}`);
    for (let attemptNo = 1; attemptNo <= 2; attemptNo++) {
      const started = Date.now();
      const before = shotCount();
      let lost = null;
      try {
        await run();
      } catch (e) {
        manifest.failures.push({ id: name, attempt: attemptNo, message: e instanceof Error ? e.stack : String(e) });
        log(`session ${name} aborted:`, e instanceof Error ? e.message.split('\n')[0] : e);
        await page.screenshot({ path: join(out, `failure-${name}-${attemptNo}.png`), timeout: 120000 }).catch(() => undefined);
      } finally {
        await saveTimeline(name).catch(() => undefined);
        await saveManifest();
        log(`session ${name} took ${((Date.now() - started) / 1000).toFixed(0)} s`);
      }
      lost = await errorText();
      if (lost) {
        log(`application error after ${name}: ${lost}; reloading`);
        manifest.failures.push({ id: name, attempt: attemptNo, message: `application error: ${lost}` });
        await openApp(true);
        presetApplied = false;
        // Retry only when the error cost the session its shots.
        if (shotCount() > before || attemptNo === 2) break;
        continue;
      }
      break;
    }
  }
} catch (e) {
  manifest.failures.push({ id: 'boot', message: e instanceof Error ? e.stack : String(e) });
  log('aborted:', e);
  await page.screenshot({ path: join(out, 'failure-state.png'), timeout: LONG }).catch(() => undefined);
} finally {
  manifest.finishedAt = new Date().toISOString();
  await saveManifest();
  await browser.close();
  log(`done: ${manifest.shots.length} shots, ${manifest.failures.length} failures → ${out}`);
}
