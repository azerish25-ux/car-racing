import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { installSpecularAntialiasing } from '../../src/rendering/specular-aa.ts';
import { FarShadow } from '../../src/rendering/far-shadow.ts';
import { SceneAmbientPass } from '../../src/rendering/scene-ambient-pass.ts';
import { LensBloomPass } from '../../src/rendering/lens-bloom.ts';
import { BroadcastGradePass } from '../../src/rendering/broadcast-grade.ts';
import { WetRoadReflection } from '../../src/rendering/wet-reflection.ts';
import { studioUniforms } from '../../src/rendering/studio/studio-frame.ts';
import { sunPenumbraScale } from '../../src/rendering/studio/shadow-filter.ts';
import { lightingDirection } from '../../src/rendering/daylight.ts';
import { graphicsPreset, type QualityPreset } from '../../src/rendering/options.ts';
import { UltraPipeline } from '../../src/rendering/ultra/pipeline.ts';
import { materials, PROCEDURAL_RECIPES } from '../../src/rendering/materials/index.ts';
import { textures as libraryTextures } from '../../src/rendering/materials/library.ts';
import { H, HEADER } from '../../src/simulation/protocol.ts';

/**
 * Deterministic ULTRA pipeline capture (scripts/ultra-capture.ts and
 * e2e/58-ultra-pipeline.spec.ts). A fixed synthetic set - wet asphalt with
 * puddles, a flaked-paint body, carbon, rubber, brushed metal, glass, a
 * concrete wall and leaf cards - under a sun with near + far + mid shadow
 * maps and a PMREM environment, rendered through the retained scene pass,
 * bloom, output and grade with every ULTRA module inserted. Nothing depends
 * on wall-clock time: the camera path and presented time are frame-indexed.
 */
export interface UltraCaptureOptions {
  preset: QualityPreset;
  width: number;
  height: number;
  frames: number;
  rain: number;
  replay: boolean;
}
export interface UltraCaptureResult {
  renderer: string;
  glErrors: number[];
  diagnostics: ReturnType<UltraPipeline['diagnostics']>;
  heldFramesIdentical: boolean;
  meanLuminance: number;
  image: string;
  drawCalls: number;
  programs: number;
}

function heldHash(gl: WebGL2RenderingContext, width: number, height: number) {
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let hash = 2166136261;
  let luminance = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    hash = Math.imul(hash ^ pixels[i], 16777619);
    hash = Math.imul(hash ^ pixels[i + 1], 16777619);
    hash = Math.imul(hash ^ pixels[i + 2], 16777619);
    luminance += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
  }
  return { hash: hash >>> 0, luminance: luminance / (width * height * 255) };
}

export function capture(options: UltraCaptureOptions): UltraCaptureResult {
  installSpecularAntialiasing();
  const canvas = document.createElement('canvas');
  canvas.width = options.width;
  canvas.height = options.height;
  document.body.appendChild(canvas);
  const context = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  if (!context) throw new Error('WebGL2 unavailable');
  const renderer = new T.WebGLRenderer({ canvas, context });
  renderer.setSize(options.width, options.height, false);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color(0x9fb7d0);
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  const camera = new T.PerspectiveCamera(50, options.width / options.height, 0.045, 7000);

  // Lights: sun (directional shadow 0), far map (1), the pipeline's mid cascade (2).
  const sun = new T.DirectionalLight(0xfff0dc, 3.4);
  const direction = lightingDirection('sunset').clone();
  sun.position.copy(direction);
  sun.castShadow = true;
  const g = graphicsPreset(options.preset);
  const size =
    g.shadowSize > 0 ? Math.min(g.shadowSize, renderer.capabilities.maxTextureSize) : 1024;
  sun.shadow.mapSize.set(size, size);
  Object.assign(sun.shadow.camera, {
    left: -38,
    right: 38,
    top: 38,
    bottom: -38,
    near: 20,
    far: 500,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.000015;
  sun.shadow.normalBias = 0.008;
  sun.shadow.radius = sunPenumbraScale(sun.shadow.camera);
  scene.add(new T.HemisphereLight(0x8fb6ea, 0x4a4237, 0.25), sun, sun.target);
  const far = new FarShadow(2048);
  scene.add(far.light, far.light.target);

  // The set.
  const ground = new T.Mesh(
    materials.boxProjectUv(new T.PlaneGeometry(160, 160, 1, 1).rotateX(-Math.PI / 2)),
    materials.wetRoad({ wetness: 0.9 }),
  );
  ground.receiveShadow = true;
  const body = new T.Mesh(
    new T.SphereGeometry(1, 96, 48).scale(2.3, 0.55, 0.95),
    materials.carPaint({ color: 0xb3121a, flake: 0.7 }),
  );
  body.position.set(0, 0.75, 0);
  const wing = new T.Mesh(new T.BoxGeometry(1.9, 0.06, 0.45), materials.carbon());
  wing.position.set(-2.1, 1.25, 0);
  const tyreMaterial = materials.rubber({ wear: 0.3 });
  const tyres = [-1.5, 1.5].flatMap((x) =>
    [-0.95, 0.95].map((z) => {
      const tyre = new T.Mesh(new T.TorusGeometry(0.33, 0.14, 24, 48), tyreMaterial);
      tyre.position.set(x, 0.47, z);
      return tyre;
    }),
  );
  const pole = new T.Mesh(
    materials.boxProjectUv(new T.CylinderGeometry(0.12, 0.12, 6, 32), 0.3),
    materials.metal({ kind: 'brushed' }),
  );
  pole.position.set(4, 3, -4);
  const pane = new T.Mesh(new T.PlaneGeometry(3, 1.6), materials.glass({ tint: 0xa9bccc }));
  pane.position.set(-4, 1.4, -2);
  pane.rotation.y = 0.6;
  const wall = new T.Mesh(
    materials.boxProjectUv(new T.BoxGeometry(30, 2.4, 0.6)),
    materials.concrete({ horizontal: 0 }),
  );
  wall.position.set(0, 1.2, -9);
  const leafMaterial = materials.vegetation({ translucency: 0.45 });
  const leaves = Array.from({ length: 24 }, (_, i) => {
    const leaf = new T.Mesh(new T.PlaneGeometry(1.4, 1.4), leafMaterial);
    leaf.position.set(-12 + (i % 6) * 0.7, 3 + Math.floor(i / 6) * 0.6, -8 + (i % 3) * 0.4);
    leaf.rotation.set(0.3 * (i % 3), i * 0.7, 0.2);
    return leaf;
  });
  for (const mesh of [body, wing, ...tyres, pole, wall, ...leaves]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  scene.add(ground, body, wing, ...tyres, pole, pane, wall, ...leaves);
  scene.updateMatrixWorld(true);
  far.bake(renderer, scene, {
    direction,
    bounds: new T.Box3(new T.Vector3(-80, -5, -80), new T.Vector3(80, 20, 80)),
    hidden: [],
    farCasters: [],
    sun,
  });

  // The retained composer chain, then the ULTRA modules.
  const composer = new EffectComposer(renderer);
  composer.setSize(options.width, options.height);
  const scenePass = new SceneAmbientPass(
    scene,
    camera,
    Math.min(g.msaa, renderer.capabilities.maxSamples),
    null,
    sun,
  );
  const bloom = new LensBloomPass();
  const grade = new BroadcastGradePass();
  composer.addPass(scenePass);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(grade);
  const ultra = new UltraPipeline({
    renderer,
    scene,
    camera,
    composer,
    scenePass,
    bloom,
    grade,
    sun,
    farShadow: far,
    wetReflection: new WetRoadReflection(),
    roadMaterial: ground.material,
  });
  composer.setSize(options.width, options.height);
  scenePass.ambientOcclusion = g.ambientOcclusion;
  scenePass.temporal.enabled = g.temporalAA;
  bloom.enabled = g.bloom;
  grade.apply('sunset', 0, 0);
  ultra.configure(options.preset, g);

  const presented = new Float32Array(HEADER);
  presented[H.RAIN] = options.rain;
  presented[H.WATER] = 0.9;
  presented[H.CLOUD] = 0.3;
  const viewProj = new T.Matrix4();
  const frame = (index: number, advance: boolean) => {
    // A slow, frame-indexed dolly: TAA, temporal AO and SSR see real motion.
    const t = index / 60;
    camera.position.set(Math.sin(0.3 + t * 0.2) * 7.5, 1.35, Math.cos(0.3 + t * 0.2) * 7.5);
    camera.lookAt(0, 0.8, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    studioUniforms.studioPrevViewProj.value.copy(viewProj);
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!advance || index === 0) studioUniforms.studioPrevViewProj.value.copy(viewProj);
    studioUniforms.studioViewProj.value.copy(viewProj);
    studioUniforms.studioFrameDt.value = advance ? 1 / 60 : 0;
    studioUniforms.studioTime.value = t;
    studioUniforms.studioSunDir.value.copy(direction).normalize();
    presented[H.TIME] = t;
    ultra.prepareFrame({
      presented,
      cars: [{ reflectivePaint: [body.material] }],
      subject: body.position,
      cameraMode: 'chase',
      lighting: 'sunset',
      studio: false,
      menu: false,
      photo: false,
      replay: options.replay,
      otherDof: false,
      cut: index === 0,
    });
    renderer.info.reset();
    composer.render();
    ultra.afterFrame();
  };
  renderer.info.autoReset = false;
  for (let i = 0; i < options.frames; i++) frame(i, true);
  const drawCalls = renderer.info.render.calls;
  // Two held frames of the last instant must be byte-identical.
  frame(options.frames - 1, false);
  const first = heldHash(context, options.width, options.height);
  frame(options.frames - 1, false);
  const second = heldHash(context, options.width, options.height);
  const glErrors: number[] = [];
  for (
    let e = context.getError();
    e !== context.NO_ERROR && glErrors.length < 8;
    e = context.getError()
  )
    glErrors.push(e);
  const debug = context.getExtension('WEBGL_debug_renderer_info');
  const result: UltraCaptureResult = {
    renderer: String(
      debug
        ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : context.getParameter(context.RENDERER),
    ),
    glErrors,
    diagnostics: ultra.diagnostics(),
    heldFramesIdentical: first.hash === second.hash,
    meanLuminance: first.luminance,
    image: canvas.toDataURL('image/png'),
    drawCalls,
    programs: renderer.info.programs?.length ?? 0,
  };
  ultra.dispose();
  composer.dispose();
  renderer.dispose();
  canvas.remove();
  return result;
}

/** Bake every procedural recipe output and return them as PNG data URLs
 * (review aid: tiling, relief and tone of the GPU-generated maps). */
export function proceduralSheets() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2');
  if (!context) throw new Error('WebGL2 unavailable');
  const renderer = new T.WebGLRenderer({ canvas, context });
  const outputs = ['normal', 'orm', 'albedo'] as const;
  const handed = PROCEDURAL_RECIPES.flatMap((recipe) =>
    outputs.map((output) => ({ recipe, output, texture: libraryTextures.get(recipe, output) })),
  );
  libraryTextures.bake(renderer);
  const sheets: Record<string, string> = {};
  for (const { recipe, output, texture } of handed) {
    const image = texture.image as { data: Uint8Array; width: number; height: number };
    const view = document.createElement('canvas');
    // Two tiles across: seams and repetition are visible.
    view.width = image.width * 2;
    view.height = image.height;
    const ctx = view.getContext('2d')!;
    const data = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
    ctx.putImageData(data, 0, 0);
    ctx.putImageData(data, image.width, 0);
    sheets[`${recipe}-${output}`] = view.toDataURL('image/png');
  }
  renderer.dispose();
  return { sheets, diagnostics: libraryTextures.diagnostics() };
}
