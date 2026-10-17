import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from '../../../public/models/solvane/detail-kit.manifest.json' with { type: 'json' };
import { downloadAuthoredAsset } from '../authored-download.ts';
import { assetUrl } from '../assets/third-party.ts';
import { installSpecularIBL } from '../studio/ibl-energy.ts';
import type { QualityPreset } from '../options.ts';
import type { Structure } from '../../simulation/open-world/placement.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import { trackPoint } from '../../simulation/track.ts';
import { bodyFrame } from '../vehicle-bodies/frame.ts';
import { vehicleAt, VEHICLES } from '../../simulation/vehicles.ts';
import { F, R, RACE_BASE, carBase } from '../../simulation/protocol.ts';

export const SOLVANE_DETAILS = manifest;
const NAMES = Object.keys(manifest.templates);
interface Placement {
  matrix: T.Matrix4;
  position: T.Vector3;
  near: boolean;
  distance: number;
}
interface Batch {
  meshes: T.InstancedMesh[];
  max: number;
  count: number;
}

/** Reject a CDN fallback, changed payload, external URI or unbounded mesh
 * before invoking the loader. This kit has no textures or external buffers. */
export async function parseSolvaneKit(bytes: Uint8Array<ArrayBuffer>): Promise<T.Group> {
  if (bytes.length !== manifest.bytes || bytes.length > 2_000_000)
    throw new Error('Solvane detail byte budget mismatch');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonBytes = view.getUint32(12, true);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    jsonBytes > bytes.length - 28
  )
    throw new Error('Invalid Solvane GLB');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  if (Array.from(hash, (n) => n.toString(16).padStart(2, '0')).join('') !== manifest.sha256)
    throw new Error('Solvane detail integrity mismatch');
  const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonBytes))) as {
    buffers?: { uri?: string }[];
    images?: unknown[];
    nodes?: { name?: string }[];
  };
  if (
    document.buffers?.length !== 1 ||
    document.buffers[0].uri ||
    document.images?.length ||
    NAMES.some((name) => document.nodes?.filter((node) => node.name === name).length !== 1)
  )
    throw new Error('Solvane library must be self-contained with all named templates');
  // A cache or transport may return a view into a larger backing buffer.
  // Validate and decode the same byte range, never its unrelated prefix/suffix.
  const buffer =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;
  return (await new GLTFLoader().parseAsync(buffer, '')).scene;
}

/** Original Blender geometry on the existing region, not a second world.
 * Facades are distance-budgeted instances; boats/aero share immutable meshes.
 * The library owns geometry/materials; each instance owns its GPU matrix. */
export class SolvaneDetails {
  readonly root = new T.Group();
  readonly aero = new T.Group();
  readonly stats = {
    loaded: true,
    frontage: 0,
    balconies: 0,
    boats: 0,
    nearInstances: 0,
    farInstances: 0,
    drawBatches: 0,
  };
  private readonly fronts: Placement[] = [];
  private readonly balconies: Placement[] = [];
  private readonly batches = new Map<string, Batch>();
  private readonly templates = new Map<string, T.Object3D>();
  private readonly boats: {
    root: T.Group;
    near: T.Object3D;
    far: T.Object3D;
    y: number;
    yaw: number;
  }[] = [];
  private readonly flap: T.Object3D;
  private readonly main: T.Object3D;
  private readonly support: T.Object3D;
  private readonly farWing: T.Object3D;
  private readonly eye = new T.Vector3();
  private readonly frustum = new T.Frustum();
  private readonly projection = new T.Matrix4();
  private readonly sphere = new T.Sphere(new T.Vector3(), 4.3);
  private readonly materials = new Set<T.MeshStandardMaterial>();
  private readonly finishes: {
    material: T.MeshStandardMaterial;
    color: T.Color;
    roughness: number;
    darkening: number;
    wetRoughness: number;
  }[] = [];
  private readonly frame = bodyFrame(VEHICLES.eh3);
  private disposed = false;
  private flapAngle = 0;

  static async load(world: OpenWorld, structures: readonly Structure[], cancelled: () => boolean) {
    const aborted = () => new DOMException('Festival detail load cancelled', 'AbortError');
    const bytes = await downloadAuthoredAsset({
      label: 'Solvane',
      title: 'Solvane Blender details',
      bytes: manifest.bytes,
      url: assetUrl('models/solvane/detail-kit.glb'),
      cancelled,
      fetcher: fetch,
      aborted,
    });
    const source = await parseSolvaneKit(bytes);
    const result = new SolvaneDetails(source, world, structures);
    if (cancelled()) {
      result.dispose();
      throw aborted();
    }
    return result;
  }

  constructor(
    private readonly source: T.Group,
    world: OpenWorld,
    structures: readonly Structure[],
  ) {
    this.root.name = 'Blender-authored Solvane detail library';
    this.aero.name = 'EH-3 articulated rear aero';
    for (const name of NAMES) {
      const template = source.getObjectByName(name);
      if (!template) throw new Error(`Missing Solvane template: ${name}`);
      this.templates.set(name, template);
    }
    source.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      node.castShadow = node.receiveShadow = true;
      for (const m of Array.isArray(node.material) ? node.material : [node.material])
        if (m instanceof T.MeshStandardMaterial) this.materials.add(m);
    });
    for (const material of this.materials) {
      const porous = ['stone', 'timber', 'rope', 'fabric', 'linen', 'rubber'].includes(
        material.name,
      );
      const finish = ['cream', 'teal', 'orange', 'metal', 'carbon'].includes(material.name);
      if (porous || finish)
        this.finishes.push({
          material,
          color: material.color.clone(),
          roughness: material.roughness,
          darkening: porous ? 0.2 : 0.045,
          wetRoughness: porous
            ? Math.max(0.55, material.roughness * 0.82)
            : Math.max(0.21, material.roughness * 0.74),
        });
    }
    installSpecularIBL(source);
    for (const kind of ['frontage', 'balcony'])
      for (const level of ['near', 'far'])
        this.makeBatch(`${kind}_${level}`, level === 'near' ? 48 : 160);
    this.planFacades(world, structures);
    this.planBoats(world);
    this.main = this.clone('aero_main');
    this.flap = this.clone('aero_flap');
    this.support = this.clone('aero_support');
    this.farWing = this.clone('aero_flap_far');
    this.main.position.set(0, this.frame.y(1.035), this.frame.z(1.24));
    this.support.position.copy(this.main.position);
    // +Z is the nose: flap trails the main element in the negative direction.
    this.flap.position.set(0, this.frame.y(1.055), this.frame.z(1.24) - 0.31);
    this.farWing.position.copy(this.main.position);
    this.main.rotation.y = this.flap.rotation.y = this.farWing.rotation.y = Math.PI;
    this.aero.add(this.main, this.flap, this.support, this.farWing);
    this.aero.visible = false;
    this.root.add(this.aero);
  }

  flagTemplate(far = false) {
    return this.templates.get(far ? 'gate_far' : 'gate_near')!;
  }
  private clone(name: string) {
    return this.templates.get(name)!.clone(true);
  }
  private makeBatch(name: string, max: number) {
    const meshes: T.InstancedMesh[] = [];
    this.templates.get(name)!.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      const mesh = new T.InstancedMesh(node.geometry, node.material, max);
      mesh.name = `${name} / ${node.name}`;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = name.endsWith('near');
      mesh.receiveShadow = true;
      // Per-placement sphere tests below cover the changing instance subset.
      mesh.frustumCulled = false;
      meshes.push(mesh);
      this.root.add(mesh);
    });
    this.batches.set(name, { meshes, max, count: 0 });
    this.stats.drawBatches += meshes.length;
  }
  private planFacades(world: OpenWorld, structures: readonly Structure[]) {
    const p = trackPoint(),
      pose = new T.Object3D();
    for (const s of structures) {
      if (s.kind !== 'shop' && s.kind !== 'block') continue;
      world.network.nearest(s.x, s.z, p);
      const c = Math.cos(s.heading),
        n = Math.sin(s.heading);
      const side = (p.x - s.x) * -n + (p.z - s.z) * c >= 0 ? 1 : -1;
      const width = Math.min(s.hx * 1.62, 9.2);
      const bays = Math.max(1, Math.floor(width / 3.35));
      const bayWidth = Math.min(3.7, width / bays);
      for (let i = 0; i < bays; i++) {
        const x = (i - (bays - 1) / 2) * bayWidth;
        const z = side * (s.hz + 0.021);
        pose.position.set(s.x + x * c - z * n, s.base + 0.12, s.z + x * n + z * c);
        pose.rotation.set(0, -s.heading + (side < 0 ? Math.PI : 0), 0);
        // Below existing signage/awning; projection stays in its setback.
        pose.scale.set(bayWidth / 3.4, 0.7, 1);
        pose.updateMatrix();
        this.fronts.push({
          matrix: pose.matrix.clone(),
          position: pose.position.clone().add(new T.Vector3(0, 1, 0)),
          near: false,
          distance: 0,
        });
        if ((s.style + i) % 2 === 0)
          for (let floor = 1; floor < Math.min(4, s.floors); floor++) {
            pose.position.y = s.base + floor * 3.15;
            pose.scale.set(1, 1, 0.85);
            pose.updateMatrix();
            this.balconies.push({
              matrix: pose.matrix.clone(),
              position: pose.position.clone(),
              near: false,
              distance: 0,
            });
          }
      }
    }
    this.stats.frontage = this.fronts.length;
    this.stats.balconies = this.balconies.length;
  }
  private planBoats(world: OpenWorld) {
    for (let i = 0; i < 3; i++) {
      const x = 670 + i * 69;
      let z = -2720;
      while (z > -3300 && world.field.height(x, z) > world.region.seaLevel - 1.25) z -= 8;
      if (world.field.height(x, z) > world.region.seaLevel - 1.25) continue;
      const root = new T.Group(),
        near = this.clone('launch_near'),
        far = this.clone('launch_far');
      root.name = `Port Ilse working launch ${i + 1}`;
      const y = world.region.seaLevel - 0.03,
        yaw = -0.28 + i * 0.31;
      root.position.set(x, y, z);
      root.rotation.y = yaw;
      root.add(near, far);
      this.root.add(root);
      this.boats.push({ root, near, far, y, yaw });
    }
    this.stats.boats = this.boats.length;
  }
  private populate(
    kind: string,
    placements: Placement[],
    distance: number,
    nearDistance: number,
    nearLimit: number,
  ) {
    const near = this.batches.get(`${kind}_near`)!,
      far = this.batches.get(`${kind}_far`)!;
    near.count = far.count = 0;
    for (const p of placements) p.distance = p.position.distanceToSquared(this.eye);
    // Stable nearest-first budgeting prevents catalogue order stealing detail
    // from a shop beside the camera. Only two small resident placement lists.
    placements.sort((a, b) => a.distance - b.distance);
    for (const p of placements) {
      if (p.distance > distance * distance) break;
      this.sphere.center.copy(p.position);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      p.near = nearLimit > 0 && p.distance < (nearDistance + (p.near ? 4 : -4)) ** 2;
      const batch = p.near && near.count < nearLimit ? near : far;
      if (batch.count >= batch.max) continue;
      for (const mesh of batch.meshes) mesh.setMatrixAt(batch.count, p.matrix);
      batch.count++;
    }
    for (const batch of [near, far])
      for (const mesh of batch.meshes) {
        mesh.count = batch.count;
        mesh.visible = batch.count > 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
    this.stats.nearInstances += near.count;
    this.stats.farInstances += far.count;
  }
  update(time: number, night: number, camera: T.Camera, quality: QualityPreset, dampness = 0) {
    if (this.disposed) return;
    camera.getWorldPosition(this.eye);
    this.frustum.setFromProjectionMatrix(
      this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const low = quality === 'low',
      medium = quality === 'medium';
    const near = low ? 0 : medium ? 38 : quality === 'high' ? 58 : 78;
    const far = low ? 90 : medium ? 160 : quality === 'high' ? 220 : 300;
    const budget = low ? 0 : medium ? 16 : quality === 'high' ? 28 : 40;
    this.stats.nearInstances = this.stats.farInstances = 0;
    this.populate('frontage', this.fronts, far, near, budget);
    this.populate('balcony', this.balconies, far * 0.85, near, budget);
    for (let i = 0; i < this.boats.length; i++) {
      const boat = this.boats[i],
        d = boat.root.position.distanceTo(this.eye);
      boat.root.visible = d < (low ? 400 : 1100);
      boat.near.visible = !low && d < (medium ? 100 : 170);
      boat.far.visible = !boat.near.visible;
      boat.root.position.y = boat.y + Math.sin(time * 0.75 + i * 1.7) * 0.055;
      boat.root.rotation.z = Math.sin(time * 0.55 + i * 2.1) * 0.011;
    }
    const wet = Number.isFinite(dampness) ? T.MathUtils.clamp(dampness, 0, 1) : 0;
    // Recorded global wetness cue, not an off-road puddle simulation. Always
    // restore from immutable dry values; rain cannot compound darkening.
    for (const finish of this.finishes) {
      finish.material.color.copy(finish.color).multiplyScalar(1 - wet * finish.darkening);
      finish.material.roughness = T.MathUtils.lerp(finish.roughness, finish.wetRoughness, wet);
    }
    for (const material of this.materials) {
      if (material.name === 'lamp') material.emissiveIntensity = 0.15 + night * 2.4;
      if (material.name === 'redlamp' || material.name === 'greenlamp')
        material.emissiveIntensity = 0.2 + night * 2;
    }
  }
  poseAero(frame: Float32Array, subject: T.Object3D | null, dt: number, camera: T.Camera): boolean {
    const o = carBase(0);
    const compatible =
      subject !== null && vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE])).id === 'eh3';
    this.aero.visible = compatible && frame[o + F.REAR_HEALTH] > 0.08;
    if (!compatible || !subject) {
      this.flapAngle = 0;
      return false;
    }
    this.aero.position.copy(subject.position);
    this.aero.quaternion.copy(subject.quaternion);
    const close = subject.position.distanceTo(camera.position) < 55;
    this.main.visible = this.flap.visible = this.support.visible = close;
    this.farWing.visible = !close;
    const target = frame[o + F.BRAKE] > 0.35 && Math.abs(frame[o + F.SPEED]) > 12 ? 0.46 : 0.025;
    this.flapAngle +=
      (target - this.flapAngle) * (1 - Math.exp(-Math.max(0, Math.min(dt, 0.08)) * 7));
    this.flap.rotation.x = -this.flapAngle;
    return true;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const batch of this.batches.values()) for (const mesh of batch.meshes) mesh.dispose();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    this.source.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      geometries.add(node.geometry);
      for (const m of Array.isArray(node.material) ? node.material : [node.material])
        materials.add(m);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.root.removeFromParent();
    this.root.clear();
    this.source.clear();
    this.batches.clear();
    this.templates.clear();
    this.materials.clear();
  }
}
