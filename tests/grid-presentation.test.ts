import { expect, it } from 'vitest';
import * as T from 'three';
import {
  GridPresentationClock,
  GRID_PRESENTATION_STAGES,
  gridPresentationStage,
} from '../src/core/grid-presentation.ts';
import {
  gridStep,
  poseGridMechanic,
  gridBlanketPoint,
  gridPresentationCamera,
} from '../src/rendering/grid-mechanic-motion.ts';
import {
  GridPresentationView,
  gridBlanketGeometry,
  installGridBlanket,
} from '../src/rendering/grid-presentation-view.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H, carBase } from '../src/simulation/protocol.ts';

it('keeps preparation on an explicitly controlled clock, bounded through hidden or stalled frames', () => {
  const c = new GridPresentationClock();
  c.advance(1);
  expect(c.time).toBe(0);
  c.play();
  c.advance(0.05);
  expect(c.time).toBe(0.05);
  c.advance(50);
  expect(c.time).toBeCloseTo(0.15);
  c.advance(1, false);
  expect(c.playing).toBe(false);
  expect(c.time).toBeCloseTo(0.15);
  c.seek(13);
  expect(c.playing).toBe(false);
  expect(gridPresentationStage(c.time).title).toBe('Blankets off');
  c.seek(99);
  expect(c.complete).toBe(true);
  c.play();
  expect(c.playing).toBe(false);
  c.seek(-2);
  expect(c.time).toBe(0);
  expect(() => c.advance(NaN)).toThrow();
  expect(() => c.advance(-1)).toThrow();
  expect(() => c.seek(Infinity)).toThrow();
  c.reset();
  expect(c.time).toBe(0);
  expect(c.playing).toBe(false);
  expect(GRID_PRESENTATION_STAGES.map((s) => s.start)).toEqual([0, 4, 7, 12, 17, 36]);
});

it('plants feet in world space between swings, without teleporting at pose boundaries', () => {
  for (const length of [0.9, 2.7])
    for (const foot of [0, 1] as const) {
      let previous = gridStep(0, length, foot);
      for (let d = 0.001; d < length; d += 0.001) {
        const s = gridStep(d, length, foot);
        if (s.planted && previous.planted) expect(s.forward).toBe(previous.forward);
        expect(Math.abs(s.forward - previous.forward)).toBeLessThan(0.008);
        expect(s.lift).toBeGreaterThanOrEqual(0);
        expect(s.lift).toBeLessThanOrEqual(0.085);
        previous = s;
      }
    }
  const hub = new T.Vector3(-0.83, -0.2, 1.82);
  for (const t of [4, 7, 9, 12, 15, 17, 17.75, 18.5, 19.25, 20, 23, 26, 34, 38]) {
    const a = poseGridMechanic(t - 1e-6, 0, hub),
      b = poseGridMechanic(t + 1e-6, 0, hub);
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-4);
    for (let f = 0; f < 2; f++) expect(a.feet[f].distanceTo(b.feet[f])).toBeLessThan(1e-4);
    expect(a.blanket.distanceTo(b.blanket)).toBeLessThan(1e-4);
  }
});

it('uses the real skinned bodies and gloves through the whole sequence without changing the race', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 2 }),
    frame = sim.makeFrame(),
    before = frame.slice();
  const view = new GridPresentationView(),
    camera = new T.Vector3().fromArray(frame, carBase(0));
  const failures: unknown[] = [];
  for (let tick = 0; tick <= 380; tick++) {
    const t = tick / 10;
    view.update(frame, camera, t);
    const d = view.diagnostics();
    expect(d.actors).toBe(12);
    expect(d.blankets).toBe(12);
    expect(d.highDetail).toBe(4);
    for (const c of d.contacts)
      if (!c.arms || !c.feet || c.gripError > 0.001) failures.push({ t, ...c });
  }
  expect(failures.slice(0, 10)).toEqual([]);
  expect(frame).toEqual(before);
  view.update(frame, camera, 38);
  expect(view.diagnostics().actors).toBe(12);
  expect(view.diagnostics().phase).toBe('clear');
  view.park(frame);
  view.update(frame, camera, null);
  expect(view.diagnostics().parked).toBe(true);
  // Race started: every crew member, umbrella holder and engineer has left
  // the circuit; nothing of the pre-race cast is drawn on the grid.
  expect(view.diagnostics().actors).toBe(0);
  expect(view.diagnostics().cast.actors).toBe(0);
  const drawn: number[] = [];
  view.root.traverse((o) => {
    if (o instanceof T.InstancedMesh) drawn.push(o.count);
  });
  expect(drawn.every((n) => n === 0)).toBe(true);
  view.reset();
  view.update(frame, camera, 12);
  const d = view.diagnostics();
  view.update(frame, camera, 4);
  view.update(frame, camera, 12);
  expect(view.diagnostics()).toEqual(d);
  view.update(frame, camera, null);
  expect(view.diagnostics().actors).toBe(0);
  frame[H.TIME] = 0.1;
  view.update(frame, camera, 12);
  expect(view.diagnostics().actors).toBe(0);
  view.dispose();
});

it('uses identical wrap/gather vertices in colour and both shadow programs', () => {
  const g = gridBlanketGeometry(),
    p = new T.Vector3();
  expect(g.index!.count / 3).toBe(1088);
  for (let i = 0; i < 9 * 33; i++) {
    const uv = g.getAttribute('uv');
    gridBlanketPoint(uv.getX(i) - 0.5, -Math.PI + uv.getY(i) * 2 * Math.PI, 1, p);
    expect(
      p.distanceTo(new T.Vector3().fromBufferAttribute(g.getAttribute('gridFolded'), i)),
    ).toBeLessThan(1e-6);
  }
  for (const material of [
    new T.MeshStandardMaterial(),
    new T.MeshDepthMaterial(),
    new T.MeshDistanceMaterial(),
  ]) {
    installGridBlanket(material, material instanceof T.MeshStandardMaterial);
    const shader = {
      vertexShader: '#include <begin_vertex>\n#include <beginnormal_vertex>\n#include <uv_vertex>',
      fragmentShader: '#include <color_fragment>',
      uniforms: {},
    };
    material.onBeforeCompile(shader as T.WebGLProgramParametersWithUniforms, {} as T.WebGLRenderer);
    expect(shader.vertexShader).toContain('mix(position, gridFolded, gridFold)');
    expect(shader.vertexShader).toContain('mix(objectNormal, gridFoldedNormal, gridFold)');
  }
  const eye = new T.Vector3(),
    target = new T.Vector3();
  gridPresentationCamera(4, true, eye, target);
  const before = eye.clone();
  gridPresentationCamera(18, true, eye, target);
  expect(eye).toEqual(before);
  g.dispose();
});

it('retains bounded authored hero topology, UVs and normalized four-influence skin weights', async () => {
  const { gridMechanicGeometry, GRID_MECHANIC_ASSET } = await import(
    '../src/rendering/grid-mechanic-asset.ts'
  );
  const g = gridMechanicGeometry();
  // The near kit is now the procedural human body (same skeleton and skin).
  const { default: humanKit } = await import('../src/rendering/human-kit.json', {
    with: { type: 'json' },
  });
  expect(g.index!.count / 3).toBe(humanKit.meshes.body_suit_0.triangles);
  expect(g.index!.count / 3).toBeLessThan(14000);
  expect(GRID_MECHANIC_ASSET.finalArtApproved).toBe(false);
  expect(g.getAttribute('uv').count).toBe(g.getAttribute('position').count);
  const joint = g.getAttribute('crewJoint'),
    weight = g.getAttribute('crewWeight'),
    normal = g.getAttribute('normal');
  for (let i = 0; i < joint.count; i++) {
    expect(weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i)).toBeCloseTo(1, 5);
    expect(joint.getX(i)).toBeLessThan(15);
    expect(joint.getY(i)).toBeLessThan(15);
    // Normals are stored as normalised 8-bit components.
    expect(Math.abs(new T.Vector3().fromBufferAttribute(normal, i).length() - 1)).toBeLessThan(
      0.012,
    );
  }
  g.dispose();
});

it('retains a fixed supporting foot while kneeling and rising, and throughout each walking stance', () => {
  const hub = new T.Vector3(-0.83, -0.2, 1.82);
  const up = new T.Vector3(0, 1, 0);
  let previous = poseGridMechanic(0, 0, hub);
  const worldFoot = (motion: ReturnType<typeof poseGridMechanic>, foot: 0 | 1) =>
    motion.feet[foot].clone().applyAxisAngle(up, motion.yaw).add(motion.position);
  for (let i = 1; i <= 3800; i++) {
    const m = poseGridMechanic(i / 100, 0, hub);
    expect(m.planted.some(Boolean), `no support at ${m.time}`).toBe(true);
    for (const foot of [0, 1] as const) {
      if (m.planted[foot]) expect(m.feet[foot].y).toBeCloseTo(0.055, 6);
      if (m.planted[foot] && previous.planted[foot])
        expect(worldFoot(m, foot).distanceTo(worldFoot(previous, foot))).toBeLessThan(1e-6);
    }
    previous = m;
  }
});
