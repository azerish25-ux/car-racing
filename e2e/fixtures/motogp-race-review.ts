import * as T from 'three';
import type { QualityPreset } from '../../src/rendering/options.ts';

const offlineAssets: Record<string, string> = {};
const originalFetch = globalThis.fetch.bind(globalThis);

/** Offline review only: identical local asset bytes, no network requests. */
export function installOfflineAssets(assets: Record<string, string>) {
  Object.assign(offlineAssets, assets);
  // Controlled fixture acquisition only: feed the actual local JPEG/KTX2 bytes
  // to the production decoders. This does not exercise HTTP or app navigation.
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^\.\//, '').replace(/^\//, '');
    return originalFetch(offlineAssets[path] ?? input, init);
  };
  T.DefaultLoadingManager.setURLModifier(
    (url) => offlineAssets[url.replace(/^\.\//, '').replace(/^\//, '')] ?? url,
  );
}

/** Integration capture from the real simulation and full racing renderer.
 * Constructor-based controlled composition: the production simulation and
 * renderer, but not the asynchronous native pit-asset factory, UI navigation,
 * human playtesting or a hardware frame-rate benchmark. */
export async function captureGPRace(
  weather: 'clear' | 'rain' = 'clear',
  preset: QualityPreset = 'high',
) {
  const [
    { Simulation },
    { DEFAULT_OPTIONS },
    { RacingRenderer },
    { graphicsPreset },
    { H, F, carBase },
  ] = await Promise.all([
    import('../../src/simulation/world.ts'),
    import('../../src/simulation/config.ts'),
    import('../../src/rendering/renderer.ts'),
    import('../../src/rendering/options.ts'),
    import('../../src/simulation/protocol.ts'),
  ]);
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    ruleset: 'gp-motorcycle',
    vehicles: ['gpr1', 'gpr2'],
    weather,
    compound: weather === 'rain' ? 'wet' : 'medium',
    opponents: 1,
    seed: 34100,
  });
  simulation.autoPlayer = true;
  for (let tick = 0; tick < 900; tick++) simulation.step(1 / 120);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:960px;height:600px';
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  const renderer = new RacingRenderer(canvas, simulation.track);
  renderer.setQuality(preset, {
    ...graphicsPreset(preset),
    resolutionScale: 1,
    reflections: 'environment',
  });
  const captures: { view: string; image: string; draws: number; triangles: number }[] = [];
  const frame = simulation.makeFrame();
  let unchanged = true;
  try {
    const yieldGpu = () => new Promise<void>((resolve) => setTimeout(resolve, 12));
    const copy = frame.slice();
    const prepared = await renderer.prepare(
      frame,
      (stage) => console.log(stage),
      () => false,
      yieldGpu,
    );
    if (!prepared) throw new Error('GP composition preparation cancelled');
    for (const view of ['chase', 'cockpit', 'trackside'] as const) {
      await renderer.waitForPreparedFrame(() => false, yieldGpu);
      renderer.changeCamera(view);
      // Camera damping receives the SAME held state throughout this inspection.
      for (let display = 0; display < 3; display++) {
        await yieldGpu();
        renderer.draw(frame, frame, 1, 1 / 60, false);
        await renderer.waitForPreparedFrame(() => false, yieldGpu);
      }
      captures.push({
        view,
        image: canvas.toDataURL('image/png'),
        draws: renderer.renderer.info.render.calls,
        triangles: renderer.renderer.info.render.triangles,
      });
      unchanged &&= frame.every((value, i) => value === copy[i]);
    }
    return {
      captures,
      unchanged,
      finite: frame.every(Number.isFinite),
      bikes: renderer.bikeShells.count,
      speed: frame[carBase(0) + F.SPEED],
      time: frame[H.TIME],
      weather,
      preset,
      glError: renderer.renderer.getContext().getError(),
    };
  } finally {
    renderer.dispose();
    canvas.remove();
    globalThis.fetch = originalFetch;
    T.DefaultLoadingManager.setURLModifier((url) => url);
  }
}
