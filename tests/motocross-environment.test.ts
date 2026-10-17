import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { BuildQueue } from '../src/rendering/build-queue.ts';
import { OffroadScene } from '../src/rendering/offroad/index.ts';
import { MxCourseDressing } from '../src/rendering/offroad/mx-course-dressing.ts';
import { MX_SOIL_COLOURS, MX_SOIL_DETAIL_HOOK } from '../src/rendering/offroad/mx-soil-detail.ts';
import { sampleMxSoilTransition } from '../src/rendering/offroad/mx-soil-transition.ts';
import { Roost, ROOST_CAPACITY } from '../src/rendering/offroad/roost.ts';
import { Stadium } from '../src/rendering/offroad/stadium.ts';
import { StartGate } from '../src/rendering/offroad/start-gate.ts';
import { TerrainView, SOIL_COLOURS } from '../src/rendering/offroad/terrain-view.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { SOIL_KINDS } from '../src/simulation/offroad/course.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';

function shader(material: T.Material, kind: 'physical' | 'points') {
  const source = T.ShaderLib[kind];
  const result = {
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
    uniforms: T.UniformsUtils.clone(source.uniforms),
  } as StudioShader;
  material.onBeforeCompile(result, {} as T.WebGLRenderer);
  return result;
}

function frameAt(s = 100) {
  const track = rigTrack('valley-ridge-mx'),
    surface = Track.offroadOf(track) as TrackTerrainSurface;
  const p = track.at(s, trackPoint()),
    q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(p.tx, p.tz));
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.CARS] = 1;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
  frame[o + F.X] = p.x;
  frame[o + F.Y] = surface.terrain.baseHeight(s, 0) + 0.55;
  frame[o + F.Z] = p.z;
  frame.set(q.toArray(), o + F.QX);
  frame[o + F.SPEED] = 15;
  frame[o + F.VX] = p.tx * 15;
  frame[o + F.VZ] = p.tz * 15;
  frame[o + F.S] = s;
  for (let i = 0; i < 4; i++) {
    const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
    frame[w + W.LOAD] = 600;
    frame[w + W.SLIP] = 0.24;
    frame[w + W.SURFACE] = MATERIAL.DIRT;
  }
  return frame;
}

function finiteGeometry(root: T.Object3D) {
  let draws = 0;
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    draws++;
    const pos = object.geometry.getAttribute('position');
    expect([...pos.array].every(Number.isFinite), object.name).toBe(true);
    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
    expect(Number.isFinite(object.geometry.boundingSphere!.radius), object.name).toBe(true);
  });
  return draws;
}

describe('reference-informed MX environments', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    'keeps %s race lines clear while batching surveyed course furniture',
    (id) => {
      const track = rigTrack(id),
        course = (Track.offroadOf(track) as TrackTerrainSurface).course;
      const dressing = new MxCourseDressing(track);
      expect(dressing.stats.stakes).toBeGreaterThan(60);
      expect(dressing.stats.jumpMarkers).toBeGreaterThan(8);
      expect(finiteGeometry(dressing.root)).toBeLessThan(14);
      const m = new T.Matrix4(),
        point = trackPoint(),
        p = new T.Vector3();
      const stakes = dressing.root.getObjectByName('MX course-edge stakes') as T.InstancedMesh;
      for (let i = 0; i < stakes.count; i++) {
        stakes.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        const lateral = track.nearest(p.x, p.z, point);
        const legal = course.legalWidth(point.width, point.s, lateral);
        expect(Math.abs(lateral), `stake ${i} at ${point.s.toFixed(1)} m`).toBeGreaterThan(
          legal - 0.06,
        );
      }
      if (id === 'valley-ridge-mx') {
        expect(dressing.stats.banners).toBeGreaterThan(12);
        expect(dressing.stats.grassClumps).toBeGreaterThan(1000);
        expect(dressing.stats.stones).toBeGreaterThan(30);
        expect(dressing.stats.canopies).toBeGreaterThan(0);
      } else {
        expect(dressing.stats.blocks).toBeGreaterThan(25);
        expect(dressing.stats.grassClumps).toBe(0);
      }
      dressing.dispose();
      expect(dressing.root.children).toHaveLength(0);
    },
  );

  it('keeps render heights exact while adding MX-only grading and a single color decode', () => {
    const track = rigTrack('valley-ridge-mx'),
      t = (Track.offroadOf(track) as TrackTerrainSurface).terrain;
    const view = new TerrainView(track);
    const mesh = view.group.children[0] as T.Mesh,
      g = mesh.geometry;
    const coordinates = g.getAttribute('mxCourse'),
      position = g.getAttribute('position'),
      color = g.getAttribute('color');
    let soilSamples = 0;
    for (let i = 0; i < position.count; i += 17) {
      const lateral = coordinates.getX(i),
        s = coordinates.getY(i);
      expect(position.getY(i)).toBeCloseTo(t.baseHeight(s, lateral), 4);
      const sample = sampleMxSoilTransition(t, lateral, s);
      const expected = SOIL_KINDS.reduce(
        (sum, kind, index) => sum + new T.Color(MX_SOIL_COLOURS[kind]).r * sample.weights[index],
        0,
      );
      expect(color.getX(i)).toBeCloseTo(expected, 5);
      if (coordinates.getZ(i) > 0.5) soilSamples++;
    }
    expect(soilSamples).toBeGreaterThan(10);
    expect(studioHookKeys(view.material)).toContain(MX_SOIL_DETAIL_HOOK);
    expect(view.soilSlots[0]).toBe('meadow');
    expect(view.soilMacro).toBe('forest');
    const compiled = shader(view.material, 'physical');
    expect(compiled.fragmentShader).toContain('vec3 apexMacro = apexScanMacro( apexScanForestC,');
    expect(compiled.fragmentShader).toContain('mxPreparedRelief');
    expect(compiled.fragmentShader).toContain('apexSoilWetness');
    expect(compiled.vertexShader).not.toContain('transformed.y += mx');
    view.dispose();
    const rx = new TerrainView(rigTrack('kestrel-rx'));
    expect(rx.soilMacro).toBe(rx.soilSlots[0]);
    expect((rx.group.children[0] as T.Mesh).geometry.hasAttribute('mxCourse')).toBe(false);
    expect(studioHookKeys(rx.material)).not.toContain(MX_SOIL_DETAIL_HOOK);
    const rxMesh = rx.group.children[0] as T.Mesh,
      rxT = (Track.offroadOf(rx.track) as TrackTerrainSurface).terrain;
    const rxKind = rxT.soilKind(rxT.cellIndex(rxT.lateralMin, 0));
    const legacy = new T.Color(SOIL_COLOURS[rxKind]).convertSRGBToLinear();
    expect(rxMesh.geometry.getAttribute('color').getX(0)).toBeCloseTo(legacy.r, 6);
    rx.dispose();
  });

  it('uses prepared earth rather than the synthetic turf slot for the actual SX course macro', () => {
    const view = new TerrainView(rigTrack('arena-nord-sx'));
    expect(view.soilSlots).toEqual(['meadow', 'dryEarth', 'forest']);
    expect(view.soilMacro).toBe('dryEarth');
    const compiled = shader(view.material, 'physical');
    expect(compiled.fragmentShader).toContain('vec3 apexMacro = apexScanMacro( apexScanDryEarthC,');
    expect(compiled.fragmentShader).toContain(
      'vec3 apexMacroFar = apexScanMacro( apexScanDryEarthC,',
    );
    view.dispose();
  });

  it('builds a stadium with real truss members and under 16 material batches', () => {
    const arena = new Stadium(rigTrack('arena-nord-sx'));
    expect(finiteGeometry(arena.root)).toBeLessThan(16);
    expect(arena.crowd.count).toBeGreaterThan(1000);
    expect(arena.root.getObjectByName('Merged open-web roof trusses and columns')).toBeTruthy();
    expect(arena.root.getObjectByName('Merged arena round floodlight lenses')).toBeTruthy();
    expect(arena.root.getObjectByName('Arena concourse ribbon boards')).toBeTruthy();
    const lights: T.Light[] = [];
    arena.root.traverse((o) => {
      if (o instanceof T.Light) lights.push(o);
    });
    expect(lights).toHaveLength(0);
    arena.dispose();
    expect(arena.root.children).toHaveLength(0);
  });

  it('opens the welded gate on the same snapshot release without filling its aperture', () => {
    const track = rigTrack('valley-ridge-mx'),
      course = (Track.offroadOf(track) as TrackTerrainSurface).course;
    const gate = new StartGate(track, course),
      frame = frameAt();
    const hinge = gate.root.children[0].children.find((o) => o instanceof T.Group) as T.Group;
    const panel = hinge.children[0] as T.Mesh;
    expect(panel.geometry.index!.count).toBeGreaterThan(200);
    const ray = new T.Raycaster(new T.Vector3(0.065, 0.35, -1), new T.Vector3(0, 0, 1));
    panel.material = new T.MeshBasicMaterial({ side: T.DoubleSide });
    panel.updateMatrixWorld(true);
    // The child panel in local space has a visible hole between welded bars.
    const local = new T.Mesh(panel.geometry, panel.material);
    local.updateMatrixWorld(true);
    expect(ray.intersectObject(local)).toHaveLength(0);
    frame[H.PHASE] = PHASE.RACING;
    frame[H.RACE_TIME] = 2;
    gate.update(frame);
    expect(hinge.rotation.x).toBeCloseTo(Math.PI / 2, 6);
    (panel.material as T.Material).dispose();
    gate.dispose();
  });
});

describe('MX contact, dust and landing presentation', () => {
  it('clears particles and airborne edge history on a short reverse seek', () => {
    // Keep construction pending: this exercises the production snapshot
    // path and particle history without building unrelated course meshes.
    const world = new OffroadScene(rigTrack('valley-ridge-mx'), new BuildQueue());
    const frame = frameAt(),
      o = carBase(0);
    frame[H.TIME] = 10;
    world.update(frame);
    frame[H.TIME] = 10.1;
    world.update(frame);
    expect(world.roost.active).toBeGreaterThan(0);
    frame[H.TIME] = 10.15;
    frame[o + OFFROAD_BASE + O.AIRBORNE] = 1;
    world.update(frame);
    frame[H.TIME] = 10.14;
    frame[o + F.SPEED] = 0;
    frame[o + OFFROAD_BASE + O.AIRBORNE] = 0;
    frame[o + OFFROAD_BASE + O.LANDING_SPEED] = 8;
    world.update(frame);
    expect(world.roost.active).toBe(0);
    frame[H.TIME] = 10.15;
    world.update(frame);
    expect(world.roost.active).toBe(0); // No invented landing after the seek.
    world.dispose();
  });
  it('uses bounded mixed particle sizes, pauses airborne emission, and clears on rewind', () => {
    const roost = new Roost(rigTrack('valley-ridge-mx')),
      frame = frameAt();
    for (let i = 0; i < 8; i++) roost.update(frame, 1 / 60);
    expect(roost.active).toBeGreaterThan(15);
    expect(roost.active).toBeLessThanOrEqual(ROOST_CAPACITY);
    const sizes = roost.points.geometry.getAttribute('mxParticleSize'),
      alpha = roost.points.geometry.getAttribute('mxParticleAlpha');
    const visible = Array.from({ length: sizes.count }, (_, i) => ({
      size: sizes.getX(i),
      alpha: alpha.getX(i),
    })).filter((p) => p.alpha > 0);
    expect(visible.some((p) => p.size < 0.11)).toBe(true);
    expect(visible.some((p) => p.size > 0.28)).toBe(true);
    expect(roost.contactShadows!.count).toBe(2);
    const active = roost.active;
    frame[carBase(0) + OFFROAD_BASE + O.AIRBORNE] = 1;
    roost.update(frame, 1 / 60); // Deliberately keep stale positive loads.
    expect(roost.active).toBeLessThanOrEqual(active);
    expect(roost.contactShadows!.count).toBe(0);
    const compiled = shader(roost.points.material as T.Material, 'points');
    expect(compiled.vertexShader).toContain('gl_PointSize *= mxParticleSize;');
    expect(compiled.fragmentShader).toContain('diffuseColor.a *= vMxParticleAlpha;');
    roost.clear();
    expect(roost.active).toBe(0);
    expect([...alpha.array].every((a) => a === 0)).toBe(true);
    roost.dispose();
  });

  it('emits one impact burst on landing and wet soil suppresses broad dust', () => {
    const track = rigTrack('valley-ridge-mx');
    const dry = new Roost(track),
      wet = new Roost(track),
      frame = frameAt(),
      o = carBase(0);
    frame[o + F.SPEED] = 0;
    frame[o + OFFROAD_BASE + O.AIRBORNE] = 1;
    dry.update(frame, 1 / 60);
    wet.update(frame, 1 / 60);
    frame[o + OFFROAD_BASE + O.AIRBORNE] = 0;
    frame[o + OFFROAD_BASE + O.LANDING_SPEED] = 7;
    dry.update(frame, 1 / 60);
    frame[o + OFFROAD_BASE + O.MOISTURE] = 0.7;
    wet.update(frame, 1 / 60);
    expect(dry.active).toBe(29);
    expect(wet.active).toBe(29);
    const broad = (r: Roost) =>
      [...r.points.geometry.getAttribute('mxParticleSize').array].filter((v) => v > 0.2).length;
    expect(broad(dry)).toBeGreaterThan(12);
    expect(broad(wet)).toBe(0);
    const before = dry.active;
    dry.update(frame, 1 / 60);
    expect(dry.active).toBeLessThanOrEqual(before);
    dry.dispose();
    wet.dispose();
    const legacy = new Roost(rigTrack('kestrel-rx'));
    expect(legacy.contactShadows).toBeNull();
    expect(studioHookKeys(legacy.points.material as T.Material)).not.toContain(
      'mx-roost-particle-v1',
    );
    legacy.dispose();
  });
});
