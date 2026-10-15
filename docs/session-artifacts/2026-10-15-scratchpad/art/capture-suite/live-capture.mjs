/**
 * APEX art-direction capture suite, driven through the real application.
 *
 *   node --experimental-transform-types live-capture.mjs --repo /path/to/checkout --out NEW_DIR
 *        [--url http://127.0.0.1:PORT/] [--size 960x540] [--preset ultra]
 *        [--backend mesa|swiftshader] [--sessions dry,rain,neon,festival] [--build-dir DIR]
 *
 * See README.md next to this file. In short: the script builds the checkout
 * (or uses --url), opens it in Chromium, chooses the render preset in GARAGE &
 * SETTINGS, starts ordinary sessions from the paddock menu with the AI DRIVER,
 * and pauses on conditions read from the read-only `window.apexDiagnostics()`.
 * Views are changed only with the existing controls (pause menu CHANGE CAMERA,
 * ACADEMY lighting, PHOTO STUDIO, WATCH REPLAY + seek bar, festival menu).
 * Nothing is injected into the simulation or renderer. The only page change
 * the script makes is a capture-time stylesheet that hides the DOM overlays
 * (HUD, pause menu, replay bar) for the clean canvas PNG; it is removed again
 * right after each screenshot. Photo-studio shots use the studio's own
 * DOWNLOAD PNG export.
 *
 * Framings (CONTENT_PIPELINE.md §3 plus two venue shots):
 *   01 cockpit, low speed, pit exit        (Aurel, live, paused; replay fallback)
 *   02 chase, high speed, main straight    (Aurel, live, paused)
 *   03 side-by-side racing                 (Aurel, live, paused; replay fallback)
 *   04 wet braking into turn 1, heavy rain (Aurel rain session, live, paused)
 *   05 sunset, into the sun                (Aurel, ACADEMY SUNSET, live, paused; replay fallback)
 *   06 night traffic                       (Aurel, ACADEMY NIGHT, opening laps, live, paused)
 *   07 pit entry and service               (Aurel, pit assist, live, paused in service; replay fallback)
 *   08 wide replay / broadcast             (Aurel, WATCH REPLAY, trackside camera, held seek)
 *   09 close photo of a car                (Aurel, PHOTO STUDIO orbit + DOF, studio PNG)
 *   10 catalogue venue: Neon City at night (race start, live, paused)
 *   11 open-world festival, Port Ilse town, golden hour (festival menu, held)
 *
 * Determinism: fixed viewport and device scale, a fresh browser context (no
 * saved preferences), fixed menu choices, AI driver from the grid, and pause
 * conditions on simulation state (track distance, speed, pit phase, heading,
 * rival gaps) rather than on wall time. Replay shots seek to an exact replay
 * time. Software GL renders seconds per frame, so the simulation clock keeps
 * running while the page draws: a paused frame is reproducible in framing, not
 * byte-identical between runs.
 */
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
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
const [width, height] = opt('size', '960x540').split('x').map(Number);
const preset = opt('preset', 'ultra');
const backendName = opt('backend', process.env.DISPLAY ? 'mesa' : 'swiftshader');
const sessions = new Set(opt('sessions', 'dry,rain,neon,festival').split(','));
const executablePath = process.env.CHROMIUM_PATH || undefined;
if (!(width > 0 && height > 0)) throw new Error('Invalid --size');
if (!['low', 'medium', 'high', 'ultra'].includes(preset)) throw new Error('Invalid --preset');

const need = createRequire(join(repo, 'package.json'));
const { chromium } = need('@playwright/test');
const protocol = await import(pathToFileURL(join(repo, 'src/simulation/protocol.ts')).href);
const { H, F, HEADER, CAR_STRIDE } = protocol;
// The authored golden-hour sun (sky-light.ts), read from source so a change follows.
const skySource = await readFile(join(repo, 'src/rendering/sky-light.ts'), 'utf8');
const sunsetMatch = /SUNSET_OFFSET = Object\.freeze\(new T\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\)\)/.exec(
  skySource,
);
const SUNSET = sunsetMatch ? sunsetMatch.slice(1).map(Number) : [-215, 45, -150];

// ---------------------------------------------------------------- server
async function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => ok(port));
    });
  });
}
let server = null;
let buildDir = null;
let url = opt('url', '');
if (!url) {
  const vite = need('vite');
  const parent = opt('build-dir', tmpdir());
  await mkdir(parent, { recursive: true });
  const outDir = (buildDir = await mkdtemp(join(parent, 'apex-capture-build-')));
  console.log(`Building ${repo} into ${outDir}`);
  await vite.build({ root: repo, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  const port = await freePort();
  server = await vite.preview({
    root: repo,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port, strictPort: true },
  });
  url = `http://127.0.0.1:${port}/`;
}

// ---------------------------------------------------------------- browser
const backendArgs =
  backendName === 'mesa'
    ? ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
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
const LONG = 20 * 60 * 1000; // software GL: a single draw can take minutes after a lighting change
page.setDefaultTimeout(LONG);
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)} s]`, ...a);
const manifest = {
  suite: 'APEX art-direction capture suite (live application)',
  url,
  repo,
  size: { width, height },
  preset,
  backend: backendName,
  startedAt: new Date().toISOString(),
  shots: [],
  failures: [],
  consoleErrors,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- page helpers
async function click(target) {
  const locator = typeof target === 'string' ? page.locator(target).first() : target;
  await locator.waitFor({ state: 'attached' });
  try {
    await locator.click({ force: true, timeout: 60000 });
  } catch {
    // A long software draw can hold the input dispatch; a DOM click reaches
    // the same delegated data-action handler.
    await locator.dispatchEvent('click');
  }
}
async function snap() {
  return page.evaluate(
    ({ H, F, HEADER, CAR_STRIDE }) => {
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
        // Requested view (renderer.mode); `camera` is the last presented one.
        camera: r?.requestedCamera ?? null,
        presentedCamera: r?.camera ?? null,
        lighting: r?.lighting ?? null,
        settingsBusy: x.settingsTransition.busy,
        wall: Date.now(),
      };
      const f = x.frame;
      if (f) {
        o.t = f[H.TIME];
        o.rt = f[H.RACE_TIME];
        o.rain = f[H.RAIN];
        o.length = f[H.LENGTH];
        o.cars = [];
        for (let i = 0; i < Math.round(f[H.CARS]); i++) {
          const b = HEADER + i * CAR_STRIDE;
          o.cars.push({
            id: i,
            x: f[b + F.X],
            z: f[b + F.Z],
            vx: f[b + F.VX],
            vz: f[b + F.VZ],
            speed: f[b + F.SPEED],
            brake: f[b + F.BRAKE],
            s: f[b + F.S],
            lat: f[b + F.LATERAL],
            laps: f[b + F.LAPS],
            pitPhase: f[b + F.PIT_PHASE],
            inPit: f[b + F.IN_PIT],
            rank: f[b + F.RANK],
          });
        }
      }
      return o;
    },
    { H, F, HEADER, CAR_STRIDE },
  );
}
/** Signed along-track gap from car a to car b (m), wrapped to ±L/2. */
function gap(a, b, length) {
  let g = (((b.s - a.s) % length) + length) % length;
  if (g > length / 2) g -= length;
  return g;
}
const timeline = [];
/** Keep the polled simulation states of a session (pause conditions, replay picks). */
async function saveTimeline(name) {
  const rows = timeline.map((x) => ({
    wall: x.wall,
    t: +x.t.toFixed(3),
    rt: +x.rt.toFixed(3),
    state: x.state,
    cars: x.cars.map((c) => [+c.s.toFixed(1), +c.lat.toFixed(2), +c.speed.toFixed(2), +c.brake.toFixed(2), c.laps, c.pitPhase]),
  }));
  await writeFile(join(out, `timeline-${name}.json`), JSON.stringify({ columns: ['s', 'lateral', 'speed', 'brake', 'laps', 'pitPhase'], rows }));
}
/** Poll the simulation until `predicate` holds; `giveUp` ends the wait early
 * (for example a race-distance budget). The session ending also ends it. */
async function until(label, predicate, { timeout = LONG, every = 600, giveUp = null } = {}) {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    last = await snap();
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
/** Pause when `predicate` holds, then check the held state with `verify`: a
 * slow draw can delay the pause by seconds, so a held state that drifted out
 * of the framing is resumed and the wait repeated (up to `tries` times). */
async function pauseWhen(label, predicate, { verify = predicate, tries = 4, ...options } = {}) {
  for (let i = 1; i <= tries; i++) {
    const r = await until(i > 1 ? `${label} (try ${i})` : label, predicate, options);
    if (!r.hit) return r;
    await pause();
    const held = await snap();
    const ok = held.cars && verify(held);
    if (ok) return { snap: held, hit: ok, met: r.snap };
    log(`${label}: held at s ${held.cars?.[0].s.toFixed(0)} m, ${(held.cars?.[0].speed * 3.6).toFixed(0)} km/h no longer matches`);
    if (i < tries) await resume();
  }
  return { snap: null, hit: null };
}
async function waitState(state, timeout = LONG) {
  await page.waitForFunction((s) => window.apexDiagnostics().state === s, state, {
    timeout,
    polling: 1000,
  });
}
/** Wait until `n` more frames have been presented (live paused / photo redraw at the idle cap). */
async function frames(n = 2) {
  const start = (await snap()).frames;
  await page.waitForFunction(
    ({ start, n }) => window.apexDiagnostics().presentation.frames >= start + n,
    { start, n },
    { timeout: LONG, polling: 1000 },
  );
}
async function pauseMenu() {
  await page.locator('#modal[open] [data-action=resume]').waitFor({ state: 'attached', timeout: 5 * 60 * 1000 });
}
/** Pause menu or results screen: both offer PHOTO STUDIO and WATCH REPLAY. */
async function sessionMenu() {
  await page.locator('#modal[open] [data-action=photo]').waitFor({ state: 'attached', timeout: 5 * 60 * 1000 });
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
/** ACADEMY → CIRCUIT LIGHTING (paused). The switch re-bakes sky and shadows. */
async function lighting(mode) {
  if ((await snap()).lighting === mode) return;
  log(`lighting → ${mode}`);
  await click('#modal [data-action=academy]');
  await click(`#modal [data-action="lighting:${mode}"]`);
  await page.waitForFunction(
    (m) => window.apexDiagnostics().renderer?.lighting === m,
    mode,
    { timeout: LONG, polling: 2000 },
  );
  await click('#modal [data-action=modalClose]');
  await pauseMenu();
  // Draw the new lighting while still paused: the sky, probe and shadow
  // re-bake can hold the page for many seconds, which must not happen while
  // the pause conditions are being polled.
  await frames(2);
}
/** CHANGE CAMERA (pause menu or replay bar) until the renderer reports `mode`. */
async function camera(mode, where = '#modal') {
  // The cycle is chase → cockpit → pod → trackside; one press per step, each
  // confirmed on the requested view before the next (the presented view only
  // follows on the next draw, which can be many seconds away).
  for (let i = 0; i < 4; i++) {
    const current = (await snap()).camera;
    if (current === mode) return;
    await click(`${where} [data-action=camera]`);
    await page.waitForFunction(
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
  await page.waitForFunction(() => window.apexDiagnostics().auto === true, null, {
    timeout: LONG,
    polling: 1000,
  });
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
      options: x.options,
      presentedTime: x.presentation?.time,
      replayPosition: x.state === 'replay' ? x.replayPosition : null,
      renderer: r
        ? {
            camera: r.camera,
            requestedCamera: r.requestedCamera,
            lighting: r.lighting,
            renderWidth: r.renderWidth,
            renderHeight: r.renderHeight,
            automaticExposure: r.automaticExposure,
            weatherPresentation: r.weatherPresentation,
            photo: r.photo,
            drawCalls: r.drawCalls,
            triangles: r.triangles,
            ultra: u && {
              preset: u.preset,
              tier: u.tier,
              unsupported: u.unsupported,
              toneMapper: u.toneMapper,
              ssrFrames: u.ssr?.frames,
              aoTemporalFrames: u.aoTemporal?.frames,
              taaSharpenFrames: u.taaSharpen?.frames,
              lightShafts: u.lightShafts,
              replayDof: u.replayDof,
              cascades: u.shadowCascades?.count,
            },
          }
        : null,
    };
  });
}
/** Clean canvas PNG (DOM overlays hidden for the screenshot only). */
async function shoot(id, slug, notes, { asSeen = false, festival = false } = {}) {
  const file = `${id}-${slug}.png`;
  const meta = festival ? { festival: true } : await summary();
  const player = festival ? null : (await snap()).cars?.[0];
  if (asSeen) {
    await page.screenshot({ path: join(out, `${id}-${slug}-as-seen.png`), timeout: LONG });
  }
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
  manifest.shots.push({
    id,
    slug,
    file,
    asSeen: asSeen ? `${id}-${slug}-as-seen.png` : null,
    notes,
    player: player && {
      speedKmh: +(player.speed * 3.6).toFixed(1),
      s: +player.s.toFixed(1),
      lap: player.laps,
      pitPhase: player.pitPhase,
      brake: +player.brake.toFixed(2),
    },
    ...meta,
    capturedAt: new Date().toISOString(),
  });
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log(`captured ${file}`);
}
async function attempt(id, fn) {
  try {
    await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message.split('\n')[0] : String(e);
    log(`shot ${id} failed: ${message}`);
    manifest.failures.push({ id, message });
    await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
}

// ---------------------------------------------------------------- menu flow
async function boot() {
  log(`open ${url} (${backendName}, ${width}x${height})`);
  await page.goto(url);
  await page.locator('#menu').waitFor({ state: 'visible', timeout: LONG });
  manifest.gl = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
  });
  log(`menu ready on ${manifest.gl}; GARAGE & SETTINGS → ${preset}`);
  await click('#menu [data-action=settings]');
  await page.locator('#settingsForm select[name=quality]').selectOption(preset, { force: true });
  await click('#settingsForm button[type=submit]');
  await page.waitForFunction(
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
  if (s === 'driving') await pause();
  await click('#modal [data-action=menu]');
  await waitState('menu');
}
/** Paddock form → ENTER CIRCUIT → (briefing) GO STRAIGHT TO LIGHTS → paused on the grid. */
async function startRace({ circuit, mode = 'race', laps, weather, opponents, start }) {
  await toPaddock();
  log(`session: ${circuit} ${mode} ${laps} laps ${weather} grid ${+opponents + 1} start ${start}`);
  const select = (id, v) => page.locator(`#${id}`).selectOption(String(v), { force: true });
  await select('circuit', circuit);
  await select('mode', mode);
  await select('laps', laps);
  await select('weather', weather);
  await select('opponents', opponents);
  await select('startSlot', start);
  await click(page.getByRole('button', { name: /ENTER CIRCUIT/ }));
  await page.waitForFunction(
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
}
/** Replay bar: hold playback, then seek (a held replay draws once per seek). */
async function replaySeek(position) {
  const s = await snap();
  if (s.replay.playing) {
    await click('#replayPlay');
    await page.waitForFunction(() => !window.apexDiagnostics().replayPlaying, null, { polling: 500 });
  }
  const p = Math.max(0, Math.min(s.replay.duration, position));
  // Seek away and back so a camera change made while held is redrawn too.
  for (const value of [Math.max(0, p - 0.5), p]) {
    const before = (await snap()).frames;
    await page.locator('#replaySeek').fill(String(value.toFixed(2)), { force: true });
    await page.waitForFunction(
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
  await page.waitForFunction(() => window.apexDiagnostics().state !== 'replay', null, { polling: 1000 });
}
const toReplayPosition = (s, t) => t - (s.replay.start || 0);

// ---------------------------------------------------------------- sessions
const near = (s, predicate) => s.cars.slice(1).filter((c) => predicate(c, s.cars[0], s.length));
const sun = (() => {
  const l = Math.hypot(SUNSET[0], SUNSET[2]);
  return [SUNSET[0] / l, SUNSET[2] / l];
})();
const sunAlignment = (c) => (c.speed > 5 ? (c.vx * sun[0] + c.vz * sun[1]) / Math.hypot(c.vx, c.vz) : -1);

async function dryAurel() {
  timeline.length = 0;
  await startRace({ circuit: 'aurel', laps: 10, weather: 'clear', opponents: 11, start: 'midfield' });
  // 03 side-by-side (day): mid-grid of 12. The recorded races show the field
  // strung out within seconds of the start (the AI driver is quick and passes
  // with wide margins), so the reliable side-by-side moment is the launch: the
  // car diagonally ahead on the grid, 1-12 m ahead and a lane across, above
  // 29 km/h. Budget: the first 60 s of racing. Fallback: replay, below.
  let sideBySide = false;
  await attempt('03', async () => {
    await lighting('day');
    await camera('chase');
    await aiDriver();
    await resume();
    // Alongside and just ahead, so the chase camera (about 6 m behind) frames both cars.
    const beside = (lo, hi, latLo, latHi) => (s) => {
      if (s.cars[0].speed < 8) return null;
      const c = near(s, (c, me, L) => gap(me, c, L) > lo && gap(me, c, L) < hi && Math.abs(c.lat - me.lat) > latLo && Math.abs(c.lat - me.lat) < latHi);
      return c.length ? c[0].id : null;
    };
    const r = await pauseWhen('03 side-by-side', (s) => (s.state === 'driving' ? beside(1, 12, 1.8, 7.5)(s) : null), {
      verify: beside(-1, 15, 1.5, 8.5),
      giveUp: (s) => s.rt > 60,
    });
    if (!r.hit) return;
    await frames(2);
    await shoot('03', 'side-by-side', `live chase camera, car ${r.hit + 1} alongside (gap ${gap(r.snap.cars[0], r.snap.cars[r.hit], r.snap.length).toFixed(1)} m, ${(r.snap.cars[0].speed * 3.6).toFixed(0)} km/h)`);
    sideBySide = true;
  });
  // 06 night traffic: ACADEMY NIGHT while paused, then on behind the field.
  await attempt('06', async () => {
    await pause();
    await lighting('night');
    await aiDriver();
    await resume();
    const from = (await snap()).t;
    const ahead = (lo, hi) => (s) => near(s, (c, me, L) => gap(me, c, L) > lo && gap(me, c, L) < hi).length;
    const r = await pauseWhen(
      '06 night traffic',
      (s) => {
        if (s.state !== 'driving' || !(s.t > from + 4) || s.cars[0].speed < 25 || s.cars[0].inPit) return null;
        const n = ahead(10, 80)(s);
        return n >= 2 || (s.t > from + 30 && n >= 1) || s.t > from + 90 ? n || -1 : null;
      },
      { verify: (s) => (ahead(5, 100)(s) || (s.t > from + 90 ? -1 : 0)) && !s.cars[0].inPit },
    );
    if (!r.hit) throw new Error('06 night traffic: condition not met');
    await frames(2);
    await shoot('06', 'night-traffic', `ACADEMY NIGHT, chase camera, ${Math.max(0, r.hit)} cars 5-100 m ahead when held`);
  });
  await attempt('day', async () => {
    await pause();
    await lighting('day');
    await aiDriver();
  });
  // 02 chase at speed on the start/finish straight, past the pits and grandstand
  // (the polled laps show 240-280 km/h at 120-420 m after the line).
  await attempt('02', async () => {
    await resume();
    const r = await pauseWhen(
      '02 main straight',
      (s) => {
        const me = s.cars[0];
        return s.state === 'driving' && s.rt > 30 && me.s > 120 && me.s < 420 && me.speed > 65 && !me.inPit ? 1 : null;
      },
      { verify: (s) => s.cars[0].s > 80 && s.cars[0].s < 650 && s.cars[0].speed > 60 && !s.cars[0].inPit },
    );
    if (!r.hit) throw new Error('02 main straight: condition not met');
    await frames(2);
    await shoot('02', 'chase-main-straight', 'live chase camera, start/finish straight after the line, above 216 km/h');
  });
  // 07 pit service: P requests the stop and pit assist drives in; paused in the
  // box. P toggles the request, and the AI driver's own strategy may already
  // have set it, so a lap without entering the pit lane presses P again. The
  // service lasts about 5 s of simulation; if a slow draw hides it from the
  // poll, the stop is still recorded and the replay fallback below holds it.
  let serviced = false,
    pitted = false,
    exited = false;
  await attempt('07', async () => {
    await resume();
    for (let request = 1; request <= 3 && !pitted; request++) {
      await page.keyboard.press('KeyP');
      const lap = (await snap()).cars[0].laps;
      let entered = false;
      const lost = (s) => !entered && s.cars[0].laps > lap && s.cars[0].s > 600;
      const track = (s) => {
        if (s.cars[0].inPit || s.cars[0].pitPhase > 0) entered = true;
      };
      // Hold once on the pit-lane approach (Aurel: the box is about 100 m after
      // the line): the first close draw of the box and crew can block the page
      // for longer than the whole service; drawing it while paused avoids that.
      const approach = await until(
        `07 pit approach (request ${request})`,
        (s) => {
          track(s);
          const me = s.cars[0];
          return s.state === 'driving' && me.pitPhase === 1 && (me.s > 2950 || me.s < 50) ? 1 : null;
        },
        { giveUp: (s) => (entered && s.cars[0].pitPhase >= 2) || lost(s) },
      );
      if (approach.hit) {
        await pause();
        await frames(2);
        await resume();
      }
      const r = await pauseWhen(
        `07 pit service (request ${request})`,
        (s) => {
          track(s);
          return s.state === 'driving' && s.cars[0].pitPhase >= 2 && s.cars[0].pitPhase <= 5 ? 1 : null;
        },
        {
          verify: (s) => s.cars[0].pitPhase >= 2 && s.cars[0].pitPhase <= 5,
          tries: 1,
          // Released before a poll saw the service, or the request was lost.
          giveUp: (s) => (entered && s.cars[0].pitPhase === 6) || lost(s),
        },
      );
      serviced = !!r.hit;
      pitted = serviced || entered;
      if (!pitted && (await snap()).state !== 'driving') break;
    }
    if (!serviced) throw new Error(pitted ? 'service not held live (replay fallback below)' : 'no pit stop observed');
    await frames(2);
    await shoot('07', 'pit-service', 'pit assist, paused in the box during service (pit phase 2-5), chase camera');
  });
  // 01 cockpit leaving the box at the pit-lane limit.
  await attempt('01', async () => {
    if (!pitted) throw new Error('needs the pit stop of shot 07');
    await resume();
    const r = await pauseWhen(
      '01 pit exit',
      (s) => (s.state === 'driving' && s.cars[0].pitPhase === 6 && s.cars[0].speed > 8 ? 1 : null),
      { verify: (s) => s.cars[0].inPit && s.cars[0].speed > 5, tries: 1, timeout: 5 * 60 * 1000 },
    );
    if (!r.hit) throw new Error('pit exit not held live (replay fallback below)');
    await camera('cockpit');
    await frames(2);
    await shoot('01', 'cockpit-pit-exit', 'cockpit camera, released from the box, pit-lane speed');
    exited = true;
    await camera('chase');
  });
  // 09 close photo: PHOTO STUDIO, free orbit, 50 mm, depth of field, studio PNG export.
  await attempt('09', async () => {
    await pause();
    await sessionMenu();
    await click('#modal [data-action=photo]');
    await waitState('photo');
    const set = (k, v) => page.locator(`#photo-${k}`).fill(String(v), { force: true });
    await set('azimuth', 32);
    await set('elevation', 8);
    await set('distance', 8);
    await set('focalLength', 50);
    await page.locator('#photo-depthOfField').check({ force: true });
    await frames(2);
    const meta = await summary();
    const download = page.waitForEvent('download', { timeout: LONG });
    await click('#capturePhoto');
    const d = await download;
    await d.saveAs(join(out, '09-close-photo.png'));
    manifest.shots.push({
      id: '09',
      slug: 'close-photo',
      file: '09-close-photo.png',
      notes: 'PHOTO STUDIO free orbit (az 32, el 8, 8 m, 50 mm, DOF on subject), DOWNLOAD PNG export',
      ...meta,
      capturedAt: new Date().toISOString(),
    });
    log('captured 09-close-photo.png');
    await click('[data-photo-action=close]');
    await page.waitForFunction(() => window.apexDiagnostics().state !== 'photo', null, { polling: 1000 });
  });
  // 08 broadcast replay: WATCH REPLAY, trackside camera, held on the opening lap.
  await attempt('08', async () => {
    await pause();
    await sessionMenu();
    const live = await snap();
    await enterReplay();
    await camera('trackside', '#replayBar');
    // Densest moment of the field in the first 40 s of racing.
    let best = null;
    for (const s of timeline) {
      if (!(s.rt > 3 && s.rt < 40)) continue;
      const me = s.cars[0];
      const pack = near(s, (c) => Math.abs(gap(me, c, s.length)) < 60).length;
      if (!best || pack > best.pack) best = { pack, t: s.t };
    }
    const target = best ? toReplayPosition(live, best.t) : 12;
    await replaySeek(target);
    await shoot('08', 'replay-broadcast', `WATCH REPLAY, held at replay ${target.toFixed(2)} s, trackside (broadcast) camera; as-seen keeps letterbox and lower third`, { asSeen: true });
    if (!sideBySide) {
      // Fallback for 03: the closest recorded side-by-side moment, replay chase camera.
      // Closest to a rival about 7 m ahead and 2-6 m to the side, which the
      // chase camera (about 6 m behind) frames; a car exactly level is out of
      // its view, so ahead is required first and only then any neighbour.
      let pick = null;
      for (const ahead of [true, false]) {
        for (const s of timeline) {
          const me = s.cars[0];
          if (me.speed < 8 || me.inPit) continue;
          for (const c of s.cars.slice(1)) {
            const g = gap(me, c, s.length),
              l = Math.abs(c.lat - me.lat);
            if ((ahead && (g < 1.5 || g > 15)) || Math.abs(g) > 20 || l > 9) continue;
            const score = Math.abs(g - 7) + 2 * Math.max(0, 2 - l) + Math.max(0, l - 6);
            if (!pick || score < pick.score) pick = { g, score, t: s.t };
          }
        }
        if (pick) break;
      }
      if (pick) {
        await camera('chase', '#replayBar');
        const p = toReplayPosition(live, pick.t);
        await replaySeek(p);
        await shoot('03', 'side-by-side', `replay fallback (no live side-by-side in the first 60 s of racing): WATCH REPLAY, replay chase camera held at ${p.toFixed(2)} s, nearest recorded rival ${pick.g.toFixed(1)} m ahead`);
      }
    }
    if (!serviced) {
      // Fallback for 07: the recorded stop, held in the box (between the last
      // pit-lane sample at rest and the release), replay chase camera.
      // The stop lies between the last pit-lane sample before it and the first
      // sample after release (polls can be seconds apart while a slow draw
      // holds the page); the middle of that span is inside the 5.2 s service.
      const rows = timeline.filter((x) => x.cars[0].inPit || x.cars[0].pitPhase > 0);
      const inBox = rows.find((x) => x.cars[0].pitPhase >= 2 && x.cars[0].pitPhase <= 5);
      const after = rows.find((x) => x.cars[0].pitPhase === 6);
      const before = after && rows.filter((x) => x.cars[0].pitPhase === 1 && x.t < after.t).pop();
      const t = inBox ? inBox.t : before && after ? (before.t + 1 + after.t - 1.5) / 2 : null;
      if (t !== null) {
        await camera('chase', '#replayBar');
        const p = toReplayPosition(live, t);
        await replaySeek(p);
        await shoot('07', 'pit-service', `replay fallback (service not caught by the live poll): WATCH REPLAY, chase camera held in the box at ${p.toFixed(2)} s`);
      }
    }
    if (pitted && !exited) {
      // Fallback for 01: first recorded sample released from the box above 8 m/s, replay cockpit.
      const x = timeline.find((y) => y.cars[0].pitPhase === 6 && y.cars[0].speed > 8);
      if (x) {
        await camera('cockpit', '#replayBar');
        const p = toReplayPosition(live, x.t);
        await replaySeek(p);
        await shoot('01', 'cockpit-pit-exit', `replay fallback: WATCH REPLAY, cockpit camera held at ${p.toFixed(2)} s, released from the box`);
      }
    }
    await exitReplay();
  });
  // 05 sunset into the sun: ACADEMY SUNSET, drive on until heading at the low sun.
  await attempt('05', async () => {
    await pause();
    await pauseMenu();
    await lighting('sunset');
    await camera('chase');
    await aiDriver();
    await resume();
    const resumedAt = (await snap()).t;
    const r = await pauseWhen(
      '05 into the sun',
      (s) => {
        const me = s.cars[0];
        return s.state === 'driving' && s.t > resumedAt + 8 && me.speed > 35 && !me.inPit && sunAlignment(me) > 0.9 ? 1 : null;
      },
      { verify: (s) => s.cars[0].speed > 25 && sunAlignment(s.cars[0]) > 0.85 },
    );
    if (r.hit) {
      await frames(2);
      await shoot('05', 'sunset-into-sun', 'ACADEMY SUNSET, live chase camera heading within 26° of the low sun');
      return;
    }
    // Fallback: the race ended first; hold the replay where the heading met the sun.
    let pick = null;
    for (const s of timeline) {
      const a = sunAlignment(s.cars[0]);
      if (s.cars[0].speed > 30 && (!pick || a > pick.a)) pick = { a, t: s.t };
    }
    if (!pick) throw new Error('no heading toward the sun recorded');
    const live = await snap();
    await click('#modal [data-action=replay]');
    await waitState('replay');
    await camera('chase', '#replayBar');
    const p = toReplayPosition(live, pick.t);
    await replaySeek(p);
    await shoot('05', 'sunset-into-sun', `replay fallback: SUNSET lighting, replay chase camera at ${p.toFixed(2)} s, heading alignment ${pick.a.toFixed(3)}`);
  });
}

async function rainAurel() {
  timeline.length = 0;
  await startRace({ circuit: 'aurel', laps: 3, weather: 'rain', opponents: 7, start: 'midfield' });
  await attempt('04', async () => {
    await lighting('day');
    await camera('chase');
    await aiDriver();
    await resume();
    // Turn-1 stop: the first braking zone after the line. NORTH HOOK (s 627)
    // is taken flat; the polled laps show the first heavy stop at 880-1020 m
    // (about 260 km/h, brake 0.9 in the dry). On the pedal, or losing speed
    // fast between two samples, on any lap.
    let previous = null;
    const r = await pauseWhen(
      '04 wet braking turn 1',
      (s) => {
        const me = s.cars[0];
        const slowing = previous && s.t > previous.t && me.speed < previous.speed - 3;
        previous = { t: s.t, speed: me.speed };
        return s.state === 'driving' && s.rt > 3 && me.s > 820 && me.s < 1010 && me.speed > 25 && (me.brake > 0.3 || slowing) ? 1 : null;
      },
      { verify: (s) => s.cars[0].s > 780 && s.cars[0].s < 1040 && s.cars[0].speed > 15 },
    );
    if (!r.hit) throw new Error('turn-1 braking not observed');
    await frames(2);
    const me = r.snap.cars[0];
    await shoot('04', 'wet-braking-turn1', `heavy rain, live chase camera, turn-1 braking zone (first stop after the line): s ${me.s.toFixed(0)} m, ${(me.speed * 3.6).toFixed(0)} km/h, brake ${me.brake.toFixed(2)}`);
  });
}

async function neonCity() {
  timeline.length = 0;
  await startRace({ circuit: 'neon-city', laps: 3, weather: 'clear', opponents: 7, start: 'midfield' });
  await attempt('10', async () => {
    await camera('chase');
    await aiDriver();
    await resume();
    const r = await pauseWhen(
      '10 neon city',
      (s) => {
        if (s.state !== 'driving' || !(s.rt > 10) || s.cars[0].speed < 25) return null;
        const ahead = near(s, (c, me, L) => gap(me, c, L) > 10 && gap(me, c, L) < 90);
        return ahead.length >= 1 || s.rt > 45 ? 1 : null;
      },
      { verify: (s) => s.cars[0].speed > 15 },
    );
    if (!r.hit) throw new Error('10 neon city: condition not met');
    await frames(2);
    await shoot('10', 'neon-city-night', 'catalogue venue NEON CITY (night by venue), live chase camera, race traffic');
  });
}

async function festival() {
  await attempt('11', async () => {
    await toPaddock();
    log('session: festival (open world)');
    await page.locator('#mode').selectOption('festival', { force: true });
    await click(page.getByRole('button', { name: /ENTER CIRCUIT/ }));
    await page.locator('#festMenu').waitFor({ state: 'attached', timeout: LONG });
    await page.locator('#loading').waitFor({ state: 'hidden', timeout: LONG });
    log('festival loaded at Port Ilse');
    await sleep(5000);
    await page.keyboard.press('Escape');
    await page.locator('#festMenu [data-fest=lighting][data-value=sunset]').waitFor({ state: 'visible' });
    await click('#festMenu [data-fest=lighting][data-value=sunset]');
    await page.waitForFunction(
      () => document.querySelector('#festMenu [data-fest=lighting][data-value=sunset]')?.getAttribute('aria-pressed') === 'true',
      null,
      { timeout: LONG, polling: 2000 },
    );
    await click('#festMenu [data-fest=resume]');
    // Let the exposure meter adapt to golden hour at the spawn (car at rest), then hold.
    await sleep(45000);
    await page.keyboard.press('Escape');
    await page.locator('#festMenu').waitFor({ state: 'visible' });
    await sleep(20000);
    await shoot('11', 'festival-town-golden-hour', 'open-world festival, Port Ilse spawn (town), festival menu Golden hour, chase camera, menu hidden for the capture', { festival: true });
  });
}

try {
  await boot();
  for (const [name, run] of [
    ['dry', dryAurel],
    ['rain', rainAurel],
    ['neon', neonCity],
  ]) {
    if (!sessions.has(name)) continue;
    try {
      await run();
    } finally {
      await saveTimeline(name).catch(() => undefined);
    }
  }
  if (sessions.has('festival')) await festival();
} catch (e) {
  manifest.failures.push({ id: 'session', message: e instanceof Error ? e.stack : String(e) });
  log('aborted:', e);
  await page.screenshot({ path: join(out, 'failure-state.png'), timeout: LONG }).catch(() => undefined);
} finally {
  manifest.finishedAt = new Date().toISOString();
  manifest.timelineSamples = timeline.length;
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await browser.close();
  if (server) await new Promise((ok) => server.httpServer.close(ok));
  if (buildDir) await rm(buildDir, { recursive: true, force: true });
  log(`done: ${manifest.shots.length} shots, ${manifest.failures.length} failures → ${out}`);
}
