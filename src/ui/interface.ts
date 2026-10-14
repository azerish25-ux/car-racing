import { installRaceDayHud, updateRaceDayHud } from './race-day-hud.ts';
import { installCompactRaceHud } from './compact-race-hud.ts';
import {
  compoundOf,
  fastestLapCar,
  installF1Hud,
  revLedThresholds,
  surname,
  towerWindow,
  tyreBand,
  type F1Hud,
} from './f1-hud.ts';
import { TrackMap } from './f1-minimap.ts';
import { installSpeedTunnel } from '../rendering/studio/speed-tunnel.ts';
import { SectorBoard } from './sector-timing.ts';
import { audioAccessibility, readDrivingAudio } from './audio-accessibility.ts';
import type { DrivingAudioSettings } from '../audio/driving-cues.ts';
import { nearbyTraffic } from './proximity.ts';
import { GapTimer, formatInterval } from './gap-timer.ts';
import { BUTTON_ACTIONS, BUTTON_ACTION_LABELS } from '../input/button-actions.ts';
import { engineeringReport } from './engineering.ts';
import { flagLabel } from '../simulation/marshal.ts';
import { presentationControls, bindPresentation, weatherReadout } from './presentation.ts';
import { DeviceCalibrationPanel } from './device-calibration.ts';
import { developerMode } from './dev-mode.ts';
import { LOADING_TIPS, loadingStage } from './loading-copy.ts';
import {
  BINDING_LABELS,
  keyName,
  validateBindings,
  type BindingAction,
  type Bindings,
} from '../input/bindings.ts';
import { TELEMETRY_VIEWS, type TelemetryView } from '../storage/telemetry-plots.ts';
import {
  COMPOUNDS,
  DEFAULT_OPTIONS,
  DEFAULT_SETUP,
  DRIVERS,
  LIVERIES,
  QUALIFYING_TIMED_LAPS,
  SETUP_LIMITS,
  racingSession,
  startingGrid,
  validateOptions,
  VEHICLE,
  type SessionOptions,
  type Setup,
  type StartSlot,
} from '../simulation/config.ts';
import { rulesetFor, sessionIncompatibilities } from '../simulation/events.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, WHEEL_NAMES, carBase } from '../simulation/protocol.ts';
import { type Track } from '../simulation/track.ts';
import { CIRCUIT_IDS, circuitDefinition, type CircuitId } from '../simulation/circuits.ts';
import {
  DEFAULT_CALENDAR,
  complete,
  nextRound,
  qualifyingGrid,
  standings,
  type Championship,
} from '../core/championship.ts';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
/** Menu labels for each original circuit (lengths are asserted in tests). */
/** Short track-conditions chip: air temperature and surface state. */
export function conditions(ambientC: number, rainMmHr: number, meanWaterMm: number) {
  if (![ambientC, rainMmHr, meanWaterMm].every(Number.isFinite)) return '—';
  const surface =
    rainMmHr > 0.01 ? 'RAIN' : meanWaterMm >= 0.04 ? 'WET' : meanWaterMm > 0.001 ? 'DAMP' : 'DRY';
  return `${surface}<small>${Math.round(ambientC)}°C</small>`;
}
/** Player-facing session names (pause menu and loading screen). */
export const SESSION_TITLES: Readonly<Record<SessionOptions['mode'], string>> = Object.freeze({
  race: 'Grand Prix',
  practice: 'Free Practice',
  'time-trial': 'Time Trial',
  qualifying: 'Qualifying',
  endurance: 'Endurance',
});
export const CIRCUIT_MENU_LABELS: Readonly<Record<CircuitId, string>> = Object.freeze({
  aurel: 'Aurel Grand Circuit · 2.97 km',
  vellamar: 'Vellamar Coast Circuit · 4.00 km',
});
/** Player-facing circuit name, e.g. "Aurel Grand Circuit". */
export const circuitTitle = (id: CircuitId) =>
  (CIRCUIT_MENU_LABELS[id] ?? CIRCUIT_MENU_LABELS.aurel).split(' · ')[0];
/** Fit any circuit into the 250×240 map. Aurel keeps its original centre and
 * 0.24 px/m scale (it already fits); larger circuits are centred and scaled. */
export function minimapFrame(track: Track) {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of track.points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const fitsOriginal =
    125 + minX * 0.24 >= 12 &&
    125 + maxX * 0.24 <= 238 &&
    125 - maxZ * 0.23 >= 12 &&
    125 - minZ * 0.23 <= 228;
  if (fitsOriginal) return { cx: 0, cz: 0, scale: 0.24 };
  const scale = Math.min(220 / Math.max(1, maxX - minX), 210 / Math.max(1, maxZ - minZ));
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, scale };
}
import { type Settings, validateSettings } from '../storage/data.ts';
import { type RacingRenderer } from '../rendering/renderer.ts';
export const lapTime = (seconds: number) =>
  seconds > 0
    ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(3).padStart(6, '0')}`
    : '—:——.———';
/** Timed-session tower cell: the session best in full, other times as a gap. */
export const timedGap = (best: number, sessionBest: number, holder: boolean) =>
  !(best > 0)
    ? '--:--.---'
    : holder || !(sessionBest > 0)
      ? lapTime(best)
      : `+${Math.max(0, best - sessionBest).toFixed(3)}`;
export const shortTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
/** Keep useful slider increments without rounding a valid researched/imported setup. */
export function setupControlStep(key: keyof Setup, value: number): number | 'any' {
  const [min, max] = SETUP_LIMITS[key];
  const preferred = max > 1000 ? 500 : max > 100 ? 1 : max <= 0.01 ? 0.0005 : 0.001;
  const steps = (value - min) / preferred;
  return Math.abs(steps - Math.round(steps)) < 1e-9 ? preferred : 'any';
}
interface Callbacks {
  action: (name: string) => void;
  start: (options: SessionOptions, holdOnGrid?: boolean) => void;
  apply: (settings: Settings) => void;
  seek: (value: number) => void;
  replaySpeed: (value: number) => void;
  exportSetup: () => void;
  importSetup: (file: File) => void;
  previewAudio?: (settings: DrivingAudioSettings) => void;
}
/** DOM writes only when the value changed: unchanged writes still dirty layout. */
function writeText(e: Element, value: string) {
  if (e.textContent !== value) e.textContent = value;
}
function writeWidth(e: HTMLElement, value: string) {
  if (e.style.width !== value) e.style.width = value;
}
/** Per-entry vehicles and the ruleset a MACHINE choice implies (WP22). */
export function machineOptions(
  options: SessionOptions,
  machine: string,
): Pick<SessionOptions, 'vehicles' | 'ruleset' | 'compound'> {
  if (machine !== 'tc1' && machine !== 'mixed') return { compound: options.compound };
  const count = options.opponents + 1;
  const vehicles = Array.from({ length: count }, (_, i) =>
    machine === 'mixed' ? (i % 2 ? 'apx01' : 'tc1') : 'tc1',
  );
  const ruleset =
    machine === 'mixed'
      ? options.mode === 'race' || options.mode === 'practice'
        ? 'open-exhibition'
        : undefined
      : options.mode === 'race'
        ? 'touring-sprint'
        : undefined;
  // Touring tyres are a single slick construction plus a wet.
  const compound =
    machine === 'tc1' && options.mode === 'race' && options.compound !== 'wet'
      ? 'medium'
      : options.compound;
  return { vehicles, ...(ruleset ? { ruleset } : {}), compound };
}
export class Interface {
  readonly menu: HTMLElement;
  readonly hud: HTMLElement;
  readonly modal: HTMLDialogElement;
  readonly map: HTMLCanvasElement;
  readonly graph: HTMLCanvasElement;
  readonly replayBar: HTMLElement;
  private toastTimer = 0;
  private nodes = new Map<string, HTMLElement>();
  private tick = 0;
  private lastAnnounced = '';
  private deviceCalibration: DeviceCalibrationPanel | null = null;
  private bindingCapture: AbortController | null = null;
  private driverName = DRIVERS[0];
  /** The player's driver name (timing tower, results and paddock masthead). */
  get playerName() {
    return this.driverName;
  }
  set playerName(name: string) {
    this.driverName = name;
    const node = this.element?.querySelector('#menuDriver');
    if (node) node.textContent = name.toUpperCase();
  }
  /** Timing loops for the tower's race intervals, rebuilt per field/circuit. */
  private gaps: GapTimer | null = null;
  private gapPositions = new Float64Array(0);
  private towerRefresh = -Infinity;
  /** Per-sector session and personal bests (sector panel colours). */
  private sectors: SectorBoard | null = null;
  /** F1-style layout: cluster, tower header, sector panel, banners, tags. */
  private readonly f1: F1Hud;
  private readonly trackMap: TrackMap;
  private readonly revThresholds = revLedThresholds();
  options: SessionOptions = { ...DEFAULT_OPTIONS };
  /** Time Trial: saved personal best (0 when none) and the live ghost delta. */
  timeTrial: { best: number; delta: number | null } | null = null;
  /** Developer tools and raw diagnostics are shown only with `?dev`. */
  readonly developer = developerMode();
  /** Latest presented frame, for the pause menu's session summary. */
  private lastFrame: Float32Array | null = null;
  private loadingProgress = 0;
  private loadingTipIndex = 0;
  constructor(
    readonly element: HTMLElement,
    public track: Track,
    private callbacks: Callbacks,
  ) {
    const DEV = this.developer;
    element.innerHTML = `
  <div id="loading" class="loading" role="status" aria-live="polite" aria-busy="true"><div class="brand">APEX<span>FORMULA</span></div><p id="loadingSession" class="loading-session" hidden></p><div class="loading-progress"><div class="loading-row"><b id="loadingStage">Loading</b><span id="loadingPercent">0%</span></div><div class="loader" id="loadingBar" role="progressbar" aria-label="Loading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div></div><p id="loadingText" class="loading-detail"${DEV ? '' : ' hidden'}>Preparing circuit and car systems…</p><p id="loadingTip" class="loading-tip"><b>TIP</b> ${LOADING_TIPS[0]}</p></div>
  <section id="menu" class="menu" hidden>
   <header class="masthead"><div class="brand">APEX<span>FORMULA</span></div><span class="edition">DRIVER <b id="menuDriver">${escapeHtml(this.playerName.toUpperCase())}</b></span></header>
   <div class="menu-body" tabindex="0" role="region" aria-label="Race setup and tools"><div class="eyebrow"><i></i> <span id="circuitEyebrow">AUREL · GRAND CIRCUIT</span></div><h1>EVERY INPUT.<br>EVERY FORCE.</h1><p class="intro">Four contact patches. One racing line.<br>Find the limit between them.</p>
   <form id="sessionForm" class="session-form">
    <div class="form-row"><label>CIRCUIT<select id="circuit">${CIRCUIT_IDS.map((id) => `<option value="${id}">${CIRCUIT_MENU_LABELS[id]}</option>`).join('')}</select></label></div>
    <div class="form-row"><label>SESSION<select id="mode"><option value="race">Grand Prix</option><option value="practice">Free practice</option><option value="time-trial">Time trial · ghost</option><option value="qualifying">Race weekend · qualifying</option><option value="endurance">Endurance · mandatory stop</option></select></label><label>DISTANCE<select id="laps"><option value="1">1 lap · Sprint</option><option value="3" selected>3 laps · Standard</option><option value="5">5 laps</option><option value="10">10 laps</option><option value="15">15 laps · Endurance</option><option value="25">25 laps · Endurance</option></select></label></div>
    <div class="form-row"><label>WEATHER<select id="weather"><option value="clear">Clear / Dry</option><option value="changeable">Dry → Rain</option><option value="rain">Heavy rain</option></select></label><label>GRID<select id="opponents"><option value="0">Solo</option><option value="3">4 cars</option><option value="7" selected>8 cars</option><option value="11">12 cars</option></select></label></div>
    <div class="form-row"><label>TYRES<select id="compound"><option value="soft">Soft</option><option value="medium" selected>Medium</option><option value="hard">Hard</option><option value="intermediate">Intermediate</option><option value="wet">Full wet</option></select></label><label>ASSISTS<select id="assist"><option value="sport">ABS + TC</option><option value="raw">Off</option></select></label></div>
    <div class="form-row"><label>START<select id="startSlot"><option value="pole" selected>Pole position</option><option value="midfield">Mid-field</option><option value="back">Back of the grid</option></select></label><label>MACHINE<select id="vehicle"><option value="apx01" selected>APX-01 Formula</option><option value="tc1">TC-1 Touring · front drive</option><option value="mixed">Mixed exhibition · Formula + Touring</option></select></label></div>
    <p class="session-rules" id="sessionRules" aria-live="polite"></p>
    <button class="primary enter" type="submit">ENTER CIRCUIT <span aria-hidden="true">↗</span></button>
    <button class="enter" type="submit" name="prepareGrid" value="yes">PREPARE GRID <span>START PAUSED</span></button>
   </form><div class="menu-actions" role="group" aria-label="Paddock"><button data-action="settings">GARAGE & SETTINGS</button><button data-action="championship">CHAMPIONSHIP</button><button data-action="team">TEAM HQ</button><button data-action="academy">DRIVING ACADEMY</button><button data-action="photo">PHOTO / LIVERY</button><button data-action="controls">CONTROLS</button></div>${
     DEV
       ? '<div class="dev-tools" role="group" aria-label="Developer tools"><span>DEV</span><button data-action="references">REFERENCE REVIEW</button><button data-action="sessionReview">SESSION 146 EVIDENCE</button></div>'
       : ''
   }</div>
   <div class="car-label"><span>APX–01</span><b>FORMULA / HYBRID</b><div>770 KG DRY · 8 SPEED · 4 MJ ERS</div></div>
   <footer class="menu-footer"><span><b id="circuitLength">${(track.length / 1000).toFixed(3)}</b> KM</span><span><b id="circuitTurns">${track.circuit.corners.length}</b> TURNS</span><span><b id="circuitDrs">${track.circuit.drsZones.length}</b> DRS ${track.circuit.drsZones.length === 1 ? 'ZONE' : 'ZONES'}</span><span class="menu-hint"><kbd>WASD</kbd> / <kbd>ARROWS</kbd> DRIVE · <kbd>G</kbd> AI DRIVER · GAMEPAD READY</span><span id="buildIdentity"${DEV ? '' : ' hidden'}>DEV BUILD</span></footer>
  </section>
  <section id="hud" class="hud" hidden>
   <div class="hud-top"><div class="brand small">APEX<span>LIVE</span></div><div class="position-badge" role="status" aria-label="Race position"><b id="positionBadge">P1</b><span id="positionField">/ 1</span></div><div class="session-status"><span id="lapLabel">LAP 1 / 3</span><b id="flag">GRID</b><span id="weatherLabel">24°C / DRY</span></div><button class="icon-button" data-action="pause" aria-label="Pause session">Ⅱ</button></div>
   <aside class="timing" tabindex="0" aria-label="Live race classification"><div class="panel-heading">CLASSIFICATION <span id="towerColumn">INTERVAL</span></div><div id="tower"></div></aside>
   <div class="lap-panel"><label class="lap-delta"><i id="lapDeltaLabel">DELTA TO BEST</i><span id="lapDelta">—</span></label><label class="lap-current">CURRENT LAP<b id="lapTime">—:——.———</b></label><label>PERSONAL BEST<span id="bestLap">—:——.———</span></label><label>LAST LAP<span id="lastLap">—:——.———</span></label></div>
   <div id="startSequence" class="start-sequence" hidden><div id="lights">${'<i></i>'.repeat(5)}</div><span id="startText">BUILD REVS. HOLD THE BRAKE.</span></div>
   <div class="proximity proximity-left" id="proximityLeft" hidden><b>◀</b><span>CAR LEFT</span></div><div class="proximity proximity-right" id="proximityRight" hidden><b>▶</b><span>CAR RIGHT</span></div>
   <div class="race-message" id="raceMessage" role="status" aria-live="polite"></div>
   <div class="minimap"><canvas id="minimap" width="250" height="240"></canvas><span id="minimapCaption">${track.circuit.name}</span></div>
   <div class="instruments"><div class="programme-hud" id="programmeHud" hidden></div><div class="guide-readout" id="guideReadout" hidden></div><div class="rev-lights" id="rpmLights">${'<i></i>'.repeat(15)}</div><div class="dash-main"><div class="gear"><b id="gear">1</b><span>GEAR</span></div><div class="speed"><b id="speed">0</b><span>KPH</span></div><div class="engine"><b id="rpm">4200</b><span>RPM</span><strong id="ersMode">BALANCED</strong></div></div>
   <div class="pedals"><label>BRK<span class="meter"><i id="brakeBar"></i></span></label><label>THR<span class="meter"><i id="throttleBar"></i></span></label></div>
   <div class="resources"><label>ERS <b id="battery">80%</b><span class="meter"><i id="batteryBar"></i></span></label><label>FUEL <b id="fuel">24.0 KG</b></label></div></div>
   <aside class="car-status"><div class="panel-heading">VEHICLE STATE <span id="tireCompound">MEDIUM</span></div><div id="tires" class="tires">${WHEEL_NAMES.map((name) => `<div><label>${name}</label><b>87°</b><span>100%</span><small>320° BRAKE</small></div>`).join('')}</div><div class="health"><span>AERO <b id="health">100%</b></span><span>LAT <b id="lateralG">0.0 G</b></span><span>PEN <b id="penalty">0 S</b></span></div></aside>
   <nav class="hud-actions"><button data-action="camera"><kbd>C</kbd> <span id="cameraLabel">CHASE</span></button><button data-action="pit"><kbd>P</kbd> PIT</button><button data-action="ers"><kbd>E</kbd> ERS</button><button data-action="telemetry"><kbd>T</kbd> DATA</button><button data-action="replay"><kbd>R</kbd> REPLAY</button><button data-action="autopilot"><kbd>G</kbd> <span id="autoLabel">AI OFF</span></button></nav>
   <div class="touch-controls"><button data-touch="left" aria-label="Steer left">◀</button><button data-touch="right" aria-label="Steer right">▶</button><button data-touch="brake">BRAKE</button><button data-touch="throttle">THROTTLE</button></div>
  </section>
  <div id="replayBar" class="replay-bar" hidden><span class="replay-tag">REPLAY</span><button data-action="replayPlay" id="replayPlay">PAUSE</button><span id="replayTime">0:00</span><input id="replaySeek" type="range" min="0" max="1" step=".01" value="0" aria-label="Replay position"><select id="replaySpeed" aria-label="Replay playback speed"><option value=".25">¼×</option><option value=".5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select><button data-action="camera">CAMERA</button><button data-action="photo">PHOTO STUDIO</button><button data-action="replayExit">RETURN</button></div>
  <div id="debug" class="debug" hidden></div><div id="toast" class="toast" role="status" hidden></div>
  <dialog id="modal"><div id="modalContent"></div></dialog>
  <dialog id="telemetryModal" class="telemetry-modal"><header><div><span class="eyebrow">ENGINEERING / DATA</span><h2>Telemetry</h2></div><button data-action="telemetryClose" aria-label="Close telemetry">✕</button></header><label class="telemetry-selector">CHANNEL GROUP<select id="telemetryView" aria-label="Telemetry channels">${Object.entries(
    TELEMETRY_VIEWS,
  )
    .map(([key, view]) => `<option value="${key}">${view.title}</option>`)
    .join(
      '',
    )}</select></label><canvas id="graph" width="1100" height="590" role="img"></canvas><div class="telemetry-actions"><button data-action="compare">COMPARE LAPS</button><button data-action="csv">EXPORT CSV</button><span>SI UNITS · RECORDED THIS SESSION</span></div></dialog>
  `;
    this.menu = this.get('menu');
    this.hud = this.get('hud');
    this.modal = this.get('modal') as HTMLDialogElement;
    this.map = this.get('minimap') as HTMLCanvasElement;
    this.graph = this.get('graph') as HTMLCanvasElement;
    this.replayBar = this.get('replayBar');
    installCompactRaceHud(this.hud);
    installRaceDayHud(this.hud);
    this.f1 = installF1Hud(this.hud);
    installSpeedTunnel(element.ownerDocument);
    this.trackMap = new TrackMap(this.map);
    element.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (button) this.callbacks.action(button.dataset.action!);
    });
    // Preserve the browser's scrolling/focus behavior without delivering scroll
    // navigation keys to the window-level driving shortcuts. Keyup still releases
    // previously held driving input; controls retain their native key handling.
    const menuBody = this.menu.querySelector<HTMLElement>('.menu-body')!;
    menuBody.addEventListener('keydown', (event) => {
      if (
        event.target === menuBody &&
        ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)
      )
        event.stopPropagation();
    });
    // Native standings scrolling must not also steer the car through window
    // keydown listeners. Keyup still propagates to release any held drive input.
    this.element.querySelector('.timing')!.addEventListener('keydown', (event) => {
      if (
        ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(
          (event as KeyboardEvent).key,
        )
      )
        event.stopPropagation();
    });
    this.modal.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.callbacks.action('modalClose');
    });
    this.telemetryModal.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.callbacks.action('telemetryClose');
    });
    this.get('sessionForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const select = (id: string) => (this.get(id) as HTMLSelectElement).value;
      this.options = {
        ...DEFAULT_OPTIONS,
        circuit: select('circuit') as CircuitId,
        mode: select('mode') as SessionOptions['mode'],
        laps: Number(select('laps')),
        opponents: select('mode') === 'time-trial' ? 0 : Number(select('opponents')),
        weather: select('weather') as SessionOptions['weather'],
        compound: select('compound') as SessionOptions['compound'],
        assist: select('assist') as SessionOptions['assist'],
      };
      // Races and endurance start from the chosen slot; timed sessions ignore it.
      if (racingSession(this.options.mode)) {
        const grid = startingGrid(this.options.opponents + 1, select('startSlot') as StartSlot);
        if (grid) this.options.grid = grid;
      }
      Object.assign(this.options, machineOptions(this.options, select('vehicle')));
      // Reject incompatible machine/ruleset/tyre combinations with reasons.
      const problems = sessionIncompatibilities(validateOptions(this.options));
      if (problems.length) {
        this.get('sessionRules').textContent = `Cannot start: ${problems.join('; ')}.`;
        return;
      }
      // Preparation is presentation/session control, not a physics option or save.
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      this.callbacks.start(this.options, submitter?.name === 'prepareGrid');
    });
    const describeRules = () => {
      const select = (id: string) => (this.get(id) as HTMLSelectElement).value;
      const options = validateOptions({
        ...DEFAULT_OPTIONS,
        mode: select('mode') as SessionOptions['mode'],
        opponents: Number(select('opponents')),
        compound: select('compound') as SessionOptions['compound'],
      });
      const resolved = { ...options, ...machineOptions(options, select('vehicle')) };
      const rules = rulesetFor(resolved),
        problems = sessionIncompatibilities(validateOptions(resolved));
      this.get('sessionRules').textContent = problems.length
        ? `Unavailable: ${problems.join('; ')}.`
        : `${rules.name}: ${rules.tires.mandatoryCompoundChange ? 'two dry compounds required' : 'no mandatory stop'} · DRS ${rules.drs ? 'on' : 'off'} · ${rules.points.length ? 'points scored' : 'no points'}.`;
    };
    for (const id of ['mode', 'vehicle', 'compound', 'opponents'])
      this.get(id).addEventListener('change', describeRules);
    describeRules();
    this.get('weather').addEventListener('change', () => {
      if ((this.get('weather') as HTMLSelectElement).value === 'rain')
        (this.get('compound') as HTMLSelectElement).value = 'wet';
    });
    // Time Trial is solo and open-ended: the field and distance do not apply.
    this.get('mode').addEventListener('change', () => {
      const mode = (this.get('mode') as HTMLSelectElement).value,
        laps = this.get('laps') as HTMLSelectElement,
        trial = mode === 'time-trial';
      (this.get('opponents') as HTMLSelectElement).disabled = trial;
      (this.get('startSlot') as HTMLSelectElement).disabled = !racingSession(
        mode as SessionOptions['mode'],
      );
      laps.disabled = trial;
      // Endurance distances apply only to endurance; other races stop at 10.
      if (mode === 'endurance' && Number(laps.value) < 15) laps.value = '15';
      else if (mode !== 'endurance' && Number(laps.value) > 10) laps.value = '10';
    });
    this.get('replaySeek').addEventListener('input', (e) =>
      this.callbacks.seek(Number((e.target as HTMLInputElement).value)),
    );
    this.get('replaySpeed').addEventListener('change', (e) =>
      this.callbacks.replaySpeed(Number((e.target as HTMLSelectElement).value)),
    );
  }
  get(id: string) {
    let node = this.nodes.get(id);
    if (!node || !node.isConnected) {
      node = document.getElementById(id) ?? undefined;
      if (!node) throw new Error(`Missing UI element: ${id}`);
      this.nodes.set(id, node);
    }
    return node;
  }
  get telemetryModal() {
    return this.get('telemetryModal') as HTMLDialogElement;
  }
  /** Show the loading screen. Raw engineering messages become a player-facing
   * stage title and a monotonic progress bar; the raw text is developer-only. */
  loading(text: string) {
    const screen = this.get('loading');
    if (screen.hidden) {
      // A new load: restart the bar and show the next tip.
      this.loadingProgress = 0;
      this.loadingTipIndex = (this.loadingTipIndex + 1) % LOADING_TIPS.length;
      this.get('loadingTip').innerHTML =
        `<b>TIP</b> ${escapeHtml(LOADING_TIPS[this.loadingTipIndex])}`;
    }
    const stage = loadingStage(text, this.loadingProgress);
    this.loadingProgress = Math.max(this.loadingProgress, stage.fraction);
    const percent = Math.round(this.loadingProgress * 100);
    this.setText('loadingStage', stage.title);
    this.setText('loadingPercent', `${percent}%`);
    const bar = this.get('loadingBar');
    bar.style.setProperty('--progress', String(this.loadingProgress));
    bar.setAttribute('aria-valuenow', String(percent));
    bar.setAttribute('aria-valuetext', `${stage.title}, ${percent}%`);
    this.get('loadingText').textContent = text;
    screen.hidden = false;
    screen.setAttribute('aria-busy', 'true');
  }
  /** Session context line on the loading screen (null hides it). */
  loadingSession(options: SessionOptions | null) {
    const line = this.get('loadingSession');
    line.hidden = !options;
    if (!options) return;
    const timed = options.mode === 'time-trial' || options.mode === 'practice';
    const weather = { clear: 'Dry', changeable: 'Changeable', rain: 'Wet' }[options.weather];
    line.textContent = [
      SESSION_TITLES[options.mode],
      circuitTitle(circuitDefinition(options.circuit).id),
      options.mode === 'qualifying' || timed
        ? ''
        : `${options.laps} ${options.laps === 1 ? 'lap' : 'laps'}`,
      options.mode === 'time-trial' ? '' : `${options.opponents + 1} cars`,
      weather,
    ]
      .filter(Boolean)
      .join('  ·  ');
  }
  ready() {
    const screen = this.get('loading');
    screen.hidden = true;
    screen.setAttribute('aria-busy', 'false');
    this.menu.hidden = false;
  }
  toast(message: string) {
    const e = this.get('toast');
    e.textContent = message;
    e.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (e.hidden = true), 6000);
  }
  showMode(
    mode: 'menu' | 'driving' | 'paused' | 'results' | 'replay' | 'loading' | 'photo' | 'pregame',
  ) {
    this.menu.hidden = mode !== 'menu';
    this.hud.hidden =
      mode === 'menu' || mode === 'loading' || mode === 'photo' || mode === 'pregame';
    this.get('debug').hidden ||= mode === 'photo';
    this.replayBar.hidden = mode !== 'replay';
    this.element.dataset.mode = mode;
  }
  setText(id: string, value: string) {
    writeText(this.get(id), value);
  }
  private observeGaps(frame: Float32Array) {
    const cars = frame[H.CARS];
    if (!this.gaps || this.gaps.cars !== cars || this.gaps.length !== this.track.length) {
      this.gaps = new GapTimer(this.track.length, cars);
      this.gapPositions = new Float64Array(cars);
      this.towerRefresh = -Infinity;
      this.sectors = Number.isInteger(cars) && cars > 0 ? new SectorBoard(cars) : null;
    }
    for (let id = 0; id < cars; id++) this.gapPositions[id] = frame[carBase(id) + F.S];
    this.gaps.observe(frame[H.TIME], this.gapPositions);
    this.sectors?.observe(frame);
  }
  update(frame: Float32Array, renderer: RacingRenderer, auto: boolean, ers: number) {
    this.lastFrame = frame;
    const proximity = nearbyTraffic(frame);
    for (const side of ['left', 'right'] as const) {
      const node = this.get(side === 'left' ? 'proximityLeft' : 'proximityRight');
      node.hidden = proximity[side] === 'clear';
      node.dataset.proximity = proximity[side];
    }

    this.hud.dataset.camera = renderer.mode;
    // Timing loops and name tags see every presented frame; the panels below
    // refresh at a third of the rate.
    this.observeGaps(frame);
    const mode = this.element.dataset.mode;
    const banner = this.f1.observe(frame, auto);
    this.f1.nameTags(frame, renderer, mode === 'driving' || mode === 'paused');
    this.tick++;
    if (this.tick % 3 !== 0) return;
    const o = carBase(0),
      speed = frame[o + F.SPEED],
      compound = Object.keys(COMPOUNDS)[Math.round(frame[o + F.COMPOUND])] ?? 'medium';
    this.setText('speed', String(Math.round(speed * 3.6)));
    const gear = frame[o + F.GEAR];
    this.setText('gear', gear === 0 ? 'N' : gear < 0 ? 'R' : String(Math.round(gear)));
    this.setText('rpm', String(Math.round(frame[o + F.RPM])));
    this.setText(
      'lapLabel',
      racingSession(this.options.mode)
        ? `${this.options.mode === 'endurance' ? 'ENDURANCE / ' : ''}LAP ${Math.min(this.options.laps, Math.round(frame[o + F.LAPS]) + 1)} / ${this.options.laps}`
        : this.options.mode === 'qualifying'
          ? `QUALIFYING / ${
              frame[o + F.FINISH] > 0
                ? 'COMPLETE'
                : frame[o + F.LAP_TIME] > 0
                  ? `LAP ${Math.min(QUALIFYING_TIMED_LAPS, Math.round(frame[o + F.LAPS]) + 1)} / ${QUALIFYING_TIMED_LAPS}`
                  : 'OUT LAP'
            }`
          : `${this.options.mode === 'time-trial' ? 'TIME TRIAL' : 'PRACTICE'} / LAP ${Math.round(frame[o + F.LAPS]) + 1}`,
    );
    const flag = frame[H.PHASE] < 2 ? 'GRID' : flagLabel(frame[H.FLAG]);
    // Time Trial compares against the saved personal-best ghost when one exists.
    const trial = this.options.mode === 'time-trial' ? this.timeTrial : null;
    const deltaValid = trial ? trial.delta !== null : frame[o + F.DELTA_VALID] > 0;
    const delta = trial ? (trial.delta ?? 0) : frame[o + F.LAP_DELTA];
    this.setText('lapDeltaLabel', trial?.best ? 'DELTA TO PB' : 'DELTA TO BEST');
    this.setText('lapDelta', deltaValid ? `${delta >= 0 ? '+' : ''}${delta.toFixed(3)} S` : '—');
    this.get('lapDelta').dataset.ahead = deltaValid ? String(delta < 0) : 'none';
    this.setText('flag', flag);
    this.get('flag').dataset.flag = String(frame[H.FLAG]);
    this.setText('weatherLabel', weatherReadout(frame[H.AMBIENT], frame[H.RAIN], frame[H.WATER]));
    for (const [id, field] of [
      ['lapTime', F.LAP_TIME],
      ['bestLap', F.BEST_LAP],
      ['lastLap', F.LAST_LAP],
    ] as const)
      this.setText(id, lapTime(frame[o + field]));
    if (trial?.best && !(frame[o + F.BEST_LAP] > 0 && frame[o + F.BEST_LAP] < trial.best))
      this.setText('bestLap', lapTime(trial.best));
    this.setText('battery', `${Math.round(frame[o + F.BATTERY] / 4e4)}%`);
    this.setText('fuel', `${frame[o + F.FUEL].toFixed(1)} KG`);
    updateRaceDayHud(this.hud, frame);
    writeWidth(this.get('brakeBar'), `${(frame[o + F.BRAKE] * 100).toFixed(1)}%`);
    writeWidth(this.get('throttleBar'), `${(frame[o + F.THROTTLE] * 100).toFixed(1)}%`);
    writeWidth(this.get('batteryBar'), `${(frame[o + F.BATTERY] / 4e4).toFixed(1)}%`);
    const ersMode = ['HARVEST', 'BALANCED', 'ATTACK'][ers] ?? 'BALANCED';
    this.setText('ersMode', ersMode);
    this.get('ersMode').dataset.mode = ersMode;
    this.setText('tireCompound', compound.toUpperCase());
    this.setText('autoLabel', auto ? 'AI ON' : 'AI OFF');
    this.setText('cameraLabel', renderer.mode.toUpperCase());
    this.setText('health', `${Math.round(frame[o + F.FRONT_HEALTH] * 100)}%`);
    this.setText('lateralG', `${Math.abs(frame[o + F.G_LAT]).toFixed(1)} G`);
    this.setText('penalty', `${Math.round(frame[o + F.PENALTY])} S`);
    // Rev lights: 15 LEDs up to the shift point; every LED flashes blue at
    // the limiter (8 Hz) and with the pit limiter on (2 Hz), on sim time.
    const rpm = frame[o + F.RPM],
      lights = this.get('rpmLights'),
      pitPhase = Math.round(frame[o + F.PIT_PHASE]),
      pitLimiter = frame[o + F.IN_PIT] > 0 && (pitPhase === 1 || pitPhase === 6),
      limiter = pitLimiter || rpm >= VEHICLE.limiterRPM - 60,
      blinkOn = Math.floor(frame[H.TIME] * (pitLimiter ? 4 : 16)) % 2 === 0;
    lights.dataset.limiter = limiter ? 'on' : 'off';
    Array.from(lights.children).forEach((e, i) => {
      (e as HTMLElement).classList.toggle('lit', limiter ? blinkOn : rpm > this.revThresholds[i]);
    });
    Array.from(this.get('tires').children).forEach((e, i) => {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE,
        temp = frame[p + W.CARCASS_TEMP];
      writeText(e.querySelector('b')!, `${Math.round(temp)}°`);
      writeText(e.querySelector('span')!, `${Math.round(100 * (1 - frame[p + W.WEAR]))}%`);
      writeText(e.querySelector('small')!, `${Math.round(frame[p + W.DISC_TEMP])}° BRAKE`);
      const band = tyreBand(temp);
      if ((e as HTMLElement).style.getPropertyValue('--tire') !== band)
        (e as HTMLElement).style.setProperty('--tire', band);
    });
    this.get('startSequence').hidden = frame[H.PHASE] !== 1;
    Array.from(this.get('lights').children).forEach((e, i) =>
      e.classList.toggle('lit', i < frame[H.LIGHTS]),
    );
    // Race control: one message for the polite live region; the F1 layout
    // shows it as a 4 s banner (flags stay as a compact chip while they apply).
    const message = banner?.text ?? '';
    if (message !== this.lastAnnounced) {
      this.setText('raceMessage', message);
      this.lastAnnounced = message;
    }
    const tower = this.get('tower');
    const cars = frame[H.CARS];
    if (tower.children.length !== cars) {
      this.hud.style.setProperty('--grid-rows', String(cars));
      tower.innerHTML = Array.from(
        { length: cars },
        () =>
          '<div class="tower-row"><b></b><i></i><span></span><small></small><em></em><u></u></div>',
      ).join('');
    }
    const order = Array.from({ length: cars }, (_, id) => id).sort(
      (a, b) => frame[carBase(a) + F.RANK] - frame[carBase(b) + F.RANK],
    );
    const playerRank = order.indexOf(0);
    this.setText('positionBadge', `P${playerRank + 1}`);
    this.setText('positionField', `/ ${cars}`);
    // Broadcast towers refresh intervals a few times a second, not every frame.
    const racing = racingSession(this.options.mode);
    const refresh = frame[H.TIME] < this.towerRefresh || frame[H.TIME] - this.towerRefresh >= 0.5;
    if (refresh) {
      this.towerRefresh = frame[H.TIME];
      this.setText('towerColumn', racing ? 'INTERVAL' : 'BEST LAP');
    }
    // Five rows around the player while driving; focus expands the full list.
    const [first, end] = towerWindow(playerRank, cars);
    const fastest = fastestLapCar(frame);
    // Timed sessions: the fastest lap in full, everyone else as the gap to it.
    const poleBest = fastest >= 0 ? frame[carBase(fastest) + F.BEST_LAP] : 0;
    order.forEach((id, rank) => {
      const e = tower.children[rank] as HTMLElement,
        p = carBase(id);
      e.classList.toggle('player', id === 0);
      const slot = rank < first || rank >= end ? 'out' : rank === end - 1 ? 'last' : 'in';
      if (e.dataset.window !== slot) e.dataset.window = slot;
      e.toggleAttribute('data-fastest', id === fastest);
      e.querySelector('b')!.textContent = String(rank + 1);
      (e.querySelector('i') as HTMLElement).style.background =
        id === 0
          ? `#${renderer.cars[0].paint.color.getHexString()}`
          : `#${LIVERIES[id].toString(16).padStart(6, '0')}`;
      const name = id === 0 ? this.playerName : DRIVERS[id];
      const label = e.querySelector('span')!;
      if (label.title !== name) {
        label.title = name;
        label.textContent = surname(name);
      }
      const compound = compoundOf(frame, id);
      const tyre = e.querySelector('em')!;
      if (tyre.dataset.c !== compound) {
        tyre.dataset.c = compound;
        tyre.textContent = compound[0].toUpperCase();
        tyre.title = compound;
        tyre.style.setProperty('--tyre', `var(--tyre-${compound})`);
      }
      if (!refresh) return;
      const ahead = order[rank - 1];
      const best = frame[p + F.BEST_LAP];
      const gap = e.querySelector('small')!;
      // Time penalties ride on the interval cell as an orange "+5S" chip.
      const penalty = Math.round(frame[p + F.PENALTY]);
      const chip = penalty > 0 ? `+${penalty}S` : '';
      if ((gap.dataset.penalty ?? '') !== chip) {
        if (chip) gap.dataset.penalty = chip;
        else delete gap.dataset.penalty;
      }
      gap.textContent =
        frame[p + F.RETIRED] > 0
          ? 'DNF'
          : frame[p + F.FINISH] > 0
            ? 'FIN'
            : frame[p + F.IN_PIT]
              ? 'PIT'
              : !racing
                ? timedGap(best, poleBest, id === fastest)
                : rank === 0
                  ? 'LEADER'
                  : formatInterval(
                      this.gaps!.interval(ahead, id),
                      this.gaps!.lapsBetween(ahead, id),
                    );
    });
    this.f1.update({
      frame,
      trackLength: this.track.length,
      mode: this.options.mode,
      laps: this.options.laps,
      order,
      sectors: this.sectors,
      ers,
      auto,
      delta: deltaValid ? delta : null,
      bestKnown: frame[o + F.BEST_LAP] > 0 || (trial?.best ?? 0) > 0,
      deltaShown: deltaValid && !racing,
    });
    this.drawMap(frame);
    this.get('debug').hidden = !renderer.debug;
    if (renderer.debug) {
      this.get('debug').textContent = engineeringReport(
        frame,
        renderer.stats(),
        renderer.engineering,
        renderer.replayView,
      );
    }
  }
  /** Replace the displayed circuit (menu captions, length and minimap). */
  setTrack(track: Track) {
    this.track = track;
    const name = track.circuit.name;
    this.get('minimapCaption').textContent = name;
    this.get('circuitEyebrow').textContent = name.replace(' / ', ' · ');
    this.get('circuitLength').textContent = (track.length / 1000).toFixed(3);
    this.get('circuitTurns').textContent = String(track.circuit.corners.length);
    const zones = track.circuit.drsZones.length;
    this.get('circuitDrs').textContent = String(zones);
    this.get('circuitDrs').nextSibling!.textContent = ` DRS ${zones === 1 ? 'ZONE' : 'ZONES'}`;
    (this.get('circuit') as HTMLSelectElement).value = track.circuit.id;
    this.mapFrame = minimapFrame(track);
  }
  private mapFrame: ReturnType<typeof minimapFrame> | null = null;
  private drawMap(frame: Float32Array) {
    this.trackMap.draw(frame, this.track, (this.mapFrame ??= minimapFrame(this.track)));
  }
  gridPresentationAvailable = false;
  pause() {
    const developer = this.developer
      ? '<div class="dev-tools" role="group" aria-label="Developer tools"><span>DEV</span><button data-action="performance">PERFORMANCE CAPTURE</button><button data-action="visualReview">FULL-LAP VISUAL REVIEW</button><button data-action="sessionReview">SESSION 146 EVIDENCE</button></div>'
      : '';
    this.modalContent(
      `<div class="pause-menu"><header class="pause-head"><span class="eyebrow">PAUSED</span><h2>${SESSION_TITLES[this.options.mode] ?? 'Session'}</h2><span class="pause-circuit">${escapeHtml(circuitTitle(this.track.circuit.id))}</span></header>${this.pauseSummary()}<div class="dialog-buttons pause-actions"><button class="primary" data-action="resume">RESUME SESSION</button>${this.gridPresentationAvailable ? '<button data-action="gridPresentation">PRE-RACE PRESENTATION</button>' : ''}<button data-action="restart">RESTART SESSION</button><button data-action="settings">GARAGE & SETTINGS</button><button data-action="menu">RETURN TO PADDOCK</button></div><div class="pause-more" role="group" aria-label="More options"><button data-action="camera">CHANGE CAMERA</button><button data-action="replay">WATCH REPLAY</button><button data-action="photo">PHOTO STUDIO</button><button data-action="autopilot">AI DRIVER</button><button data-action="academy">ACADEMY</button></div>${developer}</div>`,
    );
  }
  /** Compact session context for the pause menu: position, lap, gap, tyres, conditions. */
  private pauseSummary() {
    const frame = this.lastFrame;
    if (!frame || !(frame[H.CARS] >= 1)) return '';
    const o = carBase(0),
      cars = Math.round(frame[H.CARS]);
    let position = 1;
    for (let id = 1; id < cars; id++)
      if (frame[carBase(id) + F.RANK] < frame[o + F.RANK]) position++;
    const racing = racingSession(this.options.mode);
    const lap = escapeHtml(this.get('lapLabel').textContent ?? '')
      .replace(/^(ENDURANCE|QUALIFYING|TIME TRIAL|PRACTICE) \/ /, '')
      .replace(/^LAP (\d+) \/ (\d+)$/, '$1<small>/$2</small>')
      .replace(/^LAP /, '');
    const gap = this.element.querySelector('.tower-row.player small')?.textContent?.trim() || '—';
    const compound = Object.keys(COMPOUNDS)[Math.round(frame[o + F.COMPOUND])] ?? 'medium';
    let life = 0;
    for (let i = 0; i < 4; i++) life += 1 - frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.WEAR];
    const cells: [string, string][] = [
      ['POSITION', cars > 1 ? `P${position}<small>/${cars}</small>` : 'SOLO'],
      ['LAP', lap || '—'],
      racing
        ? ['INTERVAL', escapeHtml(position === 1 ? 'LEADER' : gap)]
        : ['BEST LAP', lapTime(frame[o + F.BEST_LAP])],
      [
        'TYRES',
        `<i class="tyre-dot" style="--tyre: var(--tyre-${compound})" title="${compound}">${compound[0].toUpperCase()}</i>${Math.round((100 * life) / 4)}<small>%</small>`,
      ],
      ['TRACK', conditions(frame[H.AMBIENT], frame[H.RAIN], frame[H.WATER])],
    ];
    return `<dl class="pause-summary">${cells.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  }
  performance(status: string, machine: string, workload: string, exportable: boolean) {
    this.modalContent(
      `<span class="eyebrow">MEASURE / COMPARE</span><h2>Performance capture.</h2>
       <p id="profileStatus"></p><p>Resume this session, warm up for 5 seconds, then record 30 seconds of real frames. Slow frames are retained. Pausing, changing the view or resizing interrupts the run.</p>
       <label>COMPUTER / POWER PROFILE<input id="profileMachine" maxlength="80" placeholder="e.g. desktop-plugged-in" /></label>
       <label>REPEATABLE WORKLOAD<input id="profileWorkload" maxlength="120" placeholder="e.g. same seed, new practice, AI, cockpit" /></label>
       <p>These labels are your declaration that the hardware and workload match. They are not detected or verified by the browser. Export contains frame timings and browser/configuration details; it is not uploaded.</p>
       <div class="dialog-buttons"><button class="primary" data-action="profileStart">RESUME & CAPTURE</button><button data-action="profileExport" ${exportable ? '' : 'disabled'}>EXPORT PERFORMANCE JSON</button><button data-action="modalClose">BACK</button></div>`,
    );
    this.get('profileStatus').textContent = status;
    (this.get('profileMachine') as HTMLInputElement).value = machine;
    (this.get('profileWorkload') as HTMLInputElement).value = workload;
  }
  sessionReview(status: string, active: boolean, atMenu: boolean, exportable: boolean) {
    this
      .modalContent(`<span class="eyebrow">PHASE 27F / WHOLE SESSION</span><h2>Section 146 observations.</h2>
      <p id="sessionReviewStatus"></p><p>Arm from the paddock before choosing a race. Drive the complete master scenario, finish, view results, watch replay and inspect telemetry. This observes the real application states and worker snapshots; it never drives or modifies the simulation.</p>
      <label>REVIEWER<input id="sessionReviewer" maxlength="80" /></label><label>COMPUTER / POWER PROFILE<input id="sessionReviewMachine" maxlength="80" /></label>
      <p>At most 2 samples/second, 14,400 snapshots and 4,096 events. Autopilot, restarts, visibility loss and mid-race pauses remain explicit. These snapshots are not every physics tick or an audiovisual recording. The separate direct-to-file tab recorder includes the actual HTML HUD and optional tab audio from when you start it. Retain an external uninterrupted recording for application launch. All Section 146 perceptual and human acceptance remains unverified.</p>
      <div class="dialog-buttons"><button data-action="sessionReviewStart" ${!active && atMenu ? '' : 'disabled'}>ARM FROM PADDOCK</button><button data-action="sessionReviewStop" ${active ? '' : 'disabled'}>STOP OBSERVATIONS</button><button data-action="sessionReviewExport" ${exportable ? '' : 'disabled'}>EXPORT SESSION JSON</button><button data-action="sessionReview">REFRESH STATUS</button><button data-action="modalClose">BACK</button></div>`);
    this.get('sessionReviewStatus').textContent = status;
  }
  presentationReview(status: string, machine: string, exportable: boolean, videoReady: boolean) {
    this
      .modalContent(`<span class="eyebrow">PHASE 27F / EVIDENCE</span><h2>Review the complete lap.</h2>
      <p id="visualReviewStatus"></p>
      <p>Use the current session and camera. A full lap ends only after a complete forward circuit traversal and a real lap-counter increase. Timed scenes last at least 30 seconds. Racing workloads also require observed events: a populated start, five seconds beside the same rival, three seconds behind a moving car in wet spray, or pit entry through jacked service and exit. A label or timer alone cannot complete them.</p>
      <label>COMPUTER / POWER PROFILE<input id="reviewMachine" maxlength="80" placeholder="e.g. laptop-plugged-in / GPU model" /></label>
      <label>WORKLOAD<select id="reviewWorkload"><option value="clear-day">Clear day</option><option value="overcast-day">Overcast day</option><option value="wet-day">Wet day</option><option value="wet-night">Wet night</option><option value="sunset">Sunset</option><option value="grid-start">Grid start</option><option value="pit-service">Pit entry, service and exit</option><option value="close-racing">Close racing</option><option value="wet-following">Wet following with emitted spray</option><option value="other">Other / changing weather</option></select></label>
      <label>CAPTURE<select id="reviewMode"><option value="full-lap">Full lap</option><option value="timed-scene">Timed scene (30 seconds minimum)</option></select></label>
      <label><input id="reviewVideo" type="checkbox" /> ALSO RECORD LOCAL VIDEO (64 MiB maximum)</label>
      <label><input id="reviewAudio" type="checkbox" /> INCLUDE GAME AUDIO (not microphone audio)</label>
      <p>Repeat clear, overcast, wet and wet-night sessions with cockpit, chase, pod and broadcast cameras. Choose the weather label matching the actual session; this tool never changes weather or drives the car. Changing settings, pausing or losing focus interrupts the evidence. Video adds encoding cost and can coalesce frames; JSON retains every observed rendered-frame interval. The local export includes browser-reported platform/GPU strings, available JavaScript heap size, and controller-axis ranges (no typed text or microphone). Missing values stay unmeasured. No GPU VRAM or physical-controller certification is inferred.</p>
      <div class="dialog-buttons"><button class="primary" data-action="reviewStart">RESUME & RECORD REVIEW</button><button data-action="reviewExport" ${exportable ? '' : 'disabled'}>EXPORT FRAME JSON</button><button data-action="reviewVideoExport" ${videoReady ? '' : 'disabled'}>EXPORT WEBM</button><button data-action="visualReview">REFRESH EVIDENCE STATUS</button><button data-action="modalClose">BACK</button></div>`);
    this.get('visualReviewStatus').textContent = status;
    (this.get('reviewMachine') as HTMLInputElement).value = machine;
  }
  controls(bindings: Bindings) {
    this.modalContent(
      `<span class="eyebrow">DRIVER BRIEFING</span><h2>Take control.</h2><div class="control-grid">${Object.entries(
        bindings,
      )
        .map(
          ([action, code]) =>
            `<b>${keyName(code)}</b><span>${BINDING_LABELS[action as BindingAction]}</span>`,
        )
        .join(
          '',
        )}<b>ESC</b><span>Pause / release mouse look</span><b>DOUBLE CLICK</b><span>Cockpit mouse look</span></div><p>Gamepad: left stick steers, triggers for throttle and brake, shoulder buttons shift, Y changes camera, X cycles energy mode and Start pauses. Remap any control or set up a wheel in Garage &amp; Settings.</p><button class="primary" data-action="modalClose">UNDERSTOOD</button>`,
    );
  }
  modalContent(html: string) {
    this.bindingCapture?.abort();
    this.bindingCapture = null;
    this.deviceCalibration?.dispose();
    this.deviceCalibration = null;
    this.get('modalContent').innerHTML = html;
    if (!this.modal.open) this.modal.showModal();
  }
  closeModal() {
    this.bindingCapture?.abort();
    this.bindingCapture = null;
    this.deviceCalibration?.dispose();
    this.deviceCalibration = null;
    if (this.modal.open) this.modal.close();
  }
  applyBindings(bindings: Bindings) {
    this.hud.querySelectorAll<HTMLElement>('[data-action] kbd').forEach((key) => {
      const action = key.parentElement?.dataset.action as BindingAction;
      if (bindings[action]) key.textContent = keyName(bindings[action]);
    });
  }
  get telemetryView(): TelemetryView {
    const key = (this.get('telemetryView') as HTMLSelectElement).value;
    return Object.hasOwn(TELEMETRY_VIEWS, key) ? (key as TelemetryView) : 'driver';
  }
  settings(settings: Settings) {
    const descriptions: Record<keyof Setup, string> = {
      frontWing: 'Front wing',
      rearWing: 'Rear wing',
      brakeBias: 'Front brake bias',
      diffPower: 'Differential · power',
      diffCoast: 'Differential · coast',
      frontSpring: 'Front spring · N/m',
      rearSpring: 'Rear spring · N/m',
      frontARB: 'Front anti-roll · N/m',
      rearARB: 'Rear anti-roll · N/m',
      frontRide: 'Front ride height · m',
      rearRide: 'Rear ride height · m',
      frontPressure: 'Front pressure · kPa',
      rearPressure: 'Rear pressure · kPa',
      frontCamber: 'Front camber · rad',
      rearCamber: 'Rear camber · rad',
      frontToe: 'Front toe · rad',
      rearToe: 'Rear toe · rad',
    };
    const setupRows = (Object.keys(DEFAULT_SETUP) as (keyof Setup)[])
      .map((key) => {
        const [min, max] = SETUP_LIMITS[key],
          step = setupControlStep(key, settings.setup[key]);
        return `<label class="range-row">${descriptions[key]}<output>${settings.setup[key]}</output><input name="${key}" data-setup type="range" min="${min}" max="${max}" step="${step}" value="${settings.setup[key]}"></label>`;
      })
      .join('');
    this.modalContent(
      `<header><div><span class="eyebrow">GARAGE / PREFERENCES</span><h2>Make it yours.</h2></div><button data-action="modalClose" aria-label="Close settings">✕</button></header><form id="settingsForm"><div class="settings-columns"><section><h3>Presentation</h3><label>RENDER QUALITY<select name="quality"><option value="low">Low · No shadows / crowd / particles</option><option value="medium">Medium · 2× MSAA / AO / bloom</option><option value="high">High · 4× MSAA / local reflections / specular AA</option></select></label>${presentationControls(settings)}${[
        ['volume', 'Volume', 0, 1, 0.01],
        ['shake', 'Camera vibration', 0, 1, 0.01],
        ['uiScale', 'Interface scale', 0.8, 1.35, 0.05],
      ]
        .map(
          ([key, title, min, max, step]) =>
            `<label class="range-row">${title}<output>${settings[key as 'volume' | 'shake' | 'uiScale']}</output><input name="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${settings[key as 'volume' | 'shake' | 'uiScale']}"></label>`,
        )
        .join(
          '',
        )}${audioAccessibility(settings.drivingAudio)}<h3>Input mapping</h3><p class="small-note">Axis and button numbers are zero-based. Keyboard always remains available.</p><div class="mapping-grid">${[
        ['steerAxis', 'Steer axis'],
        ['throttleAxis', 'Throttle axis'],
        ['brakeAxis', 'Brake axis'],
        ['throttleButton', 'Throttle button'],
        ['brakeButton', 'Brake button'],
        ['clutchAxis', 'Clutch axis (-1: button / key)'],
        ['clutchButton', 'Clutch button (-1: key only)'],
        ['shiftUpButton', 'Upshift button (-1: disabled)'],
        ['shiftDownButton', 'Downshift button (-1: disabled)'],
      ]
        .map(
          ([key, title]) =>
            `<label>${title}<input name="${key}" type="number" min="${key.startsWith('clutch') || key.includes('Button') ? -1 : 0}" max="${key.includes('Button') ? 127 : 31}" value="${settings.mapping[key as keyof typeof settings.mapping]}"></label>`,
        )
        .join('')}</div>${[
        ['axisPedals', 'Use axes for pedals'],
        ['invertSteer', 'Invert steering axis'],
        ['invertPedals', 'Invert pedal axes'],
      ]
        .map(
          ([key, title]) =>
            `<label class="check"><input type="checkbox" name="${key}" ${settings.mapping[key as keyof typeof settings.mapping] ? 'checked' : ''}>${title}</label>`,
        )
        .join(
          '',
        )}<label class="range-row">Deadzone<output>${settings.mapping.deadzone}</output><input name="deadzone" type="range" min="0" max=".35" step=".01" value="${settings.mapping.deadzone}"></label><label class="range-row">Steering response exponent<output>${settings.mapping.exponent}</output><input name="exponent" type="range" min=".5" max="3" step=".1" value="${settings.mapping.exponent}"></label><div id="deviceCalibration"></div><h3>Controller action buttons</h3><p class="small-note">Use -1 to disable an action. Buttons cannot share an active pedal, paddle or another action. Pause/resume works from the pause menu; keyboard remains available.</p><div class="mapping-grid">${BUTTON_ACTIONS.map((action) => `<label>${BUTTON_ACTION_LABELS[action]} button<input name="action_${action}" required type="number" min="-1" max="127" step="1" value="${settings.mapping.buttonActions[action]}"></label>`).join('')}</div><h3>Keyboard bindings</h3><div class="binding-grid">${Object.entries(
        settings.bindings,
      )
        .map(
          ([action, key]) =>
            `<label>${BINDING_LABELS[action as BindingAction]}<button type="button" data-bind="${action}" data-key="${key}">${keyName(key)}</button></label>`,
        )
        .join(
          '',
        )}</div></section><section><h3>Vehicle setup</h3><p class="small-note">Physical setup changes take effect at the next session start. Rendering and audio changes apply immediately.</p>${setupRows}<div class="setup-files"><button type="button" id="exportSetup">EXPORT SETUP</button><label class="file-label">IMPORT SETUP<input id="importSetup" type="file" accept=".json,application/json" hidden></label></div></section></div><footer><button type="button" data-action="modalClose">CANCEL</button><button class="primary" type="submit">APPLY & SAVE</button></footer></form>`,
    );
    const form = document.getElementById('settingsForm') as HTMLFormElement;
    this.deviceCalibration = new DeviceCalibrationPanel(
      document.getElementById('deviceCalibration')!,
      form,
      settings.mapping,
    );
    (form.elements.namedItem('quality') as HTMLSelectElement).value = settings.quality;
    const graphics = bindPresentation(form, settings);
    form.querySelector<HTMLButtonElement>('#previewDrivingAudio')!.onclick = () =>
      this.callbacks.previewAudio?.(readDrivingAudio(form));
    form.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      const output = input.parentElement?.querySelector('output');
      if (output) output.value = input.value;
    });
    form.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((button) =>
      button.addEventListener('click', () => {
        this.bindingCapture?.abort();
        this.bindingCapture = new AbortController();
        const capture = this.bindingCapture;
        button.textContent = 'PRESS A KEY · ESC CANCELS';
        capture.signal.addEventListener(
          'abort',
          () => {
            button.textContent = keyName(button.dataset.key!);
          },
          { once: true },
        );
        const listener = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.code === 'Escape') {
            capture.abort();
            return;
          }
          const proposed = { ...settings.bindings };
          form.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((item) => {
            proposed[item.dataset.bind as BindingAction] = item.dataset.key!;
          });
          proposed[button.dataset.bind as BindingAction] = e.code;
          try {
            validateBindings(proposed);
            button.dataset.key = e.code;
            capture.abort();
          } catch (error) {
            this.toast(String(error));
          }
        };
        document.addEventListener('keydown', listener, { capture: true, signal: capture.signal });
      }),
    );
    document.getElementById('exportSetup')!.onclick = () => this.callbacks.exportSetup();
    document.getElementById('importSetup')!.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.callbacks.importSetup(file);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const value = (key: string) => (form.elements.namedItem(key) as HTMLInputElement).value;
      const next = structuredClone(settings);
      next.quality = value('quality') as Settings['quality'];
      next.graphics = graphics();
      next.drivingAudio = readDrivingAudio(form);
      next.colorblind = (form.elements.namedItem('colorblind') as HTMLInputElement).checked;
      next.highContrast = (form.elements.namedItem('highContrast') as HTMLInputElement).checked;
      for (const key of ['captions', 'engineerRadio', 'reducedMotion'] as const)
        next[key] = (form.elements.namedItem(key) as HTMLInputElement).checked;
      next.quickStart = (form.elements.namedItem('quickStart') as HTMLInputElement).checked;
      for (const key of ['volume', 'shake', 'uiScale'] as const) next[key] = Number(value(key));
      for (const key of Object.keys(DEFAULT_SETUP) as (keyof Setup)[])
        next.setup[key] = Number(value(key));
      for (const key of [
        'steerAxis',
        'throttleAxis',
        'brakeAxis',
        'throttleButton',
        'brakeButton',
        'clutchAxis',
        'clutchButton',
        'shiftUpButton',
        'shiftDownButton',
        'deadzone',
        'exponent',
      ] as const)
        next.mapping[key] = Number(value(key));
      for (const key of ['axisPedals', 'invertSteer', 'invertPedals'] as const)
        next.mapping[key] = (form.elements.namedItem(key) as HTMLInputElement).checked;
      form
        .querySelectorAll<HTMLButtonElement>('[data-bind]')
        .forEach(
          (button) => (next.bindings[button.dataset.bind as BindingAction] = button.dataset.key!),
        );
      this.bindingCapture?.abort();
      try {
        this.deviceCalibration?.apply(next.mapping);
        for (const action of BUTTON_ACTIONS)
          next.mapping.buttonActions[action] = Number(value(`action_${action}`));
        this.callbacks.apply(validateSettings(next));
      } catch (error) {
        this.toast(`Settings not applied: ${String(error)}`);
      }
    };
  }
  /** Championship line under a race classification (set by the application). */
  championshipNote = '';
  results(frame: Float32Array) {
    if (this.options.mode === 'qualifying') {
      this.qualifyingResults(frame);
      return;
    }
    const rows = Array.from({ length: frame[H.CARS] }, (_, id) => id)
      .sort((a, b) => frame[carBase(a) + F.RANK] - frame[carBase(b) + F.RANK])
      .map((id, index) => {
        const p = carBase(id);
        return `<tr${id === 0 ? ' class="you"' : ''}><td>${index + 1}</td><td>${id === 0 ? this.playerName : DRIVERS[id]}</td><td>${Math.round(frame[p + F.LAPS])}</td><td>${frame[p + F.FINISH] > 0 ? lapTime(frame[p + F.FINISH]) : frame[p + F.RETIRED] ? 'DNF' : 'RUNNING'}</td><td>${lapTime(frame[p + F.BEST_LAP])}</td><td>${frame[p + F.PENALTY].toFixed(0)}s</td></tr>`;
      })
      .join('');
    this.modalContent(
      `<span class="eyebrow">CHEQUERED FLAG / SESSION CLASSIFICATION</span><h2>${frame[carBase(0) + F.FINISH] > 0 ? 'Across the line.' : 'Session ended.'}</h2><p>Classified by laps completed, then race time including penalties.</p><table class="results"><thead><tr><th>POS</th><th>DRIVER</th><th>LAPS</th><th>TIME + PEN.</th><th>BEST LAP</th><th>PEN.</th></tr></thead><tbody>${rows}</tbody></table>${this.championshipNote ? `<p class="championship-note">${escapeHtml(this.championshipNote)}</p>` : ''}<div class="dialog-buttons inline"><button class="primary" data-action="replay">WATCH REPLAY</button><button data-action="telemetry">TELEMETRY</button>${this.championshipNote ? '<button data-action="championship">STANDINGS</button>' : ''}<button data-action="photo">PHOTO STUDIO</button><button data-action="restart">RACE AGAIN</button><button data-action="menu">PADDOCK</button></div>`,
    );
  }
  /** Qualifying classification: the fastest valid lap sets the race grid. */
  qualifyingResults(frame: Float32Array) {
    const grid = qualifyingGrid(frame),
      pole = frame[carBase(grid[0]) + F.BEST_LAP];
    const rows = grid
      .map((id, index) => {
        const best = frame[carBase(id) + F.BEST_LAP];
        const gap = best > 0 && pole > 0 && index > 0 ? `+${(best - pole).toFixed(3)}` : '';
        return `<tr${id === 0 ? ' class="you"' : ''}><td>${index + 1}</td><td>${id === 0 ? escapeHtml(this.playerName) : DRIVERS[id]}</td><td>${best > 0 ? lapTime(best) : 'NO TIME'}</td><td>${gap}</td></tr>`;
      })
      .join('');
    const position = grid.indexOf(0) + 1;
    this.modalContent(
      `<span class="eyebrow">QUALIFYING / CLASSIFICATION</span><h2>${position === 1 ? 'Pole position.' : `P${position} on the grid.`}</h2><p>Fastest valid lap sets the starting order. Invalid or penalised laps do not count.</p><table class="results"><thead><tr><th>POS</th><th>DRIVER</th><th>BEST LAP</th><th>GAP</th></tr></thead><tbody>${rows}</tbody></table>${this.championshipNote ? `<p class="championship-note">${escapeHtml(this.championshipNote)}</p>` : ''}<div class="dialog-buttons inline"><button class="primary" data-action="weekendRace">START RACE FROM THIS GRID</button><button data-action="replay">WATCH REPLAY</button><button data-action="telemetry">TELEMETRY</button><button data-action="menu">PADDOCK</button></div>`,
    );
  }
  /** Championship standings and calendar. */
  championship(c: Championship | null) {
    if (!c) {
      this.modalContent(
        `<span class="eyebrow">CHAMPIONSHIP</span><h2>A season of race weekends.</h2><p>${DEFAULT_CALENDAR.length} rounds across the original circuits. Each weekend is qualifying, which sets the grid, and then the race. Points go to the top ten finishers (25-18-15-12-10-8-6-4-2-1). Progress is saved on this device.</p><div class="dialog-buttons inline"><button class="primary" data-action="championship:new">START NEW CHAMPIONSHIP</button><button data-action="modalClose">CLOSE</button></div>`,
      );
      return;
    }
    const table = standings(c);
    const rows = table
      .map(
        (s, index) =>
          `<tr${s.id === 0 ? ' class="you"' : ''}><td>${index + 1}</td><td>${s.id === 0 ? escapeHtml(this.playerName) : DRIVERS[s.id]}</td><td>${s.points}</td><td>${s.wins}</td><td>${s.finishes.map((p) => (p ? `P${p}` : 'DNF')).join(' · ') || '—'}</td></tr>`,
      )
      .join('');
    const calendar = c.rounds
      .map((r, i) => {
        const done = c.results[i];
        const status = done
          ? `P${done.order.indexOf(0) + 1}${done.retired.includes(0) ? ' (DNF)' : ''}${done.demonstration ? ' · AI DEMO' : ''}`
          : i === c.results.length
            ? 'NEXT'
            : '';
        return `<li${i === c.results.length ? ' class="next"' : ''}><b>R${i + 1}</b> ${circuitDefinition(r.circuit).name} · ${r.weather.toUpperCase()} · ${r.laps} LAPS <span>${status}</span></li>`;
      })
      .join('');
    const round = nextRound(c);
    this.modalContent(
      `<span class="eyebrow">CHAMPIONSHIP / ROUND ${Math.min(c.results.length + 1, c.rounds.length)} OF ${c.rounds.length}</span><h2>${complete(c) ? `Champion: ${table[0].id === 0 ? escapeHtml(this.playerName) : DRIVERS[table[0].id]}.` : 'Standings.'}</h2><ol class="championship-calendar">${calendar}</ol><table class="results"><thead><tr><th>POS</th><th>DRIVER</th><th>PTS</th><th>WINS</th><th>RESULTS</th></tr></thead><tbody>${rows}</tbody></table><div class="dialog-buttons inline">${round ? `<button class="primary" data-action="championship:start">START ROUND ${c.results.length + 1} · QUALIFYING</button>` : ''}<button data-action="championship:new">NEW CHAMPIONSHIP</button><button data-action="modalClose">CLOSE</button></div>`,
    );
  }
  error(error: string) {
    this.get('loading').hidden = true;
    this.modalContent(
      '<span class="eyebrow">SOMETHING WENT WRONG</span><h2>Session stopped.</h2><p>The session could not continue. Reload to return to the paddock. If this keeps happening, lower the render quality in Garage &amp; Settings.</p><p id="errorMessage" class="error-detail"></p><button class="primary" data-action="reload">RELOAD GAME</button>',
    );
    document.getElementById('errorMessage')!.textContent = error;
  }
}
