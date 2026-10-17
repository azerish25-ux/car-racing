import * as T from 'three';
import { disposeTextureLoaders } from '../../src/rendering/assets/texture-loader.ts';
import { scannedGround } from '../../src/rendering/ground/scan-store.ts';
import { materials } from '../../src/rendering/materials/index.ts';
import { MX_SOIL_COLOURS } from '../../src/rendering/offroad/mx-soil-detail.ts';
import { TerrainView } from '../../src/rendering/offroad/terrain-view.ts';
import { studioHookKeys } from '../../src/rendering/studio/shader-hooks.ts';
import { installShadowFilter, sunPenumbraScale } from '../../src/rendering/studio/shadow-filter.ts';
import { COURSE_CELL, type SoilKind } from '../../src/simulation/offroad/course.ts';
import { TrackTerrainSurface } from '../../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';

const WIDTH = 1280,
  HEIGHT = 800;
type Circuit = 'valley-ridge-mx' | 'arena-nord-sx';
type Filter = 'native' | 'production';

/** Independent controls of the real TerrainView geometry/material. A camera
 * and light can expose the cause of a defect more clearly than the full
 * venue, but these images are explicitly component evidence, not game FPS.
 * Probe classes come from double-sided geometry rays, never image darkness.
 */
export async function captureMotocrossTerrainControls(circuit: Circuit, filter: Filter) {
  if (filter === 'production') installShadowFilter();
  const hasProductionFilter = T.ShaderChunk.shadowmap_pars_fragment.includes('apexShadowFilter(');
  if (hasProductionFilter !== (filter === 'production'))
    throw new Error('Terrain control must start with the requested independent filter');
  const track = rigTrack(circuit),
    surface = Track.offroadOf(track) as TrackTerrainSurface;
  const terrain = surface.terrain,
    view = new TerrainView(track);
  const source = {
    soil: terrain.soil.slice(),
    moisture: terrain.baseMoisture.slice(),
    hash: terrain.hash(),
  };
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(WIDTH, HEIGHT);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color(0xb7c7d2);
  const camera = new T.PerspectiveCamera(47, WIDTH / HEIGHT, 0.1, 1200);
  const key = new T.DirectionalLight(0xfff2dd, 3.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {
    left: -38,
    right: 38,
    top: 38,
    bottom: -38,
    near: 0.1,
    far: 200,
  });
  key.shadow.normalBias = 0.025;
  if (filter === 'production') key.shadow.radius = sunPenumbraScale(key.shadow.camera);
  scene.add(view.group, key, key.target, new T.HemisphereLight(0xc9ddee, 0x65523f, 1.3));
  const jump =
    surface.course.jumps.find((feature) => feature.kind === 'double') ?? surface.course.jumps[0];
  const station = (jump.start + jump.end) / 2,
    p = track.at(station, trackPoint());
  const target = new T.Vector3(p.x, terrain.baseHeight(station, 0) + 0.3, p.z);
  key.target.position.copy(target);
  key.position.set(target.x - p.tx * 60, target.y + 17, target.z - p.tz * 60);
  camera.position.set(
    target.x + p.tx * 20 + p.nx * 24,
    target.y + 21,
    target.z + p.tz * 20 + p.nz * 24,
  );
  camera.lookAt(target);
  camera.updateMatrixWorld();
  scene.updateMatrixWorld(true);
  const jumpView = {
    camera: {
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
      fov: camera.fov,
    },
    light: {
      position: key.position.toArray(),
      target: key.target.position.toArray(),
      intensity: key.intensity,
    },
  };
  const ray = new T.Raycaster(),
    up = new T.Vector3(0, -1, 0);
  const point = trackPoint(),
    origin = new T.Vector3(),
    sunDirection = new T.Vector3();
  const meshes = view.group.children as T.Mesh[];
  const probes: {
    s: number;
    lateral: number;
    point: number[];
    pixel: number[];
    kind: 'lit' | 'occluded';
    blockerDistance: number | null;
  }[] = [];
  // Establish the receiver sites before either image exists. Both camera
  // visibility and sun occlusion use the actual indexed triangle surfaces.
  for (let s = jump.start - 7; s <= jump.end + 12; s += 1.25) {
    track.at(s, point);
    for (const lateral of [-3, -1.5, 0, 1.5, 3]) {
      origin.set(
        point.x + point.nx * lateral,
        terrain.baseHeight(s, lateral) + 20,
        point.z + point.nz * lateral,
      );
      ray.set(origin, up);
      ray.near = 0;
      ray.far = 40;
      const receiver = ray.intersectObjects(meshes, false)[0];
      if (!receiver?.face) continue;
      const projected = receiver.point.clone().project(camera);
      const x = Math.round((projected.x * 0.5 + 0.5) * WIDTH);
      const y = Math.round((-projected.y * 0.5 + 0.5) * HEIGHT);
      if (
        Math.abs(projected.x) > 0.9 ||
        Math.abs(projected.y) > 0.9 ||
        projected.z < -1 ||
        projected.z > 1
      )
        continue;
      // Reject hidden back slopes; a screenshot pixel must see this receiver.
      const cameraDirection = receiver.point.clone().sub(camera.position).normalize();
      ray.set(camera.position, cameraDirection);
      ray.far = camera.position.distanceTo(receiver.point) + 0.1;
      const visible = ray.intersectObjects(meshes, false)[0];
      if (!visible || visible.point.distanceTo(receiver.point) > 0.025) continue;
      sunDirection.copy(key.position).sub(key.target.position).normalize();
      if (receiver.face.normal.dot(sunDirection) < 0.12) continue;
      ray.set(receiver.point.clone().addScaledVector(sunDirection, 0.08), sunDirection);
      ray.near = 0.04;
      ray.far = 110;
      const side = view.material.side;
      view.material.side = T.DoubleSide; // CPU rays match the material's actual shadow side.
      const blocker = ray.intersectObjects(meshes, false)[0];
      view.material.side = side;
      probes.push({
        s,
        lateral,
        point: receiver.point.toArray(),
        pixel: [x, y],
        kind: blocker ? 'occluded' : 'lit',
        blockerDistance: blocker?.distance ?? null,
      });
    }
  }
  const lumaAt = (pixels: Uint8Array, pixel: number[]) => {
    let total = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const offset = ((HEIGHT - 1 - pixel[1] - dy) * WIDTH + pixel[0] + dx) * 4;
        total +=
          (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) /
          255;
      }
    return total / 9;
  };
  const renderBufferDirect = renderer.renderBufferDirect.bind(renderer);
  let shadowCalls = 0,
    shadowTriangles = 0;
  renderer.renderBufferDirect = (...args) => {
    const calls = renderer.info.render.calls,
      triangles = renderer.info.render.triangles;
    renderBufferDirect(...args);
    if (args[0] === key.shadow.camera) {
      shadowCalls += renderer.info.render.calls - calls;
      shadowTriangles += renderer.info.render.triangles - triangles;
    }
  };
  const capture = (label: string, sampleProbes = true) => {
    shadowCalls = 0;
    shadowTriangles = 0;
    renderer.render(scene, camera);
    const gl = renderer.getContext(),
      pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (const value of pixels) hash = Math.imul(hash ^ value, 16777619) >>> 0;
    return {
      label,
      image: renderer.domElement.toDataURL('image/png'),
      hash,
      glError: gl.getError(),
      luma: sampleProbes ? probes.map((probe) => lumaAt(pixels, probe.pixel)) : [],
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      shadowWork: { calls: shadowCalls, triangles: shadowTriangles },
      resources: {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? 0,
      },
    };
  };
  try {
    materials.prepare(renderer);
    scannedGround.attach(renderer, 'high');
    if (!(await scannedGround.ready(60000)))
      throw new Error(`Terrain scans unavailable: ${JSON.stringify(scannedGround.diagnostics())}`);
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    const on = capture('jump-terrain-casters-on');
    for (const mesh of meshes) mesh.castShadow = false;
    const off = capture('jump-terrain-casters-off');
    for (const mesh of meshes) mesh.castShadow = true;
    const restored = capture('jump-restored-casters');
    view.record({ reset: true, wetness: 0, blocks: new Float32Array() }, 0, true);
    view.record({ reset: false, wetness: 0.72, blocks: new Float32Array() }, 8, true);
    const wet = capture('jump-wet-soil'),
      held = capture('jump-held-wet-soil');
    view.showAt(0);
    const rewound = capture('jump-rewound-soil');
    const observations = probes.map((probe, i) => ({
      ...probe,
      on: on.luma[i],
      off: off.luma[i],
      difference: off.luma[i] - on.luma[i],
    }));
    const lit = observations.filter((probe) => probe.kind === 'lit');
    const occluded = observations.filter((probe) => probe.kind === 'occluded');
    const sorted = occluded.map((probe) => probe.difference).sort((a, b) => a - b);
    const median =
      sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

    // Detail captures of authored cell boundaries. The color and scan data
    // come from the same mesh as the jump, with no replacement material.
    const transitions: { s: number; before: SoilKind; after: SoilKind }[] = [];
    const column = Math.floor((0 - terrain.lateralMin) / COURSE_CELL.lateral);
    for (let row = 1; row < terrain.rows; row++) {
      const before = terrain.soilKind((row - 1) * terrain.columns + column),
        after = terrain.soilKind(row * terrain.columns + column);
      if (before !== after) transitions.push({ s: row * COURSE_CELL.along, before, after });
    }
    const chosen =
      circuit === 'valley-ridge-mx'
        ? [
            transitions.find((site) => site.after === 'sand'),
            transitions.find((site) => site.after === 'mud'),
            transitions.find((site) => site.before === 'mud' && site.after === 'loam'),
          ]
        : [transitions.find((site) => site.before === 'hardpack' && site.after === 'loam')];
    const boundaries = [];
    for (const site of chosen) {
      if (!site) throw new Error('Missing authored soil boundary control');
      track.at(site.s, point);
      const height = terrain.baseHeight(site.s, 0);
      camera.position.set(
        point.x - point.tx * 4 + point.nx * 9,
        height + 9,
        point.z - point.tz * 4 + point.nz * 9,
      );
      camera.lookAt(point.x, height, point.z);
      camera.updateMatrixWorld();
      key.target.position.set(point.x, height, point.z);
      key.position.set(point.x - point.tx * 35, height + 45, point.z - point.tz * 35);
      scene.updateMatrixWorld(true);
      const samples = [];
      const colorA = new T.Color(MX_SOIL_COLOURS[site.before]),
        colorB = new T.Color(MX_SOIL_COLOURS[site.after]);
      // Ray/barycentric sampling evaluates the displayed triangle field,
      // including its 1 m along-lap interpolation, not a resampled CPU grid.
      for (const lateral of [-3, -1.5, 0, 1.5, 3]) {
        let closest: { s: number; fraction: number; moisture: number } | null = null;
        for (let s = site.s - 2.5; s <= site.s + 2.5; s += 0.025) {
          track.at(s, point);
          origin.set(
            point.x + point.nx * lateral,
            terrain.baseHeight(s, lateral) + 10,
            point.z + point.nz * lateral,
          );
          ray.set(origin, up);
          ray.near = 0;
          ray.far = 20;
          const hit = ray.intersectObjects(meshes, false)[0];
          if (!hit?.face) continue;
          const geometry = (hit.object as T.Mesh).geometry,
            position = geometry.getAttribute('position');
          const a = new T.Vector3().fromBufferAttribute(position, hit.face.a),
            b = new T.Vector3().fromBufferAttribute(position, hit.face.b),
            c = new T.Vector3().fromBufferAttribute(position, hit.face.c);
          const bary = T.Triangle.getBarycoord(hit.point, a, b, c, new T.Vector3());
          if (!bary) continue;
          const color = geometry.getAttribute('color'),
            state = geometry.getAttribute('apexSoilState');
          const red =
            color.getX(hit.face.a) * bary.x +
            color.getX(hit.face.b) * bary.y +
            color.getX(hit.face.c) * bary.z;
          const fraction = (red - colorA.r) / (colorB.r - colorA.r);
          const moisture =
            state.getX(hit.face.a) * bary.x +
            state.getX(hit.face.b) * bary.y +
            state.getX(hit.face.c) * bary.z;
          if (!closest || Math.abs(fraction - 0.5) < Math.abs(closest.fraction - 0.5))
            closest = { s, fraction, moisture };
        }
        if (!closest) throw new Error('No visible triangle at soil transition');
        samples.push({ lateral, ...closest });
      }
      const image = capture(`boundary-${site.before}-to-${site.after}`, false);
      boundaries.push({
        ...site,
        samples,
        crossingSpreadM:
          Math.max(...samples.map((sample) => sample.s)) -
          Math.min(...samples.map((sample) => sample.s)),
        image,
      });
    }
    return {
      circuit,
      filter,
      productionFilterInstalled: hasProductionFilter,
      jump: { ...jump },
      jumpView,
      shadow: {
        mapSize: key.shadow.mapSize.toArray(),
        normalBias: key.shadow.normalBias,
        bias: key.shadow.bias,
        radius: key.shadow.radius,
      },
      samples: [on, off, restored, wet, held, rewound],
      observations,
      lit: {
        count: lit.length,
        meanAbsoluteChange:
          lit.reduce((sum, probe) => sum + Math.abs(probe.difference), 0) / lit.length,
      },
      occluded: { count: occluded.length, medianDarkening: median },
      boundaries,
      sourceUnchanged:
        terrain.hash() === source.hash &&
        terrain.soil.every((value, index) => value === source.soil[index]) &&
        terrain.baseMoisture.every((value, index) => value === source.moisture[index]),
      hooks: studioHookKeys(view.material),
      scans: scannedGround.diagnostics(),
    };
  } finally {
    scannedGround.detach(renderer);
    view.dispose();
    await disposeTextureLoaders(renderer);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
