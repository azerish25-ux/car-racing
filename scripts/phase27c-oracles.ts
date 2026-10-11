import assert from 'node:assert/strict';
import * as T from 'three';
import { DriverRig, DriverActions } from '../src/rendering/driver.ts';
import { driverBodyPose, fingerGeometry } from '../src/rendering/driver-anatomy.ts';
import { CrowdCluster, crowdDetail, spectatorGeometry } from '../src/rendering/crowd.ts';
import { serviceSitePlan, inServiceFootprint } from '../src/rendering/venue-service-plan.ts';
import { buildServiceAreas } from '../src/rendering/venue-service.ts';
import { venueLampPlan } from '../src/rendering/venue-lighting.ts';
import { buildTrackInfrastructure, trackInfrastructurePlan } from '../src/rendering/track-infrastructure.ts';
import { TracksideDirector, tracksideFraming, tracksideRigs } from '../src/rendering/trackside.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { vegetationPlan } from '../src/rendering/landscape.ts';
import { grassApronOffset } from '../src/rendering/ground-profile.ts';
import { sculptedLoft } from '../src/rendering/bodywork.ts';
import { openFrontCap, addWheelMechanicalDetail } from '../src/rendering/car-mechanical-detail.ts';

function dispose(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>();
  root.traverse((object) => {
    if (object instanceof T.InstancedMesh) object.dispose();
    if (!(object instanceof T.Mesh)) return;
    geometries.add(object.geometry);
    for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m);
    if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
  });
  for (const m of materials) for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
  geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); textures.forEach((t) => t.dispose());
}
function finiteGeometry(g: T.BufferGeometry) {
  for (const attribute of Object.values(g.attributes)) assert(Array.from(attribute.array).every(Number.isFinite));
  g.computeBoundingBox(); g.computeBoundingSphere(); assert(Number.isFinite(g.boundingSphere!.radius));
}

export function verifyGloveGeometry() {
  const reports = [];
  for (const side of [-1, 1]) for (let finger = 0; finger < 4; finger++) {
    const g = fingerGeometry(side, finger), again = fingerGeometry(side, finger);
    try {
      finiteGeometry(g);
      assert.deepEqual(g.getAttribute('position').array, again.getAttribute('position').array);
      const p = g.getAttribute('position'), n = g.getAttribute('normal'), idx = g.getIndex()!;
      const keys = new Map<string, number>(), edges = new Map<string, { count: number; direction: number }>();
      const ids = Array.from({ length: p.count }, (_, i) => {
        const key = [p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v * 1e8)).join(',');
        if (!keys.has(key)) keys.set(key, keys.size);
        assert(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-5);
        return keys.get(key)!;
      });
      let minArea = Infinity;
      for (let i = 0; i < idx.count; i += 3) {
        const vertices = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
        const [a, b, c] = vertices.map((v) => new T.Vector3().fromBufferAttribute(p, v));
        minArea = Math.min(minArea, b.sub(a).cross(c.sub(a)).length() * 0.5);
        for (let j = 0; j < 3; j++) {
          const x = ids[vertices[j]], y = ids[vertices[(j + 1) % 3]];
          const key = `${Math.min(x, y)}:${Math.max(x, y)}`;
          const edge = edges.get(key) ?? { count: 0, direction: 0 };
          edge.count++; edge.direction += x < y ? 1 : -1; edges.set(key, edge);
        }
      }
      const openEdges = [...edges.values()].filter((e) => e.count !== 2).length;
      const windingErrors = [...edges.values()].filter((e) => e.direction !== 0).length;
      assert.equal(openEdges, 0); assert.equal(windingErrors, 0); assert(minArea > 1e-10);
      assert.equal(idx.count / 3, 672); assert(g.boundingSphere!.radius < 0.06);
      reports.push({ side, finger, triangles: idx.count / 3, openEdges, windingErrors, minArea });
    } finally { g.dispose(); again.dispose(); }
  }
  for (const bad of [NaN, Infinity, 0, 2]) assert.throws(() => fingerGeometry(bad, 0));
  assert.throws(() => fingerGeometry(1, 4));
  return reports;
}

export function verifyDriverEnvelope() {
  const root = new T.Group(), wheel = new T.Group();
  wheel.position.set(0, 0.115, 0.22); wheel.rotation.x = 0.12;
  root.add(wheel);
  const driver = new DriverRig(wheel); root.add(driver.root);
  let poses = 0, maximumUpperError = 0, maximumLowerError = 0;
  try {
    for (const lat of [-5, 0, 5]) for (const longitudinal of [-6, 0, 6]) for (const vertical of [-1, 1, 5])
      for (let step = 0; step <= 140; step++) {
        wheel.rotation.z = -1.4 + step * 0.02;
        driver.update(step / 60, 4, 1, lat, longitudinal, vertical);
        for (const arm of driver.diagnostics()) {
          assert(arm.reachable); assert(arm.elbow.every(Number.isFinite));
          assert.deepEqual(arm.shoulder, [arm.side * 0.16, 0.015, -0.48]);
          maximumUpperError = Math.max(maximumUpperError, Math.abs(arm.upperLength - 0.37));
          maximumLowerError = Math.max(maximumLowerError, Math.abs(arm.lowerLength - 0.36)); poses++;
        }
      }
    assert(maximumUpperError < 1e-9 && maximumLowerError < 1e-9);
    const state = driverBodyPose(4, -5, 3); driverBodyPose(-4, 3, -1);
    assert.deepEqual(driverBodyPose(4, -5, 3), state);
    assert.throws(() => driverBodyPose(NaN, 0, 1));
    const actions = new DriverActions(); actions.sample(1, 3, 1); actions.sample(1.02, 4, 1);
    assert.equal(actions.up, 1); actions.sample(1.02, 4, 1); assert.equal(actions.up, 1);
    actions.sample(0.4, 1, 0); assert.deepEqual([actions.up, actions.down, actions.button], [0, 0, 0]);
    return { poses, maximumUpperError, maximumLowerError, pauseAndSeekActions: true };
  } finally { dispose(root); }
}

export function verifyCrowdContract() {
  const counts = [0, 1, 2].map((d) => {
    const g = spectatorGeometry(d as 0 | 1 | 2);
    try { finiteGeometry(g); assert(g.boundingBox!.min.y >= -0.300001); return g.getIndex()!.count / 3; }
    finally { g.dispose(); }
  });
  // Procedural spectators: the near level carries two arm poses and a cup
  // (unselected shells collapse per seat) and the sculpted head and hands; it is
  // drawn only inside half the old switch distance. Mid/far keep the old budgets.
  assert(counts[0] <= 6600 && counts[1] <= 1450 && counts[2] <= 638);
  assert(counts[1] < counts[0] * 0.6 && counts[2] < counts[1] * 0.5);
  const matrices = Array.from({ length: 128 }, (_, i) => new T.Matrix4().makeTranslation((i % 8) * 0.98, 0, Math.floor(i / 8) * 0.65));
  const colours = matrices.map(() => new T.Color(0x428675)), material = new T.MeshStandardMaterial();
  const a = new CrowdCluster(matrices, colours, 821, material), b = new CrowdCluster(matrices, colours, 821, material);
  try {
    const phase = a.levels[0].geometry.getAttribute('spectatorPhase');
    assert.equal(new Set(Array.from(phase.array)).size, 128);
    assert.deepEqual(phase.array, b.levels[0].geometry.getAttribute('spectatorPhase').array);
    assert.strictEqual(a.levels[0].instanceMatrix, a.levels[2].instanceMatrix);
    const camera = new T.Vector3(5, 2, 3);
    a.update(12, camera, 24);
    const before = [...a.uniforms.crowdClock.value.toArray(), a.uniforms.crowdMotion.value];
    a.update(12, camera, 24); assert.deepEqual([...a.uniforms.crowdClock.value.toArray(), a.uniforms.crowdMotion.value], before);
    a.update(200, camera, 24); a.update(12, camera, 24);
    assert.deepEqual([...a.uniforms.crowdClock.value.toArray(), a.uniforms.crowdMotion.value], before);
    for (const distance of [0, 50, 120, 260, 230, 100, 80]) {
      a.update(12, new T.Vector3(distance, 2, 3), 24);
      const active = a.levels.filter((mesh) => mesh.visible).length;
      assert(active >= 1 && active <= 2);
      for (const value of phase.array) {
        const rank = Math.min(0.9999999, value / (Math.PI * 2));
        assert.equal(a.lodRanges.filter((range) => rank >= range.x && rank < range.y).length, 1);
      }
    }
    assert.equal(crowdDetail(55, 0), 0); assert.equal(crowdDetail(50, 1), 1);
    assert.equal(crowdDetail(235, 1), 1); assert.equal(crowdDetail(220, 2), 2);
    assert.throws(() => crowdDetail(NaN, 0));
    return { triangles: counts, phaseCount: 128, boundedInstances: matrices.length,
      sharedStorage: true, exclusiveSpectatorLod: true, maximumActiveLevels: 2, pauseAndRewindUniforms: true };
  } finally { dispose(a.root); dispose(b.root); material.dispose(); }
}

export function verifyServiceAndLights() {
  const track = new Track('clear'), sites = serviceSitePlan(track);
  assert.equal(sites.length, 6); assert.deepEqual(sites, serviceSitePlan(track));
  assert(sites.every((site) => site.clearance >= 6 && site.y > site.baseY));
  const trees = vegetationPlan(track, 7109, sites);
  assert(trees.every((tree) => !inServiceFootprint(sites, tree.x, tree.z, 8)));
  const root = new T.Group(); buildServiceAreas(root, sites);
  let triangles = 0, meshes = 0;
  try {
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      finiteGeometry(object.geometry); triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3; meshes++;
    });
    assert(triangles <= 28000); assert(meshes <= 48);
  } finally { dispose(root); }
  const lights = venueLampPlan(track); assert.equal(lights.length, Math.ceil(track.length / 90));
  assert.deepEqual(lights, venueLampPlan(track));
  for (const light of lights) {
    const p = trackPoint(), lateral = track.nearest(light.x, light.z, p);
    const ground = p.y + p.bank * Math.max(-12, Math.min(12, lateral)) + grassApronOffset(track, p.s, lateral);
    assert(Math.abs(light.baseY - ground) < 0.04, `Floating mast ${light.s}`);
    assert(Math.abs(lateral) > track.boundary(p.s, light.side) + 4);
    assert(light.topY - light.baseY > 10 && light.topY - light.baseY < 18);
  }
  return { sites: sites.length, minClearanceMetres: Math.min(...sites.map((s) => s.clearance)),
    triangles, meshes, trees: trees.length, groundedMasts: lights.length };
}

export function verifyBroadcastFraming() {
  const track = new Track('clear'), point = trackPoint(), reports = [];
  for (const aspect of [16 / 9, 4 / 3, 1, 9 / 16]) {
    const director = new TracksideDirector(track), camera = new T.PerspectiveCamera(42, aspect, 0.1, 2000);
    let maximumScreenCoordinate = 0, corners = 0;
    for (let s = 0; s < track.length; s += 2) {
      track.at(s, point);
      const target = new T.Vector3(point.x, point.y + 0.6, point.z);
      director.update(s, target, new T.Vector3(point.tx * 95, 0, point.tz * 95), 2 / 95, aspect);
      assert(director.position.equals(director.rigs[director.activeId].position));
      camera.position.copy(director.position); camera.lookAt(director.gaze);
      camera.fov = director.fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      for (const x of [-1.05, 1.05]) for (const y of [-0.55, 0.6]) for (const z of [-2.7, 2.7]) {
        const p = new T.Vector3(target.x + point.nx * x + point.tx * z, target.y + y, target.z + point.nz * x + point.tz * z).project(camera);
        const extent = Math.max(Math.abs(p.x), Math.abs(p.y));
        assert(extent < 0.96 && p.z > -1 && p.z < 1, `Framing at ${s}m / ${aspect}`);
        maximumScreenCoordinate = Math.max(maximumScreenCoordinate, extent); corners++;
      }
    }
    assert(director.cuts <= 22); reports.push({ aspect, maximumScreenCoordinate, corners, cuts: director.cuts });
    const target = new T.Vector3(point.x, point.y + 0.6, point.z), velocity = new T.Vector3();
    director.update(point.s, target, velocity, 0, aspect);
    const pause = [director.fov, ...director.gaze.toArray(), ...director.position.toArray()];
    director.update(point.s, target, velocity, 0, aspect);
    assert.deepEqual([director.fov, ...director.gaze.toArray(), ...director.position.toArray()], pause);
    director.update(point.s, target, velocity, 0, 9 / 16); assert(director.framingFits);
  }
  assert.throws(() => tracksideFraming(0, 42)); assert.throws(() => tracksideFraming(20, 42, 0));
  return reports;
}

export function verifyCameraOptics() {
  const track = new Track('clear'), root = new T.Group(), safety = new T.MeshStandardMaterial();
  const plan = trackInfrastructurePlan(track); buildTrackInfrastructure(track, root, safety, plan);
  root.updateMatrixWorld(true);
  let rays = 0;
  try {
    for (const rig of tracksideRigs(track)) {
      const geometry = root.getObjectByName(`Replay camera infrastructure ${rig.id}`)!; assert(geometry);
      for (const offset of [-0.45, 0, 0.45]) {
        const p = track.at(rig.centerS + rig.coverageM * offset, trackPoint());
        const target = new T.Vector3(p.x, p.y + 0.6, p.z), direction = target.clone().sub(rig.position);
        const ray = new T.Raycaster(rig.position, direction.clone().normalize(), 0.1, direction.length() - 3);
        assert.equal(ray.intersectObject(geometry, true).length, 0, `Camera ${rig.id} looks through itself`); rays++;
      }
    }
    root.traverse((object) => {
      if (object instanceof T.Mesh && object.material instanceof T.MeshPhysicalMaterial)
        assert.equal(object.material.transmission, 0, 'Camera lenses must not trigger a full scene transmission pass');
    });
    return { cameras: plan.cameras.length, selfOcclusionRays: rays, unnecessaryTransmission: false };
  } finally { dispose(root); safety.dispose(); }
}

export function verifyMechanicalOwnership() {
  const material = new T.MeshStandardMaterial();
  const materials = { carbon: material, dark: material, metal: material, paint: material };
  const root = new T.Group(), carrier = new T.Group(), spin = new T.Group(); root.add(carrier, spin);
  try {
    const detail = addWheelMechanicalDetail(carrier, spin, 1, 0.2, materials);
    assert.strictEqual(detail.upright.parent, carrier); assert.strictEqual(detail.lock.parent, spin);
    root.traverse((o) => { if (o instanceof T.Mesh) finiteGeometry(o.geometry); });
    const loft = sculptedLoft([[-1, 0, 0.1, 0.1], [0, 0, 0.2, 0.1], [0.4, 0, 0.2, 0.1]]);
    try {
      const positions = loft.getAttribute('position').array.slice(), count = loft.index!.count;
      assert.strictEqual(openFrontCap(loft), loft); assert(loft.index!.count < count);
      assert.deepEqual(loft.getAttribute('position').array, positions); finiteGeometry(loft);
    } finally { loft.dispose(); }
    return { rigidCarrierOwnership: true, rotatingLockOwnership: true, openInletPreservesSkin: true };
  } finally { dispose(root); material.dispose(); }
}
