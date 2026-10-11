import * as T from 'three';
import type { Track } from '../simulation/track.ts';
import { AUREL_VENUE, type StandSpec } from './venue-plan.ts';
import type { BroadcastSightlines } from './broadcast-sightlines.ts';
import { StaticInstanceShadowBounds } from './static-instance-shadow-bounds.ts';
import { installVenueFinish } from './venue-materials.ts';
import { installStadiumSeat } from './stadium-seat.ts';
import { SECONDARY_STAND_ASSET, type SecondaryRole } from './secondary-grandstand-assets.ts';
import {
  packSecondaryStandCirculation,
  packSecondaryStandRole,
  type PackedSecondaryRole,
} from './secondary-grandstand-detail.ts';

export interface SecondaryStandFrame {
  x: number;
  y: number;
  z: number;
  yaw: number;
  ground(x: number, z: number): number;
}
interface StandEntry {
  root: T.Group;
  site: StandSpec;
  seats: number;
  meshes: T.InstancedMesh[];
}
function makeMaterials() {
  const materials = {
    stone: new T.MeshStandardMaterial({ color: 0x969b95, roughness: 0.87 }),
    steel: new T.MeshStandardMaterial({ color: 0x334b52, roughness: 0.43, metalness: 0.65 }),
    roof: new T.MeshStandardMaterial({ color: 0xbfc6c5, roughness: 0.52, metalness: 0.4 }),
    trim: new T.MeshStandardMaterial({ color: 0x12606b, roughness: 0.5, metalness: 0.15 }),
    seat: installStadiumSeat(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.58 })),
  };
  installVenueFinish(materials.stone, 'stone');
  for (const material of [materials.steel, materials.roof, materials.trim])
    installVenueFinish(material, 'metal');
  return materials;
}

/** A12 is deliberately separate from the two hero start/finish stands. It
 * installs at six retained Aurel sites only, without changing the venue plan,
 * seat matrices, audience cohorts, physical corridor or simulation state. */
export class SecondaryGrandstands {
  readonly roots: T.Group[] = [];
  readonly shadowBounds: StaticInstanceShadowBounds[] = [];
  private readonly entries = new Map<T.Group, StandEntry>();
  private readonly assets = new Map<string, PackedSecondaryRole>();
  private readonly detach: (() => void)[] = [];
  private materials?: ReturnType<typeof makeMaterials>;
  private disposed = false;
  constructor(readonly track: Track) {}

  accepts(site: StandSpec): boolean {
    return (
      this.track.circuit.id === 'aurel' &&
      SECONDARY_STAND_ASSET.sites.includes(site.s) &&
      AUREL_VENUE.grandstands.some(
        (s) => s.s === site.s && s.side === site.side && s.length === site.length,
      )
    );
  }
  private packed(role: SecondaryRole | 'circulation', mirror = false) {
    const key = `${role}:${mirror}`;
    let asset = this.assets.get(key);
    if (!asset) {
      asset =
        role === 'circulation'
          ? packSecondaryStandCirculation(mirror)
          : packSecondaryStandRole(role, mirror);
      this.assets.set(key, asset);
    }
    return asset;
  }
  private batch(
    entry: StandEntry,
    role: SecondaryRole | 'circulation',
    material: T.Material,
    matrices: readonly T.Matrix4[],
    mirror = false,
    colors?: readonly T.Color[],
  ) {
    if (
      !matrices.length ||
      (colors && colors.length !== matrices.length) ||
      matrices.some((m) => !m.elements.every(Number.isFinite) || m.determinant() <= 0)
    )
      throw new Error('Invalid A12 instance transforms');
    const asset = this.packed(role, mirror);
    const mesh = new T.InstancedMesh(asset.geometry, material, matrices.length);
    mesh.name = `A12 / ${entry.site.s}m / ${role}`;
    matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      if (colors) mesh.setColorAt(i, colors[i]);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    entry.root.add(mesh);
    entry.meshes.push(mesh);
    this.detach.push(asset.bind(mesh));
    // Keep the same conservative rigid-batch shadow culling as the hero stands.
    this.shadowBounds.push(new StaticInstanceShadowBounds(mesh));
    return mesh;
  }
  architecture(
    parent: T.Group,
    site: StandSpec,
    frame: SecondaryStandFrame,
    sightlines?: BroadcastSightlines,
  ) {
    if (
      this.disposed ||
      !this.accepts(site) ||
      this.entries.has(parent) ||
      [...this.entries.values()].some((e) => e.site.s === site.s) ||
      ![frame.x, frame.y, frame.z, frame.yaw].every(Number.isFinite)
    )
      throw new Error('Invalid or duplicate A12 placement');
    // Resolve terrain before changing the graph; a bad ground query cannot
    // leave a half-built stand or a negative-scale column in the scene.
    const footings: T.Matrix4[] = [],
      posts: T.Matrix4[] = [];
    const bays = site.length / SECONDARY_STAND_ASSET.moduleLength;
    for (let bay = 0; bay <= bays; bay++) {
      const z = -site.length / 2 + bay * 8;
      for (const u of [2.1, 9.8]) {
        const x = site.side * u;
        const wx = frame.x + Math.cos(frame.yaw) * x + Math.sin(frame.yaw) * z;
        const wz = frame.z - Math.sin(frame.yaw) * x + Math.cos(frame.yaw) * z;
        const low = frame.ground(wx, wz) - frame.y - 0.12;
        // Match the retained native assembly's rafter attachment datums.
        const high = u < 3 ? 6.07 : 7.36;
        if (!Number.isFinite(low) || high <= low) throw new Error('Invalid A12 foundation height');
        footings.push(new T.Matrix4().makeScale(1, 0.34, 1).setPosition(x, low, z));
        posts.push(new T.Matrix4().makeScale(1, high - low, 1).setPosition(x, low, z));
      }
    }
    const m = (this.materials ??= makeMaterials());
    const root = new T.Group();
    root.name = `A12 authored secondary grandstand ${site.s}m`;
    root.userData.secondaryStand = {
      ...site,
      revision: SECONDARY_STAND_ASSET.revision,
      finalArtApproved: false,
    };
    parent.add(root);
    const entry: StandEntry = { root, site: { ...site }, seats: 0, meshes: [] };
    this.entries.set(parent, entry);
    this.roots.push(root);
    const modules = Array.from({ length: bays }, (_, i) =>
      new T.Matrix4().makeTranslation(0, 0, (i - (bays - 1) / 2) * 8),
    );
    const frames = Array.from({ length: bays + 1 }, (_, i) =>
      new T.Matrix4().makeTranslation(0, 0, -site.length / 2 + i * 8),
    );
    const mirror = site.side < 0;
    this.batch(entry, 'deck', m.stone, modules, mirror);
    this.batch(entry, 'roof', m.roof, modules, mirror);
    // Two halves retain all six rail bays and both aisle locations exactly.
    this.batch(
      entry,
      'circulation',
      m.steel,
      [-12, 12].map((z) => new T.Matrix4().makeTranslation(0, 0, z)),
      mirror,
    );
    this.batch(entry, 'frame', m.steel, frames, mirror);
    this.batch(entry, 'trim', m.trim, modules, mirror);
    this.batch(
      entry,
      'end',
      m.stone,
      [-1, 1].map((s) => new T.Matrix4().makeTranslation(0, 0, s * (site.length / 2 - 0.06))),
      mirror,
    );
    this.batch(entry, 'foot', m.stone, footings);
    this.batch(entry, 'post', m.steel, posts);
    if (sightlines) {
      // Retain the established thin, pitched canopy occluder. An axis-aligned
      // bound around all trusses/seating would invent an opaque wall beneath
      // the roof and change the broadcast cameras despite an unchanged site.
      const g = new T.BoxGeometry(12.8, 0.12, site.length + 1.5);
      const solid = new T.Mesh(g, m.roof);
      solid.position.set(site.side * 4.5, 6.58, 0);
      solid.rotation.z = site.side * 0.166;
      parent.add(solid);
      try {
        sightlines.add(solid);
      } finally {
        parent.remove(solid);
        g.dispose();
      }
    }
  }
  seats(
    parent: T.Group,
    site: StandSpec,
    matrices: readonly T.Matrix4[],
    colors: readonly T.Color[],
  ) {
    const entry = this.entries.get(parent);
    if (
      this.disposed ||
      !entry ||
      entry.site.s !== site.s ||
      entry.site.side !== site.side ||
      entry.site.length !== site.length ||
      entry.seats ||
      !this.materials
    )
      throw new Error('A12 seats require their single authored stand');
    // The existing positive-determinant seat rotations already face the track;
    // mirroring these meshes again would reverse the left-side seat shells.
    this.batch(entry, 'seat', this.materials.seat, matrices, false, colors);
    entry.seats = matrices.length;
  }
  diagnostics() {
    return {
      revision: SECONDARY_STAND_ASSET.revision,
      source: 'constructed-runtime-groups',
      sites: [...this.entries.values()].map((e) => ({
        ...e.site,
        seats: e.seats,
        batches: e.meshes.length,
      })),
      geometryBuffers: this.assets.size,
      allocatedTriangles: [...this.assets.values()].reduce(
        (n, a) => n + a.geometry.index!.count / 3,
        0,
      ),
      finalArtApproved: false,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.shadowBounds.forEach((bound) => bound.dispose());
    this.detach.forEach((detach) => detach());
    for (const entry of this.entries.values()) {
      entry.root.removeFromParent();
      entry.meshes.forEach((mesh) => mesh.dispose());
      entry.root.clear();
    }
    for (const asset of this.assets.values()) asset.geometry.dispose();
    if (this.materials) Object.values(this.materials).forEach((material) => material.dispose());
    this.assets.clear();
    this.entries.clear();
    this.roots.length = this.shadowBounds.length = this.detach.length = 0;
  }
}
