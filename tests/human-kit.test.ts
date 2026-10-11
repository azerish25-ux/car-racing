import { describe, expect, it } from 'vitest';
import * as T from 'three';
import kit from '../src/rendering/human-kit.json' with { type: 'json' };
import {
  crewBodyGeometry,
  crewHandGeometry,
  humanHeadGeometry,
  humanKitGeometry,
  humanSkinToneRGB,
  spectatorKitGeometry,
  type HumanKitMesh,
} from '../src/rendering/human-kit.ts';
import { CREW_REST } from '../src/rendering/people-asset.ts';
import { GRID_SHOTS, gridBroadcastShot } from '../src/rendering/grid-broadcast.ts';
import { GRID_PRESENTATION_SECONDS } from '../src/core/grid-presentation.ts';
import { GridCastView } from '../src/rendering/grid-cast.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, carBase } from '../src/simulation/protocol.ts';

describe('procedural human kit', () => {
  it('decodes every baked mesh into owned, valid, closed-index geometry', () => {
    for (const name of Object.keys(kit.meshes) as HumanKitMesh[]) {
      const a = humanKitGeometry(name),
        b = humanKitGeometry(name);
      const n = a.getAttribute('position').count;
      expect(a.getAttribute('position').array).not.toBe(b.getAttribute('position').array);
      expect(a.index!.count / 3).toBe(kit.meshes[name].triangles);
      expect(Array.from(a.index!.array).every((i) => i < n)).toBe(true);
      const normal = a.getAttribute('normal');
      for (let i = 0; i < n; i += 7) {
        const l = new T.Vector3().fromBufferAttribute(normal, i).length();
        expect(Math.abs(l - 1)).toBeLessThan(0.012);
      }
      expect(a.boundingBox!.isEmpty()).toBe(false);
      a.dispose();
      b.dispose();
    }
  });
  it('skins bodies to the shared skeleton with four normalised influences', () => {
    for (const style of ['polo', 'polof', 'suit'] as const)
      for (const lod of [0, 1, 2] as const) {
        const g = crewBodyGeometry(style, lod);
        const joints = g.getAttribute('crewJoint'),
          weights = g.getAttribute('crewWeight');
        let multi = 0;
        for (let i = 0; i < joints.count; i++) {
          let sum = 0;
          for (let k = 0; k < 4; k++) {
            expect(joints.getComponent(i, k)).toBeLessThan(15);
            sum += weights.getComponent(i, k);
          }
          expect(sum).toBeCloseTo(1, 2);
          if (weights.getY(i) > 0.05) multi++;
        }
        // Smooth joint blending, not rigid segments.
        expect(multi / joints.count).toBeGreaterThan(0.15);
        // Feet on the floor, head joint above the collar, arms at the rest joints.
        expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(0);
        expect(g.boundingBox!.min.y).toBeLessThan(0.01);
        expect(g.boundingBox!.max.y).toBeLessThan(CREW_REST[2].y + 0.02); // neck ends inside the head
        expect(g.boundingBox!.max.x).toBeLessThan(CREW_REST[6].x + 0.08);
        g.dispose();
      }
  });
  it('keeps LOD budgets falling and heads, hands and spectators within their budgets', () => {
    const tris = (name: string) => kit.meshes[name as HumanKitMesh].triangles;
    for (const style of ['polo', 'suit']) {
      expect(tris(`body_${style}_0`)).toBeLessThanOrEqual(9000);
      expect(tris(`body_${style}_1`)).toBeLessThan(tris(`body_${style}_0`) * 0.4);
      expect(tris(`body_${style}_2`)).toBeLessThan(tris(`body_${style}_1`) * 0.4);
    }
    for (const wear of ['bare', 'cap', 'headset', 'cap-headset', 'fem-bare', 'fem-headset']) {
      expect(tris(`head_${wear}_0`)).toBeLessThanOrEqual(5200);
      expect(tris(`head_${wear}_2`)).toBeLessThan(600);
    }
    for (const v of ['a', 'b']) {
      const g = spectatorKitGeometry(v as 'a' | 'b', 0);
      const tags = g.getAttribute('crowdPerson');
      const joints = new Set<number>(),
        skins = new Set<number>(),
        accessories = new Set<number>();
      for (let i = 0; i < tags.count; i++) {
        joints.add(tags.getX(i));
        skins.add(tags.getY(i));
        accessories.add(tags.getZ(i));
      }
      expect([...joints].sort()).toEqual([0, 1, 2, 3]);
      expect([...skins].sort()).toEqual([0, 1, 2]);
      // Body, cap, phone, resting arms, folded arms and a cup (code 5 retired).
      expect([...accessories].sort()).toEqual([0, 1, 2, 3, 4, 6]);
      // Standing correspondence rises in front of the seat.
      const standing = g.getAttribute('standingPosition');
      let top = -Infinity;
      for (let i = 0; i < standing.count; i++) top = Math.max(top, standing.getY(i));
      expect(top).toBeGreaterThan(1.2);
      g.dispose();
    }
  });
  it('mirrors the gloved hand with reversed winding and matches GPU skin tones', () => {
    const right = crewHandGeometry(0),
      left = crewHandGeometry(0, true);
    for (let i = 0; i < right.getAttribute('position').count; i++)
      expect(left.getAttribute('position').getX(i)).toBe(-right.getAttribute('position').getX(i));
    expect(left.index!.getX(1)).toBe(right.index!.getX(2));
    const a = humanSkinToneRGB(3),
      b = humanSkinToneRGB(3);
    expect(a.equals(b)).toBe(true);
    expect(humanSkinToneRGB(4).equals(a)).toBe(false);
    const head = humanHeadGeometry('cap-headset', 1);
    expect(head.boundingBox!.max.x).toBeGreaterThan(0.1);
    head.dispose();
  });
});

describe('pre-race broadcast direction', () => {
  it('cuts between distinct shots in order and repeats every frame exactly', () => {
    const seen: number[] = [];
    for (let t = 0; t <= GRID_PRESENTATION_SECONDS; t += 0.25) {
      const a = gridBroadcastShot(t, false),
        b = gridBroadcastShot(t, false);
      expect(a.eye.toArray()).toEqual(b.eye.toArray());
      expect(a.fov).toBeGreaterThan(5);
      expect(a.fov).toBeLessThan(50);
      // Never below the grid surface (car origin is ~0.52 m up).
      expect(a.eye.y).toBeGreaterThan(-0.4);
      expect(a.caption.length).toBeGreaterThan(4);
      if (seen.at(-1) !== a.index) seen.push(a.index);
    }
    expect(seen).toEqual(GRID_SHOTS.map((_, i) => i));
    const held = gridBroadcastShot(12, true);
    expect(gridBroadcastShot(30, true).eye.toArray()).toEqual(held.eye.toArray());
    expect(() => gridBroadcastShot(NaN, false)).toThrow();
  });
});

describe('grid cast', () => {
  it('stands an umbrella holder and an engineer at each nearby car, then clears the grid', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 5 });
    const frame = sim.makeFrame();
    const camera = new T.Vector3().fromArray(frame, carBase(0) + F.X);
    const cast = new GridCastView();
    cast.update(frame, camera, 5);
    expect(cast.diagnostics()).toEqual({ actors: 12, umbrellas: 6, tablets: 6 });
    cast.update(frame, camera, 26);
    const leaving = cast.diagnostics().actors;
    expect(leaving).toBeGreaterThan(0);
    cast.update(frame, camera, GRID_PRESENTATION_SECONDS);
    expect(cast.diagnostics().actors).toBe(0);
    cast.update(frame, camera, null);
    expect(cast.diagnostics().actors).toBe(0);
    cast.dispose();
  });
});
