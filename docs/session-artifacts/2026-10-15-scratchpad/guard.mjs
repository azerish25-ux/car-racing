import * as T from '/home/user/Experiment-3/node_modules/three/build/three.module.js';
const RAKE = 0.42;
const mount = new T.Group();
mount.rotation.x = -RAKE;
const steer = new T.Group();
mount.add(steer);
const lower = new T.Group();
steer.add(lower);
const g = new T.CylinderGeometry(0.33, 0.33, 0.13, 8, 1, true, 0.87, 1.75);
const guard = new T.Mesh(g);
lower.add(guard);
guard.rotation.set(RAKE, 0, Math.PI / 2);
mount.updateMatrixWorld(true);
const p = g.getAttribute('position');
const v = new T.Vector3();
for (let i = 0; i < p.count; i += 2) {
  v.fromBufferAttribute(p, i).applyMatrix4(guard.matrixWorld);
  console.log(v.toArray().map((x) => x.toFixed(2)).join(' '));
}
