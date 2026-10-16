import * as T from 'three';

/** Read-only projection and visibility census. Rays ignore hidden ancestors,
 * not just a child's flag, and admit transmissive windscreens, not opaque hulls. */
export function inspectBikeCockpit(root: T.Object3D, camera: T.PerspectiveCamera) {
  root.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const display = root.getObjectByName('GP instrument display');
  if (!(display instanceof T.Mesh)) throw new Error('Missing production instrument display');
  const centre = display.getWorldPosition(new T.Vector3());
  const normal = new T.Vector3(0, 0, 1).transformDirection(display.matrixWorld);
  const corners = [
    [-0.066, -0.033],
    [0.066, -0.033],
    [-0.066, 0.033],
    [0.066, 0.033],
  ].map(([x, y]) =>
    new T.Vector3(x, y, 0).applyMatrix4(display.matrixWorld).project(camera).toArray(),
  );
  const ray = new T.Raycaster();
  const samples = [];
  // Interior 3x3 grid avoids ray/triangle ambiguity exactly on a shared edge.
  for (const x of [-0.059, 0, 0.059])
    for (const y of [-0.029, 0, 0.029]) {
      const target = new T.Vector3(x, y, 0).applyMatrix4(display.matrixWorld);
      ray.set(camera.position, target.clone().sub(camera.position).normalize());
      ray.far = camera.position.distanceTo(target) + 0.001;
      const hit = ray.intersectObject(root, true).find((hit) => {
        let ancestor: T.Object3D | null = hit.object;
        while (ancestor) {
          if (!ancestor.visible) return false;
          ancestor = ancestor.parent;
        }
        const material = (hit.object as T.Mesh).material;
        if (Array.isArray(material) || !material) return false;
        return !material.transparent && !((material as T.MeshPhysicalMaterial).transmission > 0.5);
      });
      samples.push({
        visible: hit?.object === display,
        blocker: hit
          ? `${hit.object.name} / ${((hit.object as T.Mesh).material as T.Material).name} / ${(hit.object as T.Mesh).geometry.type}`
          : 'none',
      });
    }
  return {
    centre: centre.toArray(),
    facing: normal.dot(camera.position.clone().sub(centre).normalize()),
    corners,
    samples,
    visibleSamples: samples.filter((s) => s.visible).length,
  };
}
