import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { lightingDirection } from '../../src/rendering/daylight.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H, F, carBase } from '../../src/simulation/protocol.ts';
import { trackPoint } from '../../src/simulation/track.ts';
import { detailDistance } from '../../src/rendering/view-detail.ts';
import { attachDrawLedger } from '../../src/rendering/draw-ledger.ts';

/** Production-renderer layer comparison, closed resource cycles and a real
 * physics-driven automated Quarry traversal. Not historical or human footage. */
export async function surveyAurelQuarry(lighting: 'day' | 'sunset' | 'night') {
  const width = 1280,
    height = 720;
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    opponents: 11,
    weather: lighting === 'night' ? 'rain' : 'clear',
    seed: 1887,
  });
  sim.autoPlayer = true;
  for (let i = 0; i < 8 * 120; i++) sim.step(1 / 120);
  const frame = sim.makeFrame().slice(),
    original = frame.slice(),
    water = sim.track.water.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  const view = await RacingRenderer.create(
    canvas,
    sim.track,
    () => {},
    () => false,
    { quality: 'medium', graphics: { ...graphicsPreset('medium'), resolutionScale: 1 } },
  );
  if (!view?.circuit.quarry) throw new Error('Missing production A55-A60 installation');
  const kit = view.circuit.quarry;
  const gl = view.renderer.getContext(),
    pixels = new Uint8Array(width * height * 4);
  const ledger = attachDrawLedger(view.renderer);
  const images: {
    name: string;
    image: string;
    calls: number;
    triangles: number;
    range: number;
    passes: ReturnType<typeof ledger.snapshot>;
    cpuMs: number;
  }[] = [];
  const resources = () => ({ ...view.renderer.info.memory });
  const sourceIds = kit.chunks.map(({ mesh }) => ({
    mesh,
    geometry: mesh.geometry,
    position: mesh.geometry.getAttribute('position'),
    index: mesh.geometry.index,
  }));
  const updateCut = () => {
    for (const name of [
      'concreteBarriers',
      'steelGuardrails',
      'catchFence',
      'impactBarriers',
      'recoveryGates',
      'marshalPosts',
      'startGantry',
      'signalHardware',
      'trackBoards',
      'broadcastCameras',
      'vegetation',
      'quarry',
    ] as const)
      view.circuit[name]?.update(view.camera, 'medium');
    view.circuit.heroGarage?.update(view.camera, 'medium', lighting);
    view.tyreEquipment?.update(view.camera, 'medium');
    view.wheelGunStorage?.update(view.camera);
    view.circuit.tyreBlankets?.update(view.camera, 'medium', lighting);
    view.circuit.pitBuildingFrontage?.update(view.camera, 'medium', lighting);
    view.circuit.pitWallStation?.update(view.camera, 'medium', lighting, frame, 'HELD', true);
    for (let id = 0; id < frame[H.CARS]; id++) {
      const base = carBase(id),
        followed = id === view.reviewCar();
      const d = new T.Vector3(frame[base + F.X], frame[base + F.Y], frame[base + F.Z]).distanceTo(
        view.camera.position,
      );
      view.cars[id].setLod(
        followed ? 0 : detailDistance(d, view.camera.fov, view.camera.aspect),
        'medium',
        followed,
      );
      view.cars[id].update(frame, frame, base, 1, 0, frame[H.TIME], false);
    }
    view.circuit.startFinish.update(frame, view.camera, lighting === 'night');
    view.circuit.staff.update(frame, view.camera.position, true);
    for (const crowd of view.circuit.crowdClusters)
      crowd.update(
        frame[H.TIME],
        view.camera.position,
        frame[H.RAIN],
        frame,
        view.camera.fov,
        view.camera.aspect,
      );
    view.sun.target.position.copy(view.camera.position);
    view.sun.position.copy(view.camera.position).add(lightingDirection(lighting));
    view.venueLighting.update(
      lighting !== 'day',
      view.camera.position,
      lighting === 'sunset' ? 0.18 : 1,
    );
  };
  const render = () => {
    view.renderer.info.reset();
    ledger.begin();
    const start = performance.now();
    view.renderer.render(view.scene, view.camera);
    const cpuMs = performance.now() - start;
    ledger.end();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return cpuMs;
  };
  const capture = (name: string) => {
    const cpuMs = render();
    let min = 255,
      max = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const v = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    images.push({
      name,
      image: canvas.toDataURL('image/png'),
      calls: view.renderer.info.render.calls,
      triangles: view.renderer.info.render.triangles,
      range: max - min,
      passes: ledger.snapshot(),
      cpuMs,
    });
  };
  const point = trackPoint();
  const cut = (station: number, fov = 58, orchard = false) => {
    sim.track.at(station, point);
    view.camera.fov = fov;
    view.camera.position.set(
      point.x - point.nx * 1 - point.tx * (orchard ? 35 : 0),
      point.y + (orchard ? 4 : 2),
      point.z - point.nz * 1 - point.tz * (orchard ? 35 : 0),
    );
    view.camera.lookAt(
      point.x + point.tx * (orchard ? 6 : 35) - point.nx * (orchard ? 72 : 0),
      point.y + (orchard ? 1 : 0.5),
      point.z + point.tz * (orchard ? 6 : 35) - point.nz * (orchard ? 72 : 0),
    );
    view.camera.updateProjectionMatrix();
    view.camera.updateMatrixWorld(true);
    updateCut();
  };
  try {
    view.lighting = lighting;
    view.mode = 'cockpit';
    view.draw(frame, frame, 1, 1 / 60);
    const cockpit = {
      name: 'normal-cockpit',
      image: canvas.toDataURL('image/png'),
      stats: view.stats(),
    };
    const comparisons: {
      station: number;
      changedPixels: number;
      beforeCalls: number;
      afterCalls: number;
    }[] = [];
    for (const station of [1150, 1230, 1330, 1410]) {
      cut(station, 55, true);
      kit.root.visible = false;
      // capture() already submits the measured production frame; do not
      // immediately render the same camera/visibility twice on software GPUs.
      capture(`quarry-${station}-layer-off`);
      const before = pixels.slice(),
        beforeCalls = images.at(-1)!.calls;
      kit.root.visible = true;
      capture(`quarry-${station}-authored`);
      let changedPixels = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          Math.max(
            Math.abs(before[i] - pixels[i]),
            Math.abs(before[i + 1] - pixels[i + 1]),
            Math.abs(before[i + 2] - pixels[i + 2]),
          ) > 12
        )
          changedPixels++;
      comparisons.push({ station, changedPixels, beforeCalls, afterCalls: images.at(-1)!.calls });
    }
    // Hysteretic LODs can visit different prebuilt geometry when approached
    // from opposite directions. Warm the SAME closed bidirectional sequence
    // that is measured, twice, never an open forward-only path or "until stable".
    const cuts = [0, 700, 1100, 1160, 1230, 1330, 1410, 1490, 1800, 2400];
    const sequence = [
      ...cuts.map((station) => ({ station, forward: true })),
      ...[...cuts].reverse().map((station) => ({ station, forward: false })),
    ].flatMap((step) => [
      { ...step, fov: 58 },
      { ...step, fov: 16 },
    ]);
    const warmupMemories: ReturnType<typeof resources>[] = [];
    for (let warm = 0; warm < 2; warm++)
      for (const { station, fov } of sequence) {
        cut(station, fov);
        render();
        warmupMemories.push(resources());
      }
    const geometrySnapshot = () => {
      const found = new Map<
        T.BufferGeometry,
        { index: T.BufferAttribute | null; attributes: unknown[] }
      >();
      view.scene.traverse((object) => {
        if (!(object instanceof T.Mesh || object instanceof T.Points || object instanceof T.Line))
          return;
        const g = object.geometry as T.BufferGeometry;
        found.set(g, {
          index: g.index,
          attributes: Object.entries(g.attributes).flatMap(([name, attr]) => [
            name,
            attr,
            attr.array,
          ]),
        });
      });
      return found;
    };
    const allGeometryBefore = geometrySnapshot();
    const memoryBefore = resources();
    const memories: ReturnType<typeof resources>[] = [];
    for (const { station, fov, forward } of sequence) {
      cut(station, fov);
      if (forward && fov === 58) capture(`lap-${Math.round(station)}`);
      else render();
      memories.push(resources());
    }
    const allGeometryAfter = geometrySnapshot();
    const sceneGeometryUnchanged =
      allGeometryBefore.size === allGeometryAfter.size &&
      [...allGeometryBefore].every(([g, before]) => {
        const after = allGeometryAfter.get(g);
        return (
          after &&
          before.index === after.index &&
          before.attributes.length === after.attributes.length &&
          before.attributes.every((value, index) => value === after.attributes[index])
        );
      });
    const identitiesUnchanged = sourceIds.every(
      ({ mesh, geometry, position, index }) =>
        mesh.geometry === geometry &&
        geometry.getAttribute('position') === position &&
        geometry.index === index,
    );
    const sourceUnchanged = frame.every((v, i) => Object.is(v, original[i]));
    const waterUnchanged = water.every((v, i) => v === sim.track.water[i]);
    // Ordinary production AI controls and physical simulation carry the same car
    // through Quarry. No placement/pose overrides, timeouts-as-passes or manual
    // driving claims. Render intermittent real frames; this is not a FPS sample.
    const driving: {
      station: number;
      time: number;
      image: string;
      calls: number;
      triangles: number;
    }[] = [];
    const deadline = frame[H.TIME] + 180;
    let entered = false,
      completed = false,
      lastCapture = 1020,
      previous = frame;
    view.mode = 'cockpit';
    while (sim.makeFrame()[H.TIME] < deadline) {
      for (let i = 0; i < 60; i++) sim.step(1 / 120);
      const current = sim.makeFrame().slice(),
        station = sim.cars[0].s;
      if (station >= 1060 && station < 1480) {
        entered = true;
        view.draw(previous, current, 1, 0.5);
        if (station - lastCapture >= 55) {
          const stats = view.stats();
          driving.push({
            station,
            time: current[H.TIME],
            image: canvas.toDataURL('image/png'),
            calls: stats.drawCalls,
            triangles: stats.triangles,
          });
          lastCapture = station;
        }
      }
      previous = current;
      if (entered && station >= 1480) {
        completed = true;
        break;
      }
    }
    return {
      lighting,
      images,
      cockpit,
      comparisons,
      driving,
      driveCompleted: completed,
      detail: kit.diagnostics(),
      identitiesUnchanged,
      sceneGeometryUnchanged,
      sceneGeometryCount: allGeometryBefore.size,
      warmupMemories,
      cameraSequence: sequence,
      memoryBefore,
      memories,
      sourceUnchanged,
      waterUnchanged,
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
      acceptance: {
        finalArt: false,
        humanLap: false,
        hardwarePerformance: false,
        historicalBaseline: false,
      },
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
