import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Original GP-R1 close-range drive chain, rather than the former two straight
 * boxes. Every chain link shares one roller and two side-plate instanced draws;
 * the rear sprocket is one toothed metal shell that spins with the wheel.
 *
 * The 42-tooth pitch phase is taken exclusively from the replay's rear wheel
 * angle. Advancing it by 2π permutes identical links, so modulo-wrapped wheel
 * snapshots cannot introduce a visible discontinuity. No simulation state,
 * unbounded object creation or wall-clock timing is involved.
 *
 * Form and scale: the supplied REF 018 and REF 087 motorcycle close-ups.
 * Neither licensed meshes nor source images are included.
 */
const TAU = Math.PI * 2;
const REAR_TEETH = 42;
const CHAIN_PITCH = 0.015875;
const SAMPLES = 512;
const X = 0.115;

function sprocketGeometry() {
  const shape = new T.Shape();
  for (let i = 0; i <= REAR_TEETH * 8; i++) {
    const angle = (TAU * i) / (REAR_TEETH * 8);
    const radius = 0.102 + 0.0042 * Math.cos(REAR_TEETH * angle);
    const a = radius * Math.cos(angle);
    const b = radius * Math.sin(angle);
    if (i === 0) shape.moveTo(a, b);
    else shape.lineTo(a, b);
  }
  const hole = new T.Path();
  hole.absarc(0, 0, 0.069, 0, TAU, true);
  shape.holes.push(hole);
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: 0.007,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 12,
  });
  // Shape local XY -> motorcycle YZ with thickness along the axle (X).
  geometry.rotateY(Math.PI / 2);
  geometry.computeBoundingSphere();
  return geometry;
}

export class GPChainDrive {
  readonly root = new T.Group();
  readonly sprocket: T.Mesh;
  readonly rollers: T.InstancedMesh;
  readonly plates: T.InstancedMesh;
  readonly links: number;
  private readonly samples: T.Vector3[];
  private readonly qRoller = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(0, 0, 1),
    -Math.PI / 2,
  );
  private readonly qLink = new T.Quaternion();
  private readonly axis = new T.Vector3(1, 0, 0);
  private readonly p = new T.Vector3();
  private readonly tangent = new T.Vector3();
  private readonly matrix = new T.Matrix4();
  private readonly one = new T.Vector3(1, 1, 1);
  private lastWheelPhase = Number.NaN;

  constructor(arm: number, steel: T.Material, chainSide: T.Material, aluminium: T.Material) {
    if (!Number.isFinite(arm) || arm < 0.3 || arm > 1.1)
      throw new Error('Invalid GP motorcycle swingarm length');
    // Continuous route around dissimilar sprocket radii. The small tangency
    // angle is smoothed at the four handovers without stretching the links.
    const path = new T.CatmullRomCurve3(
      [
        [0.046, 0],
        [0.061, -arm * 0.27],
        [0.089, -arm * 0.73],
        [0.106, -arm],
        [0.075, -arm - 0.074],
        [0, -arm - 0.106],
        [-0.075, -arm - 0.074],
        [-0.106, -arm],
        [-0.089, -arm * 0.73],
        [-0.061, -arm * 0.27],
        [-0.046, 0],
        [-0.033, 0.031],
        [0, 0.046],
        [0.033, 0.031],
      ].map(([y, z]) => new T.Vector3(X, y, z)),
      true,
      'centripetal',
    );
    path.arcLengthDivisions = SAMPLES;
    this.samples = path.getSpacedPoints(SAMPLES);
    this.links = Math.max(70, Math.round(path.getLength() / CHAIN_PITCH));
    this.root.name = 'GP-R1 animated steel chain (articulated with swingarm)';
    this.rollers = new T.InstancedMesh(
      new T.CylinderGeometry(0.004, 0.004, 0.016, 8),
      steel,
      this.links,
    );
    this.rollers.name = 'Steel chain pins and rollers';
    this.plates = new T.InstancedMesh(
      new RoundedBoxGeometry(0.0028, 0.009, 0.014, 2, 0.0012),
      chainSide,
      this.links * 2,
    );
    this.plates.name = 'Paired articulated link plates';
    for (const mesh of [this.rollers, this.plates]) {
      mesh.castShadow = mesh.receiveShadow = true;
      // Instances move through the fixed belt envelope, not the bounding
      // sphere computed from their identity matrices.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.root.add(mesh);
    }
    const gear = new T.Mesh(sprocketGeometry(), aluminium);
    gear.name = 'Forged 42-tooth rear drive sprocket';
    gear.position.x = X - 0.0035;
    gear.castShadow = gear.receiveShadow = true;
    this.sprocket = gear;
    this.root.userData.referenceRevision = 'motogp-100-r3-chain';
    this.update(0);
  }

  update(rearRotation: number) {
    if (!Number.isFinite(rearRotation)) rearRotation = 0;
    if (rearRotation === this.lastWheelPhase) return;
    this.lastWheelPhase = rearRotation;
    // Repeated, identical links mean a wheel rotation of 2π simply permutes
    // the observed links by exactly REAR_TEETH places.
    const phase = (rearRotation / TAU) * REAR_TEETH;
    for (let i = 0; i < this.links; i++) {
      const slot = (((i + phase) % this.links) + this.links) % this.links;
      const at = (slot / this.links) * SAMPLES;
      const k = Math.floor(at);
      const t = at - k;
      this.p.lerpVectors(this.samples[k], this.samples[k + 1], t);
      this.tangent.subVectors(this.samples[k + 1], this.samples[k]);
      this.qLink.setFromAxisAngle(this.axis, Math.atan2(-this.tangent.y, this.tangent.z));
      this.matrix.compose(this.p, this.qRoller, this.one);
      this.rollers.setMatrixAt(i, this.matrix);
      for (const side of [-1, 1]) {
        const index = i * 2 + (side + 1) / 2;
        const x = this.p.x;
        this.p.x = x + side * 0.009;
        this.matrix.compose(this.p, this.qLink, this.one);
        this.plates.setMatrixAt(index, this.matrix);
        this.p.x = x;
      }
    }
    this.rollers.instanceMatrix.needsUpdate = true;
    this.plates.instanceMatrix.needsUpdate = true;
  }
}
