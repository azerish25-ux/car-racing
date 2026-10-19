import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VEHICLES } from '../../simulation/vehicles.ts';
import { bodySheetFor } from '../vehicle-bodies/body-sheet.ts';
import { bodyFrame } from '../vehicle-bodies/frame.ts';
import { buildVehicleBody } from '../vehicle-bodies/index.ts';
import { bodyPaint } from '../vehicle-bodies/materials.ts';
import { tuneFestivalPaint } from './festival-car-finish.ts';

/** Festival meet cars (refs 025, 076, 080-083): the hub meet and the store
 * car-park meets show the festival's own production-form sports cars, not
 * the boxy ambient traffic. Each model is built once with the festival form
 * (`buildVehicleBody(..., { festival: true })`), its mid and far LODs posed
 * at rest and merged into four material classes — clear-coated paint (per
 * instance colour), gloss (glass, gloss trims, lenses), matte (plastics,
 * tyres, meshes, carbon) and metal (rims, chrome, exhausts, discs) — with
 * each source material's colour baked per vertex. Static and instanced: at
 * most four draws per model and LOD present; the mid LOD (about 30k
 * triangles) only within `MEET_NEAR` m of the camera, the far LOD (about
 * 5k) beyond. */
export const MEET_MODELS = ['lx12', 'sc7', 'eh3', 'rs5', 'rh3', 'rm8', 'rd2'] as const;
export const MEET_NEAR = 26;
type Kind = 'paint' | 'gloss' | 'matte' | 'metal';
const KINDS: readonly Kind[] = ['paint', 'gloss', 'matte', 'metal'];

function classify(material: T.Material, paint: ReadonlySet<T.Material>): Kind {
  if (paint.has(material)) return 'paint';
  const m = material as T.MeshStandardMaterial;
  if (material.transparent || material.userData.vehicleGlass) return 'gloss';
  if ((m.metalness ?? 0) >= 0.6) return 'metal';
  if ((m.roughness ?? 1) <= 0.4) return 'gloss';
  return 'matte';
}
/** A LOD group merged into the four classes (car frame, at rest). */
function mergeLod(group: T.Object3D, paint: ReadonlySet<T.Material>) {
  const lists: Record<Kind, T.BufferGeometry[]> = { paint: [], gloss: [], matte: [], metal: [] };
  group.updateMatrixWorld(true);
  const inverse = new T.Matrix4().copy(group.matrixWorld).invert(),
    local = new T.Matrix4(),
    colour = new T.Color();
  group.traverse((node) => {
    if (!(node instanceof T.Mesh) || !node.visible) return;
    if (node.name === 'Suspension link' || node.material instanceof T.ShaderMaterial) return;
    local.multiplyMatrices(inverse, node.matrixWorld);
    const source = node.geometry as T.BufferGeometry,
      materials = Array.isArray(node.material) ? node.material : [node.material];
    const groups = source.groups.length
      ? source.groups
      : [
          {
            start: 0,
            count: source.index?.count ?? source.getAttribute('position').count,
            materialIndex: 0,
          },
        ];
    const flat = source.index ? source.toNonIndexed() : source.clone();
    const position = flat.getAttribute('position'),
      normal = flat.getAttribute('normal');
    for (const g of groups) {
      const material = materials[g.materialIndex ?? 0];
      if (!material || material.visible === false) continue;
      const kind = classify(material, paint);
      const part = new T.BufferGeometry();
      const count = Math.min(g.count, position.count - g.start);
      if (count <= 0) continue;
      part.setAttribute(
        'position',
        new T.BufferAttribute(
          (position.array as Float32Array).slice(g.start * 3, (g.start + count) * 3),
          3,
        ),
      );
      if (normal)
        part.setAttribute(
          'normal',
          new T.BufferAttribute(
            (normal.array as Float32Array).slice(g.start * 3, (g.start + count) * 3),
            3,
          ),
        );
      else part.computeVertexNormals();
      part.applyMatrix4(local);
      // Glazing bakes as the dark tinted glass it reads as (refs 019, 097),
      // not its light transmission tint.
      const c =
        material.transparent || material.userData.vehicleGlass
          ? colour.set(0x0a0f12)
          : ((material as T.MeshStandardMaterial).color ?? colour.set(0x202020));
      const colours = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) colours.set([c.r, c.g, c.b], i * 3);
      part.setAttribute('color', new T.BufferAttribute(colours, 3));
      lists[kind].push(part);
    }
    if (flat !== source) flat.dispose();
  });
  const out = {} as Record<Kind, T.BufferGeometry | null>;
  for (const kind of KINDS) {
    const list = lists[kind];
    out[kind] = list.length ? mergeGeometries(list, false) : null;
    for (const g of list) g.dispose();
    out[kind]?.computeBoundingSphere();
  }
  return out;
}

interface Model {
  ground: number;
  lods: Record<Kind, T.InstancedMesh | null>[];
}
/** One meet car: ground position, heading (+z nose), model id and paint. */
export interface MeetSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  model: string;
  paint: number;
}
export class MeetCars {
  readonly root = new T.Group();
  readonly stats = { cars: 0, draws: 0, triangles: [0, 0] };
  private readonly materials: Record<Kind, T.Material>;
  private readonly models = new Map<string, Model>();
  private readonly spots: { spot: MeetSpot; matrix: T.Matrix4; colour: T.Color }[] = [];
  private readonly last = new T.Vector3(Infinity, 0, 0);
  private readonly pending: string[] = [];
  private readonly capacity = new Map<string, number>();
  constructor(spots: readonly MeetSpot[]) {
    this.root.name = 'Meet cars (festival form)';
    const paint = bodyPaint(0xffffff, 'metallic');
    tuneFestivalPaint(paint);
    paint.name = 'Meet car paint';
    this.materials = {
      paint,
      gloss: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.1 }),
      matte: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 }),
      metal: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.9 }),
    };
    this.materials.gloss.name = 'Meet car gloss';
    this.materials.matte.name = 'Meet car matte';
    this.materials.metal.name = 'Meet car metal';
    const up = new T.Vector3(0, 1, 0),
      q = new T.Quaternion(),
      p = new T.Vector3(),
      one = new T.Vector3(1, 1, 1);
    for (const spot of spots) {
      const def = VEHICLES[spot.model];
      if (!def || !bodySheetFor(def)) continue;
      if (!this.capacity.has(spot.model)) this.pending.push(spot.model);
      this.capacity.set(spot.model, (this.capacity.get(spot.model) ?? 0) + 1);
      const matrix = new T.Matrix4().compose(
        p.set(spot.x, spot.y - bodyFrame(def).ground, spot.z),
        q.setFromAxisAngle(up, spot.yaw),
        one,
      );
      this.spots.push({ spot, matrix, colour: new T.Color(spot.paint) });
    }
    this.stats.cars = this.spots.length;
  }
  private model(id: string, capacity: number) {
    let model = this.models.get(id);
    if (model) return model;
    const def = VEHICLES[id],
      sheet = def && bodySheetFor(def);
    if (!sheet) return null;
    const body = buildVehicleBody(0, def, sheet, { festival: true });
    const paints = new Set<T.Material>([body.materials.paint, body.materials.accent]);
    model = { ground: body.frame.ground, lods: [] };
    for (const detail of [1, 2]) {
      const merged = mergeLod(body.lods[detail].group, paints),
        set = {} as Record<Kind, T.InstancedMesh | null>;
      for (const kind of KINDS) {
        const g = merged[kind];
        if (!g) {
          set[kind] = null;
          continue;
        }
        const mesh = new T.InstancedMesh(g, this.materials[kind], capacity);
        mesh.name = `Meet ${id} ${detail === 1 ? 'mid' : 'far'} ${kind}`;
        mesh.count = 0;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        if (kind === 'paint')
          mesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        this.root.add(mesh);
        this.stats.triangles[detail - 1] += g.getAttribute('position').count / 3;
        set[kind] = mesh;
      }
      model.lods.push(set);
    }
    // The source body's own buffers and per-car materials are not kept.
    body.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    for (const m of [
      body.materials.paint,
      body.materials.accent,
      body.materials.head,
      body.materials.tail,
    ])
      m.dispose();
    this.models.set(id, model);
    return model;
  }
  /** Assign each car to its LOD by camera distance (when the camera moved). */
  update(camera: T.Camera, shadows = true) {
    const eye = camera.position;
    // Models are built one per call while the meet is in range (a body build
    // takes a few hundred milliseconds; none at session start).
    const id = this.pending.shift();
    if (id) {
      this.model(id, this.capacity.get(id)!);
      this.last.set(Infinity, 0, 0);
    }
    if (eye.distanceToSquared(this.last) < 4) return;
    this.last.copy(eye);
    for (const model of this.models.values())
      for (const set of model.lods) for (const kind of KINDS) if (set[kind]) set[kind]!.count = 0;
    const at = new T.Vector3();
    for (const { spot, matrix, colour } of this.spots) {
      const model = this.models.get(spot.model);
      if (!model) continue;
      const near = at.set(spot.x, spot.y, spot.z).distanceTo(eye) < MEET_NEAR,
        set = model.lods[near ? 0 : 1];
      for (const kind of KINDS) {
        const mesh = set[kind];
        if (!mesh) continue;
        mesh.setMatrixAt(mesh.count, matrix);
        if (kind === 'paint') mesh.setColorAt(mesh.count, colour);
        mesh.count++;
      }
    }
    let draws = 0;
    for (const model of this.models.values())
      for (const [lod, set] of model.lods.entries())
        for (const kind of KINDS) {
          const mesh = set[kind];
          if (!mesh) continue;
          mesh.visible = mesh.count > 0;
          mesh.castShadow = shadows && lod === 0 && mesh.visible;
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          if (mesh.visible) draws++;
        }
    this.stats.draws = draws;
  }
  dispose() {
    for (const model of this.models.values())
      for (const set of model.lods)
        for (const kind of KINDS) {
          set[kind]?.geometry.dispose();
          set[kind]?.dispose();
        }
    for (const m of Object.values(this.materials)) m.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }
}
