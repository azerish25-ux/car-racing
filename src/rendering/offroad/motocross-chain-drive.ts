import * as T from 'three';
import { ChainLoop, chainLinkPlateGeometry } from '../chain-geometry.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { installMud, type MudUniforms } from './mud.ts';

const TAU = Math.PI * 2;
const CHAIN_PITCH = 0.015875;
const REAR_RADIUS = 0.112;
const FRONT_RADIUS = 0.036;
const REAR_TEETH = 40;
const X = 0.095;

/** Original MX drivetrain, informed by reference 005/010/012/027/031. Two
 * instanced draws retain 96 rollers and 192 paired plates at both near LODs.
 * Wheel phase comes only from the supplied snapshot, including replay seeks.
 * The authored loop and tooth count are visual values, not measured reference
 * dimensions or a drivetrain simulation. The model owns geometry/disposal;
 * its existing chain material is shared with the wheel's drive sprocket. */
export class MotocrossChainDrive {
  readonly root = new T.Group();
  readonly rollers: T.InstancedMesh;
  readonly plates: T.InstancedMesh;
  readonly links = 96;
  private readonly loop: ChainLoop;
  private readonly qRoller = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(0, 0, 1),
    -Math.PI / 2,
  );
  private readonly qLink = new T.Quaternion();
  private readonly axis = new T.Vector3(1, 0, 0);
  private readonly p = new T.Vector3();
  private readonly next = new T.Vector3();
  private readonly midpoint = new T.Vector3();
  private readonly tangent = new T.Vector3();
  private readonly matrix = new T.Matrix4();
  private readonly one = new T.Vector3(1, 1, 1);
  private readonly linkScale = new T.Vector3(1, 1, 1);
  private lastWheelPhase = Number.NaN;
  private lastStretch = Number.NaN;

  constructor(
    private readonly arm: number,
    detail: 'high' | 'mid',
    material: T.MeshStandardMaterial,
    mud: MudUniforms,
  ) {
    if (!Number.isFinite(arm) || arm < 0.3 || arm > 1.1)
      throw new Error('Invalid motocross swingarm length');
    this.loop = new ChainLoop(arm, REAR_RADIUS, FRONT_RADIUS, X);
    this.root.name = 'Motocross wheel-driven articulated chain';
    this.root.userData.referenceRevision = 'motocross-followup-chain';
    this.rollers = new T.InstancedMesh(
      new T.CylinderGeometry(0.0039, 0.0039, 0.0235, detail === 'high' ? 8 : 5),
      material,
      this.links,
    );
    this.rollers.name = 'Motocross steel chain pins and rollers';
    this.plates = new T.InstancedMesh(
      detail === 'high'
        ? chainLinkPlateGeometry(CHAIN_PITCH)
        : new T.BoxGeometry(0.0028, 0.0086, CHAIN_PITCH + 0.0086),
      material,
      this.links * 2,
    );
    this.plates.name = 'Motocross paired articulated link plates';
    for (const mesh of [this.rollers, this.plates]) {
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      // Reuse these bounds when the arm changes; no per-frame allocations,
      // whole-instance recomputation or disabled frustum culling.
      mesh.boundingBox = new T.Box3();
      mesh.boundingSphere = new T.Sphere();
      this.root.add(mesh);
    }
    installMud(material, mud);
    // The ordinary mud hook samples mesh-local position. Instanced vertices
    // need their link placement too, otherwise every pin repeats one mask.
    // USE_INSTANCING keeps this shared material's rigid sprocket unchanged.
    chainShaderHook(material, 'motocross-chain-instance-mud-v1', (shader) => {
      injectAfter(
        shader,
        'begin_vertex',
        '#ifdef USE_INSTANCING\nvOffroadMudPos = ( instanceMatrix * vec4( position, 1.0 ) ).xyz;\n#endif',
        'vertex',
      );
    });
    this.update(0);
  }

  update(rearRotation: number, swingarmStretch = 1) {
    // The rendered arm follows the actual rear axle. Cancel its non-uniform
    // scale before constructing a newly taut loop; scaling the loop itself
    // would turn both circular wraps into ellipses during suspension travel.
    const stretch =
      Number.isFinite(swingarmStretch) && swingarmStretch >= 0.5 && swingarmStretch <= 1.5
        ? swingarmStretch
        : 1;
    const angle = Number.isFinite(rearRotation) ? ((rearRotation % TAU) + TAU) % TAU : 0;
    const armChanged = stretch !== this.lastStretch;
    if (!armChanged && angle === this.lastWheelPhase) return;
    if (armChanged) {
      this.lastStretch = stretch;
      this.root.scale.z = 1 / stretch;
      const arm = this.arm * stretch;
      this.loop.setArm(arm);
      for (const mesh of [this.rollers, this.plates]) {
        mesh.boundingBox!.min.set(X - 0.016, -REAR_RADIUS - 0.016, -arm - REAR_RADIUS - 0.016);
        mesh.boundingBox!.max.set(X + 0.016, REAR_RADIUS + 0.016, FRONT_RADIUS + 0.016);
        mesh.boundingBox!.getBoundingSphere(mesh.boundingSphere!);
      }
    }
    this.lastWheelPhase = angle;
    const spacing = this.loop.length / this.links;
    // Sampling traverses the rear wrap clockwise in YZ; positive wheel X
    // rotation is anticlockwise, so the phase must move in the opposite sign.
    const phase = -(angle / TAU) * REAR_TEETH;
    for (let i = 0; i < this.links; i++) {
      const distance = (i + phase) * spacing;
      this.loop.sample(distance, this.p);
      this.loop.sample(distance + spacing, this.next);
      this.tangent.subVectors(this.next, this.p);
      this.midpoint.addVectors(this.p, this.next).multiplyScalar(0.5);
      this.qLink.setFromAxisAngle(this.axis, Math.atan2(-this.tangent.y, this.tangent.z));
      this.linkScale.z = this.tangent.length() / CHAIN_PITCH;
      this.matrix.compose(this.p, this.qRoller, this.one);
      this.rollers.setMatrixAt(i, this.matrix);
      for (let side = 0; side < 2; side++) {
        this.midpoint.x = X + (side * 2 - 1) * (i % 2 ? 0.0104 : 0.0076);
        this.matrix.compose(this.midpoint, this.qLink, this.linkScale);
        this.plates.setMatrixAt(i * 2 + side, this.matrix);
      }
    }
    this.rollers.instanceMatrix.needsUpdate = true;
    this.plates.instanceMatrix.needsUpdate = true;
  }
}
