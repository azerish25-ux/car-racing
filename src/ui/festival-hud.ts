import './festival-hud.css';
import type { DriftCue } from '../simulation/open-world/drift-feedback.ts';
import type { PaceCue } from '../rendering/open-world/pace-coach.ts';
import {
  EVENT_KIND_LABEL,
  isRace,
  type FestivalEvent,
  type FestivalResult,
} from '../simulation/open-world/festival-events.ts';
import type { FestivalStatus } from '../simulation/open-world/session.ts';
import type { OpenWorld } from '../simulation/open-world/world.ts';
import type { VehicleDefinition } from '../simulation/vehicles.ts';
import { EVENT_COLOURS } from '../rendering/open-world/markers.ts';
import { escapeHtml } from './team-hub.ts';
import type { LightingMode } from '../rendering/daylight.ts';
import { SEASONS, SEASON_LABEL, type Season } from '../session/festival-season.ts';
import { MAP_HALF, MAP_SIZE, mapToWorld, minimapMatrix, worldToMap } from './festival-map.ts';

export interface FestivalHudCallbacks {
  start(id: string): void;
  continue(): void;
  cancel(): void;
  reset(): void;
  resume(): void;
  exit(): void;
  lighting(mode: LightingMode): void;
  /** Presentation season (optional: hosts without seasons omit the row). */
  season?(season: Season): void;
  vehicle(id: string): void;
  travel(id: string): void;
  autopilot(on: boolean): void;
  /** Ambient traffic on or off (free roam; always off during events). */
  traffic(on: boolean): void;
  map?(): void;
  photo?(open: boolean): void;
  photoAngle?(angle: number): void;
}
const colour = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60),
    s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
const points = (n: number) => Math.round(n).toLocaleString('en');
const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s·-])\p{L}/gu, (c) => c.toUpperCase());
const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'TH' : (['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH')}`;
/** Best saved result per event (FestivalSave.best), shown as Current Best. */
export type FestivalBest = Readonly<
  Record<string, { stars: number; time: number | null; value: number | null }>
>;

/** Speedometer geometry in SVG units, measured from the reference HUD
 * (FH6 ref 041/042): a 225 degree arc open at the lower right, zero at the
 * lower left (135 degrees, screen clockwise) to the top of the scale at three
 * o'clock; the digits sit in the open quadrant, the gear in a ring at the
 * centre and the last tenth of the scale is the magenta redline. */
export const GAUGE = Object.freeze({ cx: 104, cy: 98, r: 80, start: 135, sweep: 225 });
function gaugePoint(fraction: number, radius: number) {
  const a = ((GAUGE.start + GAUGE.sweep * fraction) * Math.PI) / 180;
  return [GAUGE.cx + radius * Math.cos(a), GAUGE.cy + radius * Math.sin(a)] as const;
}
function arcPath(from: number, to: number, radius: number) {
  const [x0, y0] = gaugePoint(from, radius),
    [x1, y1] = gaugePoint(to, radius);
  const large = GAUGE.sweep * (to - from) > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${radius} ${radius} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function gaugeArcs() {
  return `<path class="fest-gauge-track" d="${arcPath(0, 1, GAUGE.r)}"></path><path class="fest-gauge-red" id="festRedline" d="${arcPath(0.9, 1, GAUGE.r + 3.5)}"></path><path class="fest-gauge-rpm" id="festRpm" pathLength="1" d="${arcPath(0, 1, GAUGE.r)}"></path>`;
}
/** Scale of the rev gauge in thousands of rpm for a machine's limiter:
 * whole thousands to the next one above the limiter, labelled every 1, 2 or
 * 4 thousand so a high-revving machine never crowds the arc. */
export function gaugeScale(limiterRpm: number) {
  const top = Math.max(4, Math.ceil(Math.max(0, limiterRpm) / 1000 + 1e-6));
  const step = top > 16 ? 4 : top > 9 ? 2 : 1;
  const max = Math.ceil(top / step) * step;
  return { max, step, red: Math.min(1, Math.max(0, (limiterRpm * 0.9) / (max * 1000))) };
}
function gaugeTicks(scale: ReturnType<typeof gaugeScale>) {
  let svg = '';
  for (let k = 0; k <= scale.max * 2; k++) {
    const f = k / (scale.max * 2),
      major = k % (scale.step * 2) === 0;
    const [x0, y0] = gaugePoint(f, GAUGE.r - 1.5),
      [x1, y1] = gaugePoint(f, GAUGE.r - (major ? 8 : 4));
    svg += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" class="${major ? 'fest-tick-major' : 'fest-tick'}"></line>`;
    if (major) {
      const [lx, ly] = gaugePoint(f, GAUGE.r - 17);
      svg += `<text x="${lx.toFixed(1)}" y="${(ly + 0.5).toFixed(1)}" class="fest-tick-label${f >= scale.red - 1e-6 ? ' fest-tick-red' : ''}">${k / 2}</text>`;
    }
  }
  return svg;
}

/**
 * Festival heads-up display and menus, laid out as the reference in-race HUD
 * (FH6 ref 041/042) with original styling: a circular heading-up minimap
 * (route in cyan, north on the ring) with road/limit pills below it at the
 * lower left; an arc rev gauge with redline, gear ring and italic speed
 * digits at the lower right; skill popups (chain points x multiplier, named
 * skill and points) at the top centre; the running event panel (current best,
 * event, big live value, time, progress) at the bottom centre; the event card
 * at a marker; countdown; results with stars and standings; messages; the pause menu
 * (resume, reset, time of day, machine from the vehicle registry, autopilot,
 * ambient traffic, travel to discovered events, exit) and a full world map.
 */
export class FestivalHud {
  readonly root: HTMLElement;
  private readonly mapImage: HTMLCanvasElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly nodes = new Map<string, HTMLElement>();
  private lastCard = '';
  /** Rendered results (event and time): every status message is a new
   * structured clone, so identity would rebuild the card at 10 Hz and eat
   * mouse clicks on CONTINUE. */
  private lastResult = '';
  private routeEvent: FestivalEvent | null = null;
  private mapSelection = '';
  private mapFilter = 'all';
  private discovered = new Set<string>();
  private playerAt = { x: 0, z: 0 };
  private mapRevision = '';
  private previousPadButtons = new Set<number>();
  private readonly listeners = new AbortController();
  private photoOpen = false;
  private gaugeVehicle = '';
  private scale = gaugeScale(8000);
  private lastSpeed = -1;
  private lastAward = 0;
  /** Saved bests (the session's FestivalSave.best, updated in place). */
  best: FestivalBest | null = null;
  menuOpen = false;
  mapOpen = false;
  constructor(
    parent: HTMLElement,
    readonly world: OpenWorld,
    readonly events: readonly FestivalEvent[],
    readonly vehicles: readonly VehicleDefinition[],
    private readonly callbacks: FestivalHudCallbacks,
  ) {
    const root = document.createElement('section');
    root.className = 'fest-hud';
    root.id = 'festivalHud';
    root.setAttribute('aria-label', 'Festival');
    root.innerHTML = `
      <div class="fest-pace" id="festPace" aria-label="Corner advisory" hidden><span class="fest-eyebrow">ROUTE ADVISORY</span><b id="festPaceTurn"></b><span id="festPaceAction"></span><small id="festPaceSurface"></small></div>
      <div class="fest-drift" id="festDrift" aria-label="Drift angle advisory" hidden><div><span id="festDriftAction"></span><b id="festDriftAngle"></b></div><div class="fest-drift-track"><i id="festDriftMarker"></i></div><small id="festDriftTip"></small></div>
      <div class="fest-hint" id="festHint"><kbd>C</kbd> CAMERA · <kbd>T</kbd> MAP · <kbd>ESC</kbd> MENU</div>
      <div class="fest-explore" id="festExplore"><span class="fest-eyebrow">THE ROAD IS YOURS</span><b id="festExploreName">Explore Solvane Coast</b><small id="festExploreDistance"></small></div>
      <div class="fest-skills" id="festSkills" hidden role="status" aria-label="Skill chain"><div class="fest-chain-track" aria-hidden="true"><i id="festSkillTimer"></i></div><div class="fest-skill-total"><b id="festSkillScore">0</b><i id="festSkillMultiplier">x1.0</i></div><div class="fest-skill-line"><span id="festSkillName"></span><b id="festSkillPoints"></b></div><small id="festSkillBank"></small><span class="fest-sr" id="festSkillLabel"></span></div>
      <div class="fest-event" id="festEvent" hidden role="group" aria-label="Running event"><div class="fest-event-best"><span>Current Best</span><b id="festEventBest">—</b></div><div class="fest-event-head"><i class="fest-event-icon" id="festEventIcon" aria-hidden="true"></i><h2 id="festEventName"></h2><em id="festEventSide"></em></div><div class="fest-event-value"><span class="fest-chevrons" aria-hidden="true"></span><b id="festEventBig"></b><span class="fest-chevrons" aria-hidden="true"></span></div><div class="fest-row" id="festEventRow"></div><div class="fest-progress"><i id="festProgress"></i></div></div>
      <div class="fest-countdown" id="festCountdown" hidden></div>
      <div class="fest-message" id="festMessage" role="status" aria-live="polite" hidden></div>
      <div class="fest-card" id="festCard" hidden role="dialog" aria-label="Event"></div>
      <div class="fest-results" id="festResults" hidden role="dialog" aria-label="Event results"></div>
      <div class="fest-menu" id="festMenu" hidden role="dialog" aria-label="Festival menu"></div>
      <div class="fest-map" id="festMap" hidden role="dialog" aria-modal="true" aria-label="World map"><header><div><span class="fest-eyebrow">MOTOBOUND / EXPLORE</span><h2>Solvane Coast</h2></div><button class="fest-secondary" data-fest="mapClose">CLOSE</button></header><div class="fest-map-layout"><div class="fest-map-art"><canvas id="festMapCanvas" width="1024" height="1024" aria-label="Solvane road network and selected event route"></canvas><span class="fest-map-key">N ↑ &nbsp; PAVED ROADS · MOUNTAIN PASSES · DIRT TRAILS</span></div><aside><div class="fest-map-filters"><button data-fest="mapFilter" data-value="all" aria-pressed="true">All</button><button data-fest="mapFilter" data-value="races" aria-pressed="false">Races</button><button data-fest="mapFilter" data-value="skills" aria-pressed="false">Skills</button></div><div id="festMapEvents" class="fest-map-events"></div><div id="festMapDetail" class="fest-map-detail"></div></aside></div></div>
      <div class="fest-photo" id="festPhoto" hidden><div><span class="fest-eyebrow">MOTOBOUND / PHOTO MODE</span><b>Find your angle.</b><span>Drag to orbit · Scroll to zoom</span></div><nav><button data-fest="photoLeft" aria-label="Orbit camera left">←</button><button data-fest="photoRight" aria-label="Orbit camera right">→</button><button data-fest="photoHide">HIDE CONTROLS</button><button data-fest="photoClose">RETURN TO DRIVE <kbd>ESC</kbd></button></nav></div>
      <div class="fest-minimap"><canvas id="festMinimap" width="360" height="360" aria-label="Minimap: heading up, the event route in cyan"></canvas><span class="fest-north" id="festNorth" aria-hidden="true">N</span></div>
      <div class="fest-pills"><div class="fest-road" role="status" aria-label="Road"><span class="fest-limit" id="festLimit" aria-label="Speed limit">90</span><b id="festRoad">—</b><span id="festSurface">asphalt</span></div><span class="fest-pill" id="festDiscovered">0 DISCOVERED</span></div>
      <div class="fest-speed" role="group" aria-label="Speed, gear and revs"><span class="fest-machine-label" id="festMachineName"></span><svg class="fest-gauge" viewBox="0 0 220 190" aria-hidden="true">${gaugeArcs()}<g id="festTicks"></g><circle class="fest-gear-ring" cx="${GAUGE.cx}" cy="${GAUGE.cy}" r="19"></circle><text class="fest-gear" id="festGear" x="${GAUGE.cx}" y="${GAUGE.cy + 1}">N</text></svg><div class="fest-speed-readout"><small>KM/H</small><b id="festSpeed" aria-label="0 kilometres per hour"><span class="fest-dim">00</span>0</b></div><span class="fest-drive-state" id="festDriveState">FREE ROAM</span></div>`;
    parent.appendChild(root);
    this.root = root;
    this.minimap = this.get('festMinimap') as HTMLCanvasElement;
    this.mapImage = this.paintMap();
    root.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-fest]');
      if (!button) return;
      const value = button.dataset.value ?? '';
      switch (button.dataset.fest) {
        case 'start':
          this.callbacks.start(value);
          break;
        case 'continue':
          this.callbacks.continue();
          break;
        case 'cancel':
          this.callbacks.cancel();
          break;
        case 'reset':
          this.callbacks.reset();
          break;
        case 'resume':
          this.callbacks.resume();
          break;
        case 'exit':
          this.callbacks.exit();
          break;
        case 'lighting':
          this.callbacks.lighting(value as LightingMode);
          break;
        case 'season':
          this.callbacks.season?.(value as Season);
          break;
        case 'vehicle':
          this.callbacks.vehicle(value);
          break;
        case 'travel':
          this.callbacks.travel(value);
          break;
        case 'autopilot':
          this.callbacks.autopilot(value === 'on');
          break;
        case 'traffic':
          this.callbacks.traffic(value === 'on');
          break;
        case 'mapClose':
          this.showMap(false);
          break;
        case 'map':
          this.callbacks.map?.();
          break;
        case 'mapFilter':
          this.mapFilter = value;
          this.mapRevision = '';
          this.showMap(true);
          break;
        case 'mapSelect':
          this.mapSelection = value;
          this.mapRevision = '';
          this.showMap(true);
          break;
        case 'photo':
          this.callbacks.photo?.(true);
          break;
        case 'photoClose':
          this.callbacks.photo?.(false);
          break;
        case 'photoLeft':
          this.callbacks.photoAngle?.(-Math.PI / 8);
          break;
        case 'photoRight':
          this.callbacks.photoAngle?.(Math.PI / 8);
          break;
        case 'photoHide':
          this.get('festPhoto').classList.toggle('fest-photo-minimal');
          button.textContent = this.get('festPhoto').classList.contains('fest-photo-minimal')
            ? 'SHOW CONTROLS'
            : 'HIDE CONTROLS';
          break;
      }
    });
    root.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Tab') return;
        const panel = this.activePanel(),
          buttons = panel ? this.focusable(panel) : [];
        if (!buttons.length) return;
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      },
      { signal: this.listeners.signal },
    );
  }
  get(id: string) {
    let node = this.nodes.get(id);
    if (!node) {
      node = this.root.querySelector<HTMLElement>(`#${id}`)!;
      this.nodes.set(id, node);
    }
    return node;
  }
  private text(id: string, value: string) {
    const node = this.get(id);
    if (node.textContent !== value) node.textContent = value;
  }
  private show(id: string, visible: boolean) {
    const node = this.get(id);
    if (node.hidden === visible) node.hidden = !visible;
  }
  /** The road network, sea and towns pre-drawn once (north up, east on
   * the left: see festival-map.ts). */
  private paintMap() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = MAP_SIZE;
    const ctx = canvas.getContext('2d')!;
    const net = this.world.network,
      field = this.world.field;
    // Ground relief: a coarse shaded height map, lit from the image's left,
    // one pixel per cell and upscaled bilinearly (no blocks on the minimap).
    const cells = 256,
      cell = MAP_SIZE / cells,
      step = (2 * MAP_HALF) / cells;
    const relief = document.createElement('canvas');
    relief.width = relief.height = cells;
    const pixels = relief.getContext('2d')!;
    for (let j = 0; j < cells; j++)
      for (let i = 0; i < cells; i++) {
        const [x, z] = mapToWorld((i + 0.5) * cell, (j + 0.5) * cell),
          h = field.height(x, z, step),
          // Rise toward the image's right (world -x).
          hx = field.height(x - step, z, step) - h;
        const shade = Math.max(0.55, Math.min(1.25, 0.9 - (hx / step) * 2.2));
        // Satellite-like palette (ref 055): deep forest greens, lighter
        // farmland, turquoise shallows into a dark blue sea.
        let r: number, g: number, b: number;
        const depth = field.region.seaLevel - h;
        if (depth > 6) [r, g, b] = [16, 44, 70];
        else if (depth > 0) [r, g, b] = [28 + depth * -2, 104 - depth * 9, 118 - depth * 7];
        else if (h > field.snowLine(x, z)) [r, g, b] = [214, 218, 224];
        else if (field.forestDensity(x, z) > 0.45) [r, g, b] = [36, 62, 33];
        else [r, g, b] = [74 + h * 0.03, 96 + h * 0.01, 50];
        pixels.fillStyle = `rgb(${(r * shade) | 0},${(g * shade) | 0},${(b * shade) | 0})`;
        pixels.fillRect(i, j, 1, 1);
      }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(relief, 0, 0, MAP_SIZE, MAP_SIZE);
    // Roads by class: paved roads white, trails orange (ref 055).
    const style: Record<string, [string, number]> = {
      highway: ['#fbfbf8', 7],
      runway: ['#c3c8cc', 12],
      country: ['#eef0f0', 4.4],
      mountain: ['#eef0f0', 4.4],
      town: ['#dfe3e8', 3.6],
      dirt: ['#e0864f', 3.2],
    };
    for (const pass of [0, 1])
      for (const e of net.edges) {
        const [stroke, width] = style[e.roadClass];
        ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.55)' : stroke;
        ctx.lineWidth = pass === 0 ? width + 3 : width;
        ctx.lineJoin = ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = e.first; i <= e.last; i += 2) {
          const [x, y] = worldToMap(net.x[i], net.z[i]);
          if (i === e.first) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineTo(...worldToMap(net.x[e.last], net.z[e.last]));
        ctx.stroke();
      }
    return canvas;
  }
  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    discovered: ReadonlySet<string>,
    radius: number,
  ) {
    for (const event of this.events) {
      const [x, y] = worldToMap(event.marker.x, event.marker.z),
        known = discovered.has(event.spec.id);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = known ? colour(EVENT_COLOURS[event.spec.kind]) : 'rgba(200,200,200,0.45)';
      ctx.lineWidth = radius * 0.55;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
      ctx.fill();
      ctx.lineWidth = radius * 0.28;
      ctx.strokeStyle = known ? '#ffffff' : 'rgba(255,255,255,0.5)';
      ctx.stroke();
    }
  }
  /** The event route: a cyan line with a dark casing (ref 041/042). */
  private drawRoute(ctx: CanvasRenderingContext2D, width: number, event = this.routeEvent) {
    if (!event) return;
    const path = event.path;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < path.count; i += 3) {
      const [x, y] = worldToMap(path.x[i], path.z[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (path.closed) ctx.closePath();
    ctx.strokeStyle = 'rgba(4, 30, 38, 0.75)';
    ctx.lineWidth = width * 1.7;
    ctx.stroke();
    ctx.strokeStyle = '#2fd8ee';
    ctx.lineWidth = width;
    ctx.stroke();
  }
  /** Circular heading-up minimap (ref 041/042): ±420 m across, the player a
   * fifth of the radius below the centre so more road shows ahead; the
   * north marker rides the ring. `heading` from minimapHeading(forward). */
  private paintMinimap(x: number, z: number, heading: number, discovered: ReadonlySet<string>) {
    const ctx = this.minimap.getContext('2d')!,
      size = this.minimap.width,
      range = 420,
      lift = size * 0.1;
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(9, 13, 17, 0.62)';
    ctx.fillRect(0, 0, size, size);
    const [a, b, c, d, e, f] = minimapMatrix(x, z, heading, size, range);
    ctx.setTransform(a, b, c, d, e, f + lift);
    ctx.globalAlpha = 0.86;
    ctx.drawImage(this.mapImage, 0, 0);
    ctx.globalAlpha = 1;
    this.drawRoute(ctx, 5.2);
    this.drawMarkers(ctx, discovered, 7.5);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Inner rim shade, as the reference's glass ring.
    const rim = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.36,
      size / 2,
      size / 2,
      size / 2,
    );
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = rim;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
    // Player arrow (always up).
    const px = size / 2,
      py = size / 2 + lift;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py - 17);
    ctx.lineTo(px + 12, py + 13);
    ctx.lineTo(px, py + 6);
    ctx.lineTo(px - 12, py + 13);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    this.get('festNorth').style.setProperty('--north', `${heading.toFixed(4)}rad`);
  }
  showMap(open: boolean, discovered: ReadonlySet<string> = this.discovered, at = this.playerAt) {
    const wasOpen = this.mapOpen;
    const focused =
      document.activeElement instanceof HTMLElement &&
      this.get('festMap').contains(document.activeElement)
        ? {
            action: document.activeElement.dataset.fest,
            value: document.activeElement.dataset.value,
          }
        : null;
    this.mapOpen = open;
    this.root.classList.toggle('fest-map-active', open);
    this.show('festMap', open);
    if (!open) {
      if (this.menuOpen)
        this.get('festMenu').querySelector<HTMLElement>('[data-fest="resume"]')?.focus();
      return;
    }
    const selected =
      this.events.find((event) => event.spec.id === this.mapSelection) ?? this.routeEvent;
    this.discovered = new Set(discovered);
    this.playerAt = at;
    const revision = `${[...discovered].join(',')}:${this.mapFilter}:${selected?.spec.id ?? ''}`;
    if (revision !== this.mapRevision) {
      this.mapRevision = revision;
      this.get('festMapEvents').innerHTML = this.events
        .filter(
          (event) =>
            this.mapFilter === 'all' || (this.mapFilter === 'races') === isRace(event.spec.kind),
        )
        .map(
          (event) =>
            `<button data-fest="mapSelect" data-value="${escapeHtml(event.spec.id)}" aria-pressed="${selected?.spec.id === event.spec.id}" style="--event-colour:${colour(EVENT_COLOURS[event.spec.kind])}"><i></i><span><b>${escapeHtml(event.spec.name)}</b><small>${escapeHtml(EVENT_KIND_LABEL[event.spec.kind])} · ${(event.distance / 1000).toFixed(1)} KM</small></span><em>${discovered.has(event.spec.id) ? '●' : '◇'}</em></button>`,
        )
        .join('');
      this.get('festMapDetail').innerHTML = selected
        ? `<span class="fest-eyebrow">${discovered.has(selected.spec.id) ? 'DISCOVERED EVENT' : 'EXPLORE THE REGION'}</span><h3>${escapeHtml(selected.spec.name)}</h3><p>${escapeHtml(selected.spec.blurb)}</p>${discovered.has(selected.spec.id) ? `<button class="fest-primary" data-fest="travel" data-value="${escapeHtml(selected.spec.id)}">TRAVEL TO EVENT</button>` : '<p class="fest-muted">Drive near the marker to discover this event and unlock fast travel.</p>'}`
        : '<span class="fest-eyebrow">CHOOSE YOUR NEXT DRIVE</span><p>Select an event to preview its route. Discovered events are available for fast travel.</p>';
      for (const button of this.get('festMap').querySelectorAll<HTMLElement>(
        '[data-fest="mapFilter"]',
      ))
        button.setAttribute('aria-pressed', String(button.dataset.value === this.mapFilter));
    }
    const canvas = this.get('festMapCanvas') as HTMLCanvasElement,
      ctx = canvas.getContext('2d')!;
    ctx.drawImage(this.mapImage, 0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(canvas.width / MAP_SIZE, canvas.height / MAP_SIZE);
    this.drawRoute(ctx, 14, selected ?? null);
    this.drawMarkers(ctx, discovered, 22);
    ctx.font = '600 28px "Saira Variable", sans-serif';
    ctx.fillStyle = '#f4f6f8';
    for (const event of this.events) {
      if (event !== selected) continue;
      const [x, y] = worldToMap(event.marker.x, event.marker.z);
      ctx.fillText(event.spec.name, x + 28, y + 10);
    }
    if (at) {
      const [x, y] = worldToMap(at.x, at.z);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (!wasOpen) this.get('festMap').querySelector<HTMLElement>('[data-fest="mapClose"]')?.focus();
    else if (focused) {
      const target = [...this.get('festMap').querySelectorAll<HTMLElement>('button')].find(
        (button) =>
          button.dataset.fest === focused.action && button.dataset.value === focused.value,
      );
      target?.focus();
    }
  }
  update(
    status: FestivalStatus,
    x: number,
    z: number,
    heading: number,
    gear: number,
    rpm01: number,
    pace: PaceCue | null = null,
    drift: DriftCue | null = null,
  ) {
    const showPace =
      !!pace &&
      !!status.event &&
      status.mode !== 'finished' &&
      !this.menuOpen &&
      !this.mapOpen &&
      !this.photoOpen;
    this.show('festPace', showPace);
    if (pace && showPace) {
      this.get('festPace').dataset.action = pace.action;
      this.text(
        'festPaceTurn',
        `${pace.direction === 'left' ? '↰ LEFT' : 'RIGHT ↱'} ${pace.severity.toUpperCase()} · ${Math.round(pace.distance / 10) * 10} M`,
      );
      this.text(
        'festPaceAction',
        `${pace.action === 'brake' ? 'BRAKE EARLY' : pace.action === 'lift' ? 'EASE OFF' : 'LOOK AHEAD'} · ~${Math.max(5, Math.round((pace.targetSpeed * 3.6) / 5) * 5)} KM/H`,
      );
      this.text(
        'festPaceSurface',
        `${pace.wet ? 'WET · ' : ''}${pace.loose ? 'LOOSE SURFACE' : 'PAVED'} · GUIDE, NOT A LIMIT`,
      );
    }
    const showDrift =
      !!drift &&
      status.road.onRoad &&
      !status.autopilot &&
      status.mode !== 'countdown' &&
      status.mode !== 'finished' &&
      !this.menuOpen &&
      !this.mapOpen &&
      !this.photoOpen;
    this.show('festDrift', showDrift);
    if (drift && showDrift) {
      this.get('festDrift').dataset.action = drift.action;
      this.text(
        'festDriftAction',
        drift.action === 'build'
          ? 'BUILD ANGLE'
          : drift.action === 'recover'
            ? 'REDUCE ANGLE'
            : 'CONTROLLED SLIDE',
      );
      this.text('festDriftAngle', `${Math.round(drift.angleDegrees)}° ${drift.side.toUpperCase()}`);
      this.get('festDriftMarker').style.left = `${(drift.marker * 100).toFixed(1)}%`;
      this.text(
        'festDriftTip',
        drift.action === 'recover'
          ? 'Ease the slide. Look toward the exit.'
          : drift.action === 'build'
            ? 'Carry momentum into the corner.'
            : 'Balance throttle. Countersteer smoothly.',
      );
    }
    const discovered = new Set(status.discovered);
    this.discovered = discovered;
    this.playerAt = { x, z };
    this.text('festDiscovered', `${discovered.size}/${this.events.length} DISCOVERED`);
    this.text(
      'festMachineName',
      this.vehicles.find((v) => v.id === status.vehicleId)?.name ?? status.vehicleId,
    );
    this.text(
      'festDriveState',
      status.autopilot ? 'AUTOPILOT · ASSISTED' : status.event ? 'EVENT IN PROGRESS' : 'FREE ROAM',
    );
    this.root.classList.toggle('fest-in-event', !!status.event);
    this.root.classList.toggle('fest-overlay-open', this.menuOpen || this.mapOpen);
    this.pollGamepad();
    this.text('festRoad', status.road.onRoad ? status.road.name : 'Off road');
    this.text('festSurface', status.road.surface);
    this.text('festLimit', String(status.road.limitKmh));
    this.speedometer(status, gear, rpm01);
    this.skillPopup(status);
    const nearby = this.events
      .filter((event) => !discovered.has(event.spec.id))
      .sort(
        (a, b) =>
          Math.hypot(a.marker.x - x, a.marker.z - z) - Math.hypot(b.marker.x - x, b.marker.z - z),
      )[0];
    this.show('festExplore', !status.event && !this.menuOpen && !this.mapOpen && !this.photoOpen);
    if (nearby) {
      this.text('festExploreName', nearby.spec.name);
      this.text(
        'festExploreDistance',
        `${(Math.hypot(nearby.marker.x - x, nearby.marker.z - z) / 1000).toFixed(1)} KM AWAY · ${EVENT_KIND_LABEL[nearby.spec.kind].toUpperCase()}`,
      );
    } else {
      this.text('festExploreName', 'Every road has a story.');
      this.text('festExploreDistance', `${discovered.size} EVENTS DISCOVERED · CHASE YOUR BEST`);
    }
    // Running event.
    const ev = status.event;
    this.routeEvent = ev
      ? (this.events.find((e) => e.spec.id === ev.id) ?? null)
      : status.card
        ? (this.events.find((e) => e.spec.id === status.card!.id) ?? null)
        : null;
    this.show('festEvent', !!ev && status.mode !== 'finished');
    if (ev) this.eventPanel(ev);
    const count = ev && status.mode === 'countdown' ? Math.ceil(ev.countdown) : 0;
    this.show('festCountdown', count > 0);
    if (count > 0) this.text('festCountdown', String(count));
    // Card at a race marker.
    const card = status.mode === 'card' ? status.card : null;
    const cardKey = card ? card.id : '';
    if (cardKey !== this.lastCard) {
      this.lastCard = cardKey;
      const node = this.get('festCard');
      node.hidden = !card;
      if (card) {
        this.root.style.setProperty(
          '--fest-accent',
          colour(EVENT_COLOURS[card.kind as keyof typeof EVENT_COLOURS] ?? 0xff6a2a),
        );
        node.innerHTML = `<div class="fest-kind">${escapeHtml(EVENT_KIND_LABEL[card.kind as keyof typeof EVENT_KIND_LABEL] ?? card.kind)}</div>
          <h2>${escapeHtml(card.name)}</h2><p>${escapeHtml(card.blurb)}</p>
          <dl><div><dt>DISTANCE</dt><dd>${card.distanceKm.toFixed(1)} km</dd></div>${card.laps > 1 ? `<div><dt>LAPS</dt><dd>${card.laps}</dd></div>` : ''}<div><dt>RIVALS</dt><dd>${card.rivals}</dd></div></dl>
          <button class="fest-primary" data-fest="start" data-value="${escapeHtml(card.id)}">START EVENT <kbd>ENTER</kbd></button><button class="fest-secondary" data-fest="cancel">NOT NOW</button>`;
      }
    }
    // Results.
    const result = status.mode === 'finished' ? status.result : null,
      resultKey = result ? `${result.eventId}:${result.at}` : '';
    if (resultKey !== this.lastResult) {
      this.lastResult = resultKey;
      const node = this.get('festResults');
      node.hidden = !result || !isRace(result.eventKind);
      if (result && isRace(result.eventKind)) node.innerHTML = this.resultsHtml(result);
    }
    this.text('festMessage', status.message ?? '');
    this.show('festMessage', !!status.message && !this.menuOpen);
    if (!this.photoOpen) this.paintMinimap(x, z, heading, discovered);
  }
  /** Arc rev gauge with redline, gear ring and three italic digits (leading
   * zeros dimmed), rebuilt only when the machine changes. */
  private speedometer(status: FestivalStatus, gear: number, rpm01: number) {
    const machine = this.vehicles.find((v) => v.id === status.vehicleId);
    if (machine && machine.id !== this.gaugeVehicle) {
      this.gaugeVehicle = machine.id;
      this.scale = gaugeScale(machine.spec.limiterRPM);
      this.get('festTicks').innerHTML = gaugeTicks(this.scale);
      this.get('festRedline').setAttribute('d', arcPath(this.scale.red, 1, GAUGE.r + 3.5));
    }
    const kmh = Math.max(0, Math.min(999, Math.round(status.speedKmh)));
    if (kmh !== this.lastSpeed) {
      this.lastSpeed = kmh;
      const digits = String(kmh).padStart(3, '0'),
        lead = digits.length - String(kmh).length;
      const node = this.get('festSpeed');
      node.innerHTML = `${lead ? `<span class="fest-dim">${digits.slice(0, lead)}</span>` : ''}${digits.slice(lead)}`;
      node.setAttribute('aria-label', `${kmh} kilometres per hour`);
    }
    this.get('festSpeed').classList.toggle(
      'fest-over-limit',
      status.speedKmh > status.road.limitKmh + 10,
    );
    this.text('festGear', gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear));
    const spec = machine?.spec;
    const rpm = spec
      ? spec.idleRPM + Math.max(0, Math.min(1, rpm01)) * (spec.limiterRPM - spec.idleRPM)
      : Math.max(0, Math.min(1, rpm01)) * this.scale.max * 900;
    const fraction = Math.max(0, Math.min(1, rpm / (this.scale.max * 1000)));
    const arc = this.get('festRpm');
    arc.style.strokeDashoffset = (1 - fraction).toFixed(4);
    arc.classList.toggle('fest-gauge-hot', fraction >= this.scale.red);
  }
  /** Top-centre skill popup: chain points x multiplier in yellow, the named
   * skill and its points below, the bank timer above; a new award pops. */
  private skillPopup(status: FestivalStatus) {
    const skills = status.skills;
    this.show(
      'festSkills',
      !!skills && skills.phase !== 'idle' && !this.menuOpen && !this.mapOpen && !this.photoOpen,
    );
    if (!skills) return;
    const node = this.get('festSkills');
    node.dataset.phase = skills.phase;
    this.text('festSkillLabel', skills.label);
    this.text('festSkillScore', points(skills.phase === 'banked' ? skills.lastBank : skills.score));
    this.text(
      'festSkillMultiplier',
      skills.phase === 'active'
        ? `x${skills.multiplier.toFixed(1)}`
        : skills.phase === 'banked'
          ? 'BANKED'
          : '',
    );
    const skill = skills.skill;
    this.text('festSkillName', skill ? titleCase(skill.name) : titleCase(skills.label));
    this.text('festSkillPoints', skill ? points(skill.points) : '');
    this.text(
      'festSkillBank',
      skills.phase === 'active'
        ? `${points(skills.total)} PTS TO BANK`
        : skills.phase === 'lost'
          ? skills.label
          : `SESSION ${points(skills.sessionTotal)} PTS`,
    );
    this.get('festSkillTimer').style.transform =
      `scaleX(${Math.min(1, skills.bankRemaining / 4).toFixed(3)})`;
    const award = skills.award?.id ?? 0;
    if (award !== this.lastAward) {
      this.lastAward = award;
      if (award) {
        // Restart the pop animation for each newly completed skill.
        node.classList.remove('fest-skill-pop');
        void node.offsetWidth;
        node.classList.add('fest-skill-pop');
      }
    }
  }
  /** Bottom-centre event panel (ref 041/042): current best, the event and
   * its format icon, a big live value between chevrons, time and progress. */
  private eventPanel(ev: NonNullable<FestivalStatus['event']>) {
    const kind = ev.kind as keyof typeof EVENT_COLOURS;
    this.root.style.setProperty('--fest-accent', colour(EVENT_COLOURS[kind] ?? 0xff6a2a));
    this.get('festEvent').dataset.kind = ev.kind;
    this.text('festEventName', ev.name);
    const race = isRace(ev.kind as never);
    const best = this.best?.[ev.id];
    this.text(
      'festEventBest',
      !best
        ? '—'
        : race
          ? best.time !== null
            ? clock(best.time)
            : '—'
          : best.value === null
            ? '—'
            : ev.kind === 'drift-zone'
              ? `${points(best.value)} PTS`
              : `${Math.round(best.value)} KM/H`,
    );
    let big: string;
    if (race) big = `${ordinal(ev.position)} / ${ev.entrants}`;
    else if (ev.kind === 'drift-zone') big = `${points(Number(ev.live?.value ?? 0))} PTS`;
    else big = ev.live?.value ?? '—';
    this.text('festEventBig', big);
    this.text(
      'festEventSide',
      ev.laps > 1 ? `LAP ${ev.lap}/${ev.laps}` : `${Math.round(ev.progress * 100)}%`,
    );
    const cells: [string, string][] = [['TIME', clock(ev.elapsed)]];
    if (ev.live && race) cells.push([ev.live.label, ev.live.value]);
    else if (ev.live && ev.kind !== 'drift-zone') cells.push([ev.live.label, ev.live.value]);
    if (ev.offRoute) cells.push(['ROUTE', 'RETURN TO ROUTE']);
    const html = cells
      .map(([k, v]) => `<div><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`)
      .join('');
    const row = this.get('festEventRow');
    if (row.innerHTML !== html) row.innerHTML = html;
    this.get('festProgress').style.transform = `scaleX(${ev.progress.toFixed(4)})`;
  }
  private resultsHtml(r: FestivalResult) {
    const rows = r.standings
      .map(
        (s, i) =>
          `<tr class="${s.car === 0 ? 'fest-you' : ''}"><td>${i + 1}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.vehicleId.toUpperCase())}</td><td>${s.time !== null ? clock(s.time) : `${Math.round(s.progress * 100)}%`}</td></tr>`,
      )
      .join('');
    const headline = r.abandoned
      ? 'DID NOT FINISH'
      : r.position === 1
        ? 'WINNER'
        : `P${r.position} OF ${r.entrants}`;
    return `<div class="fest-kind">${escapeHtml(EVENT_KIND_LABEL[r.eventKind])} · RESULT</div><h2>${escapeHtml(r.eventName)} — ${headline}</h2>
      <div class="fest-stars" aria-label="${r.stars} of 3 stars">${stars(r.stars)}</div>
      ${r.time !== null ? `<div>Time ${clock(r.time)}${r.assisted ? ' · autopilot assisted' : ''}</div>` : ''}
      <table>${rows}</table>
      <button class="fest-primary" data-fest="continue">CONTINUE <kbd>ENTER</kbd></button>`;
  }
  /** Pause menu (free roam): resume, reset, time of day, machine, autopilot,
   * traffic, travel, exit. */
  showMenu(
    open: boolean,
    state?: {
      lighting: LightingMode;
      vehicle: string;
      discovered: readonly string[];
      autopilot: boolean;
      inEvent: boolean;
      traffic?: boolean;
      season?: Season;
    },
  ) {
    this.menuOpen = open;
    this.root.classList.toggle('fest-menu-active', open);
    const node = this.get('festMenu');
    node.hidden = !open;
    if (!open || !state) return;
    const pressed = (on: boolean) => `aria-pressed="${on}"`;
    const lightings: [LightingMode, string][] = [
      ['day', 'Day'],
      ['sunset', 'Golden hour'],
      ['night', 'Night'],
    ];
    node.innerHTML = `<header class="fest-menu-heading"><div><span class="fest-eyebrow">MOTOBOUND / FESTIVAL</span><h2>The open road.</h2><p>Solvane Coast · ${state.discovered.length} of ${this.events.length} events discovered</p></div><span class="fest-menu-mark">S<span>COAST</span></span></header>
      <div class="fest-menu-actions"><button class="fest-primary" data-fest="resume">RESUME</button><button class="fest-secondary" data-fest="reset">RESET TO ROAD</button>${state.inEvent ? '<button class="fest-secondary" data-fest="cancel">ABANDON EVENT</button>' : ''}<button class="fest-secondary" data-fest="exit">EXIT FESTIVAL</button>${this.callbacks.map ? '<button class="fest-secondary" data-fest="map">WORLD MAP</button>' : ''}${this.callbacks.photo ? '<button class="fest-secondary" data-fest="photo">PHOTO MODE</button>' : ''}</div>
      <div class="fest-menu-columns"><div>
      <section><h3>Time of day</h3><div class="fest-options">${lightings.map(([m, label]) => `<button data-fest="lighting" data-value="${m}" ${pressed(state.lighting === m)}>${label}</button>`).join('')}</div></section>
      ${this.callbacks.season ? `<section><h3>Season</h3><div class="fest-options">${SEASONS.map((m) => `<button data-fest="season" data-value="${m}" ${pressed((state.season ?? 'summer') === m)}>${SEASON_LABEL[m]}</button>`).join('')}</div></section>` : ''}
      <section><h3>Your machine <span>${this.vehicles.length} AVAILABLE</span></h3><div class="fest-options fest-garage">${this.vehicles.map((v) => `<button data-fest="vehicle" data-value="${escapeHtml(v.id)}" ${pressed(state.vehicle === v.id)}><span>${escapeHtml(v.name)}</span><small>${escapeHtml(v.classId.toUpperCase())} · ${Math.round(v.spec.dryMass).toLocaleString('en')} KG</small></button>`).join('')}</div></section></div><div>
      <section><h3>Autopilot</h3><div class="fest-options"><button data-fest="autopilot" data-value="on" ${pressed(state.autopilot)}>On</button><button data-fest="autopilot" data-value="off" ${pressed(!state.autopilot)}>Off</button></div></section>
      <section><h3>Ambient traffic</h3><div class="fest-options"><button data-fest="traffic" data-value="on" ${pressed(state.traffic !== false)}>Traffic on</button><button data-fest="traffic" data-value="off" ${pressed(state.traffic === false)}>Traffic off</button>${state.inEvent ? '<span>Off while an event runs.</span>' : ''}</div></section>
      <section><h3>Travel to a discovered event</h3><div class="fest-options">${
        this.events
          .filter((e) => state.discovered.includes(e.spec.id))
          .map(
            (e) =>
              `<button data-fest="travel" data-value="${escapeHtml(e.spec.id)}">${escapeHtml(e.spec.name)} · ${escapeHtml(EVENT_KIND_LABEL[e.spec.kind])}</button>`,
          )
          .join('') || '<span>Drive near an event marker to discover it.</span>'
      }</div></section><section class="fest-driving-note"><h3>Make the drive count</h3><p>Link clean speed and drifts into a skill chain. Keep the car clear of impacts, then let the chain bank. Autopilot runs are marked assisted.</p><p><kbd>R</kbd> Reset to road &nbsp; <kbd>G</kbd> Autopilot</p></section></div></div>`;
    node.querySelector<HTMLElement>('[data-fest="resume"]')?.focus();
  }
  /** Is a dialog that owns Enter visible? */
  get cardOpen() {
    return !this.get('festCard').hidden;
  }
  get resultsOpen() {
    return !this.get('festResults').hidden;
  }
  showPhoto(open: boolean) {
    this.photoOpen = open;
    this.root.classList.toggle('fest-photo-active', open);
    this.show('festPhoto', open);
    if (open) {
      this.showMenu(false);
      this.showMap(false);
      this.get('festPhoto').classList.remove('fest-photo-minimal');
      this.get('festPhoto').querySelector<HTMLButtonElement>(
        '[data-fest="photoHide"]',
      )!.textContent = 'HIDE CONTROLS';
      this.get('festPhoto').querySelector<HTMLElement>('[data-fest="photoClose"]')?.focus();
    }
  }
  private activePanel() {
    return this.photoOpen
      ? this.get('festPhoto')
      : this.mapOpen
        ? this.get('festMap')
        : this.menuOpen
          ? this.get('festMenu')
          : null;
  }
  private focusable(panel: HTMLElement) {
    return [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(
      (button) => button.getClientRects().length > 0,
    );
  }
  private pollGamepad() {
    const panel = this.activePanel();
    let pad: Gamepad | null | undefined;
    try {
      pad = navigator.getGamepads?.().find((pad) => pad?.connected);
    } catch {
      // Embedded/privacy-restricted contexts may deny the Gamepad API.
      // Keyboard and pointer menus still work in those contexts.
      this.previousPadButtons.clear();
      return;
    }
    if (!pad) {
      this.previousPadButtons.clear();
      return;
    }
    const pressed = new Set(
      pad.buttons.map((button, i) => (button.pressed ? i : -1)).filter((i) => i >= 0),
    );
    if (panel) {
      const buttons = this.focusable(panel);
      const fresh = (id: number) => pressed.has(id) && !this.previousPadButtons.has(id);
      if (fresh(12) || fresh(14) || fresh(13) || fresh(15)) {
        const direction = fresh(12) || fresh(14) ? -1 : 1;
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(at + direction + buttons.length) % buttons.length]?.focus();
      }
      if (fresh(0) && panel.contains(document.activeElement))
        (document.activeElement as HTMLButtonElement).click();
      if (fresh(1)) {
        if (this.photoOpen) this.callbacks.photo?.(false);
        else if (this.mapOpen) this.showMap(false);
        else this.callbacks.resume();
      }
    }
    this.previousPadButtons = pressed;
  }
  dispose() {
    this.listeners.abort();
    this.root.remove();
  }
}
