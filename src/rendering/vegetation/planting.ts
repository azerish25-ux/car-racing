import type * as T from 'three';
import { clamp } from '../../core/math.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import type { SkyPalette } from '../assets/sky-catalogue.ts';
import {
  aurelVegetationPlan,
  type AuthoredTree,
  type PlantingExclusion,
} from '../aurel-vegetation-plan.ts';
import { grassApronOffset } from '../ground-profile.ts';
import { inStandFootprint } from '../grandstand.ts';
import { grovePlan, plantingCharacter, vegetationPlan, type TreePlacement } from '../landscape.ts';
import { venuePlan } from '../venue-plan.ts';
import type { QualityPreset } from '../options.ts';
import { forestBeltPlan, FOREST_BELTS } from '../studio/forest-belts.ts';
import { terrainFor } from '../terrain.ts';
import { inServiceFootprint, type ServiceSite } from '../venue-service-plan.ts';
import { PhotoForest, type PhotoPlant } from './forest.ts';
import { grassPlan, TrackGrass } from './grass.ts';
import type { VegetationLibrary } from './library.ts';
import { VEGETATION } from './materials.ts';
import {
  MAX_SCALE,
  pickSpecies,
  plantHash,
  plantScale,
  plantTint,
  SPECIES,
  treeRole,
  type TreeRole,
} from './species.ts';

/** Turn planned trees (shape only) into photographic plants of the palette. */
export function photoPlants(
  trees: readonly TreePlacement[],
  library: VegetationLibrary,
  palette: SkyPalette,
  role?: (tree: TreePlacement) => TreeRole,
): PhotoPlant[] {
  const available = library.available,
    out: PhotoPlant[] = [];
  for (const tree of trees) {
    const r = role?.(tree) ?? treeRole(tree.height, tree.width);
    const hash = plantHash(tree.x, tree.z, 17);
    const id = pickSpecies(r, palette, hash, available);
    const species = id ? library.get(id) : null;
    if (!id || !species) continue;
    out.push({
      species: id,
      x: tree.x,
      // The trunk sinks a little into uneven ground.
      y: tree.y - 0.12,
      z: tree.z,
      scale:
        plantScale(species.info.height, tree.height, MAX_SCALE[id]) *
        (0.94 + 0.12 * plantHash(tree.x, tree.z, 3)),
      yaw: tree.yaw,
      tint: plantTint(plantHash(tree.x, tree.z, 29), palette),
    });
  }
  return out;
}

/** Share of a coniferous venue's broadleaf belt trees drawn as conifers. */
const BELT_CONIFER_BIAS = 0.42;

const AUREL_ROLE: Record<string, TreeRole> = {
  'broadleaf-young': 'broadleaf',
  'broadleaf-mature': 'spreading',
  'columnar-young': 'upright',
  'columnar-mature': 'upright',
  'orchard-open': 'small',
  'orchard-row-end': 'small',
};

export interface PhotoPlantingOptions {
  track: Track;
  library: VegetationLibrary;
  palette: SkyPalette;
  services: readonly ServiceSite[];
  exclusion?: PlantingExclusion;
  /** Aurel: the authored A51-A54 layout (variants and layers). */
  aurel: boolean;
  /** Near-track planting and groves (the venue's planting zones). */
  planting: boolean;
  forestBelts: boolean;
  /** Meadow grass beyond the barriers (grass venues). */
  grass: boolean;
  /** Ground under the grass band: the venue kit's skirt or the original apron. */
  kit: { overOtherSection(x: number, z: number, s: number, margin?: number): boolean } | null;
  /** Shrub placements recorded by the venue kit's scatter (non-desert). */
  shrubs?: readonly TreePlacement[];
}

/** Ground height of the original circuits' apron and terrain. */
function apronGround(track: Track) {
  const terrain = terrainFor(track),
    p = trackPoint();
  return (s: number, l: number, x: number, z: number) => {
    track.at(s, p);
    return Math.abs(l) <= p.width + 38
      ? p.y + p.bank * clamp(l, -12, 12) + grassApronOffset(track, s, l)
      : terrain.height(x, z);
  };
}
/** Ground height of the venue kit's verge (inside the barrier) and skirt
 * (easing over 26 m onto the venue terrain, as venue-kit/ground.ts lays it,
 * with the ribbon's four straight segments across). */
function kitGround(track: Track) {
  const terrain = terrainFor(track),
    p = trackPoint();
  return (s: number, l: number, x: number, z: number) => {
    track.at(s, p);
    const side = l < 0 ? -1 : 1;
    const road = (lat: number) => p.y + p.bank * clamp(lat, -12, 12);
    const a = Math.max(p.width + 4, track.boundaryAt(p, side) + 1);
    if (Math.abs(l) < a) return road(l) - 0.04;
    const t = clamp((Math.abs(l) - a) / 26, 0, 1);
    if (t >= 1) return terrain.height(x, z) - 0.08;
    const knot = (k: number) => {
      const lat = side * (a + 26 * k),
        tt = k * k * (3 - 2 * k),
        ground = terrain.height(p.x + p.nx * lat, p.z + p.nz * lat) - 0.08 - road(lat);
      return road(lat) - 0.05 + (ground + 0.05) * tt;
    };
    const i = Math.min(3, Math.floor(t * 4)),
      f = t * 4 - i;
    return knot(i / 4) * (1 - f) + knot((i + 1) / 4) * f;
  };
}

/** Role of a planned tree from the venue's planting zone at its station:
 * the zone names the intended character (cypress rows, olive groves,
 * conifer belts); its crown aspect decides otherwise. */
export function zoneRole(track: Track) {
  const zones = venuePlan(track).plantingZones;
  const conifers = zones.some((z) => z.species === 'cypress');
  const p = trackPoint();
  return (tree: TreePlacement): TreeRole => {
    track.nearest(tree.x, tree.z, p);
    const species = plantingCharacter(p.s, track.length, zones).species;
    switch (species) {
      case 'cypress':
        return 'conifer';
      case 'upright':
        return conifers ? 'conifer' : 'upright';
      case 'olive':
        return 'small';
      case 'spreading':
      case 'open-crown':
      case 'umbrella-pine':
        return 'spreading';
      case 'broadleaf':
        return tree.height < 7.5 ? 'small' : 'broadleaf';
    }
    return treeRole(tree.height, tree.width);
  };
}

export class PhotoPlanting {
  readonly forest: PhotoForest;
  grass: TrackGrass | null = null;
  constructor(
    readonly options: PhotoPlantingOptions,
    group: T.Object3D,
  ) {
    const { track, library, palette, services, exclusion } = options;
    this.forest = new PhotoForest(library);
    const terrain = terrainFor(track);
    const ground = (x: number, z: number) => terrain.height(x, z);
    let trees = 0;
    if (options.aurel) {
      const sites = aurelVegetationPlan(track, services, exclusion);
      const layer = (name: AuthoredTree['layer']) => sites.filter((t) => t.layer === name);
      const role = (t: TreePlacement) => AUREL_ROLE[(t as AuthoredTree).variant] ?? 'broadleaf';
      this.forest.add(
        photoPlants([...layer('near'), ...layer('orchard')], library, palette, role),
        {
          label: 'Near',
          shadows: true,
          ground,
        },
      );
      this.forest.add(photoPlants(layer('grove'), library, palette, role), {
        label: 'Grove',
        shadows: false,
        chunk: 240,
        ground,
      });
      this.forest.add(photoPlants(layer('treeline'), library, palette, role), {
        label: 'Treeline',
        shadows: false,
        chunk: 500,
      });
      trees = layer('near').length + layer('orchard').length;
      group.userData.orchardTrees = layer('orchard').length;
      group.userData.groveTrees = layer('grove').length;
      group.userData.treelineTrees = layer('treeline').length;
    } else if (options.planting) {
      const near = vegetationPlan(track, 7109, services, exclusion);
      const { groves, treeline } = grovePlan(track, 40913, services);
      const role = zoneRole(track);
      this.forest.add(photoPlants(near, library, palette, role), {
        label: 'Near',
        shadows: true,
        ground,
      });
      this.forest.add(photoPlants(groves, library, palette, role), {
        label: 'Grove',
        shadows: false,
        chunk: 240,
        ground,
      });
      this.forest.add(photoPlants(treeline, library, palette, role), {
        label: 'Treeline',
        shadows: false,
        chunk: 500,
      });
      trees = near.length;
      group.userData.groveTrees = groves.length;
      group.userData.treelineTrees = treeline.length;
    }
    if (options.forestBelts) {
      const belts = forestBeltPlan(track, services, exclusion);
      // Venues planted with conifer rows (the forest theme) keep conifers the
      // majority of their woodland too: about two in three instead of 40 %.
      const coniferous = venuePlan(track).plantingZones.some((z) => z.species === 'cypress');
      this.forest.add(
        photoPlants(belts, library, palette, (t) =>
          (t as (typeof belts)[number]).conifer ||
          (coniferous && plantHash(t.x, t.z, 61) < BELT_CONIFER_BIAS)
            ? 'conifer'
            : treeRole(t.height, t.width),
        ),
        { label: 'Forest belt', shadows: false, chunk: FOREST_BELTS.bucket, ground },
      );
      group.userData.forestBeltTrees = belts.length;
    }
    // Flowering shrubs: the kit's scatter shrubs plus a sprinkle beyond the barriers.
    const shrub = library.get(SPECIES.shrub);
    if (shrub) {
      const shrubs = [...(options.shrubs ?? []), ...(options.grass ? this.edgeShrubs() : [])];
      this.forest.add(
        shrubs.map((t) => ({
          species: SPECIES.shrub,
          x: t.x,
          y: t.y - 0.05,
          z: t.z,
          scale: clamp(t.height / Math.max(0.3, shrub.info.height), 0.7, 2.2),
          yaw: t.yaw,
          tint: plantTint(plantHash(t.x, t.z, 41), palette),
        })),
        { label: 'Shrubs', shadows: true, chunk: 160 },
      );
    }
    group.userData.treeCount = trees;
    group.userData.photoPlants = this.forest.plants;
    group.add(this.forest.root);
    const grass = library.get(SPECIES.grass);
    if (options.grass && grass?.grass) {
      const ground = options.kit ? kitGround(track) : apronGround(track);
      const tiles = grass.grass.tiles,
        green = Math.ceil(tiles / 2);
      const clumps = grassPlan(track, {
        ground,
        allow: (x, z) =>
          !inStandFootprint(track, x, z, 2) &&
          !inServiceFootprint(services, x, z, 2) &&
          !(exclusion?.(x, z, 1) ?? false),
        tiles,
        green,
        // Late-summer clumps show bare soil at their foot: dry venues only,
        // a sprinkle elsewhere.
        dry: palette === 'arid' || palette === 'desert' ? 0.85 : palette === 'flat' ? 0.3 : 0.06,
      });
      this.grass = new TrackGrass(grass, clumps);
      group.add(this.grass.root);
      group.userData.grassClumps = clumps.length;
    }
  }

  /** Occasional flowering shrubs 2-10 m beyond the barrier line. */
  private edgeShrubs(): TreePlacement[] {
    const { track, services, exclusion } = this.options;
    const p = trackPoint(),
      q = trackPoint(),
      out: TreePlacement[] = [];
    const ground = this.options.kit ? kitGround(track) : apronGround(track);
    for (let k = 0, s = 0; s < track.length; k++, s = k * 11) {
      track.at(s, p);
      for (const side of [-1, 1] as const) {
        if (plantHash(k, side, 0x5b) > 0.32) continue;
        const l = side * (track.boundaryAt(p, side) + 2 + 8 * plantHash(k, side, 0x5c));
        const x = p.x + p.nx * l,
          z = p.z + p.nz * l;
        const nl = track.nearest(x, z, q);
        if (Math.abs(nl) < track.boundaryAt(q, nl < 0 ? -1 : 1) + 1.5) continue;
        if (
          inStandFootprint(track, x, z, 4) ||
          inServiceFootprint(services, x, z, 4) ||
          (exclusion?.(x, z, 3) ?? false)
        )
          continue;
        const height = 0.9 + 1.1 * plantHash(k, side, 0x5d);
        out.push({
          x,
          y: ground(q.s, nl, x, z),
          z,
          height,
          width: height * 1.4,
          yaw: plantHash(k, side, 0x5e) * 6.283,
        });
      }
    }
    return out;
  }

  update(camera: T.Camera, preset: QualityPreset, density = 1) {
    this.forest.update(camera, preset, density);
    this.grass?.update(camera, VEGETATION.grass[preset]);
  }
  diagnostics() {
    return {
      ...this.forest.diagnostics(),
      grassClumps: this.grass?.clumps ?? 0,
    };
  }
  dispose() {
    this.forest.dispose();
    this.grass?.dispose();
  }
}
