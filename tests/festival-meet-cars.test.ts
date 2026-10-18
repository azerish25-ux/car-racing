import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { MEET_MODELS, MEET_NEAR, MeetCars } from '../src/rendering/open-world/meet-cars.ts';

describe('festival meet cars', () => {
  it('draws meet rows with festival-form bodies: four classes per model and LOD, mid LOD near', () => {
    const spots = MEET_MODELS.flatMap((model, k) =>
      [0, 1, 2].map((r) => ({ x: k * 3, y: 0, z: r * 6, yaw: 0.6, model, paint: 0xc4141a })),
    );
    const meet = new MeetCars(spots);
    expect(meet.stats.cars).toBe(spots.length);
    // Nothing is built at construction; one model per update while in range.
    expect(meet.stats.triangles).toEqual([0, 0]);
    const camera = new T.PerspectiveCamera();
    camera.position.set(0, 2, -400);
    meet.update(camera, true);
    expect(meet.stats.triangles[1]).toBeGreaterThan(0);
    for (let k = 1; k < MEET_MODELS.length; k++) meet.update(camera, true);
    // Budgets per car: mid about 30k triangles, far about 5k (summed models).
    expect(meet.stats.triangles[0] / MEET_MODELS.length).toBeLessThan(40000);
    expect(meet.stats.triangles[1] / MEET_MODELS.length).toBeLessThan(8000);
    // Far away: only far LODs, at most four draws per model, no shadows.
    expect(meet.stats.draws).toBeLessThanOrEqual(MEET_MODELS.length * 4);
    let casting = 0,
      near = 0;
    meet.root.traverse((o) => {
      if (o instanceof T.InstancedMesh && o.visible) {
        if (o.castShadow) casting++;
        if (o.name.includes(' mid ')) near += o.count;
      }
    });
    expect(casting).toBe(0);
    expect(near).toBe(0);
    // At the first car: it (and its close neighbours) switch to the mid LOD.
    camera.position.set(0, 1.5, MEET_NEAR * 0.2);
    meet.update(camera, true);
    meet.root.traverse((o) => {
      if (o instanceof T.InstancedMesh && o.visible && o.name.includes(' mid ')) near += o.count;
    });
    expect(near).toBeGreaterThan(0);
    meet.dispose();
  });
});
