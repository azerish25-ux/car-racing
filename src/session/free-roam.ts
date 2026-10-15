import type * as T from 'three';
import type { Assist, Controls, WeatherPreset } from '../simulation/config.ts';
import { resolveEvents, type FestivalEvent, type FestivalResult } from '../simulation/open-world/festival-events.ts';
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
import { FestivalRenderer } from '../rendering/open-world/festival-renderer.ts';
import type { GraphicsOptions, QualityPreset } from '../rendering/options.ts';
import type { AudioView } from '../audio/spatial.ts';
import { FestivalHud } from '../ui/festival-hud.ts';
import { FestivalControls } from './festival-controls.ts';
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
    update(frame: Float32Array, cockpit: boolean, playing: boolean, view: AudioView, liveHuman: boolean): void;
  };
  /** Career/progression hook: every finished or abandoned event result. */
  onResult?(result: FestivalResult): void;
  /** Persisted festival state (discovered events, best results). */
  load?(): Promise<unknown>;
  save?(state: FestivalSave): Promise<void>;
}
export interface FestivalSave {
  version: 1;
  discovered: string[];
  best: Record<string, { stars: number; time: number | null; value: number | null }>;
  vehicle: string;
}
export interface FestivalStartOptions {
  vehicle?: string;
  weather?: WeatherPreset;
  assist?: Assist;
  seed?: number;
}
export const FESTIVAL_SAVE_KEY = 'festival:v1';
export function validateFestivalSave(value: unknown): FestivalSave | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<FestivalSave>;
  if (v.version !== 1 || !Array.isArray(v.discovered) || typeof v.vehicle !== 'string') return null;
  return {
    version: 1,
    discovered: v.discovered.filter((d): d is string => typeof d === 'string').slice(0, 256),
    best: v.best && typeof v.best === 'object' ? v.best : {},
    vehicle: v.vehicle,
  };
}

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
  private controls: FestivalControls | null = null;
  /** Fast travel in progress: the simulation is held and frames are not
   * drawn while the destination streams in behind the loading screen. */
  private travelling = false;
  private events: readonly FestivalEvent[] = [];
  private disposed = false;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private save: FestivalSave;
  private constructor(
    private readonly host: FestivalHost,
    save: FestivalSave | null,
  ) {
    this.save = save ?? { version: 1, discovered: [], best: {}, vehicle: festivalDefaultVehicle() };
    this.worker = new OpenWorldWorker();
    this.tiles = new TileWorker();
    this.worker.onmessage = (event: MessageEvent<FromOpenWorld>) => this.receive(event.data);
    this.worker.onerror = (event) => this.fail(new Error(event.message || 'Festival worker failed'));
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
    const renderer = new FestivalRenderer(host.renderer, host.canvas, world, events, structures, this.tiles);
    this.renderer = renderer;
    renderer.setQuality(host.quality, host.graphics);
    renderer.lighting = host.lighting;
    for (const id of this.save.discovered) renderer.discovered.add(id);
    const vehicles = festivalVehicles();
    // A road machine chosen in the MACHINE menu wins over the festival save;
    // the Formula default (and bikes) fall back to the saved festival car.
    const chosen = vehicles.find((v) => v.id === options.vehicle && v.classId !== 'formula');
    const vehicle = chosen?.id ?? (vehicles.some((v) => v.id === this.save.vehicle) ? this.save.vehicle : festivalDefaultVehicle());
    this.save.vehicle = vehicle;
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
    });
    const hud = this.hud;
    this.controls = new FestivalControls(hud, {
      pause: (value) => this.post({ type: 'pause', value }),
      driving: (on) => host.driving?.(on),
      menuState: () => {
        const status = this.status;
        return {
          lighting: this.renderer?.lighting ?? 'day',
          vehicle: status?.vehicleId ?? this.save.vehicle,
          discovered: status?.discovered ?? this.save.discovered,
          autopilot: status?.autopilot ?? false,
          inEvent: !!status?.event,
        };
      },
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
    await host.audio?.start().catch(() => undefined);
    host.loaded();
    this.post({ type: 'pause', value: false });
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
          this.post({ type: 'recycle', buffer: this.previous.buffer as ArrayBuffer }, [this.previous.buffer as ArrayBuffer]);
        this.previous = this.current ?? frame;
        this.current = frame;
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
          this.renderer.activeEvent = msg.status.event?.id ?? null;
          this.renderer.gate = msg.status.event?.gate ?? null;
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
        time: result.time !== null && (best?.time == null || result.time < best.time) ? result.time : (best?.time ?? null),
        value: value !== null && (best?.value == null || value > best.value) ? value : (best?.value ?? null),
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
        this.controls?.togglePause();
        return true;
      case 'camera':
        this.renderer?.changeCamera();
        return true;
      case 'replay':
        // R: reset to the road (the festival has no replay).
        this.command({ type: 'reset' });
        return true;
      case 'autopilot':
        this.command({ type: 'autopilot', value: !this.status?.autopilot });
        return true;
      case 'telemetry': {
        const open = !this.hud?.mapOpen;
        const f = this.current;
        this.hud?.showMap(open, new Set(this.status?.discovered ?? []), f ? { x: f[carBase(0) + F.X], z: f[carBase(0) + F.Z] } : undefined);
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
        -Math.atan2(fx, fz),
        Math.round(presented[o + F.GEAR]),
        (presented[o + F.RPM] - spec.idleRPM) / Math.max(1, spec.limiterRPM - spec.idleRPM),
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
    this.controls?.dispose();
    this.host.audio?.stop();
    this.worker.terminate();
    this.tiles.terminate();
    this.renderer?.dispose();
    this.hud?.dispose();
    this.renderer = null;
    this.hud = null;
  }
}
