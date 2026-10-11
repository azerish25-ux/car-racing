import * as T from 'three';
import type { PitCrewView } from './pit-crew.ts';
import {
  CAR_STRIDE,
  HEADER,
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';

export interface PitMaterialWarmup {
  renderer: T.WebGLRenderer;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  crew: Pick<PitCrewView, 'root' | 'update'>;
  frame: Float32Array;
  submitted: () => void;
  ready: () => boolean;
  cancelled: () => boolean;
  yieldFrame: () => Promise<void>;
}

/** Exercise both existing crew vertex layouts before grid release. The staging
 * copy is ONLY an offscreen shader/vertex-buffer warmup, never a simulation,
 * presented-frame, replay or review observation. No race clock is advanced. */
export async function warmPitMaterials(options: PitMaterialWarmup): Promise<number> {
  const { renderer, scene, camera, crew, frame, submitted, ready, cancelled, yieldFrame } = options;
  const count = frame[H.CARS];
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12 ||
    frame.length < HEADER + count * CAR_STRIDE
  )
    throw new Error('Invalid pit material warmup frame');
  if (cancelled()) return 0;
  const staging = frame.slice(),
    o = carBase(0);
  for (let id = 0; id < count; id++) {
    const base = carBase(id);
    staging[base + F.IN_PIT] = 0;
    staging[base + F.PIT_PHASE] = 0;
    staging[base + F.PIT_CLOCK] = 0;
  }
  staging[o + F.IN_PIT] = 1;
  staging[o + F.PIT_PHASE] = 3;
  staging[o + F.PIT_CLOCK] = 2;
  staging[o + F.SPEED] = 0;
  staging[o + F.JACK_HEIGHT] = 0.19;
  for (let wheel = 0; wheel < 4; wheel++)
    staging[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LOAD] = 0;

  // Match EffectComposer's ordinary linear half-float scene target, not the
  // canvas format, so the warmup exercises the same attachment pipeline.
  const target = new T.WebGLRenderTarget(32, 20, { type: T.HalfFloatType });
  target.texture.generateMipmaps = false;
  const probe = new T.Vector3(staging[o + F.X], staging[o + F.Y], staging[o + F.Z]);
  let passes = 0;
  // Preserve the scene's lights, fog and environment (and therefore the real
  // material program keys), but do not submit the player/circuit again merely
  // to warm crew layouts. Layer masks are restored synchronously before yielding.
  const crewObjects = new Set<T.Object3D>();
  crew.root.traverse((object) => crewObjects.add(object));
  const excluded = new Map<T.Object3D, number>();
  try {
    for (const distance of [0, 60]) {
      if (cancelled()) break;
      // Scope temporary state to a synchronous submission. A resize, context
      // loss or cancellation during an awaited RAF never observes this target
      // or a staging pose as the renderer's ordinary state.
      const previousTarget = renderer.getRenderTarget();
      const face = renderer.getActiveCubeFace(),
        mip = renderer.getActiveMipmapLevel();
      const viewport = renderer.getViewport(new T.Vector4());
      const scissor = renderer.getScissor(new T.Vector4());
      const scissorTest = renderer.getScissorTest();
      const xr = renderer.xr.enabled,
        autoClear = renderer.autoClear;
      const shadowAuto = renderer.shadowMap.autoUpdate,
        shadowNeeds = renderer.shadowMap.needsUpdate;
      const visibility = crew.root.visible;
      try {
        renderer.xr.enabled = false;
        renderer.autoClear = true;
        // Use existing shadow samplers without writing live shadow maps.
        renderer.shadowMap.autoUpdate = false;
        renderer.shadowMap.needsUpdate = false;
        renderer.setRenderTarget(target);
        renderer.setViewport(0, 0, 32, 20);
        renderer.setScissorTest(false);
        crew.root.visible = true;
        probe.x = staging[o + F.X] + distance;
        // Fixed optics select near/mid layouts; the real camera never moves.
        crew.update(staging, probe, true, 58, 16 / 9);
        // A zero draw layer excludes a surface without hiding child lights.
        scene.traverse((object) => {
          if (
            !crewObjects.has(object) &&
            (object instanceof T.Mesh ||
              object instanceof T.Line ||
              object instanceof T.Points ||
              object instanceof T.Sprite)
          ) {
            excluded.set(object, object.layers.mask);
            object.layers.mask = 0;
          }
        });
        renderer.render(scene, camera);
        submitted();
        passes++;
      } finally {
        for (const [object, mask] of excluded) object.layers.mask = mask;
        excluded.clear();
        try {
          crew.update(frame, camera.position, visibility, camera.fov, camera.aspect);
        } finally {
          crew.root.visible = visibility;
          renderer.xr.enabled = xr;
          renderer.autoClear = autoClear;
          renderer.shadowMap.autoUpdate = shadowAuto;
          renderer.shadowMap.needsUpdate = shadowNeeds;
          renderer.setRenderTarget(previousTarget, face, mip);
          renderer.setViewport(viewport);
          renderer.setScissor(scissor);
          renderer.setScissorTest(scissorTest);
        }
      }
      const deadline = performance.now() + 45000;
      while (!cancelled() && !ready()) {
        // Warmup only moves shader/upload cost off the race. A slow GPU
        // continues into the session rather than failing it.
        if (performance.now() >= deadline) break;
        await yieldFrame();
      }
    }
  } finally {
    target.dispose();
  }
  return passes;
}
