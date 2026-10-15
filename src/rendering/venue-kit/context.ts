import * as T from 'three';
import { mod } from '../../core/math.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import type { CatalogueMeta } from '../../simulation/circuit-catalogue/venue-data.ts';
import { StaticTransformGroup } from '../static-transform-group.ts';
import { venueKitMaterials, type VenueKitMaterials } from './materials.ts';
import { VENUE_THEMES, type VenueThemeStyle } from './theme.ts';

/** A detail group shown only within `range` metres of the camera (distance
 * LOD for small, numerous parts: posts, tyres, scrub, lamps, signs). */
export interface DetailCell {
  object: T.Object3D;
  centre: T.Vector3;
  range: number;
}

/** Shared state of one venue-kit build: data, materials, footprints and the
 * LOD registry. Every builder writes into `root` (sealed after construction). */
export class VenueKitContext {
  readonly meta: CatalogueMeta;
  readonly style: VenueThemeStyle;
  readonly materials: VenueKitMaterials;
  readonly root = new StaticTransformGroup();
  readonly cells: DetailCell[] = [];
  /** When photographic vegetation is loaded, scatter records its shrubs here
   * (x, y, z, size, yaw) for the planting step instead of drawing them. */
  photoShrubs:
    | { x: number; y: number; z: number; height: number; width: number; yaw: number }[]
    | null = null;
  private footprints = new Map<string, { x: number; z: number; r: number }[]>();
  private readonly scratch = trackPoint();
  constructor(readonly track: Track) {
    this.meta = track.circuit.catalogue!;
    this.style = VENUE_THEMES[this.meta.theme];
    this.materials = venueKitMaterials(this.style);
    this.root.name = `Venue kit · ${this.meta.venueName} (${this.meta.layout})`;
  }
  /** Register a circular footprint that planting and scatter must avoid. */
  occupy(x: number, z: number, r: number) {
    const cell = 40,
      x0 = Math.floor((x - r) / cell),
      x1 = Math.floor((x + r) / cell),
      z0 = Math.floor((z - r) / cell),
      z1 = Math.floor((z + r) / cell);
    for (let gx = x0; gx <= x1; gx++)
      for (let gz = z0; gz <= z1; gz++) {
        const key = `${gx},${gz}`,
          list = this.footprints.get(key);
        if (list) list.push({ x, z, r });
        else this.footprints.set(key, [{ x, z, r }]);
      }
  }
  blocks(x: number, z: number, padding = 0) {
    const list = this.footprints.get(`${Math.floor(x / 40)},${Math.floor(z / 40)}`);
    if (!list) return false;
    for (const f of list) if (Math.hypot(x - f.x, z - f.z) < f.r + padding) return true;
    return false;
  }
  /** Is (x, z) over a DIFFERENT section's corridor than lap distance `s`
   * (hairpin legs, parallel straights, roads crossing on a bridge)? */
  overOtherSection(x: number, z: number, s: number, margin = 2) {
    const p = this.scratch,
      l = this.track.nearest(x, z, p),
      L = this.track.length;
    const gap = Math.abs(mod(p.s - s + L / 2, L) - L / 2);
    return gap > 60 && Math.abs(l) < this.track.boundaryAt(p, l < 0 ? -1 : 1) + margin;
  }
  detail(object: T.Object3D, range: number) {
    object.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(object);
    this.cells.push({ object, centre: box.getCenter(new T.Vector3()), range });
    this.root.add(object);
  }
  add(object: T.Object3D) {
    this.root.add(object);
  }
}

/** One mesh with shadow policy; large, flat or emissive parts do not cast. */
export function kitMesh(
  geometry: T.BufferGeometry,
  material: T.Material,
  name: string,
  castShadow = true,
) {
  const o = new T.Mesh(geometry, material);
  o.name = name;
  o.castShadow = castShadow;
  o.receiveShadow = true;
  return o;
}
