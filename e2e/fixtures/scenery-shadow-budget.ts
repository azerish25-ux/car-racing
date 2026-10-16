import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { captureGlErrors } from './gl-error-census.ts';

/** Read-only submission census for the SAME first complete cockpit frame as the
 * infrastructure budget. Does not warm away a lighting bake or hide any caster.
 * Instrumentation is restricted to this test fixture, not the game hot path. */
export async function sceneryShadowBudget(lighting: 'day' | 'sunset' | 'night') {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    opponents: 11,
    weather: lighting === 'night' ? 'rain' : 'clear',
    seed: 1887,
  });
  sim.autoPlayer = true;
  for (let i = 0; i < 8 * 120; i++) sim.step(1 / 120);
  const frame = sim.makeFrame().slice();
  const original = frame.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:1280px;height:720px';
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  const view = await RacingRenderer.create(
    canvas,
    sim.track,
    () => {},
    () => false,
    {
      quality: 'medium',
      graphics: { ...graphicsPreset('medium'), resolutionScale: 1 },
    },
  );
  if (!view) throw new Error('Production renderer unavailable');
  const renderer = view.renderer;
  // Read-and-clear at each phase so a WebGL INVALID_OPERATION is attributed
  // to the phase that issued it instead of mislabeled as a final readback.
  // This is test-only instrumentation and never accepts an erroneous frame.
  const gl = renderer.getContext();
  const glErrorStages: { stage: string; code: number }[] = [];
  const captureGlError = (stage: string) => captureGlErrors(gl, stage, glErrorStages);
  captureGlError('construction');
  const originalDraw = renderer.renderBufferDirect;
  const rows = new Map<
    string,
    { object: string; lens: string; calls: number; triangles: number }
  >();
  renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const beforeCalls = renderer.info.render.calls;
    const beforeTriangles = renderer.info.render.triangles;
    originalDraw.call(this, camera, scene, geometry, material, object, group);
    // Do not issue a synchronous driver round-trip after every draw. Sticky
    // GL errors are drained at every phase boundary below; zero-error gates,
    // all submissions and the cold first-frame workload remain unchanged.
    if (!(material instanceof T.MeshDepthMaterial || material instanceof T.MeshDistanceMaterial))
      return;
    const names: string[] = [];
    for (let p: T.Object3D | null = object; p && names.length < 5; p = p.parent)
      if (p.name) names.unshift(p.name);
    const name = names.join('/') || object.type;
    const lens =
      camera instanceof T.OrthographicCamera
        ? `ortho:${camera.left},${camera.right},${camera.bottom},${camera.top}`
        : camera instanceof T.PerspectiveCamera
          ? `perspective:${camera.fov}`
          : camera.type;
    const key = `${lens}|${name}`;
    const row = rows.get(key) ?? { object: name, lens, calls: 0, triangles: 0 };
    row.calls += renderer.info.render.calls - beforeCalls;
    row.triangles += renderer.info.render.triangles - beforeTriangles;
    rows.set(key, row);
  };
  try {
    view.lighting = lighting;
    view.mode = 'cockpit';
    view.draw(frame, frame, 1, 1 / 60);
    captureGlError('complete-cockpit-frame');
    const stats = view.stats();
    const shadows = [...rows.values()].sort((a, b) => b.triangles - a.triangles);
    const image = canvas.toDataURL('image/png');
    captureGlError('display-capture');
    renderer.renderBufferDirect = originalDraw;
    // Compare the actual near shadow texture under an identical frozen scene.
    // These additional controls are NOT the first-frame budget measurement above.
    const controls = view.circuit.startFinish.shadowBounds;
    const target = view.sun.shadow.map;
    if (!target || !controls.length) throw new Error('Missing production shadow-bound control');
    const beforePixels = new Uint8Array(target.width * target.height * 4);
    const afterPixels = new Uint8Array(beforePixels.length);
    const beforeGeometry = controls.map(({ mesh }) => ({
      mesh,
      geometry: mesh.geometry,
      index: mesh.geometry.index,
      position: mesh.geometry.getAttribute('position'),
      instances: mesh.instanceMatrix,
      array: mesh.instanceMatrix.array,
      instanceCount: mesh.count,
      start: mesh.geometry.drawRange.start,
      count: mesh.geometry.drawRange.count,
    }));
    const renderShadow = (enabled: boolean, pixels: Uint8Array) => {
      for (const control of controls) control.enabled = enabled;
      const shadowDraw = renderer.shadowMap.render;
      const autoUpdate = renderer.shadowMap.autoUpdate;
      const measured = { calls: 0, triangles: 0 };
      renderer.shadowMap.render = function (...args) {
        const calls = renderer.info.render.calls,
          triangles = renderer.info.render.triangles;
        shadowDraw.apply(this, args);
        measured.calls += renderer.info.render.calls - calls;
        measured.triangles += renderer.info.render.triangles - triangles;
      };
      try {
        view.sun.shadow.needsUpdate = true;
        renderer.shadowMap.autoUpdate = true;
        // A normal render owns Three's current render state/light cache. Calling
        // shadowMap.render directly outside it leaves that internal state null.
        // No simulation step or presentation update occurs between the controls.
        renderer.render(view.scene, view.camera);
        captureGlError(enabled ? 'cropped-shadow-render' : 'uncropped-shadow-render');
        renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
        captureGlError(enabled ? 'cropped-shadow-readback' : 'uncropped-shadow-readback');
        return measured;
      } finally {
        renderer.shadowMap.render = shadowDraw;
        renderer.shadowMap.autoUpdate = autoUpdate;
      }
    };
    const uncropped = renderShadow(false, beforePixels);
    const cropped = renderShadow(true, afterPixels);
    let changedBytes = 0;
    for (let i = 0; i < beforePixels.length; i++)
      if (beforePixels[i] !== afterPixels[i]) changedBytes++;
    const shadowEquivalence = {
      width: target.width,
      height: target.height,
      changedBytes,
      uncropped,
      cropped,
      savedTriangles: uncropped.triangles - cropped.triangles,
      geometryUnchanged: beforeGeometry.every(
        (b) =>
          b.mesh.geometry === b.geometry &&
          b.geometry.index === b.index &&
          b.geometry.getAttribute('position') === b.position &&
          b.mesh.instanceMatrix === b.instances &&
          b.instances.array === b.array &&
          b.mesh.count === b.instanceCount &&
          b.geometry.drawRange.start === b.start &&
          b.geometry.drawRange.count === b.count,
      ),
    };
    return {
      lighting,
      workload: { cars: 12, seed: 1887, seconds: 8, quality: 'medium', resolution: [1280, 720] },
      image,
      shadowEquivalence,
      calls: stats.drawCalls,
      triangles: stats.triangles,
      passes: stats.drawBreakdown,
      shadows,
      sourceUnchanged: frame.every((v, i) => Object.is(v, original[i])),
      glError: glErrorStages[0]?.code ?? gl.getError(),
      glErrorStages,
      drawErrors: null, // Per-draw synchronous diagnostics are deliberately not collected.
      errorObservation: 'phase-boundaries',
      contextLost: gl.isContextLost(),
    };
  } finally {
    renderer.renderBufferDirect = originalDraw;
    view.dispose();
    canvas.remove();
  }
}
