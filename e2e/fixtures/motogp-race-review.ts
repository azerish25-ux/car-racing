import * as T from 'three';

const offlineAssets: Record<string, string> = {};

/** Offline review only: identical local asset bytes, no network requests. */
export function installOfflineAssets(assets: Record<string, string>) {
  Object.assign(offlineAssets, assets);
  T.DefaultLoadingManager.setURLModifier(
    (url) => offlineAssets[url.replace(/^\.\//, '').replace(/^\//, '')] ?? url,
  );
}

/** Integration capture from the real simulation and full racing renderer.
 * Small deterministic sample; not a hardware frame-rate benchmark. */
export async function captureGPRace(weather: 'clear' | 'rain' = 'clear') {
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
  renderer.setQuality('high', {
    ...graphicsPreset('high'),
    resolutionScale: 1,
    reflections: 'environment',
  });
  const captures: { view: string; image: string; draws: number; triangles: number }[] = [];
  let frame = simulation.makeFrame(),
    unchanged = true;
  try {
    for (let display = 0; display < 3; display++) {
      for (let tick = 0; tick < 6; tick++) simulation.step(1 / 120);
      frame = simulation.makeFrame();
      const copy = frame.slice();
      renderer.draw(frame, frame, 1, 1 / 20, false);
      unchanged &&= frame.every((value, i) => value === copy[i]);
      await new Promise((resolve) => setTimeout(resolve, display === 0 ? 2000 : 0));
    }
    for (const view of ['chase', 'cockpit', 'trackside'] as const)
      await new Promise<void>((resolve, reject) => {
        requestAnimationFrame(() => {
          try {
            renderer.changeCamera(view);
            renderer.draw(frame, frame, 1, 1 / 60, false);
            captures.push({
              view,
              image: canvas.toDataURL('image/png'),
              draws: renderer.renderer.info.render.calls,
              triangles: renderer.renderer.info.render.triangles,
            });
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    return {
      captures,
      unchanged,
      finite: frame.every(Number.isFinite),
      bikes: renderer.bikeShells.count,
      speed: frame[carBase(0) + F.SPEED],
      time: frame[H.TIME],
      weather,
      glError: renderer.renderer.getContext().getError(),
    };
  } finally {
    renderer.dispose();
    canvas.remove();
  }
}
