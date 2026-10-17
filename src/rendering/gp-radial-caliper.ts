import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Original, mechanically scaled high-LOD GP radial monobloc.
 *
 * Motorcycle axes: +X to rider's left, +Y up, +Z forward. The caliper stays
 * on the fork lower, not the wheel-spin node; the floating carbon rotor alone
 * spins. The gap at X=0 leaves clearance for the existing 22 mm rotor. The
 * Blender source (tools/motogp/author_gp_radial_caliper.py) is the editable
 * high-resolution look-development counterpart of this low-draw runtime mesh.
 * REF 001/003/018/020/022/028/060/096: cast body, piston bosses, radial
 * mounting bolts, friction pads, hydraulic banjo and flexible hose.
 */
export interface GPRadialMaterials {
  caliper: T.Material;
  aluminium: T.Material;
  steel: T.Material;
  dark: T.Material;
}

export const GP_RADIAL_BRAKE = Object.freeze({
  rotorThickness: 0.022,
  pistonCount: 4,
  bodyHalfWidth: 0.007,
  jawCentre: 0.028,
  maxTriangles: 9000,
  maxDraws: 4,
});

function forgedBody(): T.BufferGeometry {
  // YZ outline. Deliberate concave waists keep this a forged casting rather
  // than a filleted rectangular box; the bevels catch real highlights.
  const profile = new T.Shape();
  profile.moveTo(-0.047, -0.054);
  profile.bezierCurveTo(-0.06, -0.052, -0.066, -0.037, -0.061, -0.02);
  profile.bezierCurveTo(-0.066, 0.009, -0.057, 0.029, -0.038, 0.034);
  profile.bezierCurveTo(-0.022, 0.043, 0.007, 0.044, 0.022, 0.035);
  profile.bezierCurveTo(0.038, 0.031, 0.053, 0.016, 0.049, 0.003);
  profile.lineTo(0.043, -0.041);
  profile.bezierCurveTo(0.042, -0.051, 0.029, -0.058, 0.016, -0.056);
  profile.lineTo(-0.047, -0.054);
  const geometry = new T.ExtrudeGeometry(profile, {
    steps: 1,
    depth: GP_RADIAL_BRAKE.bodyHalfWidth * 2,
    bevelEnabled: true,
    bevelSize: 0.0028,
    bevelThickness: 0.0028,
    // One machined chamfer retains the authored outline and jaw clearance;
    // extra bevel rings on four tiny jaws exceeded the complete GP model gate.
    bevelSegments: 1,
    curveSegments: 5,
  });
  geometry.rotateY(Math.PI / 2);
  geometry.translate(-GP_RADIAL_BRAKE.bodyHalfWidth, 0, 0);
  return geometry;
}

/** Returns at most four material-batched meshes instead of 20+ tiny draws. */
export function gpRadialBrakeCaliper(side: -1 | 1, materials: GPRadialMaterials): T.Group {
  if (side !== -1 && side !== 1) throw new Error('Invalid GP caliper side');
  const bucket: T.BufferGeometry[][] = [[], [], [], []];
  const place = (
    geometry: T.BufferGeometry,
    material: 0 | 1 | 2 | 3,
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
  ) => {
    const transform = new T.Matrix4().compose(
      new T.Vector3(x, y, z),
      new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)),
      new T.Vector3(1, 1, 1),
    );
    geometry.applyMatrix4(transform);
    // Extruded shapes are non-indexed whereas cylinders/boxes are indexed.
    // Normalize before merging or Three.js rejects the mixed batches.
    if (geometry.index) {
      const unindexed = geometry.toNonIndexed();
      geometry.dispose();
      geometry = unindexed;
    }
    bucket[material].push(geometry);
  };
  const cylinder = (radius: number, depth: number, sides = 12) =>
    new T.CylinderGeometry(radius, radius, depth, sides);
  for (const sign of [-1, 1] as const) {
    place(forgedBody(), 0, sign * GP_RADIAL_BRAKE.jawCentre);
    // Four independent, machined piston/annulus stacks. A real central cavity
    // shows black pad backing through the two 7-mm jaw-to-rotor clearances.
    for (const y of [-0.03, 0.021]) {
      place(cylinder(0.018, 0.003), 1, sign * 0.04, y, -0.004, 0, 0, Math.PI / 2);
      place(cylinder(0.012, 0.003), 0, sign * 0.042, y, -0.004, 0, 0, Math.PI / 2);
    }
    for (const y of [-0.042, 0.038]) {
      // Radial titanium bolts and hex heads are modelled in three dimensions.
      place(cylinder(0.007, 0.009, 12), 2, sign * 0.043, y, -0.027, 0, 0, Math.PI / 2);
      place(cylinder(0.0035, 0.0014, 6), 3, sign * 0.049, y, -0.027, 0, 0, Math.PI / 2);
    }
    place(new T.BoxGeometry(0.008, 0.087, 0.018), 3, sign * 0.015, -0.006, 0.015);
  }
  for (const y of [-0.047, 0.042]) place(new T.BoxGeometry(0.054, 0.013, 0.019), 0, 0, y, -0.029);
  // Non-spinning banjo, washer, bleed nipple and steel-braided hydraulic line.
  place(cylinder(0.008, 0.019, 16), 2, 0.044, 0.05, -0.024, 0, 0, Math.PI / 2);
  place(cylinder(0.009, 0.0017, 20), 1, 0.053, 0.05, -0.024, 0, 0, Math.PI / 2);
  place(cylinder(0.0033, 0.015, 12), 2, -0.042, 0.051, 0.014, 0, 0, Math.PI / 2);
  const hose = new T.CatmullRomCurve3([
    new T.Vector3(0.044, 0.051, -0.024),
    new T.Vector3(0.052, 0.082, -0.013),
    new T.Vector3(0.081, 0.12, 0.004),
    new T.Vector3(0.089, 0.155, 0.04),
  ]);
  place(new T.TubeGeometry(hose, 20, 0.0027, 6, false), 3);
  const group = new T.Group();
  group.name = 'GP radial forged four-piston caliper + hydraulic line';
  group.scale.x = side;
  const materialSet = [materials.caliper, materials.aluminium, materials.steel, materials.dark];
  for (let i = 0; i < 4; i++) {
    const merged = mergeGeometries(bucket[i], false);
    for (const geometry of bucket[i]) geometry.dispose();
    if (!merged) throw new Error('Could not assemble GP brake geometry');
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mesh = new T.Mesh(merged, materialSet[i]);
    mesh.name = [
      'Forged two-jaw housing',
      'Machined piston faces',
      'Titanium hydraulic hardware',
      'Pads and braided hose',
    ][i];
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.sourcedFrom = 'Original Blender 5.2 GP monobloc study';
  group.userData.caliperHasRotorClearance = true;
  return group;
}
