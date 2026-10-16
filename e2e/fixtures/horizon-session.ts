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
import { F, carBase } from '../../src/simulation/protocol.ts';

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
    frame: internal?.current ? Array.from(internal.current) : null,
  };
};
Object.assign(window, {
  horizonReview: {
    state,
    command: (command: Parameters<FestivalSession['command']>[0]) => session?.command(command),
    // Stop submitting GPU frames only for a still capture. This does not alter
    // simulation state, renderer quality, assets, or the production code path.
    rendering: (enabled: boolean) => {
      rendering = enabled;
    },
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
    else session.input(input.update(Math.min(0.08, (time - previous) / 1000)));
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
