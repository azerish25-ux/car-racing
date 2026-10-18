import * as T from 'three';
import source from '../assets/solvane-joinery.mesh.json' with { type: 'json' };
import type { QualityPreset } from '../options.ts';
import type { FacadePlacement, JoineryKind } from './facade-layout.ts';

export const JOINERY_BUDGETS = Object.freeze({
  low: { instances: 24, triangles: 20_000, range: 55 },
  medium: { instances: 80, triangles: 90_000, range: 95 },
  high: { instances: 144, triangles: 180_000, range: 140 },
  ultra: { instances: 192, triangles: 280_000, range: 180 },
});
const CAPACITY = 192,
  CELL = 64;
/** Anodised aluminium sashes and formed-concrete sills of Japanese city
 * windows (refs 030, 089); shutters remain for the original casements. */
const COLORS: Record<string, [number, number, number]> = {
  frame: [0.3, 0.31, 0.31],
  stone: [0.56, 0.56, 0.54],
  shutter: [0.16, 0.23, 0.205],
};
interface Candidate {
  placement: FacadePlacement;
  matrix: T.Matrix4;
  distance: number;
  radius: number;
  id: number;
}
interface Batch {
  mesh: T.InstancedMesh;
  kind: JoineryKind;
}
/** Original Blender meshes, instanced only on the nearest visible openings.
 * Physical reveals and glazing remain on every facade at all distances. */
export class FacadeJoinery {
  readonly root = new T.Group();
  readonly stats = { planned: 0, active: 0, triangles: 0, draws: 0, candidates: 0 };
  private readonly cells = new Map<string, Candidate[]>();
  private readonly batches: Batch[] = [];
  private readonly cost = new Map<JoineryKind, number>();
  private readonly candidates: Candidate[] = [];
  private readonly frustum = new T.Frustum();
  private readonly projection = new T.Matrix4();
  private readonly sphere = new T.Sphere();
  private readonly materials = new Map<string, T.MeshStandardMaterial>();
  private disposed = false;
  constructor(placements: readonly FacadePlacement[]) {
    this.root.name = 'Solvane Blender facade joinery';
    for (const [kind, parts] of Object.entries(source.templates)) {
      let cost = 0;
      for (const part of parts) {
        const geometry = new T.BufferGeometry();
        geometry.setAttribute(
          'position',
          new T.Float32BufferAttribute(
            part.position.map((v) => v / source.positionScale),
            3,
          ),
        );
        geometry.setAttribute(
          'normal',
          new T.Float32BufferAttribute(
            part.normal.map((v) => v / source.normalScale),
            3,
          ),
        );
        geometry.setIndex(part.index);
        geometry.computeBoundingSphere();
        let material = this.materials.get(part.role);
        if (!material) {
          const c = COLORS[part.role];
          if (!c) throw new Error('Unknown authored joinery material');
          material = new T.MeshStandardMaterial({
            color: new T.Color(...c),
            roughness: part.role === 'frame' ? 0.45 : 0.79,
            metalness: part.role === 'frame' ? 0.35 : 0,
          });
          material.name = `Solvane joinery ${part.role}`;
          this.materials.set(part.role, material);
        }
        const mesh = new T.InstancedMesh(geometry, material, CAPACITY);
        mesh.name = `Blender ${kind} / ${part.role}`;
        mesh.count = 0;
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        mesh.frustumCulled = false; // Per-opening oriented visibility test below.
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.root.add(mesh);
        this.batches.push({ mesh, kind: kind as JoineryKind });
        cost += part.index.length / 3;
      }
      this.cost.set(kind as JoineryKind, cost);
    }
    placements.forEach((p, id) => {
      const matrix = new T.Matrix4().makeBasis(
        new T.Vector3(...p.tangent),
        new T.Vector3(0, 1, 0),
        new T.Vector3(...p.normal),
      );
      matrix.scale(new T.Vector3(p.width, p.height, 1));
      matrix.setPosition(...p.centre);
      const entry: Candidate = {
        placement: p,
        matrix,
        distance: 0,
        radius: Math.hypot(p.width * 0.94, p.height * 0.56, 0.22),
        id,
      };
      const key = `${Math.floor(p.centre[0] / CELL)},${Math.floor(p.centre[2] / CELL)}`;
      const cell = this.cells.get(key);
      if (cell) cell.push(entry);
      else this.cells.set(key, [entry]);
    });
    this.stats.planned = placements.length;
  }
  update(camera: T.Camera, quality: QualityPreset) {
    if (this.disposed) return;
    const budget = JOINERY_BUDGETS[quality];
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    this.candidates.length = 0;
    const { x, y, z } = camera.position,
      range = budget.range;
    for (let cx = Math.floor((x - range) / CELL); cx <= Math.floor((x + range) / CELL); cx++)
      for (let cz = Math.floor((z - range) / CELL); cz <= Math.floor((z + range) / CELL); cz++)
        for (const entry of this.cells.get(`${cx},${cz}`) ?? []) {
          const p = entry.placement,
            dx = x - p.centre[0],
            dy = y - p.centre[1],
            dz = z - p.centre[2];
          entry.distance = dx * dx + dy * dy + dz * dz;
          if (entry.distance > range * range || dx * p.normal[0] + dz * p.normal[2] < -0.25)
            continue;
          this.sphere.center.set(...p.centre);
          this.sphere.radius = entry.radius;
          if (this.frustum.intersectsSphere(this.sphere)) this.candidates.push(entry);
        }
    this.candidates.sort((a, b) => a.distance - b.distance || a.id - b.id);
    this.stats.candidates = this.candidates.length;
    for (const b of this.batches) b.mesh.count = 0;
    this.stats.active = this.stats.triangles = this.stats.draws = 0;
    for (const entry of this.candidates) {
      if (this.stats.active >= budget.instances) break;
      const cost = this.cost.get(entry.placement.kind)!;
      if (this.stats.triangles + cost > budget.triangles) continue;
      for (const batch of this.batches)
        if (batch.kind === entry.placement.kind) {
          batch.mesh.setMatrixAt(batch.mesh.count++, entry.matrix);
        }
      this.stats.active++;
      this.stats.triangles += cost;
    }
    for (const { mesh } of this.batches) {
      mesh.visible = mesh.count > 0;
      mesh.castShadow = quality !== 'low';
      if (mesh.count) {
        mesh.instanceMatrix.needsUpdate = true;
        this.stats.draws++;
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const { mesh } of this.batches) {
      mesh.dispose();
      mesh.geometry.dispose();
    }
    for (const material of this.materials.values()) material.dispose();
    this.cells.clear();
    this.candidates.length = 0;
    this.root.removeFromParent();
    this.root.clear();
    this.stats.active = this.stats.triangles = this.stats.draws = 0;
  }
}
