import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { configureSky } from '../../src/rendering/daylight.ts';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadSuppliedPlayer } from '../../src/rendering/supplied-player.ts';
import { suppliedShaderWorkControl } from '../../src/rendering/supplied-shader-work.ts';
import { suppliedDecalCoverageControl } from '../../src/rendering/supplied-player-materials.ts';
import { TextureBudget } from '../../src/rendering/texture-budget.ts';
import { frontToBackOpaque } from '../../src/rendering/opaque-order.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { carBase, W, WHEEL_BASE } from '../../src/simulation/protocol.ts';

/** Actual shipped geometry/maps in a fixed studio. Synchronised frame durations
 * include CPU work and GPU waiting; these are not full-race or hardware FPS. */
export async function playerRenderBudget() {
  const asset = await loadSuppliedPlayer(() => false);
  const displayCanvas = document.createElement('canvas');
  displayCanvas.width = 512;
  displayCanvas.height = 256;
  const ctx = displayCanvas.getContext('2d')!;
  ctx.fillStyle = '#17324b';
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#ffffff';
  ctx.font = '80px monospace';
  ctx.fillText('6 287', 50, 150);
  const display = new T.CanvasTexture(displayCanvas);
  display.userData.dynamic = true;
  display.colorSpace = T.SRGBColorSpace;
  const player = asset.take(display);
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(640, 400);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  document.body.append(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0x687786);
  const pmrem = new T.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = env.texture;
  const chassis = new T.Group();
  chassis.add(player.root);
  scene.add(chassis);
  scene.add(new T.HemisphereLight(0xd5e5ff, 0x676356, 2));
  const sun = new T.DirectionalLight(0xfff3e3, 3.2);
  sun.position.set(-4, 7, 5);
  scene.add(sun);
  const floor = new T.Mesh(
    new T.PlaneGeometry(50, 50),
    new T.MeshStandardMaterial({ color: 0x424b56, roughness: 0.83 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const sky = new Sky();
  configureSky(sky);
  sky.scale.setScalar(450000);
  sky.material.uniforms.cloudCover.value = 0.35;
  scene.add(sky);
  const camera = new T.PerspectiveCamera(44, 1.6, 0.025, 100);
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    opponents: 0,
    weather: 'clear',
    seed: 711,
  });
  for (let i = 0; i < 120; i++) sim.step(1 / 120);
  const frame = sim.makeFrame(),
    saved = frame.slice(),
    o = carBase(0);
  chassis.position.y = frame[o + WHEEL_BASE + W.LENGTH] + frame[o + WHEEL_BASE + W.RADIUS] - 0.05;
  const skins: T.SkinnedMesh[] = [];
  const maps = new Set<T.Texture>(),
    decals = new Set<T.Material>(),
    // Independent audit of which double-sided sheets are safe to discard at alpha=0.
    // Depth-writing, alpha-test and special-blend sheets must remain unmodified.
    eligibleDecals = new Set<T.Material>(),
    optimized = new Set<T.Material>();
  player.root.traverse((object) => {
    if (object instanceof T.SkinnedMesh) skins.push(object);
    if (!(object instanceof T.Mesh)) return;
    for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
      if (suppliedShaderWorkControl(m)) optimized.add(m);
      if (m.name.startsWith('Decal |') && m.transparent && m.side === T.DoubleSide) {
        decals.add(m);
        if (
          m instanceof T.MeshStandardMaterial &&
          m.blending === T.NormalBlending &&
          !m.depthWrite &&
          !m.stencilWrite &&
          !m.alphaToCoverage &&
          !m.alphaHash &&
          m.alphaTest === 0 &&
          !(m instanceof T.MeshPhysicalMaterial && m.transmission > 0)
        )
          eligibleDecals.add(m);
      }
      for (const v of Object.values(m))
        if (v instanceof T.Texture && v.userData.suppliedPlayerTexture === true) maps.add(v);
    }
  });
  const originals = new Map(
    [...maps].map((t) => [
      t,
      {
        image: t.image,
        source: t.source,
        repeat: t.repeat.toArray(),
        offset: t.offset.toArray(),
        flipY: t.flipY,
        colorSpace: t.colorSpace,
      },
    ]),
  );
  const budget = new TextureBudget();
  budget.configure(1024, 16);
  budget.register(player.root);
  const gl = renderer.getContext();
  renderer.info.autoReset = false;
  const shot = () => {
    const start = performance.now();
    renderer.info.reset();
    renderer.render(scene, camera);
    gl.finish();
    const pixels = new Uint8Array(640 * 400 * 4);
    gl.readPixels(0, 0, 640, 400, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // Include the actual readback: Chromium may defer work past gl.finish().
    const synchronizedFrameMs = performance.now() - start;
    return {
      pixels,
      synchronizedFrameMs,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      image: renderer.domElement.toDataURL('image/png'),
    };
  };
  const delta = (a: Uint8Array, b: Uint8Array) => {
    let sum = 0,
      max = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      sum += d;
      max = Math.max(max, d);
    }
    return { mean: sum / a.length, max };
  };
  const rows = [];
  const resourceCount = () => ({
    ...renderer.info.memory,
    programs: renderer.info.programs?.length ?? 0,
  });
  try {
    for (const view of ['front', 'rear', 'cockpit'] as const) {
      player.lods!.drawRanges!.enabled = false;
      skins.forEach((mesh) => {
        mesh.frustumCulled = false;
      });
      optimized.forEach((m) => {
        suppliedShaderWorkControl(m)!.value = false;
      });
      decals.forEach((m) => {
        const control = suppliedDecalCoverageControl(m);
        if (control) control.value = false;
      });
      player.update(frame, frame, o, 1, view === 'cockpit');
      camera.fov = view === 'cockpit' ? 68 : 44;
      if (view === 'cockpit') {
        camera.position.copy(player.eye).add(chassis.position);
        camera.lookAt(camera.position.clone().add(new T.Vector3(0, -0.035, 1)));
      } else {
        camera.position.set(view === 'front' ? 3.7 : -3.7, 2, view === 'front' ? 5.5 : -5.5);
        camera.lookAt(0, 0.43, 0);
      }
      camera.updateProjectionMatrix();
      // Force the unoptimized sky-first order as an independent pixel oracle.
      // Production instead places its unchanged far-depth sky after opaques.
      sky.renderOrder = -1;
      renderer.setOpaqueSort(null);
      decals.forEach((m) => {
        m.forceSinglePass = false;
      });
      shot();
      const original = shot();
      decals.forEach((m) => {
        m.forceSinglePass = true;
      });
      shot();
      const singlePass = shot();
      sky.renderOrder = 0;
      renderer.setOpaqueSort(frontToBackOpaque);
      shot();
      const sorted = shot();
      decals.forEach((m) => {
        const control = suppliedDecalCoverageControl(m);
        if (control) control.value = true;
      });
      shot();
      const coverage = shot();
      optimized.forEach((m) => {
        suppliedShaderWorkControl(m)!.value = true;
      });
      shot();
      const shaderWork = shot();
      skins.forEach((mesh) => {
        mesh.frustumCulled = true;
      });
      shot();
      const culled = shot();
      player.lods!.drawRanges!.compact = false;
      player.lods!.drawRanges!.enabled = true;
      shot();
      const ranged = shot();
      player.lods!.drawRanges!.compact = true;
      shot();
      const compacted = shot();
      budget.configure(256, 2);
      shot();
      const low = shot();
      const lowMaps = [...maps].map((t) => ({
        width: t.image.width,
        height: t.image.height,
        anisotropy: t.anisotropy,
      }));
      budget.configure(1024, 16);
      shot();
      const restored = shot();
      rows.push({
        view,
        decalDelta: delta(original.pixels, singlePass.pixels),
        opaqueDelta: delta(singlePass.pixels, sorted.pixels),
        coverageDelta: delta(sorted.pixels, coverage.pixels),
        restoredDelta: delta(coverage.pixels, restored.pixels),
        shaderWorkDelta: delta(coverage.pixels, shaderWork.pixels),
        cullingDelta: delta(shaderWork.pixels, culled.pixels),
        rangeDelta: delta(culled.pixels, ranged.pixels),
        ranged: { ...ranged, pixels: undefined },
        compactionDelta: delta(ranged.pixels, compacted.pixels),
        compacted: { ...compacted, pixels: undefined },
        lowMaps,
        original: { ...original, pixels: undefined },
        singlePass: { ...singlePass, pixels: undefined },
        sorted: { ...sorted, pixels: undefined },
        coverage: { ...coverage, pixels: undefined },
        low: { ...low, pixels: undefined },
        shaderWork: { ...shaderWork, pixels: undefined },
        culled: { ...culled, pixels: undefined },
        restored: { ...restored, pixels: undefined },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const warmed = resourceCount();
    const compactedWarmed = player.lods!.drawRanges!.diagnostics().compacted;
    for (let i = 0; i < 6; i++) {
      budget.configure(i % 2 ? 1024 : 256, i % 2 ? 16 : 2);
      shot();
    }
    const reused = resourceCount();
    const mapsRestored = [...originals].every(
      ([texture, old]) =>
        texture.image === old.image &&
        texture.flipY === old.flipY &&
        texture.colorSpace === old.colorSpace &&
        texture.repeat.toArray().every((v, i) => v === old.repeat[i]) &&
        texture.offset.toArray().every((v, i) => v === old.offset[i]),
    );
    budget.dispose();
    const sourcesRestored = [...originals].every(([texture, old]) => texture.source === old.source);
    return {
      rows,
      warmed,
      reused,
      compactedWarmed,
      compactedReused: player.lods!.drawRanges!.diagnostics().compacted,
      mapsRestored,
      sourcesRestored,
      sourceUnchanged: frame.every((v, i) => v === saved[i]),
      maps: maps.size,
      shaderWorkMaterials: optimized.size,
      skinBounds: player.skinBounds.diagnostics(),
      decalMaterials: decals.size,
      eligibleDecalMaterials: eligibleDecals.size,
      coverageMaterials: [...decals].filter((m) => suppliedDecalCoverageControl(m)).length,
      displayUnchanged: display.image === displayCanvas && display.image.width === 512,
      glError: gl.getError(),
      timingScope: 'synchronised studio frame CPU + GPU wait, not device FPS',
    };
  } finally {
    budget.dispose();
    player.disposeAnimation();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>(),
      skeletons = new Set<T.Skeleton>();
    scene.traverse((object) => {
      if (object instanceof T.Mesh) {
        geometries.add(object.geometry);
        for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(m);
          for (const v of Object.values(m)) if (v instanceof T.Texture) textures.add(v);
        }
      }
      if (object instanceof T.SkinnedMesh) skeletons.add(object.skeleton);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    const images = new Set<ImageBitmap>();
    textures.forEach((t) => {
      t.dispose();
      if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) images.add(t.image);
    });
    images.forEach((i) => i.close());
    skeletons.forEach((s) => s.dispose());
    env.dispose();
    renderer.dispose();
    asset.dispose();
  }
}
