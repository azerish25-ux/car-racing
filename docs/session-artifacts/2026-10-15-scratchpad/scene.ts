// Builds the production CircuitScene (venue kit) for layouts in node: scene.ts <id>...
const R = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1/src';
class Canvas {
  width = 300;
  height = 150;
  getContext() {
    const noop = () => {};
    return new Proxy(
      {
        canvas: this,
        measureText: () => ({ width: 40 }),
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
        createPattern: () => ({ setTransform: noop }),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
      },
      { get: (target, key) => Reflect.get(target, key) ?? noop },
    );
  }
}
(globalThis as Record<string, unknown>).document = { createElement: () => new Canvas() };
(globalThis as Record<string, unknown>).HTMLCanvasElement = Canvas;
const { CircuitScene } = await import(`${R}/rendering/circuit.ts`);
const { CIRCUITS } = await import(`${R}/simulation/circuits.ts`);
const { Track } = await import(`${R}/simulation/track.ts`);
for (const id of process.argv.slice(2)) {
  const t0 = performance.now();
  const track = new Track('clear', false, undefined, CIRCUITS[id]);
  const scene = new CircuitScene(track);
  const kit = scene.venueKit;
  const names = new Set<string>();
  kit.root.traverse((o: { name: string }) => names.add(o.name));
  console.log(
    id,
    `${((performance.now() - t0) / 1000).toFixed(1)} s`,
    JSON.stringify(kit.diagnostics()),
    [...names].filter((n) => /crane|Portal|Container|floodlight|lamps|frontage|tunnel|bridge|Rock|Quay/i.test(n)).join('; '),
  );
}
