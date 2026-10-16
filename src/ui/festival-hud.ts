import './festival-hud.css';
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
import { MAP_HALF, MAP_SIZE, mapToWorld, minimapMatrix, worldToMap } from './festival-map.ts';

export interface FestivalHudCallbacks {
  start(id: string): void;
  continue(): void;
  cancel(): void;
  reset(): void;
  resume(): void;
  exit(): void;
  lighting(mode: LightingMode): void;
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

/**
 * Festival heads-up display and menus: road name, speed-limit sign and
 * surface; speed, gear and revs; a heading-up minimap of the road network
 * with event markers and the active route; the event card at a marker; the
 * running event (countdown, position, lap, time, progress, live trap/zone/
 * drift metric); results with stars and standings; messages; the pause menu
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
      <div class="fest-road" role="status"><span class="fest-limit" id="festLimit">90</span><div><span class="fest-eyebrow">MOTOBOUND / SOLVANE COAST</span><b id="festRoad">—</b><span id="festSurface">asphalt</span></div></div>
      <div class="fest-hint" id="festHint"><kbd>C</kbd> CAMERA · <kbd>T</kbd> MAP · <kbd>ESC</kbd> MENU</div>
      <div class="fest-explore" id="festExplore"><span class="fest-eyebrow">THE ROAD IS YOURS</span><b id="festExploreName">Explore Solvane Coast</b><small id="festExploreDistance"></small></div>
      <div class="fest-skills" id="festSkills" hidden role="status"><span id="festSkillLabel"></span><div><b id="festSkillScore">0</b><i id="festSkillMultiplier">×1.0</i></div><small id="festSkillBank"></small><div class="fest-chain-track"><i id="festSkillTimer"></i></div></div>
      <div class="fest-event" id="festEvent" hidden><h2 id="festEventName"></h2><div class="fest-row" id="festEventRow"></div><div class="fest-progress"><i id="festProgress"></i></div></div>
      <div class="fest-countdown" id="festCountdown" hidden></div>
      <div class="fest-message" id="festMessage" role="status" aria-live="polite" hidden></div>
      <div class="fest-card" id="festCard" hidden role="dialog" aria-label="Event"></div>
      <div class="fest-results" id="festResults" hidden role="dialog" aria-label="Event results"></div>
      <div class="fest-menu" id="festMenu" hidden role="dialog" aria-label="Festival menu"></div>
      <div class="fest-map" id="festMap" hidden role="dialog" aria-modal="true" aria-label="World map"><header><div><span class="fest-eyebrow">MOTOBOUND / EXPLORE</span><h2>Solvane Coast</h2></div><button class="fest-secondary" data-fest="mapClose">CLOSE</button></header><div class="fest-map-layout"><div class="fest-map-art"><canvas id="festMapCanvas" width="1024" height="1024" aria-label="Solvane road network and selected event route"></canvas><span class="fest-map-key">N ↑ &nbsp; PAVED ROADS · MOUNTAIN PASSES · DIRT TRAILS</span></div><aside><div class="fest-map-filters"><button data-fest="mapFilter" data-value="all" aria-pressed="true">All</button><button data-fest="mapFilter" data-value="races" aria-pressed="false">Races</button><button data-fest="mapFilter" data-value="skills" aria-pressed="false">Skills</button></div><div id="festMapEvents" class="fest-map-events"></div><div id="festMapDetail" class="fest-map-detail"></div></aside></div></div>
      <div class="fest-photo" id="festPhoto" hidden><div><span class="fest-eyebrow">MOTOBOUND / PHOTO MODE</span><b>Find your angle.</b><span>Drag to orbit · Scroll to zoom</span></div><nav><button data-fest="photoLeft" aria-label="Orbit camera left">←</button><button data-fest="photoRight" aria-label="Orbit camera right">→</button><button data-fest="photoHide">HIDE CONTROLS</button><button data-fest="photoClose">RETURN TO DRIVE <kbd>ESC</kbd></button></nav></div>
      <div class="fest-minimap"><span class="fest-map-caption">SOLVANE <i id="festDiscovered">0 DISCOVERED</i></span><canvas id="festMinimap" width="440" height="440" aria-label="Minimap"></canvas></div>
      <div class="fest-speed"><span class="fest-machine-label" id="festMachineName"></span><div class="fest-speed-readout"><b id="festSpeed">0</b><div><strong id="festGear">N</strong><small>GEAR</small></div></div><small>KILOMETRES / HOUR</small><i id="festRpm"></i><span class="fest-drive-state" id="festDriveState">FREE ROAM</span></div>`;
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
    // Ground relief: a coarse shaded height map, lit from the image's left.
    const cells = 256,
      cell = MAP_SIZE / cells,
      step = (2 * MAP_HALF) / cells;
    for (let j = 0; j < cells; j++)
      for (let i = 0; i < cells; i++) {
        const [x, z] = mapToWorld((i + 0.5) * cell, (j + 0.5) * cell),
          h = field.height(x, z, step),
          // Rise toward the image's right (world -x).
          hx = field.height(x - step, z, step) - h;
        const shade = Math.max(0.55, Math.min(1.25, 0.9 - (hx / step) * 2.2));
        let r: number, g: number, b: number;
        if (h < field.region.seaLevel) [r, g, b] = [18, 38, 58];
        else if (h > field.snowLine(x, z)) [r, g, b] = [205, 210, 218];
        else if (field.forestDensity(x, z) > 0.45) [r, g, b] = [34, 58, 34];
        else [r, g, b] = [58 + h * 0.05, 74 + h * 0.03, 46];
        ctx.fillStyle = `rgb(${(r * shade) | 0},${(g * shade) | 0},${(b * shade) | 0})`;
        ctx.fillRect(i * cell, j * cell, cell + 1, cell + 1);
      }
    // Roads by class.
    const style: Record<string, [string, number]> = {
      highway: ['#f2c14e', 7],
      runway: ['#9aa0a6', 12],
      country: ['#eef0f2', 4.2],
      mountain: ['#ff9b5e', 4.2],
      town: ['#c9d2e3', 3.4],
      dirt: ['#b98a5a', 3],
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
      ctx.fill();
      ctx.lineWidth = radius * 0.35;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.stroke();
    }
  }
  private drawRoute(ctx: CanvasRenderingContext2D, width: number, event = this.routeEvent) {
    if (!event) return;
    const path = event.path;
    ctx.strokeStyle = colour(EVENT_COLOURS[event.spec.kind]);
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < path.count; i += 3) {
      const [x, y] = worldToMap(path.x[i], path.z[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (path.closed) ctx.closePath();
    ctx.stroke();
  }
  /** Heading-up minimap around the player (±650 m); `heading` from
   * minimapHeading(forward). */
  private paintMinimap(x: number, z: number, heading: number, discovered: ReadonlySet<string>) {
    const ctx = this.minimap.getContext('2d')!,
      size = this.minimap.width,
      range = 650;
    ctx.save();
    ctx.fillStyle = '#0b1016';
    ctx.fillRect(0, 0, size, size);
    ctx.setTransform(...minimapMatrix(x, z, heading, size, range));
    ctx.drawImage(this.mapImage, 0, 0);
    this.drawRoute(ctx, 6);
    this.drawMarkers(ctx, discovered, 9);
    ctx.restore();
    // Player arrow (always up).
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2 - 16);
    ctx.lineTo(size / 2 + 11, size / 2 + 12);
    ctx.lineTo(size / 2, size / 2 + 6);
    ctx.lineTo(size / 2 - 11, size / 2 + 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
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
  ) {
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
    this.text('festSpeed', String(Math.round(status.speedKmh)));
    this.text('festGear', gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear));
    this.get('festRpm').style.transform = `scaleX(${Math.max(0, Math.min(1, rpm01)).toFixed(3)})`;
    this.get('festSpeed').classList.toggle(
      'fest-over-limit',
      status.speedKmh > status.road.limitKmh + 10,
    );
    const skills = status.skills;
    this.show(
      'festSkills',
      !!skills && skills.phase !== 'idle' && !this.menuOpen && !this.mapOpen && !this.photoOpen,
    );
    if (skills) {
      this.get('festSkills').dataset.phase = skills.phase;
      this.text('festSkillLabel', skills.label);
      this.text(
        'festSkillScore',
        Math.round(skills.phase === 'banked' ? skills.lastBank : skills.score).toLocaleString('en'),
      );
      this.text(
        'festSkillMultiplier',
        skills.phase === 'active'
          ? `×${skills.multiplier.toFixed(1)}`
          : skills.phase === 'lost'
            ? 'LOST'
            : 'BANKED',
      );
      this.text(
        'festSkillBank',
        skills.phase === 'active'
          ? `${Math.round(skills.total).toLocaleString('en')} PTS TO BANK`
          : `SESSION ${Math.round(skills.sessionTotal).toLocaleString('en')} PTS`,
      );
      this.get('festSkillTimer').style.transform =
        `scaleX(${Math.min(1, skills.bankRemaining / 4)})`;
    }
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
    if (ev) {
      this.root.style.setProperty(
        '--fest-accent',
        colour(EVENT_COLOURS[ev.kind as keyof typeof EVENT_COLOURS] ?? 0xff6a2a),
      );
      this.text('festEventName', ev.name);
      const race = isRace(ev.kind as never);
      const cells: [string, string][] = [];
      if (race) cells.push(['POSITION', `${ev.position}/${ev.entrants}`]);
      if (ev.laps > 1) cells.push(['LAP', `${ev.lap}/${ev.laps}`]);
      cells.push(['TIME', clock(ev.elapsed)]);
      if (ev.live) cells.push([ev.live.label, ev.live.value]);
      if (ev.offRoute) cells.push(['ROUTE', 'RETURN TO ROUTE']);
      const html = cells
        .map(([k, v]) => `<div><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`)
        .join('');
      const row = this.get('festEventRow');
      if (row.innerHTML !== html) row.innerHTML = html;
      this.get('festProgress').style.transform = `scaleX(${ev.progress.toFixed(4)})`;
    }
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
    },
  ) {
    this.menuOpen = open;
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
