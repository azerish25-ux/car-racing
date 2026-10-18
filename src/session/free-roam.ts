import type * as T from 'three';
import { scannedGround } from '../rendering/ground/scan-store.ts';
import type { Assist, Controls, WeatherPreset } from '../simulation/config.ts';
import {
  resolveEvents,
  type FestivalEvent,
  type FestivalResult,
} from '../simulation/open-world/festival-events.ts';
import { regionStructures } from '../simulation/open-world/placement.ts';
import {
  festivalDefaultVehicle,
  festivalVehicles,
  type FestivalCommand,
  type FestivalStatus,
} from '../simulation/open-world/session.ts';
import { openWorld } from '../simulation/open-world/world.ts';
import { F, H, R, RACE_BASE, carBase } from '../simulation/protocol.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import type { LightingMode } from '../rendering/daylight.ts';
import type { Season } from './festival-season.ts';
import { FestivalRenderer } from '../rendering/open-world/festival-renderer.ts';
import { FestivalRiders } from '../rendering/festival-riders.ts';
import { TrafficCars } from '../rendering/traffic-cars.ts';
import type { GraphicsOptions, QualityPreset } from '../rendering/options.ts';
import type { AudioView } from '../audio/spatial.ts';
import { FestivalHud } from '../ui/festival-hud.ts';
import { minimapHeading } from '../ui/festival-map.ts';
import { FestivalControls, festivalMenuState } from './festival-controls.ts';
import {
  FESTIVAL_SAVE_KEY,
  festivalMachineChoice,
  validateFestivalSave,
  type FestivalSave,
} from './festival-save.ts';
import type { FromOpenWorld, ToOpenWorld } from '../workers/open-world-protocol.ts';
import OpenWorldWorker from '../workers/open-world.worker.ts?worker&inline';
import TileWorker from '../workers/open-world-tiles.worker.ts?worker&inline';

/** What the application lends the festival while it runs. */
export interface FestivalHost {
  canvas: HTMLCanvasElement;
  /** The application's WebGL renderer (one context per canvas). */
  renderer: T.WebGLRenderer;
  /** Container for the festival HUD. */
  element: HTMLElement;
  quality: QualityPreset;
  graphics: GraphicsOptions;
  lighting: LightingMode;
  /** Initial season; the festival save's season wins when absent. */
  season?: Season;
  loading(text: string): void;
  loaded(): void;
  toast(message: string): void;
  /** Leave the festival (the host restores its own presentation). */
  exit(): void;
  /** Driving input on or off: off while a festival menu is open, so the
   * keyboard reaches its buttons (the host's InputController). */
  driving?(on: boolean): void;
  /** Driving audio from the festival's frames (engine voices, contacts, wind). */
  audio?: {
    start(): Promise<void>;
    stop(): void;
    update(
      frame: Float32Array,
      cockpit: boolean,
      playing: boolean,
      view: AudioView,
      liveHuman: boolean,
    ): void;
  };
  /** Career/progression hook: every finished or abandoned event result. */
  onResult?(result: FestivalResult): void;
  /** Persisted festival state (discovered events, best results). */
  load?(): Promise<unknown>;
  save?(state: FestivalSave): Promise<void>;
}
export interface FestivalStartOptions {
  vehicle?: string;
  weather?: WeatherPreset;
  assist?: Assist;
  seed?: number;
  /** Session identity for result run ids (the career pays each run once). */
  session?: string;
  /** Fast-travel to this discovered event once the region has streamed in
   * (a career start). */
  travel?: string;
  /** The machine is the career's loan: driven this session, but not saved
   * as the festival's machine (it was not the player's choice). */
  loaner?: boolean;
}
export { FESTIVAL_SAVE_KEY, validateFestivalSave, type FestivalSave };

/**
 * The festival session controller: owns the open-world simulation worker,
 * the terrain tile worker, the festival renderer (on the application's GL
 * context) and the HUD; turns application input and actions into festival
 * commands; streams snapshots into the renderer; forwards typed results to
 * the career hook and persists discoveries and best results.
 */
export class FestivalSession {
  private worker: Worker;
  private tiles: Worker;
  private renderer: FestivalRenderer | null = null;
  private hud: FestivalHud | null = null;
  private current: Float32Array | null = null;
  private previous: Float32Array | null = null;
  private receivedAt = 0;
  private lastTime = 0;
  private status: FestivalStatus | null = null;
  /** Ambient traffic blocks paired with `previous`/`current`. */
  private trafficPrevious: Float32Array | null = null;
  private trafficCurrent: Float32Array | null = null;
  private traffic: TrafficCars | null = null;
  private riders: FestivalRiders | null = null;
  private controls: FestivalControls | null = null;
  /** Fast travel in progress: the simulation is held and frames are not
   * drawn while the destination streams in behind the loading screen. */
  private travelling = false;
  private events: readonly FestivalEvent[] = [];
  private disposed = false;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private save: FestivalSave;
  /** The key holding a rewind (Backspace, or the configurable Flashback
   * binding, which arrives as an action), and the last key pressed. */
  private rewindKey: string | null = null;
  private readonly heldKeys = new Set<string>();
  private lastKey = '';
  private rewindTimer = 0;
  /** Lighting to restore when an event staged at dusk or night ends. */
  private stagedLighting: { previous: LightingMode; staged: LightingMode } | null = null;
  private readonly photoKeys = (event: KeyboardEvent) => {
    if (!this.renderer?.photo || event.code !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.setPhoto(false);
  };
  private readonly rewindDown = (event: KeyboardEvent) => {
    this.lastKey = event.code;
    this.heldKeys.add(event.code);
    if (event.code !== 'Backspace' || event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input,select,textarea,dialog[open]')) return;
    event.preventDefault();
    this.holdRewind(event.code);
  };
  private readonly rewindUp = (event: KeyboardEvent) => {
    this.heldKeys.delete(event.code);
    if (event.code === this.rewindKey) this.releaseRewind();
  };
  private readonly rewindBlur = () => {
    this.heldKeys.clear();
    this.releaseRewind();
  };
  private constructor(
    private readonly host: FestivalHost,
    save: FestivalSave | null,
  ) {
    this.save = save ?? {
      version: 1,
      discovered: [],
      best: {},
      vehicle: festivalDefaultVehicle(),
      traffic: true,
    };
    this.worker = new OpenWorldWorker();
    this.tiles = new TileWorker();
    this.worker.onmessage = (event: MessageEvent<FromOpenWorld>) => this.receive(event.data);
    this.worker.onerror = (event) =>
      this.fail(new Error(event.message || 'Festival worker failed'));
    window.addEventListener('keydown', this.photoKeys, true);
    window.addEventListener('keydown', this.rewindDown, true);
    window.addEventListener('keyup', this.rewindUp, true);
    window.addEventListener('blur', this.rewindBlur);
  }
  static async start(host: FestivalHost, options: FestivalStartOptions = {}) {
    host.loading('Building the Solvane festival region…');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const save = validateFestivalSave(await host.load?.().catch(() => null));
    const session = new FestivalSession(host, save);
    try {
      await session.boot(options);
    } catch (error) {
      session.dispose();
      throw error;
    }
    return session;
  }
  private async boot(options: FestivalStartOptions) {
    const host = this.host;
    const world = openWorld();
    host.loading('Planning event routes and town streets…');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const events = resolveEvents(world);
    this.events = events;
    const structures = regionStructures(world);
    host.loading('Building roads, buildings and water…');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const renderer = new FestivalRenderer(
      host.renderer,
      host.canvas,
      world,
      events,
      structures,
      this.tiles,
    );
    this.renderer = renderer;
    renderer.setQuality(host.quality, host.graphics);
    renderer.lighting = host.lighting;
    renderer.season = host.season ?? this.save.season ?? 'summer';
    this.save.season = renderer.season;
    host.loading('Loading photographed trees…');
    await renderer.loadPhotoVegetation();
    host.loading('Loading authored coastal details…');
    await Promise.all([renderer.loadAuthoredDetails(), renderer.loadStreetDetails()]);
    for (const id of this.save.discovered) renderer.discovered.add(id);
    // Ambient traffic (instanced) and motorcycles (the bike presentation)
    // share the festival scene; both are posed before each draw.
    this.traffic = new TrafficCars();
    this.riders = new FestivalRiders();
    renderer.scene.add(this.traffic.root, this.riders.root);
    renderer.registerVehicleRoot(this.riders.root);
    this.riders.shells.install = () => renderer.refreshVehicleMaterials();
    const vehicles = festivalVehicles();
    const machine = festivalMachineChoice(options, this.save.vehicle);
    const vehicle = machine.drive;
    this.save.vehicle = machine.save;
    this.hud = new FestivalHud(host.element, world, events, vehicles, {
      start: (id) => this.command({ type: 'start', event: id }),
      continue: () => this.command({ type: 'continue' }),
      cancel: () => this.command({ type: 'cancel' }),
      reset: () => {
        this.command({ type: 'reset' });
        this.setPaused(false);
      },
      resume: () => this.setPaused(false),
      exit: () => this.host.exit(),
      lighting: (mode) => {
        renderer.lighting = mode;
        this.openMenu();
      },
      season: (season) => {
        renderer.season = season;
        this.save.season = season;
        void this.persist();
        this.openMenu();
      },
      vehicle: (id) => {
        this.save.vehicle = id;
        this.command({ type: 'vehicle', id });
        void this.persist();
        this.setPaused(false);
      },
      travel: (id) => void this.travel(id),
      autopilot: (on) => {
        this.command({ type: 'autopilot', value: on });
        this.setPaused(false);
      },
      traffic: (on) => {
        this.save.traffic = on;
        this.command({ type: 'traffic', value: on });
        void this.persist();
        this.openMenu();
      },
      map: () => this.openMap(),
      photo: (open) => this.setPhoto(open),
      photoAngle: (angle) => renderer.photoAngle(angle),
    });
    const hud = this.hud;
    // Current Best on the event panel (the save object is updated in place).
    hud.best = this.save.best;
    this.controls = new FestivalControls(hud, {
      pause: (value) => {
        // A menu over the road ends a rewind where it stands.
        if (value) this.releaseRewind();
        this.post({ type: 'pause', value });
      },
      driving: (on) => host.driving?.(on),
      menuState: () => festivalMenuState(this.status, this.save, this.renderer?.lighting ?? 'day'),
      card: () => (hud.cardOpen ? (this.status?.card?.id ?? null) : null),
      start: (id) => this.command({ type: 'start', event: id }),
      continue: () => this.command({ type: 'continue' }),
    });
    host.loading('Starting the festival simulation…');
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.post({
      type: 'init',
      options: {
        vehicle,
        weather: options.weather ?? 'clear',
        assist: options.assist ?? 'sport',
        seed: options.seed ?? 73021,
        discovered: this.save.discovered,
        session: options.session,
        traffic: this.save.traffic !== false,
      },
    });
    await ready;
    // Stream the terrain around the spawn before the first frame.
    host.loading('Streaming terrain around Port Ilse…');
    const frame = this.current!;
    const x = frame[carBase(0) + F.X],
      z = frame[carBase(0) + F.Z];
    const deadline = performance.now() + 20000;
    while (!renderer.ready(x, z) && performance.now() < deadline && !this.disposed) {
      renderer.prestream(x, z);
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    }
    for (let i = 0; i < 20 && !this.disposed; i++) {
      renderer.prestream(x, z);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    if (renderer.photoSky.enabled) {
      host.loading('Loading the photographed sky…');
      await renderer.photoSky.ready(frame[H.CLOUD], renderer.lighting);
    }
    if (scannedGround.enabled) {
      host.loading('Loading photographed ground…');
      await scannedGround.ready();
    }
    await host.audio?.start().catch(() => undefined);
    host.loaded();
    this.post({ type: 'pause', value: false });
    // A career start goes straight to its event (discovered: the card opens
    // on arrival, a skill challenge starts at its entry gate).
    if (options.travel && this.save.discovered.includes(options.travel))
      await this.travel(options.travel);
  }
  private post(message: ToOpenWorld, transfer: Transferable[] = []) {
    if (!this.disposed) this.worker.postMessage(message, transfer);
  }
  private fail(error: Error) {
    if (this.readyReject) {
      this.readyReject(error);
      this.readyReject = null;
      this.readyResolve = null;
    }
    this.host.toast(`Festival error: ${error.message}`);
  }
  private receive(msg: FromOpenWorld) {
    switch (msg.type) {
      case 'ready':
        break;
      case 'frame': {
        const frame = new Float32Array(msg.buffer);
        // Every superseded buffer goes back, whatever its size: the worker
        // keeps those of the current field size and drops the rest.
        if (this.previous && this.previous !== this.current && this.previous.buffer.byteLength > 0)
          this.post({ type: 'recycle', buffer: this.previous.buffer as ArrayBuffer }, [
            this.previous.buffer as ArrayBuffer,
          ]);
        this.previous = this.current ?? frame;
        this.current = frame;
        this.trafficPrevious = this.trafficCurrent;
        this.trafficCurrent = msg.traffic ? new Float32Array(msg.traffic) : null;
        this.receivedAt = performance.now();
        if (this.readyResolve) {
          this.readyResolve();
          this.readyResolve = null;
          this.readyReject = null;
        }
        break;
      }
      case 'status':
        this.status = msg.status;
        if (this.renderer) {
          for (const id of msg.status.discovered) {
            if (!this.renderer.discovered.has(id)) {
              this.renderer.discovered.add(id);
              if (!this.save.discovered.includes(id)) {
                this.save.discovered.push(id);
                void this.persist();
              }
            }
          }
          const active = msg.status.event?.id ?? null;
          if (active !== this.renderer.activeEvent) this.stageLighting(active);
          this.renderer.activeEvent = active;
          this.renderer.gate = msg.status.event?.gate ?? null;
          this.renderer.drag = msg.status.event?.drag ?? null;
        }
        break;
      case 'result':
        this.recordResult(msg.result);
        break;
      case 'error':
        this.fail(new Error(msg.message));
        break;
    }
  }
  private recordResult(result: FestivalResult) {
    this.host.onResult?.(result);
    if (!result.completed || result.assisted) return;
    const best = this.save.best[result.eventId],
      value = result.trapKmh ?? result.averageKmh ?? result.driftScore ?? null;
    const better =
      !best ||
      result.stars > best.stars ||
      (result.time !== null && (best.time === null || result.time < best.time)) ||
      (value !== null && (best.value === null || value > best.value));
    if (better) {
      this.save.best[result.eventId] = {
        stars: Math.max(result.stars, best?.stars ?? 0),
        time:
          result.time !== null && (best?.time == null || result.time < best.time)
            ? result.time
            : (best?.time ?? null),
        value:
          value !== null && (best?.value == null || value > best.value)
            ? value
            : (best?.value ?? null),
      };
      void this.persist();
    }
  }
  private async persist() {
    try {
      await this.host.save?.(this.save);
    } catch {
      /* Saving festival progress is best effort; driving continues. */
    }
  }
  command(command: FestivalCommand) {
    this.post({ type: 'command', command });
  }
  /** Hold to rewind (the worker scrubs back), release to drive on from
   * there. Ignored while paused, travelling or in photo mode. */
  private holdRewind(code: string) {
    if (this.rewindKey || this.isPaused || this.travelling || this.renderer?.photo) return;
    this.rewindKey = code;
    this.command({ type: 'rewind', active: true });
  }
  private releaseRewind() {
    window.clearTimeout(this.rewindTimer);
    if (!this.rewindKey) return;
    this.rewindKey = null;
    this.command({ type: 'rewind', active: false });
  }
  /** An event staged at dusk or night (the touge) switches the time of day
   * for its run and back afterwards, unless the player changed it since. */
  private stageLighting(active: string | null) {
    const renderer = this.renderer;
    if (!renderer) return;
    const staged = active
      ? this.events.find((e) => e.spec.id === active)?.spec.lighting
      : undefined;
    if (this.stagedLighting && renderer.lighting === this.stagedLighting.staged)
      renderer.lighting = this.stagedLighting.previous;
    this.stagedLighting = null;
    if (staged && renderer.lighting === 'day') {
      this.stagedLighting = { previous: renderer.lighting, staged };
      renderer.lighting = staged;
    }
  }
  /** Fast travel to a discovered event: the car is placed at once, and the
   * simulation stays held behind the loading screen until the terrain and
   * cover at the destination are resident (bounded wait), so the player
   * never drives onto coarse or missing ground. */
  private async travel(id: string) {
    const renderer = this.renderer,
      event = this.events.find((e) => e.spec.id === id);
    if (!renderer || !event || this.travelling) return;
    this.travelling = true;
    this.hud?.showMenu(false);
    this.hud?.showMap(false);
    this.host.loading(`Travelling to ${event.spec.name}…`);
    this.command({ type: 'travel', event: id });
    const { x, z } = event.marker,
      deadline = performance.now() + 12000;
    try {
      while (!renderer.ready(x, z) && performance.now() < deadline && !this.disposed) {
        renderer.prestream(x, z);
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
      }
    } finally {
      this.travelling = false;
      if (!this.disposed) {
        this.host.loaded();
        this.setPaused(false);
      }
    }
  }
  input(input: Controls) {
    if (!this.isPaused) this.post({ type: 'input', input: { ...input } });
  }
  private openMenu() {
    this.controls?.openMenu();
  }
  private openMap() {
    if (!this.isPaused) this.setPaused(true);
    const frame = this.current;
    this.hud?.showMap(
      true,
      new Set(this.status?.discovered ?? []),
      frame ? { x: frame[carBase(0) + F.X], z: frame[carBase(0) + F.Z] } : undefined,
    );
  }
  private setPhoto(open: boolean) {
    if (!this.renderer || !this.hud || this.travelling) return;
    if (open) this.setPaused(true);
    this.renderer.setPhoto(open);
    this.hud.showPhoto(open);
    if (!open) this.setPaused(false);
  }
  /** Pause (menu open, driving input off) or resume (FestivalControls). */
  setPaused(value: boolean) {
    this.controls?.setPaused(value);
  }
  get isPaused() {
    return this.controls?.paused ?? false;
  }
  /** Application actions while the festival drives; true when consumed. */
  action(name: string) {
    // Fast travel owns the session until the destination has streamed in.
    if (this.travelling) return name !== 'mute';
    switch (name) {
      case 'pause':
        if (this.renderer?.photo) {
          this.setPhoto(false);
          return true;
        }
        this.controls?.togglePause();
        return true;
      case 'camera':
        this.renderer?.changeCamera();
        return true;
      case 'replay':
        // R: reset to the road (the festival has no replay).
        this.command({ type: 'reset' });
        return true;
      case 'flashback':
        // The Flashback binding holds a rewind until its key is released; a
        // controller button (no key held) rewinds a fixed 3 s.
        if (this.heldKeys.has(this.lastKey)) this.holdRewind(this.lastKey);
        else {
          this.holdRewind('button');
          window.clearTimeout(this.rewindTimer);
          this.rewindTimer = window.setTimeout(() => this.releaseRewind(), 1500);
        }
        return true;
      case 'autopilot':
        this.command({ type: 'autopilot', value: !this.status?.autopilot });
        return true;
      case 'telemetry': {
        if (this.hud?.mapOpen) this.hud.showMap(false);
        else this.openMap();
        return true;
      }
      case 'pit':
        if (this.status?.card) this.command({ type: 'start', event: this.status.card.id });
        else if (this.status?.mode === 'finished') this.command({ type: 'continue' });
        return true;
      case 'blur':
      case 'deviceLost':
        if (!this.isPaused) this.setPaused(true);
        return true;
      default:
        return name !== 'mute';
    }
  }
  /** One animation frame. */
  frame(time: number) {
    const renderer = this.renderer,
      a = this.previous,
      b = this.current;
    if (!renderer || !a || !b || this.disposed || this.travelling) return;
    const wall = Math.max(0.001, (time - (this.lastTime || time - 16)) / 1000);
    this.lastTime = time;
    const span = Math.max(8, (b[H.TIME] - a[H.TIME]) * 1000),
      alpha = Math.min(1, Math.max(0, (performance.now() - this.receivedAt) / span));
    // Posed before the draw, from the same interpolation as the cars.
    this.riders?.update(a, b, alpha, renderer.camera, this.host.quality);
    this.traffic?.update(
      this.trafficPrevious,
      this.trafficCurrent,
      alpha,
      renderer.night,
      b[H.TIME],
    );
    renderer.draw(a, b, alpha, Math.min(0.08, wall));
    const o = carBase(0),
      presented = renderer.presented.value;
    const qx = presented[o + F.QX],
      qy = presented[o + F.QY],
      qz = presented[o + F.QZ],
      qw = presented[o + F.QW];
    // Car forward (0, 0, 1) rotated by the orientation: heading for the map.
    const fx = 2 * (qx * qz + qw * qy),
      fz = 1 - 2 * (qx * qx + qy * qy);
    const spec = vehicleAt(Math.round(presented[o + RACE_BASE + R.VEHICLE])).spec;
    if (this.status)
      this.hud?.update(
        this.status,
        presented[o + F.X],
        presented[o + F.Z],
        minimapHeading(fx, fz),
        Math.round(presented[o + F.GEAR]),
        (presented[o + F.RPM] - spec.idleRPM) / Math.max(1, spec.limiterRPM - spec.idleRPM),
        renderer.guidance.cue,
        renderer.driftCue,
        presented[H.TIME],
      );
    this.host.audio?.update(
      presented,
      renderer.mode === 'hood',
      !this.isPaused && !document.hidden,
      renderer.audioView.value,
      false,
    );
  }
  resize() {
    this.renderer?.resize();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.photoKeys, true);
    window.removeEventListener('keydown', this.rewindDown, true);
    window.removeEventListener('keyup', this.rewindUp, true);
    window.removeEventListener('blur', this.rewindBlur);
    this.controls?.dispose();
    this.host.audio?.stop();
    this.worker.terminate();
    this.tiles.terminate();
    this.traffic?.dispose();
    this.traffic = null;
    this.riders?.dispose();
    this.riders = null;
    this.renderer?.dispose();
    this.hud?.dispose();
    this.renderer = null;
    this.hud = null;
  }
}
