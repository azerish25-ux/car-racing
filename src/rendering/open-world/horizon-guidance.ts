import * as T from 'three';
import { brakingEnvelope } from './braking-envelope.ts';
import { clamp } from '../../core/math.ts';
import type { FestivalEvent } from '../../simulation/open-world/festival-events.ts';
import { pathPoint } from '../../simulation/open-world/route-path.ts';
import { EVENT_COLOURS } from './markers.ts';
import { ROAD_CLASSES } from '../../simulation/open-world/region-data.ts';

/** Small road-following chevrons and two verge flags make the actual route
 * legible through bends. All positions come from the event's sampled road;
 * these graphics never advance the simulation's legal checkpoint progress. */
export class HorizonGuidance {
  readonly root = new T.Group();
  private readonly arrows: T.InstancedMesh;
  private readonly flags = new T.Group();
  private readonly flagMaterial = new T.MeshStandardMaterial({
    color: 0xf2dd61,
    emissive: 0x332606,
    roughness: 0.72,
    side: T.DoubleSide,
  });
  private readonly matrix = new T.Object3D();
  private readonly point = pathPoint();
  private readonly colour = new T.Color();
  private readonly forward = new T.Vector3();
  private readonly lateral = new T.Vector3();
  private readonly normal = new T.Vector3();
  private readonly basis = new T.Matrix4();
  private current: FestivalEvent | null = null;
  private station = 0;
  private gateKey = '';
  private readonly poles: T.Group[] = [];
  readonly capacity = 28;
  private readonly curvature = new Float64Array(64);
  private readonly advisedSpeed = new Float64Array(64);
  private readonly flagCloths: T.MeshStandardMaterial[] = [];
  private readonly retired = new Set<T.BufferGeometry | T.Material>();
  /** Take private copies: guidance and the asset library have independent lifetimes. */
  useFlagTemplate(template: T.Object3D) {
    // A quality switch must recolour the replacement on the same checkpoint.
    this.gateKey = '';
    this.flagCloths.length = 0;
    for (const pole of this.poles) {
      pole.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        this.retired.add(node.geometry);
        for (const m of Array.isArray(node.material) ? node.material : [node.material])
          this.retired.add(m);
      });
      pole.clear();
      const flag = template.clone(true);
      flag.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        node.geometry = node.geometry.clone();
        node.material = Array.isArray(node.material)
          ? node.material.map((m) => m.clone())
          : node.material.clone();
        for (const m of Array.isArray(node.material) ? node.material : [node.material])
          if (m instanceof T.MeshStandardMaterial && m.name === 'fabric') this.flagCloths.push(m);
      });
      pole.add(flag);
    }
    for (const resource of this.retired) resource.dispose();
    this.retired.clear();
  }
  constructor() {
    this.root.name = 'Festival route guidance';
    const arrow = new T.BufferGeometry();
    arrow.setAttribute(
      'position',
      new T.Float32BufferAttribute(
        [
          -0.66, 0, -0.24, 0, 0, 0.58, 0, 0, 0.18, -0.66, 0, -0.24, 0, 0, 0.18, -0.66, 0, -0.65, 0,
          0, 0.58, 0.66, 0, -0.24, 0.66, 0, -0.65, 0, 0, 0.58, 0.66, 0, -0.65, 0, 0, 0.18,
        ],
        3,
      ),
    );
    arrow.computeVertexNormals();
    this.arrows = new T.InstancedMesh(
      arrow,
      new T.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        side: T.DoubleSide,
      }),
      this.capacity,
    );
    this.arrows.name = 'Road-following route chevrons';
    this.arrows.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.arrows.count = 0;
    this.arrows.frustumCulled = false;
    this.root.add(this.arrows, this.flags);
    const mast = new T.CylinderGeometry(0.035, 0.055, 4.8, 6).translate(0, 2.4, 0);
    const mastMaterial = new T.MeshStandardMaterial({
      color: 0x343b40,
      roughness: 0.5,
      metalness: 0.5,
    });
    const cloth = new T.PlaneGeometry(0.76, 3.7).translate(0.4, 2.7, 0);
    const band = new T.PlaneGeometry(0.68, 0.13);
    const dark = new T.MeshBasicMaterial({ color: 0x192029, side: T.DoubleSide });
    for (const side of [-1, 1]) {
      const pole = new T.Group();
      pole.name = side < 0 ? 'Right checkpoint flag' : 'Left checkpoint flag';
      pole.add(new T.Mesh(mast, mastMaterial), new T.Mesh(cloth, this.flagMaterial));
      for (let i = 0; i < 3; i++) {
        const stripe = new T.Mesh(band, dark);
        stripe.position.set(0.4, 2.7 + i * 0.35, 0.006);
        stripe.rotation.z = -0.4;
        pole.add(stripe);
      }
      pole.scale.x = side;
      this.poles.push(pole);
      this.flags.add(pole);
    }
    this.flags.visible = false;
  }
  reset() {
    this.current = null;
    this.gateKey = '';
  }
  update(
    event: FestivalEvent | null,
    gate: { x: number; z: number } | null,
    subject: T.Vector3,
    speed: number,
    height: (x: number, z: number, y?: number) => number,
    wetness = 0,
  ) {
    this.root.visible = !!event;
    if (!event) {
      this.current = null;
      this.gateKey = '';
      return;
    }
    const path = event.path;
    if (this.current !== event) {
      this.current = event;
      this.station = path.locate(subject.x, subject.z, path.length / 2, path.length);
      this.gateKey = '';
    } else this.station = path.locate(subject.x, subject.z, this.station, 150);
    const spacing = clamp(5 + Math.abs(speed) * 0.08, 5, 11);
    let samples = 0;
    for (let i = 0; i < this.curvature.length; i++) {
      const distance = this.station + 7 + i * spacing;
      if (!path.closed && distance > path.finishDistance) break;
      path.at(distance, this.point);
      this.curvature[samples++] = this.point.curvature;
    }
    brakingEnvelope(this.curvature, samples, spacing, wetness, this.advisedSpeed);
    let count = 0;
    for (let i = 0; i < this.capacity; i++) {
      const distance = this.station + 7 + i * spacing;
      if (!path.closed && distance > path.finishDistance) break;
      path.at(distance, this.point);
      const p = this.point;
      const lateral = clamp(path.lineAt(distance), -p.halfWidth * 0.6, p.halfWidth * 0.6);
      const x = p.x + p.nx * lateral,
        z = p.z + p.nz * lateral;
      const y = height(x, z, p.y);
      this.matrix.position.set(x, y + 0.045, z);
      // Follow both road grade and camber. A horizontal decal would cut
      // through an uphill road and float above the downhill half.
      this.forward
        .set(p.tx, (height(x + p.tx, z + p.tz, p.y) - height(x - p.tx, z - p.tz, p.y)) * 0.5, p.tz)
        .normalize();
      this.lateral
        .set(p.nx, (height(x + p.nx, z + p.nz, p.y) - height(x - p.nx, z - p.nz, p.y)) * 0.5, p.nz)
        .normalize();
      this.normal.crossVectors(this.forward, this.lateral).normalize();
      this.lateral.crossVectors(this.normal, this.forward).normalize();
      this.matrix.quaternion.setFromRotationMatrix(
        this.basis.makeBasis(this.lateral, this.normal, this.forward),
      );
      const size = Math.min(1.15, p.halfWidth * 0.27) * (1 - i / (this.capacity * 1.35));
      this.matrix.scale.set(size, 1, size * 1.7);
      this.matrix.updateMatrix();
      this.arrows.setMatrixAt(count, this.matrix.matrix);
      const ratio = Math.abs(speed) / Math.max(1, this.advisedSpeed[i]);
      this.colour.setHex(ratio > 1.12 ? 0xf28a51 : ratio > 0.91 ? 0xf0d071 : 0x76e4d0);
      this.arrows.setColorAt(count++, this.colour);
    }
    this.arrows.count = count;
    this.arrows.instanceMatrix.needsUpdate = true;
    if (this.arrows.instanceColor) this.arrows.instanceColor.needsUpdate = true;
    this.flags.visible = !!gate;
    const key = gate ? `${event.spec.id}:${gate.x}:${gate.z}` : '';
    if (gate && key !== this.gateKey) {
      this.gateKey = key;
      const d = path.locate(gate.x, gate.z, path.length / 2, path.length);
      path.at(d, this.point);
      this.flagMaterial.color.setHex(EVENT_COLOURS[event.spec.kind]);
      for (const material of this.flagCloths) material.color.setHex(EVENT_COLOURS[event.spec.kind]);
      for (let i = 0; i < this.poles.length; i++) {
        const side = i === 0 ? -1 : 1,
          p = this.point;
        const edge = path.network.edges[p.edge];
        const width = p.halfWidth + ROAD_CLASSES[edge.roadClass].shoulder + 0.85;
        const x = p.x + p.nx * side * width,
          z = p.z + p.nz * side * width;
        this.poles[i].position.set(x, height(x, z, p.y), z);
        this.poles[i].rotation.y = Math.atan2(p.tx, p.tz);
      }
    }
  }
  dispose() {
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    this.root.traverse((node) => {
      if (node instanceof T.Mesh) {
        geometries.add(node.geometry);
        for (const m of Array.isArray(node.material) ? node.material : [node.material])
          materials.add(m);
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.arrows.dispose();
    this.root.clear();
  }
}
