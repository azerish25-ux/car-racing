import styles from './f1-hud.css?inline';
import {
  COMPOUNDS,
  DRIVERS,
  LIVERIES,
  QUALIFYING_TIMED_LAPS,
  VEHICLE,
  type SessionOptions,
} from '../simulation/config.ts';
import {
  F,
  H,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import { FLAG, yellowFlag } from '../simulation/marshal.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import { CAR_PIT_SERVICE, pitServicePlan, type PitServicePlan } from '../simulation/pit-service.ts';
import type { SectorBoard, SectorState } from './sector-timing.ts';
import { Vector3, type Camera } from 'three';

/** F1-style race HUD (Art Bible B §1): a bottom-centre binocular cluster, the
 * timing tower header, the sector panel, race-control banners, the pit-lane
 * panel and name tags. It reflows the existing live nodes (every id is kept)
 * and adds presentation-only elements; it never reads the simulation through a
 * second channel: `update` receives the frame `Interface.update` already has.
 * Everything time-dependent (banner lifetime, limiter blink, flag pulse) runs
 * on the frame's simulated time, so held and replayed frames look identical. */

/** Rev lights: 5 green, 5 red, 5 blue, the last at the shift point. */
export const REV_LEDS = 15;
export function revLedThresholds(shiftRPM: number = VEHICLE.shiftRPM): number[] {
  return Array.from({ length: REV_LEDS }, (_, i) => shiftRPM * (0.8 + i * 0.0143));
}
/** Rows [start, end) of a `size`-row tower window centred on `rank` (0-based). */
export function towerWindow(rank: number, cars: number, size = 5): [number, number] {
  if (cars <= size) return [0, cars];
  const start = Math.min(Math.max(0, rank - Math.floor(size / 2)), cars - size);
  return [start, start + size];
}
/** Car holding the session's fastest lap (-1 before any lap is timed). */
export function fastestLapCar(frame: Float32Array): number {
  let best = Infinity,
    car = -1;
  for (let id = 0; id < frame[H.CARS]; id++) {
    const lap = frame[carBase(id) + F.BEST_LAP];
    if (lap > 0 && lap < best) {
      best = lap;
      car = id;
    }
  }
  return car;
}
/** Tower surname: 'A. MOREAU' -> 'MOREAU'. */
export function surname(name: string): string {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  return words.at(-1) ?? '';
}
/** Carcass temperature band (Art Bible B §1.7), °C -> colour. */
export function tyreBand(celsius: number): string {
  if (!(celsius >= 70)) return '#4fa3ff';
  if (celsius < 85) return '#5fd3a0';
  if (celsius < 105) return '#4cd964';
  if (celsius <= 115) return '#ffd60a';
  return '#ff3b30';
}
const COMPOUND_KEYS = Object.keys(COMPOUNDS) as (keyof typeof COMPOUNDS)[];
const COMPOUND_LETTERS: Record<string, string> = {
  soft: 'S',
  medium: 'M',
  hard: 'H',
  intermediate: 'I',
  wet: 'W',
};
export function compoundOf(frame: Float32Array, car: number) {
  return COMPOUND_KEYS[Math.round(frame[carBase(car) + F.COMPOUND])] ?? 'medium';
}

/** Tower header: session word and the lap counter ("LAP 3 / 10"). */
export function sessionHeading(
  mode: SessionOptions['mode'],
  laps: number,
  frame: Float32Array,
): { session: string; label: string; current: string; total: string } {
  const o = carBase(0),
    done = Math.round(frame[o + F.LAPS]);
  if (mode === 'race' || mode === 'endurance')
    return {
      session: mode === 'endurance' ? 'ENDURANCE' : 'RACE',
      label: 'LAP',
      current: String(Math.min(laps, done + 1)),
      total: `/ ${laps}`,
    };
  if (mode === 'qualifying') {
    if (frame[o + F.FINISH] > 0)
      return { session: 'QUALIFYING', label: 'SESSION', current: 'COMPLETE', total: '' };
    if (!(frame[o + F.LAP_TIME] > 0))
      return { session: 'QUALIFYING', label: '', current: 'OUT LAP', total: '' };
    return {
      session: 'QUALIFYING',
      label: 'LAP',
      current: String(Math.min(QUALIFYING_TIMED_LAPS, done + 1)),
      total: `/ ${QUALIFYING_TIMED_LAPS}`,
    };
  }
  return {
    session: mode === 'time-trial' ? 'TIME TRIAL' : 'PRACTICE',
    label: 'LAP',
    current: String(done + 1),
    total: '',
  };
}

export type BannerKind = 'none' | 'flag' | 'warn' | 'info' | 'finish' | 'pit';
export interface RaceBanner {
  kind: BannerKind;
  /** Swatch: yellow, double, blue, green, chequered, warn, info or pit. */
  swatch: string;
  title: string;
  sub: string;
  /** Stays as a compact flag chip after the 4 s banner while it applies. */
  persistent: boolean;
  /** Text for the polite live region (#raceMessage). */
  text: string;
}
/** Pit-phase text from the entrant family's service plan (car jacks or
 * motorcycle stands); the car plan by default. */
export const pitPhaseLabel = (phase: number, plan: PitServicePlan = CAR_PIT_SERVICE) =>
  plan.labels[Math.round(phase)] ?? '';
/** The service plan of entrant `id` in a snapshot. */
const servicePlanAt = (frame: Float32Array, o: number) =>
  pitServicePlan(vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE])));
function banner(
  kind: BannerKind,
  swatch: string,
  title: string,
  sub = '',
  persistent = false,
): RaceBanner {
  return { kind, swatch, title, sub, persistent, text: sub ? `${title} · ${sub}` : title };
}
/** The race-control message that applies to the player in this frame. */
export function raceBanner(frame: Float32Array, auto: boolean): RaceBanner {
  const o = carBase(0),
    flag = frame[H.FLAG];
  if (frame[o + F.FINISH] > 0)
    return banner('finish', 'chequered', 'CHEQUERED FLAG', 'COOL-DOWN LAP · WAITING FOR THE FIELD');
  const neutralised = Math.round(frame[H.SC_PHASE]);
  if (neutralised > 0)
    return banner(
      'flag',
      'yellow',
      neutralised === 1 ? 'VIRTUAL SAFETY CAR' : 'SAFETY CAR',
      neutralised === 1
        ? 'KEEP TO THE DELTA · NO OVERTAKING'
        : neutralised === 3
          ? 'IN THIS LAP · HOLD POSITION'
          : 'DEPLOYED · NO OVERTAKING',
      true,
    );
  if (yellowFlag(flag)) {
    const speed = Math.round(Math.max(0, frame[o + F.CAUTION_SPEED]) * 3.6);
    const double = flag === FLAG.DOUBLE_YELLOW;
    return banner(
      'flag',
      double ? 'double' : 'yellow',
      double ? 'DOUBLE YELLOW' : 'YELLOW FLAG',
      `${speed > 0 ? `SLOW · ${speed} KM/H · ` : ''}NO OVERTAKING`,
      true,
    );
  }
  if (flag === FLAG.BLUE) {
    const car = Math.round(frame[o + F.BLUE_CAR]);
    const who = car > 0 && car < frame[H.CARS] ? surname(DRIVERS[car] ?? '') : '';
    return banner(
      'flag',
      'blue',
      'BLUE FLAG',
      who ? `LET ${who} THROUGH` : 'LET THE LEADER PASS',
      true,
    );
  }
  if (auto) return banner('info', 'info', 'AI DEMONSTRATION', 'PRESS G TO TAKE CONTROL');
  const pit = Math.round(frame[o + F.PIT_PHASE]);
  if (pit > 0) return banner('pit', 'pit', 'PIT LANE', pitPhaseLabel(pit, servicePlanAt(frame, o)));
  if (frame[o + F.FRONT_HEALTH] < 0.6)
    return banner('warn', 'warn', 'FRONT WING DAMAGE', 'REQUEST PIT SERVICE');
  if (frame[H.DRS_ENABLED] > 0 && frame[H.LAP_LEADER] === 3)
    return banner('info', 'info', 'DRS ENABLED', 'WITHIN 1.0 S AT DETECTION');
  return banner('none', '', '', '');
}
/** Seconds a banner stays fully visible (Art Bible B §0.3 motion). */
export const BANNER_SECONDS = 4;

/** Track-limit strikes before the next one costs time: the lap tracker
 * (simulation/race.ts `limits`) adds 5 s on every fourth warning. */
export const TRACK_LIMIT_STRIKES = 3;
/** Race-control event: a penalty or a track-limits warning (Art Bible B §1.9). */
export interface RaceEvent {
  title: string;
  sub: string;
  since: number;
}
/** Why the player's penalty total grew. A track-limits penalty lands in the
 * same simulation step as its warning; everything else is race control
 * (jump start on the grid, pit-lane speeding, overtaking under yellow,
 * the endurance mandatory stop at the flag). */
export function penaltyReason(frame: Float32Array, warningsRose: boolean): string {
  const o = carBase(0);
  if (warningsRose) return 'TRACK LIMITS';
  if (frame[H.PHASE] < 2) return 'JUMP START';
  if (frame[o + F.IN_PIT] > 0) return 'PIT LANE SPEEDING';
  if (frame[o + F.FINISH] > 0) return 'MANDATORY PIT STOP';
  if (yellowFlag(frame[H.FLAG]) || yellowFlag(frame[o + F.LOCAL_FLAG]))
    return 'OVERTAKING UNDER YELLOW';
  return 'RACE CONTROL DECISION';
}
/** "WARNING 2 / 3": strikes since the last track-limits penalty. */
export function trackLimitWarning(warnings: number): string {
  const strike = ((Math.max(1, Math.round(warnings)) - 1) % (TRACK_LIMIT_STRIKES + 1)) + 1;
  return `WARNING ${Math.min(strike, TRACK_LIMIT_STRIKES)} / ${TRACK_LIMIT_STRIKES} · LAP INVALIDATED`;
}
export interface BannerView {
  swatch: string;
  title: string;
  sub: string;
  mode: 'full' | 'mini';
}
/** What the banner shows this frame. A new flag or the chequered flag gets
 * its full 4 s first; a penalty or warning then outranks the compact flag
 * chip (a persistent yellow must not swallow "+5S · OVERTAKING UNDER
 * YELLOW"); info and damage notes run 4 s when nothing else is up. */
export function bannerView(
  state: RaceBanner,
  since: number,
  event: RaceEvent | null,
  time: number,
): BannerView | null {
  const fresh = time - since < BANNER_SECONDS;
  const flag = state.kind === 'flag' || state.kind === 'finish';
  if (flag && fresh) return { ...state, mode: 'full' };
  if (event && time - event.since < BANNER_SECONDS)
    return { swatch: 'warn', title: event.title, sub: event.sub, mode: 'full' };
  if (flag && state.persistent) return { ...state, mode: 'mini' };
  if ((state.kind === 'info' || state.kind === 'warn') && fresh) return { ...state, mode: 'full' };
  return null;
}

/** Cluster status line under the gear (Art Bible B §1.5). */
export function clusterStatus(frame: Float32Array, ers: number, pitLimiter: boolean): string {
  const o = carBase(0);
  if (pitLimiter) return 'PIT LIMITER';
  if (frame[H.PHASE] < 2) return '';
  if (frame[o + F.REGEN_POWER] > 1000) return ers === 0 ? 'HARVESTING' : 'REDUCED HARVESTING';
  if (frame[o + F.MOTOR_POWER] > 1000) return ers === 2 ? 'OVERTAKE' : 'DEPLOYING';
  return '';
}

// Binocular cluster geometry (SVG user units; 10 units = 1 HUD unit, the box
// is 37.9 × 14.2 units of `--u`). Pods are joined by a chamfered bridge.
const CW = 379,
  CH = 142,
  POD = 59,
  LX = 63,
  RX = CW - LX,
  CY = 71;
const ERS_R = 51,
  RPM_R = 54,
  PEDAL_R = 47;
const arc = (r: number) => 1.5 * Math.PI * r; // 270°
const halfArc = (r: number) => 0.75 * Math.PI * r; // 135°: one pedal trace per side
function podJoin(cx: number, y: number, side: 1 | -1) {
  return cx + side * Math.sqrt(POD * POD - (y - CY) * (y - CY));
}
const TOP = 28,
  BOTTOM = 118;
const SHAPE = [
  `M${podJoin(LX, TOP, 1).toFixed(1)},${TOP}`,
  `L128,${TOP} L136,36 L243,36 L251,${TOP}`,
  `L${podJoin(RX, TOP, -1).toFixed(1)},${TOP}`,
  `A${POD},${POD} 0 1,1 ${podJoin(RX, BOTTOM, -1).toFixed(1)},${BOTTOM}`,
  `L232,${BOTTOM} L224,128 L155,128 L147,${BOTTOM}`,
  `L${podJoin(LX, BOTTOM, 1).toFixed(1)},${BOTTOM}`,
  `A${POD},${POD} 0 1,1 ${podJoin(LX, TOP, 1).toFixed(1)},${TOP} Z`,
].join(' ');
let installs = 0;
function clusterSvg(id: string) {
  const ring = (cls: string, cx: number, r: number, mirror = false, extra = '', length = arc(r)) =>
    `<circle class="${cls}" cx="${cx}" cy="${CY}" r="${r}" stroke-dasharray="${length.toFixed(1)} 999" transform="${mirror ? `matrix(-1 0 0 1 ${2 * cx} 0) ` : ''}rotate(135 ${cx} ${CY})"${extra}/>`;
  return `<svg class="f1-shape" viewBox="0 0 ${CW} ${CH}" aria-hidden="true" focusable="false">
<defs><linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9cc054"/><stop offset="1" stop-color="#e4f084"/></linearGradient></defs>
<path class="f1-body" d="${SHAPE}"/>
<circle class="f1-ticks" cx="${LX}" cy="${CY}" r="43"/><circle class="f1-ticks" cx="${RX}" cy="${CY}" r="43"/>
${ring('f1-track', LX, ERS_R)}${ring('f1-ers', LX, ERS_R, false, ` stroke="url(#${id})"`)}
${ring('f1-track f1-thin', RX, RPM_R)}${ring('f1-rpm', RX, RPM_R)}
${ring('f1-thr', RX, PEDAL_R, false, '', 0)}${ring('f1-brk', RX, PEDAL_R, true, '', 0)}
</svg>`;
}

const SECTOR_TAB = ['S1', 'S2', 'S3'];
type Dashed = { el: SVGElement; length: number; value: number };

export interface F1Frame {
  frame: Float32Array;
  trackLength: number;
  mode: SessionOptions['mode'];
  laps: number;
  /** Car ids by race rank. */
  order: readonly number[];
  sectors: SectorBoard | null;
  ers: number;
  auto: boolean;
  /** Live lap delta the panel shows (time trial: the saved-PB ghost), or null
   * when no valid reference exists. Colours the progress line. */
  delta: number | null;
  /** 0 unavailable, 1 available, 2 open (R.DRS when gameplay publishes it). */
  drs?: number;
  /** A best lap exists (this session, or a saved time-trial personal best). */
  bestKnown: boolean;
  /** Show the hatched delta row (timed sessions with a valid reference). */
  deltaShown: boolean;
}
/** Wrap an element's direct text (labels such as "CURRENT LAP") in
 * `<em class="f1-text">` so the desktop layout can hide or replace it while the
 * compact drawer keeps showing it. The live value nodes are untouched. */
function wrapText(element: Element) {
  for (const node of Array.from(element.childNodes))
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      const em = document.createElement('em');
      em.className = 'f1-text';
      em.textContent = node.textContent;
      element.replaceChild(em, node);
    }
}

/** Name tags: at most 5, only within this range of the player (m). */
export const TAG_RANGE = 120;
export const TAG_LIMIT = 5;
/** Cars that get a name tag: on the grid every nearby car (up to 5, nearest
 * first); while racing only the nearest car ahead on track (Art Bible B §1.8). */
export function nameTagCars(frame: Float32Array): number[] {
  const cars = frame[H.CARS],
    me = carBase(0),
    length = frame[H.LENGTH];
  const grid = frame[H.PHASE] < 2;
  const found: { id: number; distance: number }[] = [];
  for (let id = 1; id < cars; id++) {
    const o = carBase(id);
    if (frame[o + F.RETIRED] > 0) continue;
    const distance = Math.hypot(frame[o + F.X] - frame[me + F.X], frame[o + F.Z] - frame[me + F.Z]);
    if (!(distance <= TAG_RANGE)) continue;
    if (!grid) {
      const ahead = (((frame[o + F.S] - frame[me + F.S]) % length) + length) % length;
      if (!(ahead > 0 && ahead <= TAG_RANGE)) continue;
    }
    found.push({ id, distance });
  }
  found.sort((a, b) => a.distance - b.distance);
  return found.slice(0, grid ? TAG_LIMIT : 1).map((c) => c.id);
}
export interface TagView {
  camera?: Camera;
  cars?: readonly { root: { position: { x: number; y: number; z: number } } }[];
}
interface TagNode {
  el: HTMLElement;
  pos: HTMLElement;
  bar: HTMLElement;
  name: HTMLElement;
  car: number;
  x: number;
  y: number;
}

export class F1Hud {
  private readonly cluster: HTMLElement;
  private readonly arcs: Record<'ers' | 'rpm' | 'thr' | 'brk', Dashed>;
  private readonly status: HTMLElement;
  private readonly drs: HTMLElement;
  private readonly shift: HTMLElement;
  private readonly tyres: HTMLElement[];
  private readonly compound: HTMLElement;
  private readonly towerSession: HTMLElement;
  private readonly towerLap: HTMLElement[];
  private readonly lapPanel: HTMLElement;
  private readonly sectorTabs: HTMLElement[];
  private readonly pos: HTMLElement;
  private readonly field: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly bannerTitle: HTMLElement;
  private readonly bannerSub: HTMLElement;
  private readonly pit: HTMLElement;
  private readonly pitLane: HTMLElement;
  private readonly pitStop: HTMLElement;
  private readonly pitPhase: HTMLElement;
  private bannerKey = '';
  private bannerSince = 0;
  private banner: RaceBanner = {
    kind: 'none',
    swatch: '',
    title: '',
    sub: '',
    persistent: false,
    text: '',
  };
  private event: RaceEvent | null = null;
  private warnings = -1;
  private penalty = -1;
  private pitSince = -1;
  private time = -Infinity;
  private readonly tagLayer: HTMLElement;
  private readonly tagNodes: TagNode[];
  private readonly point = new Vector3();
  constructor(readonly hud: HTMLElement) {
    if (hud.dataset.f1) throw new Error('F1 HUD already installed');
    if (!hud.dataset.raceDay) throw new Error('Install the race-day HUD first');
    hud.dataset.f1 = 'true';
    const style = document.createElement('style');
    style.textContent = styles;
    hud.append(style);
    // One palette for HUD rings and car sidewalls.
    for (const [key, compound] of Object.entries(COMPOUNDS))
      hud.style.setProperty(`--tyre-${key}`, `#${compound.color.toString(16).padStart(6, '0')}`);
    const q = <T extends Element = HTMLElement>(selector: string) => {
      const node = hud.querySelector<T>(selector);
      if (!node) throw new Error(`Incomplete racing HUD: ${selector}`);
      return node;
    };

    // ---- Binocular cluster: reflow the live nodes over an SVG body. ----
    this.cluster = q('.instruments');
    this.cluster.dataset.f1Cluster = 'true';
    const notes = document.createElement('div');
    notes.className = 'f1-notes';
    for (const id of ['vehicleAlert', 'programmeHud', 'guideReadout']) notes.append(q(`#${id}`));
    const svgHolder = document.createElement('div');
    svgHolder.innerHTML = clusterSvg(`f1ErsGradient${++installs}`);
    const svg = svgHolder.firstElementChild as SVGSVGElement;
    this.cluster.prepend(svg, notes);
    const dashed = (cls: string, r: number): Dashed => ({
      el: svg.querySelector<SVGElement>(`.${cls}`)!,
      length: arc(r),
      value: -1,
    });
    this.arcs = {
      ers: dashed('f1-ers', ERS_R),
      rpm: dashed('f1-rpm', RPM_R),
      thr: { ...dashed('f1-thr', PEDAL_R), length: halfArc(PEDAL_R) },
      brk: { ...dashed('f1-brk', PEDAL_R), length: halfArc(PEDAL_R) },
    };
    const resources = q('.resources');
    const ersLabel = resources.querySelector('label');
    const ersText = ersLabel?.firstChild;
    if (ersText?.nodeType === Node.TEXT_NODE) {
      const span = document.createElement('span');
      span.className = 'f1-res-label';
      span.textContent = (ersText.textContent ?? '').trim();
      ersLabel!.replaceChild(span, ersText);
    }
    const add = (cls: string, html = '', tag = 'div') => {
      const node = document.createElement(tag);
      node.className = cls;
      node.innerHTML = html;
      node.setAttribute('aria-hidden', 'true');
      this.cluster.append(node);
      return node;
    };
    this.status = add('f1-status');
    this.drs = add('f1-drs', '<span>DRS</span>');
    this.drs.dataset.state = '0';
    this.shift = add('f1-shift', '<i class="up"></i><i class="down"></i>');
    const tyres = add(
      'f1-tyres',
      `<em class="f1-compound">M</em><div class="f1-car"><i data-w="1"></i><i data-w="0"></i><b></b><i data-w="3"></i><i data-w="2"></i></div>`,
    );
    this.compound = tyres.querySelector('em')!;
    this.tyres = [0, 1, 2, 3].map((w) => tyres.querySelector<HTMLElement>(`[data-w="${w}"]`)!);

    // ---- Tower header: series wordmark, session, lap counter. ----
    const heading = q('.timing .panel-heading');
    wrapText(heading);
    const head = document.createElement('span');
    head.className = 'f1-tower-head';
    head.setAttribute('aria-hidden', 'true');
    head.innerHTML = '<b class="f1-wordmark">APEX</b><em class="f1-session">RACE</em>';
    const lap = document.createElement('span');
    lap.className = 'f1-tower-lap';
    lap.setAttribute('aria-hidden', 'true');
    lap.innerHTML = '<small>LAP</small><b>1</b><small>/ 1</small>';
    heading.append(head, lap);
    this.towerSession = head.querySelector('em')!;
    this.towerLap = Array.from(lap.children) as HTMLElement[];

    // ---- Sector / position / lap panel. ----
    this.lapPanel = q('.lap-panel');
    const labels = this.lapPanel.querySelectorAll(':scope > label');
    labels.forEach(wrapText);
    labels[2]?.classList.add('f1-best');
    labels[3]?.classList.add('f1-last');
    const tabs = document.createElement('div');
    tabs.className = 'f1-sectors';
    tabs.setAttribute('aria-hidden', 'true');
    tabs.innerHTML = SECTOR_TAB.map(
      (s, i) => `<i data-s="${i}" data-state="none"><u></u><b>${s}</b></i>`,
    ).join('');
    this.sectorTabs = Array.from(tabs.children) as HTMLElement[];
    const pos = document.createElement('b');
    pos.className = 'f1-pos';
    pos.setAttribute('aria-hidden', 'true');
    pos.innerHTML = '<span>1</span><small>/ 1</small>';
    this.pos = pos.querySelector('span')!;
    this.field = pos.querySelector('small')!;
    this.progress = document.createElement('i');
    this.progress.className = 'f1-progress';
    this.progress.setAttribute('aria-hidden', 'true');
    this.lapPanel.prepend(tabs, pos);
    this.lapPanel.append(this.progress);

    // ---- Race-control banner, pit-lane panel, name tags. ----
    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'f1-banner';
    this.bannerEl.setAttribute('aria-hidden', 'true');
    this.bannerEl.dataset.state = 'off';
    this.bannerEl.innerHTML = '<i class="f1-swatch"></i><div><b></b><small></small></div>';
    this.bannerTitle = this.bannerEl.querySelector('b')!;
    this.bannerSub = this.bannerEl.querySelector('small')!;
    this.pit = document.createElement('div');
    this.pit.className = 'f1-pit';
    this.pit.setAttribute('aria-hidden', 'true');
    this.pit.hidden = true;
    this.pit.innerHTML =
      '<header>PIT LANE</header><div><span><small>PIT</small><b>0.0</b></span><span><small>STOP<br>TIME</small><b class="stop">—</b></span></div><p></p>';
    [this.pitLane, this.pitStop] = Array.from(this.pit.querySelectorAll('b')) as HTMLElement[];
    this.pitPhase = this.pit.querySelector('p')!;
    this.tagLayer = document.createElement('div');
    this.tagLayer.className = 'f1-tags';
    this.tagLayer.setAttribute('aria-hidden', 'true');
    this.tagNodes = Array.from({ length: TAG_LIMIT }, () => {
      const el = document.createElement('div');
      el.className = 'f1-tag';
      el.hidden = true;
      el.innerHTML = '<b></b><i></i><span></span>';
      this.tagLayer.append(el);
      const [pos, bar, name] = Array.from(el.children) as HTMLElement[];
      return { el, pos, bar, name, car: -1, x: NaN, y: NaN };
    });
    hud.append(this.bannerEl, this.pit, this.tagLayer);
    for (const [id, side] of [
      ['proximityLeft', 'left'],
      ['proximityRight', 'right'],
    ])
      q(`#${id}`).setAttribute('aria-label', `Car ${side}`);
  }

  /** Panel refresh (a third of the presented frames, as the rest of the HUD). */
  update(s: F1Frame) {
    const { frame } = s,
      o = carBase(0),
      time = frame[H.TIME];
    const set = (node: HTMLElement, value: string) => {
      if (node.textContent !== value) node.textContent = value;
    };
    const attr = (node: HTMLElement, key: string, value: string) => {
      if (node.dataset[key] !== value) node.dataset[key] = value;
    };

    // Cluster arcs and status.
    const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
    const spec = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE])).spec;
    this.dash(
      this.arcs.ers,
      spec.maxBatteryJ > 0 ? clamp(frame[o + F.BATTERY] / spec.maxBatteryJ) : 0,
    );
    const rpm = frame[o + F.RPM];
    this.dash(this.arcs.rpm, clamp((rpm - spec.idleRPM) / (spec.limiterRPM - spec.idleRPM)));
    this.dash(this.arcs.thr, clamp(frame[o + F.THROTTLE]));
    this.dash(this.arcs.brk, clamp(frame[o + F.BRAKE]));
    attr(this.cluster, 'redline', String(rpm >= spec.shiftRPM));
    const pitPhase = Math.round(frame[o + F.PIT_PHASE]);
    const pitLimiter = frame[o + F.IN_PIT] > 0 && (pitPhase === 1 || pitPhase === 6);
    attr(this.cluster, 'pit', String(pitLimiter));
    set(this.status, clusterStatus(frame, s.ers, pitLimiter));
    const drs = s.drs ?? Math.round(s.frame[carBase(0) + RACE_BASE + R.DRS]);
    attr(this.drs, 'state', String(drs >= 0 && drs <= 2 ? drs : 0));
    const gear = Math.round(frame[o + F.GEAR]);
    const up = gear >= 1 && gear < spec.gearRatios.length - 2 && rpm >= spec.shiftRPM * 0.985;
    const down = gear > 1 && rpm < spec.shiftRPM * 0.62 && frame[o + F.BRAKE] > 0.2;
    attr(this.shift, 'shift', up ? 'up' : down ? 'down' : 'none');
    const compound = compoundOf(frame, 0);
    set(this.compound, COMPOUND_LETTERS[compound] ?? 'M');
    attr(this.compound, 'c', compound);
    this.tyres.forEach((node, w) => {
      const p = o + WHEEL_BASE + w * WHEEL_STRIDE;
      const color = tyreBand(frame[p + W.CARCASS_TEMP]);
      const wear = `${Math.round(100 * clamp(frame[p + W.WEAR]))}%`;
      if (node.style.getPropertyValue('--t') !== color) node.style.setProperty('--t', color);
      if (node.style.getPropertyValue('--wear') !== wear) node.style.setProperty('--wear', wear);
      attr(node, 'puncture', String(frame[p + W.PUNCTURED] > 0));
    });

    // Tower header.
    const heading = sessionHeading(s.mode, s.laps, frame);
    set(this.towerSession, heading.session);
    attr(this.towerSession, 'long', String(heading.session.length > 6));
    set(this.towerLap[0], heading.label);
    set(this.towerLap[1], heading.current);
    set(this.towerLap[2], heading.total);

    // Sector panel: position, sector tabs, progress line, best and delta rows.
    const cars = frame[H.CARS];
    set(this.pos, String(Math.max(1, s.order.indexOf(0) + 1)));
    set(this.field, `/ ${cars}`);
    const sector = Math.round(frame[o + F.SECTOR]);
    const third = s.trackLength / 3;
    const lapTime = frame[o + F.LAP_TIME];
    // Just after the line the finished lap's three colours stay up briefly.
    const showLast = s.sectors !== null && lapTime > 0 && lapTime < 3 && sector === 0;
    this.sectorTabs.forEach((tab, k) => {
      let state: SectorState | 'live' = 'none';
      let fill = 0;
      if (showLast) state = s.sectors!.lastLap(0, k);
      else if (k < sector) state = s.sectors?.state(0, k) ?? 'none';
      else if (k === sector && lapTime > 0) {
        state = 'live';
        const into = frame[o + F.S] - k * third;
        fill = clamp(into / third);
      }
      attr(tab, 'state', state);
      const width = `${Math.round(fill * 1000) / 10}%`;
      if (tab.style.getPropertyValue('--fill') !== width) tab.style.setProperty('--fill', width);
    });
    const valid = frame[o + F.LAP_VALID] > 0;
    // The same delta the panel prints (time trial: the saved-PB ghost).
    const line =
      frame[o + F.IN_PIT] > 0
        ? 'pit'
        : !valid && lapTime > 0
          ? 'invalid'
          : s.delta !== null && s.delta < 0
            ? 'ahead'
            : 'neutral';
    attr(this.progress, 'state', line);
    attr(this.lapPanel, 'best', String(s.bestKnown));
    attr(this.lapPanel, 'delta', String(s.deltaShown));
    attr(this.lapPanel, 'valid', String(valid || !(lapTime > 0)));

    // Banners: the state observed every frame, plus penalty/track-limit events.
    // Hiding keeps the last swatch and text (CSS hides it at once), so no
    // frame ever shows an emptied box.
    const shown = bannerView(this.banner, this.bannerSince, this.event, time);
    attr(this.bannerEl, 'state', shown ? shown.mode : 'off');
    if (shown) {
      attr(this.bannerEl, 'swatch', shown.swatch);
      set(this.bannerTitle, shown.title);
      set(this.bannerSub, shown.sub);
    }

    // Pit-lane panel: time in the lane (stamped every frame in observe) and
    // the stationary stop time.
    const inPit = frame[o + F.IN_PIT] > 0;
    this.pit.hidden = !inPit;
    if (inPit && this.pitSince >= 0) {
      set(this.pitLane, Math.max(0, time - this.pitSince).toFixed(1));
      set(this.pitStop, pitPhase >= 2 ? frame[o + F.PIT_CLOCK].toFixed(1) : '—');
      set(this.pitPhase, pitPhaseLabel(pitPhase, servicePlanAt(frame, o)));
    }
  }
  /** Every presented frame: stamp race-control changes with the frame's
   * simulated time, so a banner's 4 s run from when the state appeared even
   * when the panels refresh rarely (software rendering, held frames). */
  observe(frame: Float32Array, auto: boolean) {
    const o = carBase(0),
      time = frame[H.TIME];
    if (!Number.isFinite(time)) return;
    if (time < this.time - 0.05) this.resetTimers();
    this.time = time;
    const warnings = frame[o + F.WARNINGS],
      penalty = frame[o + F.PENALTY];
    const warningsRose = this.warnings >= 0 && warnings > this.warnings;
    if (this.penalty >= 0 && penalty > this.penalty)
      this.event = {
        title: `+${Math.round(penalty - this.penalty)}S TIME PENALTY`,
        sub: penaltyReason(frame, warningsRose),
        since: time,
      };
    else if (warningsRose)
      this.event = { title: 'TRACK LIMITS', sub: trackLimitWarning(warnings), since: time };
    this.warnings = warnings;
    this.penalty = penalty;
    if (this.event && time - this.event.since >= BANNER_SECONDS) this.event = null;
    // Pit-lane clock: stamped on the frame the car enters the lane, not on
    // the next third-rate panel refresh.
    const inPit = frame[o + F.IN_PIT] > 0;
    if (!inPit) this.pitSince = -1;
    else if (this.pitSince < 0) this.pitSince = time;
    this.banner = raceBanner(frame, auto);
    const key = `${this.banner.kind}|${this.banner.title}`;
    if (key !== this.bannerKey) {
      this.bannerKey = key;
      this.bannerSince = time;
    }
    return this.banner;
  }
  /** Every presented frame: project the tagged cars (translate3d only). */
  nameTags(frame: Float32Array, view: TagView, active: boolean) {
    const ids = active && view.camera ? nameTagCars(frame) : [];
    const width = window.innerWidth,
      height = window.innerHeight;
    this.tagNodes.forEach((tag, slot) => {
      const id = ids[slot];
      let visible = id !== undefined;
      if (visible) {
        const o = carBase(id);
        const root = view.cars?.[id]?.root.position;
        this.point.set(
          root?.x ?? frame[o + F.X],
          (root?.y ?? frame[o + F.Y]) + 1.25,
          root?.z ?? frame[o + F.Z],
        );
        this.point.project(view.camera!);
        visible =
          this.point.z > -1 &&
          this.point.z < 1 &&
          Math.abs(this.point.x) < 1.05 &&
          Math.abs(this.point.y) < 1.05;
        if (visible) {
          const x = Math.round(((this.point.x + 1) / 2) * width * 2) / 2,
            y = Math.round(((1 - this.point.y) / 2) * height * 2) / 2;
          if (x !== tag.x || y !== tag.y) {
            tag.x = x;
            tag.y = y;
            tag.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
          }
          if (tag.car !== id) {
            tag.car = id;
            tag.bar.style.background = `#${LIVERIES[id].toString(16).padStart(6, '0')}`;
            tag.name.textContent = surname(DRIVERS[id] ?? '');
          }
          // The frame's own rank: the tower order refreshes at a third of the
          // rate, so it can lag a pass by a refresh.
          const rank = String(Math.round(frame[o + F.RANK]));
          if (tag.pos.textContent !== rank) tag.pos.textContent = rank;
        }
      }
      if (tag.el.hidden === visible) tag.el.hidden = !visible;
    });
  }
  private resetTimers() {
    this.bannerKey = '';
    this.event = null;
    this.warnings = -1;
    this.penalty = -1;
    this.pitSince = -1;
  }
  private dash(arc: Dashed, fraction: number) {
    const value = Math.round(fraction * arc.length * 2) / 2;
    if (value === arc.value) return;
    arc.value = value;
    arc.el.setAttribute('stroke-dasharray', `${value} 999`);
  }
}

/** Reflow the race-day HUD into the F1 layout (desktop geometry in CSS). */
export function installF1Hud(hud: HTMLElement) {
  return new F1Hud(hud);
}
