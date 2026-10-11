import * as T from 'three';
import { RainStreaks } from '../../src/rendering/rain-streaks.ts';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H, F, carBase } from '../../src/simulation/protocol.ts';

/** Isolate one production rain instance to measure shape, projection, fog and
 * occlusion on the GPU rather than accepting a shader-source substring test. */
export function verifyRainStreakGPU() {
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(256, 256);
  const scene = new T.Scene();
  scene.background = new T.Color(0x080a10);
  const camera = new T.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  const centers = new Float32Array(3),
    velocity = new Float32Array([0, -15, 0]),
    alpha = new Float32Array([0.8]);
  const rain = new RainStreaks(centers, velocity, alpha);
  // Rain now receives the scene's lights, like wheel spray. Explicit light is
  // necessary for a projection/occlusion fixture, not an emissive-rain fallback.
  scene.add(rain.mesh, new T.HemisphereLight(0xffffff, 0xffffff, 1.6));
  const target = new T.WebGLRenderTarget(256, 256);
  const blank = new Uint8Array(256 * 256 * 4),
    pixels = new Uint8Array(blank.length);
  const measure = () => {
    rain.mesh.visible = false;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 256, 256, blank);
    rain.mesh.visible = true;
    rain.upload();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
    let minX = 256,
      maxX = -1,
      minY = 256,
      maxY = -1,
      changed = 0,
      energy = 0,
      covariance = 0;
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const p = (y * 256 + x) * 4;
        const delta =
          Math.abs(pixels[p] - blank[p]) +
          Math.abs(pixels[p + 1] - blank[p + 1]) +
          Math.abs(pixels[p + 2] - blank[p + 2]);
        energy += delta;
        if (delta > 3) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          covariance += (x - 127.5) * (y - 127.5);
          changed++;
        }
      }
    return {
      width: Math.max(0, maxX - minX + 1),
      height: Math.max(0, maxY - minY + 1),
      changed,
      energy,
      covariance,
    };
  };
  try {
    const vertical = measure();
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const verticalImage = renderer.domElement.toDataURL('image/png');
    velocity[0] = 15;
    const wind = measure();
    velocity[0] = 0;
    camera.rotation.z = Math.PI / 2;
    const rolled = measure();
    camera.rotation.z = 0;
    // Complete extinction at depth 5; the material must compile with actual fog.
    scene.fog = new T.Fog(0x080a10, 1, 2);
    const fogged = measure();
    scene.fog = null;
    const blocker = new T.Mesh(
      new T.PlaneGeometry(4, 4),
      new T.MeshBasicMaterial({ color: 0x080a10 }),
    );
    blocker.position.z = 1;
    scene.add(blocker);
    const occluded = measure();
    scene.remove(blocker);
    blocker.geometry.dispose();
    blocker.material.dispose();
    centers[2] = 4.96;
    const near = measure();
    centers[2] = 6;
    const behind = measure();
    centers[2] = 0;
    alpha[0] = 0;
    rain.clear();
    const cleared = measure();
    return {
      vertical,
      wind,
      rolled,
      fogged,
      occluded,
      near,
      behind,
      cleared,
      glError: renderer.getContext().getError(),
      verticalImage,
    };
  } finally {
    rain.geometry.dispose();
    rain.material.dispose();
    target.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** Evolving production frames, not a frozen showroom or fabricated emitter pose.
 * Hold the last snapshot for camera review so every image shows the same weather
 * and the same particle state. This is a short sequence, NOT a full-lap audit. */
export async function captureWetRace() {
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    weather: 'rain',
    compound: 'wet',
    opponents: 3,
    seed: 1887,
  });
  simulation.autoPlayer = true;
  for (let i = 0; i < 720; i++) simulation.step(1 / 120);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:960px;height:540px';
  document.body.style.cssText = 'margin:0;background:#000';
  document.body.append(canvas);
  const renderer = new RacingRenderer(canvas, simulation.track);
  // Isolate rain/spray from a time-varying cube probe; existing reference-view
  // tests independently exercise full local-reflection/HDR targets.
  renderer.setQuality('high', {
    ...graphicsPreset('high'),
    resolutionScale: 1,
    reflections: 'environment',
  });
  const captures: { view: string; image: string; draws: number; triangles: number }[] = [];
  const start = performance.now();
  const progress = (stage: string) =>
    console.info('[wet-probe] ' + JSON.stringify({ stage, elapsedMs: performance.now() - start }));
  let frame = simulation.makeFrame(),
    sourceUnchanged = true;
  try {
    for (let display = 0; display < 19; display++) {
      if (display) for (let tick = 0; tick < 8; tick++) simulation.step(1 / 120);
      frame = simulation.makeFrame();
      const copy = frame.slice();
      renderer.draw(frame, frame, 1, 1 / 15, false);
      if (display === 0 || display % 4 === 3 || display === 18) progress(`moving-${display + 1}/19`);
      sourceUnchanged &&= copy.every((v, i) => v === frame[i]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const held = renderer.effects.diagnostics(),
      copy = frame.slice();
    for (const view of ['chase', 'cockpit', 'trackside'] as const) {
      // A non-preserved drawing buffer is cleared after browser composition.
      // Own the render + readback in one animation frame, as the application
      // does, instead of racing timer-driven GPU work against the compositor.
      // Keep both held draws, all quality settings, and the image assertions.
      await new Promise<void>((resolve, reject) => {
        requestAnimationFrame(() => {
          try {
            renderer.changeCamera(view);
            for (let i = 0; i < 2; i++) renderer.draw(frame, frame, 1, 1 / 60, false);
            captures.push({
              view,
              image: canvas.toDataURL('image/png'),
              draws: renderer.renderer.info.render.calls,
              triangles: renderer.renderer.info.render.triangles,
            });
            progress(`held-${view}`);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    }
    const after = renderer.effects.diagnostics();
    sourceUnchanged &&= copy.every((v, i) => v === frame[i]);
    return {
      captures,
      sourceUnchanged,
      finite: frame.every(Number.isFinite),
      graphics: renderer.graphics,
      tick: frame[H.TICK],
      time: frame[H.TIME],
      speed: frame[carBase(0) + F.SPEED],
      rain: frame[H.RAIN],
      held,
      after,
      glError: renderer.renderer.getContext().getError(),
    };
  } finally {
    renderer.dispose();
    canvas.remove();
  }
}
