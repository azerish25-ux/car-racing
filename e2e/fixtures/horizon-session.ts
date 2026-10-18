/** Real festival session, workers, input and renderer on one WebGL context.
 * Isolated from the unrelated circuit's initial asset load for reproducible
 * festival screenshots and lifecycle tests. Does not enter the app bundle. */
import * as T from 'three';
import '@fontsource-variable/saira';
import { FestivalSession } from '../../src/session/free-roam.ts';
import { InputController } from '../../src/input/controller.ts';
import { DEFAULT_SETTINGS } from '../../src/storage/data.ts';
import { graphicsPreset, type QualityPreset } from '../../src/rendering/options.ts';
import type { FestivalStatus } from '../../src/simulation/open-world/session.ts';
import type { FestivalRenderer } from '../../src/rendering/open-world/festival-renderer.ts';
import type { WeatherPreset } from '../../src/simulation/config.ts';
import type { LightingMode } from '../../src/rendering/daylight.ts';
import { SOLVANE } from '../../src/simulation/open-world/region-data.ts';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { F, carBase } from '../../src/simulation/protocol.ts';
import { isSeason, type Season } from '../../src/session/festival-season.ts';
import type { TrafficCars } from '../../src/rendering/traffic-cars.ts';
import { controls } from '../../src/simulation/config.ts';

const params = new URLSearchParams(location.search);
const quality = (params.get('quality') ?? 'medium') as QualityPreset;
const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const root = document.querySelector<HTMLElement>('#app')!;
const loading = document.querySelector<HTMLElement>('#loading')!;
const gl = new T.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: params.get('capture') === '1',
});
gl.toneMapping = T.ACESFilmicToneMapping;
gl.outputColorSpace = T.SRGBColorSpace;
gl.shadowMap.type = T.PCFSoftShadowMap;
const settings = structuredClone(DEFAULT_SETTINGS);
// Optional saved discoveries exercise the production fast-travel path for
// remote scenery review; an ordinary fixture boot starts undiscovered.
const reviewDiscoveries =
  params.get('discovered') === 'all' ? SOLVANE.events.map((event) => event.id) : [];
const captureFrames = params.get('capture') === '1' ? Number(params.get('frames') ?? 0) : 0;
let session: FestivalSession | null = null,
  exited = false,
  rendering = true,
  scripted = false,
  draws = 0;
const input = new InputController(settings, (action) => session?.action(action));
const results: unknown[] = [];
const state = () => {
  // Observation only. Production methods/worker messages perform every action.
  const internal = session as unknown as {
    status: FestivalStatus | null;
    renderer: FestivalRenderer | null;
    current: Float32Array | null;
  } | null;
  return {
    ready: !!session,
    paused: session?.isPaused,
    exited,
    status: internal?.status,
    render: internal?.renderer?.stats,
    camera: internal?.renderer?.mode,
    position: internal?.renderer?.camera.position.toArray(),
    photo: internal?.renderer?.photo,
    results,
    draws,
    memory: { ...gl.info.memory },
    player: internal?.current
      ? {
          x: internal.current[carBase(0) + F.X],
          y: internal.current[carBase(0) + F.Y],
          z: internal.current[carBase(0) + F.Z],
        }
      : null,
    details:
      (internal?.renderer as unknown as { details?: { stats: unknown } })?.details?.stats ?? null,
    street: internal?.renderer?.streetDetails?.stats ?? null,
    contacts: internal?.renderer?.contacts.stats ?? null,
    pace: internal?.renderer?.guidance.cue ?? null,
    lampSockets:
      (internal?.renderer as unknown as { streetLights?: { activeSockets: number[] } })
        ?.streetLights?.activeSockets ?? [],
    aero: internal?.renderer?.scene.getObjectByName('EH-3 articulated rear aero')?.visible ?? false,
    frame: internal?.current ? Array.from(internal.current) : null,
  };
};
// Fixed-camera inspection only, excluded from the shipped application.
// Pauses through the real session; never changes a car, worker, physics
// sample, material, mesh or quality level. Gameplay evidence uses input.
function inspect(position: [number, number, number], target: [number, number, number]) {
  if (!session) throw new Error('Session is not loaded');
  if (!session.isPaused) session.action('pause');
  const renderer = (session as unknown as { renderer: FestivalRenderer }).renderer;
  renderer.setPhoto(true);
  const orbit = (renderer as unknown as { orbit: OrbitControls }).orbit;
  orbit.enableDamping = false;
  orbit.maxDistance = 20000;
  orbit.maxPolarAngle = Math.PI;
  orbit.target.fromArray(target);
  renderer.camera.position.fromArray(position);
  orbit.update();
}
Object.assign(window, {
  horizonReview: {
    state,
    inspect,
    // Fixed inspection in a subject's own frame: the player car (-1) or the
    // k-th drawn ambient traffic car (vehicle visual review). Returns false
    // when that subject is not drawn.
    inspectNear: (
      which: number,
      offset: [number, number, number],
      target: [number, number, number],
    ) => {
      if (!session) throw new Error('Session is not loaded');
      const renderer = (session as unknown as { renderer: FestivalRenderer }).renderer;
      const pose = new T.Matrix4();
      if (which < 0) {
        const subject = renderer.cars.subject(0);
        if (!subject) return false;
        pose.compose(subject.position, subject.quaternion, new T.Vector3(1, 1, 1));
      } else {
        const traffic = (session as unknown as { traffic: TrafficCars | null }).traffic;
        if (!traffic || !traffic.poseOf(which, pose)) return false;
      }
      const at = (v: [number, number, number]) =>
        new T.Vector3(...v).applyMatrix4(pose).toArray() as [number, number, number];
      inspect(at(offset), at(target));
      return true;
    },
    /** Stream the terrain around the current (inspection) camera without
     * drawing, until no tile is wanted or in flight (scenery review only). */
    settle: async (limitMs = 60000) => {
      if (!session) throw new Error('Session is not loaded');
      const renderer = (session as unknown as { renderer: FestivalRenderer }).renderer;
      const terrain = renderer.terrain as unknown as {
        inFlight: number;
        stats: { requested: number };
        update(camera: T.Camera): void;
      };
      const deadline = performance.now() + limitMs;
      let quiet = 0;
      while (performance.now() < deadline && quiet < 6) {
        const requested = terrain.stats.requested;
        renderer.camera.updateMatrixWorld();
        terrain.update(renderer.camera);
        await new Promise((resolve) => setTimeout(resolve, 60));
        quiet = terrain.inFlight === 0 && terrain.stats.requested === requested ? quiet + 1 : 0;
      }
      return quiet >= 6;
    },
    /** Drawn ambient traffic positions (vehicle visual review). */
    traffic: () => {
      const traffic = session
        ? (session as unknown as { traffic: TrafficCars | null }).traffic
        : null;
      if (!traffic) return [];
      const m = new T.Matrix4(),
        out: number[][] = [];
      for (let k = 0; k < traffic.count; k++)
        if (traffic.poseOf(k, m)) out.push([m.elements[12], m.elements[13], m.elements[14]]);
      return out;
    },
    command: (command: Parameters<FestivalSession['command']>[0]) => session?.command(command),
    // Cost review: keep a named scene object hidden (its own per-frame
    // visibility writes are ignored) to measure what it adds to a frame.
    hide: (name: string) => {
      const renderer = (session as unknown as { renderer: FestivalRenderer } | null)?.renderer;
      const node = renderer?.scene.getObjectByName(name);
      if (!node) return false;
      Object.defineProperty(node, 'visible', {
        get: () => false,
        set: () => undefined,
        configurable: true,
      });
      return true;
    },
    // Hold or release the simulation worker without a menu (timed gameplay
    // captures: a drag tree at a given lamp, a rewind in progress). The
    // production pause message; nothing else changes.
    freeze: (value: boolean) =>
      (session as unknown as { post(message: unknown): void } | null)?.post({
        type: 'pause',
        value,
      }),
    // Stop submitting GPU frames only for a still capture. This does not alter
    // simulation state, renderer quality, assets, or the production code path.
    rendering: (enabled: boolean) => {
      rendering = enabled;
    },
    // Held-input drive for software-GL captures, where one frame takes
    // seconds: the production input message is re-sent every 50 ms (the
    // worker brakes after 750 ms of silence) while GPU frames are held, and
    // the snapshot-driven tyre effects advance on the latest real snapshot as
    // a 10 Hz renderer would. `freeze` then holds the worker (no menu) so the
    // captured frames keep the car's speed, slip and skill state.
    drive: (options: {
      ms: number;
      steer?: number;
      steerAt?: number;
      steerMs?: number;
      throttle?: number;
      freeze?: boolean;
    }) =>
      new Promise<void>((resolve) => {
        if (!session) return resolve();
        const internal = session as unknown as {
          renderer: FestivalRenderer;
          current: Float32Array | null;
          post(message: unknown): void;
        };
        const height = (x: number, z: number, y?: number) =>
          internal.renderer.groundHeight(x, z, y);
        const effects = internal.renderer as unknown as Record<
          string,
          { update?: (frame: Float32Array, h: typeof height) => void } | undefined
        >;
        rendering = false;
        scripted = true;
        const start = performance.now();
        let last = 0;
        const timer = setInterval(() => {
          const t = performance.now() - start,
            steerAt = options.steerAt ?? 0,
            steering =
              t >= steerAt && t < steerAt + (options.steerMs ?? options.ms)
                ? (options.steer ?? 0)
                : 0;
          session?.input({ ...controls(), throttle: options.throttle ?? 1, steer: steering });
          if (t - last >= 100 && internal.current) {
            last = t;
            for (const name of ['trails', 'smoke'])
              effects[name]?.update?.(internal.current, height);
          }
          if (t >= options.ms) {
            clearInterval(timer);
            scripted = false;
            if (options.freeze !== false) internal.post({ type: 'pause', value: true });
            setTimeout(resolve, 120);
          }
        }, 50);
      }),
    image: () => canvas.toDataURL('image/png'),
    draw: () => {
      if (session) {
        session.frame(performance.now());
        draws++;
      }
    },
  },
});
async function boot() {
  session = await FestivalSession.start(
    {
      canvas,
      renderer: gl,
      element: root,
      quality,
      graphics: graphicsPreset(quality),
      lighting: (params.get('lighting') ?? 'day') as LightingMode,
      season: isSeason(params.get('season')) ? (params.get('season') as Season) : undefined,
      loading: (text) => {
        loading.textContent = text;
        loading.hidden = false;
      },
      loaded: () => {
        loading.hidden = true;
      },
      toast: (message) => console.info('Festival:', message),
      exit: () => {
        exited = true;
        session?.dispose();
        session = null;
        input.dispose();
      },
      driving: (on) => input.setEnabled(on),
      onResult: (result) => results.push(result),
      load: async () =>
        reviewDiscoveries.length
          ? {
              version: 1,
              discovered: reviewDiscoveries,
              best: {},
              vehicle: params.get('vehicle') ?? 'eh3',
              traffic: true,
            }
          : null,
    },
    {
      weather: (params.get('weather') ?? 'clear') as WeatherPreset,
      vehicle: params.get('vehicle') ?? undefined,
      session: 'horizon-browser-review',
      travel: params.get('travel') ?? undefined,
    },
  );
  input.setEnabled(true);
  let previous = performance.now();
  const tick = (time: number) => {
    if (!session) return;
    if (session.isPaused) input.pollActions(['pause']);
    else if (!scripted) session.input(input.update(Math.min(0.08, (time - previous) / 1000)));
    previous = time;
    if (rendering) {
      session.frame(time);
      draws++;
      if (captureFrames > 0 && draws >= captureFrames) rendering = false;
    }
    requestAnimationFrame(tick);
  };
  window.addEventListener('resize', () => session?.resize());
  requestAnimationFrame(tick);
}
void boot().catch((error) => {
  loading.textContent = String(error);
  console.error(error);
});
