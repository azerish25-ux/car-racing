import { Color } from 'three';
import type { SurveyBuilding, SurveyPoint } from '../../../simulation/open-world/survey.ts';

const BRICK = [0xa86754, 0x965646, 0xb57660, 0x8d4e41, 0xa37964];
const SIDING = [0xc6c8b9, 0xe1d7b8, 0xb7bfb8, 0x96aaa5, 0x8798a0, 0xc7b79c, 0xc0c5ca];
export function buildingSeed(text: string) {
  let n = 2166136261;
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
export function footprintArea(p: readonly SurveyPoint[]) {
  return (
    p.reduce((sum, a, i) => {
      const b = p[(i + 1) % p.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0) / 2
  );
}
/** Accept only supported literal colours; never feed arbitrary OSM strings
 * into CSS or log invalid Three.js colour warnings during a render. */
export function mappedColour(text: string | undefined, fallback: number): number {
  if (!text) return fallback;
  const value = text.trim().toLowerCase();
  if (/^#?[0-9a-f]{6}$/.test(value)) return Number.parseInt(value.replace('#', ''), 16);
  if (/^#[0-9a-f]{3}$/.test(value))
    return Number.parseInt([...value.slice(1)].map((c) => c + c).join(''), 16);
  const named = value.replace(/[ _-]/g, '');
  return Object.hasOwn(Color.NAMES, named)
    ? Color.NAMES[named as keyof typeof Color.NAMES]
    : fallback;
}
export interface BuildingAppearance {
  home: boolean;
  campus: boolean;
  accessory: boolean;
  shopfront: boolean;
  material: 'brick' | 'siding' | 'stone' | 'concrete';
  tint: number;
  roofTint: number;
  roof: 'flat' | 'gabled' | 'mansard';
  mappedAppearance: boolean;
}
/** Explicit source tags take precedence over every authored style heuristic.
 * An untagged footprint is still an estimate, never a verified façade. */
export function buildingAppearance(building: SurveyBuilding): BuildingAppearance {
  const t = building.tags,
    h = buildingSeed(building.id);
  const area = Math.abs(footprintArea(building.footprint));
  const campus = /holland|charlottetown centre|wales/i.test(`${t.name ?? ''} ${t.operator ?? ''}`);
  const accessory = /^(shed|garage|garages|service)$/.test(t.building ?? '');
  const shopfront =
    !campus &&
    !accessory &&
    (/^(commercial|retail)$/.test(t.building ?? '') ||
      /^(cafe|restaurant|pub|bar|bank|post_office|pharmacy)$/.test(t.amenity ?? ''));
  const home =
    !campus &&
    !shopfront &&
    area < 320 &&
    !/commercial|retail|industrial|church|school|college|apartments|public|civic|hotel/.test(
      t.building ?? '',
    ) &&
    !/place_of_worship|arts_centre|parking|fire_station|townhall/.test(t.amenity ?? '');
  const cladding = (t['building:material'] ?? t.material ?? '').toLowerCase();
  const material = /brick/.test(cladding)
    ? 'brick'
    : /stone/.test(cladding)
      ? 'stone'
      : /concrete/.test(cladding)
        ? 'concrete'
        : /wood|timber|clapboard|siding/.test(cladding)
          ? 'siding'
          : campus || !home || h % 5 === 0
            ? 'brick'
            : 'siding';
  const palette = material === 'brick' ? BRICK : SIDING;
  const shape = t['roof:shape'];
  const roof =
    shape === 'flat' || shape === 'gabled' || shape === 'mansard'
      ? shape
      : home
        ? 'gabled'
        : 'flat';
  return {
    home,
    campus,
    accessory,
    shopfront,
    material,
    roof,
    tint: mappedColour(
      t['building:colour'],
      material === 'concrete' ? 0xb4afa2 : palette[h % palette.length],
    ),
    roofTint: mappedColour(t['roof:colour'], h % 3 === 0 ? 0x65665f : 0x474e51),
    mappedAppearance: !!(cladding || shape || t['building:colour'] || t['roof:colour']),
  };
}
interface Segment {
  ax: number;
  az: number;
  dx: number;
  dz: number;
  length2: number;
  name: string;
}
interface FrontageRoad {
  name: string;
  points: readonly SurveyPoint[];
}
const streetKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
/** Find an exterior face looking toward its mapped address street. The
 * segment index is reused across the city; no per-frame geography queries. */
export class FrontageIndex {
  private readonly all: Segment[] = [];
  private readonly streets = new Map<string, Segment[]>();
  constructor(roads: readonly FrontageRoad[]) {
    for (const road of roads) {
      const key = streetKey(road.name);
      const segments = this.streets.get(key) ?? [];
      this.streets.set(key, segments);
      for (let i = 1; i < road.points.length; i++) {
        const [ax, az] = road.points[i - 1],
          b = road.points[i];
        const dx = b[0] - ax,
          dz = b[1] - az,
          length2 = dx * dx + dz * dz;
        if (!Number.isFinite(ax + az + dx + dz) || length2 < 1e-8) continue;
        const line = { ax, az, dx, dz, length2, name: road.name };
        segments.push(line);
        this.all.push(line);
      }
    }
  }
  face(points: readonly SurveyPoint[], addressStreet = ''): number {
    if (points.length < 3) return -1;
    const orientation = footprintArea(points) >= 0 ? 1 : -1;
    const preferred = this.streets.get(streetKey(addressStreet));
    let best = -1,
      score = Infinity;
    const find = (roads: readonly Segment[]) => {
      for (let i = 0; i < points.length; i++) {
        const a = points[i],
          b = points[(i + 1) % points.length];
        const dx = b[0] - a[0],
          dz = b[1] - a[1],
          length = Math.hypot(dx, dz);
        if (length < 1.5) continue;
        const x = (a[0] + b[0]) / 2,
          z = (a[1] + b[1]) / 2;
        const nx = (orientation * dz) / length,
          nz = (-orientation * dx) / length;
        for (const road of roads) {
          const t = Math.max(
            0,
            Math.min(1, ((x - road.ax) * road.dx + (z - road.az) * road.dz) / road.length2),
          );
          const rx = road.ax + road.dx * t - x,
            rz = road.az + road.dz * t - z;
          const distance = Math.hypot(rx, rz);
          const facing = (rx * nx + rz * nz) / Math.max(1e-6, distance);
          if (facing < 0.25) continue; // A rear wall is not a street entrance.
          const candidate = distance + (1 - facing) * 12 + (length < 3 ? 12 : 0);
          if (candidate < score) {
            score = candidate;
            best = i;
          }
        }
      }
    };
    if (preferred?.length) find(preferred);
    if (best < 0) find(this.all);
    return best;
  }
}
export interface WindowBay {
  u: number;
  width: number;
}
/** Ground-floor openings cannot occupy the entrance. Upper floors retain
 * their rhythm. Shops get broader glazing only on their actual street face. */
export function windowBays(length: number, entranceWidth: number, broad = false): WindowBay[] {
  if (!Number.isFinite(length) || length < 1.5) return [];
  const columns = Math.min(24, Math.floor((length - 0.9) / (broad ? 3 : 2.7)));
  const width = Math.min(broad ? 2.15 : 1.03, (length / Math.max(1, columns)) * 0.55);
  const bays: WindowBay[] = [];
  for (let col = 0; col < columns; col++) {
    const u = (col + 0.5) / columns;
    if (entranceWidth > 0 && Math.abs((u - 0.5) * length) < (width + entranceWidth) / 2 + 0.15)
      continue;
    bays.push({ u, width });
  }
  return bays;
}
