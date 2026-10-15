/** Submitted work of a catalogue cockpit on a full grid (cars loose ends,
 * review finding 7): the full production renderer, a 12-car GT grid and the
 * same grid of Formula cars for reference (same circuit, same renderer), at
 * the low and medium tiers, in the cockpit view with the rear-view feeds
 * refreshing every measured frame. Draw calls and triangles are counted per
 * phase by the renderer's own draw ledger. These are submitted-work figures
 * from a fixed grid frame, not device FPS. */
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS, type SessionOptions } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';

/** The largest field a session allows (validateOptions: 11 opponents). */
const GRID = 12;
const t0 = performance.now();
const log = (m: string) =>
  console.info(`[cabin-cost ${((performance.now() - t0) / 1000).toFixed(1)}s] ${m}`);
function grid(machine: string) {
  const options: SessionOptions = {
    ...DEFAULT_OPTIONS,
    mode: 'race',
    opponents: GRID - 1,
    weather: 'clear',
    seed: 17,
    ...(machine === 'apx01' ? {} : { vehicles: Array.from({ length: GRID }, () => machine) }),
  };
  const sim = new Simulation(options);
  for (let i = 0; i < 60; i++) sim.step(1 / 120);
  const a = sim.makeFrame();
  sim.step(1 / 120);
  return { sim, a, b: sim.makeFrame() };
}
export async function cabinRenderCost(machines: readonly string[] = ['gt8f', 'apx01']) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:480px;height:270px;display:block';
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  const grids = machines.map((m) => ({ machine: m, ...grid(m) }));
  const view = await RacingRenderer.create(
    canvas,
    grids[0].sim.track,
    () => {},
    () => false,
  );
  if (!view) throw new Error('Scene construction cancelled');
  log('renderer ready');
  const rows = [];
  try {
    for (const { machine, a, b } of grids)
      for (const quality of ['low', 'medium'] as const) {
        view.setQuality(quality);
        view.changeCamera('cockpit');
        for (let k = 0; k < 2; k++) view.draw(a, b, 1, 1 / 60);
        const frames: {
          calls: number;
          triangles: number;
          mirrorCalls: number;
          mirrorTriangles: number;
        }[] = [];
        // 50 ms per frame: each frame refreshes one feed at every tier.
        for (let k = 0; k < 3; k++) {
          view.draw(a, b, 1, 0.05);
          const s = view.stats();
          frames.push({
            calls: s.drawCalls,
            triangles: s.triangles,
            mirrorCalls: s.drawBreakdown.mirrors.calls,
            mirrorTriangles: s.drawBreakdown.mirrors.triangles,
          });
        }
        log(`${machine} ${quality}: measured`);
        const cabins = Array.from({ length: b[H.CARS] }, (_, id) => view.vehicleBodies.cabinOf(id));
        const mean = (key: keyof (typeof frames)[number]) =>
          Math.round(frames.reduce((sum, f) => sum + f[key], 0) / frames.length);
        rows.push({
          machine,
          quality,
          cars: b[H.CARS],
          bodies: view.vehicleBodies.count,
          rivalDetail: cabins.filter((c, id) => id !== 0 && c?.detail.visible).length,
          ownDetail: !!cabins[0]?.detail.visible,
          mirrorFrames: frames.filter((f) => f.mirrorCalls > 0).length,
          calls: mean('calls'),
          triangles: mean('triangles'),
          mirrorCalls: mean('mirrorCalls'),
          mirrorTriangles: mean('mirrorTriangles'),
        });
      }
    return { rows, glError: view.renderer.getContext().getError() };
  } finally {
    view.dispose();
  }
}
