import * as T from 'three';
import type { DirtBikeModel } from '../../src/rendering/offroad/dirt-bike-model.ts';

function visible(object: T.Object3D) {
  for (let parent: T.Object3D | null = object; parent; parent = parent.parent)
    if (!parent.visible) return false;
  return true;
}

/** Read-only geometry contract for the real clean MX bars. Sights follow the
 * authored pad and grips; their rays must hit actual geometry beside the sight,
 * not an intervening number board, shoulder, helmet or empty placeholder. */
export function inspectMotocrossCockpit(model: DirtBikeModel, camera: T.PerspectiveCamera) {
  model.root.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const head = model.rider.root.getObjectByName('Rider head and helmet'),
    torso = model.rider.root.getObjectByName('Rider torso');
  if (!head || !torso) throw new Error('Missing production motocross rider visibility groups');
  const ray = new T.Raycaster();
  const firstOpaque = () =>
    ray.intersectObject(model.root, true).find((hit) => {
      if (!visible(hit.object)) return false;
      const material = (hit.object as T.Mesh).material;
      return (
        !!material &&
        !Array.isArray(material) &&
        !material.transparent &&
        !((material as T.MeshPhysicalMaterial).transmission > 0.5)
      );
    });
  const controls = model.onboardControls.children.map((sight) => {
    const target = sight.getWorldPosition(new T.Vector3()),
      distance = camera.position.distanceTo(target);
    ray.set(camera.position, target.clone().sub(camera.position).normalize());
    ray.near = camera.near;
    ray.far = distance + 0.08;
    const hit = firstOpaque();
    return {
      name: sight.name,
      ndc: target.clone().project(camera).toArray(),
      visible: !!hit && Math.abs(hit.distance - distance) < 0.08,
      distance,
      hitDistance: hit?.distance ?? null,
      blocker: hit
        ? `${hit.object.name} / ${((hit.object as T.Mesh).material as T.Material).name}`
        : 'none',
    };
  });
  const forward = [];
  // Constant angular driving corridor across aspect ratios. The peripheral
  // forearms are intentionally visible beside the bars, outside this corridor.
  for (const lateral of [-0.45, -0.225, 0, 0.225, 0.45])
    for (const y of [0, 0.3, 0.6]) {
      const x = (lateral * (4 / 3)) / camera.aspect;
      ray.setFromCamera(new T.Vector2(x, y), camera);
      ray.near = camera.near;
      ray.far = 4;
      const hit = firstOpaque();
      forward.push({
        x,
        y,
        clear: !hit,
        blocker: hit
          ? `${hit.object.name} / ${((hit.object as T.Mesh).material as T.Material).name}`
          : 'none',
      });
    }
  return {
    eye: camera.position.toArray(),
    fov: camera.fov,
    headVisible: visible(head),
    torsoVisible: visible(torso),
    handsVisible: ['left', 'right'].map((side) => {
      const hand = model.rider.root.getObjectByName(`Motocross ${side} hand`);
      return !!hand && visible(hand);
    }),
    sleeveEntries: ['left', 'right'].map((side) => {
      const shoulder = model.rider.root.getObjectByName(`Motocross ${side} upper arm`);
      if (!shoulder) throw new Error(`Missing ${side} production motocross upper arm`);
      return shoulder.getWorldPosition(new T.Vector3()).project(camera).toArray();
    }),
    controls,
    visibleControls: controls.filter((c) => c.visible).length,
    forward,
    clearForwardSamples: forward.filter((sample) => sample.clear).length,
  };
}
