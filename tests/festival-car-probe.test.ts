import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { CAR_PROBE, FestivalCarProbe } from '../src/rendering/open-world/festival-car-probe.ts';

/** A renderer stand-in recording the cube faces drawn. */
function fakeRenderer() {
  const faces: number[] = [];
  let target: T.WebGLRenderTarget | null = null;
  const renderer = {
    coordinateSystem: T.WebGLCoordinateSystem,
    shadowMap: { autoUpdate: true },
    xr: { enabled: false },
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: (t: T.WebGLRenderTarget | null, face = 0) => {
      target = t;
      if (t) faces.push(face);
    },
    render: () => {},
  };
  return { renderer: renderer as unknown as T.WebGLRenderer, faces };
}

describe('festival Medium car probe', () => {
  it('captures one face per frame and publishes a complete cube to the paint', () => {
    const { renderer, faces } = fakeRenderer();
    const probe = new FestivalCarProbe(),
      scene = new T.Scene(),
      car = new T.Object3D(),
      cars = new T.Group(),
      paint = new T.MeshPhysicalMaterial({ clearcoat: 1 });
    scene.add(cars, car);
    const sky = { value: 1 };
    for (let k = 0; k < 5; k++)
      probe.update(renderer, scene, car, [paint], true, 1 + k * 0.016, [cars], sky);
    // Five faces in: nothing published yet; the subject and exclusions are shown again.
    expect(paint.envMap).toBeNull();
    expect(car.visible && cars.visible).toBe(true);
    probe.update(renderer, scene, car, [paint], true, 1.1, [cars], sky);
    expect(faces).toEqual([0, 1, 2, 3, 4, 5]);
    expect(paint.envMap).toBeInstanceOf(T.Texture);
    expect(paint.envMapIntensity).toBe(1);
    expect(probe.updates).toBe(1);
    // No new refresh until the interval has passed; a paused frame draws nothing.
    probe.update(renderer, scene, car, [paint], true, 1.1, [cars], sky);
    probe.update(renderer, scene, car, [paint], true, 1.2, [cars], sky);
    expect(faces.length).toBe(6);
    probe.update(renderer, scene, car, [paint], true, 1 + CAR_PROBE.interval + 0.01, [cars], sky);
    expect(faces.length).toBe(7);
    // High tier (or Low): the paint returns to the sky environment.
    probe.update(renderer, scene, car, [paint], false, 3, [cars], sky);
    expect(paint.envMap).toBeNull();
    expect(sky.value).toBe(1);
    probe.dispose();
  });
});
