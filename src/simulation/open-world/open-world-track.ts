import { clamp, Vec3 } from '../../core/math.ts';
import { AUREL, STANDARD_PIT, type CircuitDefinition } from '../circuits.ts';
import type { WeatherPreset } from '../config.ts';
import {
  SURFACE,
  trackPoint,
  type SurfaceSample,
  type Track,
  type TrackPoint,
} from '../track.ts';
import { advanceWater, weatherKeyframes, WeatherTimeline, type WeatherKeyframe } from '../weather.ts';
import { ROAD_FLAG } from './road-network.ts';
import { BIOME, type Biome } from './terrain-field.ts';
import type { TerrainTileCache } from './terrain-tiles.ts';
import type { OpenWorld } from './world.ts';

/** Fine-grained ground classes of the festival region. Physics reads them
 * through the existing SURFACE codes (audio, dust and tyre contamination keep
 * working) plus grip and rolling resistance of their own. */
export const WORLD_SURFACE = Object.freeze({
  ASPHALT: 0,
  MARKING: 1,
  DIRT_ROAD: 2,
  SHOULDER: 3,
  PAVEMENT: 4,
  MEADOW: 5,
  FARMLAND: 6,
  FOREST: 7,
  SAND: 8,
  ROCK: 9,
  SNOW: 10,
  WATER: 11,
  AIRFIELD: 12,
} as const);
export type WorldSurface = (typeof WORLD_SURFACE)[keyof typeof WORLD_SURFACE];
export const WORLD_SURFACE_NAMES: readonly string[] = Object.freeze([
  'asphalt',
  'road marking',
  'dirt road',
  'gravel shoulder',
  'town paving',
  'meadow',
  'farmland',
  'forest floor',
  'sand',
  'rock',
  'snow',
  'water',
  'airfield grass',
]);
/** Physics properties per world surface: SURFACE code, grip, rolling
 * resistance and how much standing water it holds relative to a road. */
export const SURFACE_PHYSICS: Readonly<
  Record<WorldSurface, { code: number; grip: number; resistance: number; water: number }>
> = Object.freeze({
  [WORLD_SURFACE.ASPHALT]: { code: SURFACE.ASPHALT, grip: 1, resistance: 0.015, water: 1 },
  [WORLD_SURFACE.MARKING]: { code: SURFACE.PAINT, grip: 0.93, resistance: 0.015, water: 1 },
  [WORLD_SURFACE.DIRT_ROAD]: { code: SURFACE.GRAVEL, grip: 0.66, resistance: 0.045, water: 1.3 },
  [WORLD_SURFACE.SHOULDER]: { code: SURFACE.GRAVEL, grip: 0.62, resistance: 0.06, water: 1.1 },
  [WORLD_SURFACE.PAVEMENT]: { code: SURFACE.ASPHALT, grip: 0.86, resistance: 0.016, water: 0.9 },
  [WORLD_SURFACE.MEADOW]: { code: SURFACE.GRASS, grip: 0.56, resistance: 0.075, water: 0.7 },
  [WORLD_SURFACE.FARMLAND]: { code: SURFACE.GRAVEL, grip: 0.52, resistance: 0.11, water: 1.2 },
  [WORLD_SURFACE.FOREST]: { code: SURFACE.GRASS, grip: 0.54, resistance: 0.085, water: 0.6 },
  [WORLD_SURFACE.SAND]: { code: SURFACE.GRAVEL, grip: 0.48, resistance: 0.15, water: 0.5 },
  [WORLD_SURFACE.ROCK]: { code: SURFACE.ASPHALT, grip: 0.74, resistance: 0.022, water: 0.6 },
  [WORLD_SURFACE.SNOW]: { code: SURFACE.GRASS, grip: 0.36, resistance: 0.07, water: 0.4 },
  [WORLD_SURFACE.WATER]: { code: SURFACE.GRAVEL, grip: 0.3, resistance: 0.4, water: 3 },
  [WORLD_SURFACE.AIRFIELD]: { code: SURFACE.GRASS, grip: 0.58, resistance: 0.07, water: 0.7 },
});
const BIOME_SURFACE: Readonly<Record<Biome, WorldSurface>> = Object.freeze({
  [BIOME.SEA]: WORLD_SURFACE.WATER,
  [BIOME.BEACH]: WORLD_SURFACE.SAND,
  [BIOME.MEADOW]: WORLD_SURFACE.MEADOW,
  [BIOME.FARMLAND]: WORLD_SURFACE.FARMLAND,
  [BIOME.FOREST]: WORLD_SURFACE.FOREST,
  [BIOME.ROCK]: WORLD_SURFACE.ROCK,
  [BIOME.SNOW]: WORLD_SURFACE.SNOW,
  [BIOME.TOWN]: WORLD_SURFACE.PAVEMENT,
  [BIOME.AIRFIELD]: WORLD_SURFACE.AIRFIELD,
  [BIOME.RIVER]: WORLD_SURFACE.WATER,
});

/** Detailed result of a world-surface query (beyond SurfaceSample). */
export interface WorldQuery {
  surface: WorldSurface;
  onRoad: boolean;
  /** Road edge index (nearest road) and whether the road is on the queried layer. */
  edge: number;
  layer: boolean;
  bridge: boolean;
  /** Water surface above the ground at this point (m, 0 when dry land). */
  waterDepth: number;
}

/**
 * Track adapter for the festival region: everything Vehicle, the collision
 * solver and debris read from a Track, answered by the open world.
 *
 *  - `nearest`/`at` work in the road network's global station space, layer
 *    aware (bridges and the viaduct keep the road a car is actually on);
 *  - `sample`/`cast` return the real ground anywhere: the analytic cambered
 *    road surface (asphalt, markings, dirt, shoulders, bridge decks) or the
 *    carved terrain tiles with the biome's grip (grass, farmland, forest,
 *    sand, rock, snow, water);
 *  - boundaries are soft: there are no circuit walls, only guardrails along
 *    the runs the network marks (mountain drops, embankments, bridges), and
 *    only for a car on the road side of them;
 *  - there are no laps, pits or rubber/marble grids (`pitSpeedZone` is never
 *    true, `interact` keeps no state); weather and surface water evolve.
 *
 * It is not a subclass (a Track builds a circuit ribbon, racing line and
 * water grid in its constructor); `asTrack` is the single place it is handed
 * to code typed against Track, and tests assert it answers every public
 * Track member so a new Track method cannot silently go missing here.
 */
export class OpenWorldTrack {
  readonly network;
  readonly field;
  readonly tiles: TerrainTileCache;
  readonly length: number;
  readonly points: TrackPoint[] = [];
  readonly water = new Float32Array(0);
  readonly rubber = new Float32Array(0);
  readonly marbles = new Float32Array(0);
  readonly temperature = new Float32Array(0);
  readonly drainage = new Float32Array(0);
  readonly sheltered = new Uint8Array(0);
  readonly hash = new Map<string, number[]>();
  readonly pit = STANDARD_PIT;
  readonly circuit: CircuitDefinition;
  readonly weather: WeatherTimeline;
  readonly flat = false;
  rain = 0;
  cloud = 0.12;
  ambient = 22;
  windX = 1.5;
  windZ = 0.6;
  surfaceClock = 0;
  /** Standing water on a reference road surface (mm). */
  wetness: number;
  /** Last nearest(): lateral offset and segment, for boundaryAt. */
  private lastLateral = 0;
  private lastSegment = 0;
  private lastLayer = true;
  private readonly point = trackPoint();
  private readonly castPoint = new Vec3();
  private readonly normal = { x: 0, y: 1, z: 0 };
  readonly query: WorldQuery = {
    surface: WORLD_SURFACE.ASPHALT,
    onRoad: true,
    edge: 0,
    layer: true,
    bridge: false,
    waterDepth: 0,
  };
  constructor(
    readonly world: OpenWorld,
    readonly preset: WeatherPreset = 'clear',
    keyframes: readonly WeatherKeyframe[] = weatherKeyframes(preset),
    tileBudget = 64,
  ) {
    this.network = world.network;
    this.field = world.field;
    this.tiles = world.tileCache(tileBudget);
    this.length = world.network.totalStation;
    this.weather = new WeatherTimeline(keyframes);
    this.weather.sample(0, this);
    this.wetness = preset === 'rain' ? 0.9 : 0;
    this.circuit = Object.freeze({
      ...AUREL,
      name: world.region.name,
      short: 'FESTIVAL',
      corners: [],
      drsZones: [],
    });
  }
  // --- Track geometry -----------------------------------------------------
  at(s: number, out: TrackPoint): TrackPoint {
    return this.network.at(s, out);
  }
  nearest(x: number, z: number, out: TrackPoint, y?: number): number {
    const lateral = this.network.nearest(x, z, out, y);
    this.lastLateral = lateral;
    this.lastSegment = this.network.lastSegment;
    this.lastLayer = this.network.lastLayerMatch;
    return lateral;
  }
  /** Guardrail face (m from the centreline) on `side` of the road at a
   * resolved point. Only rails the network built exist, and only for a body
   * on the road side of them; elsewhere the "boundary" is unreachable. */
  boundaryAt(_p: TrackPoint, side: number) {
    const net = this.network,
      i = this.lastSegment,
      e = net.edges[net.edgeOf[i]],
      bit = side < 0 ? ROAD_FLAG.BARRIER_LEFT : ROAD_FLAG.BARRIER_RIGHT,
      face = e.spec.halfWidth + e.spec.shoulder + 0.35;
    const railed = (net.flags[i] & bit) !== 0 && (net.flags[i + 1] & bit) !== 0;
    if (!railed || !this.lastLayer || Math.abs(this.lastLateral) > face + 1.6) return 1e6;
    return face;
  }
  boundary(s: number, side: number) {
    const p = this.at(s, trackPoint());
    this.nearest(p.x, p.z, p, p.y);
    return this.boundaryAt(p, side);
  }
  runoffSurface(): number {
    return SURFACE.GRASS;
  }
  pitOffset() {
    return 0;
  }
  pitSideLateral(lateral: number) {
    return lateral;
  }
  isCovered() {
    return false;
  }
  isPitSection() {
    return false;
  }
  pitSpeedZone() {
    return false;
  }
  boxS() {
    return 0;
  }
  boxLateral() {
    return 0;
  }
  pitEntryS() {
    return -1;
  }
  inPitLane() {
    return false;
  }
  // --- Surface ------------------------------------------------------------
  /** Road surface class at a lateral offset (markings, shoulders). */
  private roadSurface(edge: number, lateral: number): WorldSurface {
    const e = this.network.edges[edge],
      spec = e.spec,
      a = Math.abs(lateral),
      hw = spec.halfWidth;
    if (a > hw) return spec.surface === 'dirt' || e.roadClass !== 'highway' ? WORLD_SURFACE.SHOULDER : WORLD_SURFACE.ASPHALT;
    if (spec.surface === 'dirt') return WORLD_SURFACE.DIRT_ROAD;
    if (spec.markings !== 'none') {
      // Edge lines, then the centre line (solid on mountain and town roads,
      // dashed elsewhere; the solid width is the physical paint).
      if (a > hw - 0.38 && a < hw - 0.16) return WORLD_SURFACE.MARKING;
      if (spec.markings !== 'runway' && a < 0.09) return WORLD_SURFACE.MARKING;
    }
    return WORLD_SURFACE.ASPHALT;
  }
  /** World ground under (x, z): fills a SurfaceSample (Track contract) and
   * `query` (detailed class). `y` selects the road layer (bridges). */
  sample(x: number, z: number, out: SurfaceSample, y?: number): SurfaceSample {
    const net = this.network,
      p = this.point,
      lateral = this.nearest(x, z, p, y),
      i = this.lastSegment,
      edge = net.edgeOf[i],
      e = net.edges[edge],
      spec = e.spec,
      a = Math.abs(lateral),
      bridge = (net.flags[i] & ROAD_FLAG.BRIDGE) !== 0,
      onRoad = this.lastLayer && a <= spec.halfWidth + spec.shoulder;
    const q = this.query;
    q.edge = edge;
    q.layer = this.lastLayer;
    q.bridge = bridge && onRoad;
    q.onRoad = onRoad;
    q.waterDepth = 0;
    out.s = p.s;
    out.lateral = lateral;
    out.width = spec.halfWidth;
    out.pit = false;
    out.cell = 0;
    let surface: WorldSurface;
    if (onRoad) {
      const hw = spec.halfWidth,
        l = clamp(lateral, -hw, hw),
        crownLeft = Math.max(0, spec.crown - Math.abs(p.bank));
      let height = p.y + p.bank * l - crownLeft * Math.abs(l),
        slope = Math.abs(lateral) <= hw ? p.bank - crownLeft * Math.sign(lateral) : 0;
      if (a > hw) {
        height -= 0.06 + (a - hw) * 0.03;
        slope -= 0.03 * Math.sign(lateral);
      }
      out.height = height;
      // Lateral unit vector is (nx, nz); the road rises `slope` per metre of it.
      out.normal.set(-p.tx * p.gradient - p.nx * slope, 1, -p.tz * p.gradient - p.nz * slope).normalize();
      surface = this.roadSurface(edge, lateral);
    } else {
      const n = this.normal,
        height = this.tiles.height(x, z, n);
      out.height = height;
      out.normal.set(n.x, n.y, n.z);
      const slope = Math.sqrt(Math.max(0, 1 - n.y * n.y)) / Math.max(0.05, n.y);
      surface = BIOME_SURFACE[this.field.biome(x, z, height, slope)];
      // Water stands above sea level and in the river channel.
      const valley = this.field.valleyAt(x, z);
      const level = valley.channel ? Math.max(valley.water, this.field.region.seaLevel) : this.field.region.seaLevel;
      if (height < level - 0.05) {
        q.waterDepth = level - height;
        surface = WORLD_SURFACE.WATER;
      }
    }
    q.surface = surface;
    const physics = SURFACE_PHYSICS[surface];
    out.surface = physics.code;
    // The class grip (public asphalt by age and use) scales paved surfaces;
    // loose surfaces carry their own absolute grip.
    const paved = surface === WORLD_SURFACE.ASPHALT || surface === WORLD_SURFACE.MARKING;
    out.grip = physics.grip * (onRoad && paved ? spec.grip : 1);
    out.resistance = physics.resistance;
    out.water = Math.min(3, this.wetness * physics.water);
    // A light general rubber coat on public asphalt; no racing line.
    out.rubber = physics.code === SURFACE.ASPHALT || physics.code === SURFACE.PAINT ? 0.08 : 0;
    out.marbles = 0;
    out.temp = this.ambient + 12 * (1 - this.cloud);
    return out;
  }
  /** Ray along `down` from `origin` to the ground (Track.cast contract):
   * distance, or Infinity when the ground is beyond `maximum`. An origin
   * already below the ground returns a small negative distance so the
   * suspension pushes the body back out. */
  cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    let x = origin.x,
      z = origin.z,
      t = 0;
    for (let iteration = 0; iteration < 2; iteration++) {
      this.sample(x, z, out, origin.y);
      const n = out.normal,
        denominator = down.x * n.x + down.y * n.y + down.z * n.z;
      if (denominator > -0.05) return Infinity;
      // Plane through (x, height, z) with normal n.
      t = ((x - origin.x) * n.x + (out.height - origin.y) * n.y + (z - origin.z) * n.z) / denominator;
      if (t > maximum + 0.5) return Infinity;
      x = origin.x + down.x * t;
      z = origin.z + down.z * t;
    }
    // Like Track's mesh ray cast, a ray never reports a hit behind its
    // origin (callers treat distances as non-negative); an origin just
    // below the ground reads as touching it, one far below misses.
    if (t > maximum || t < -0.4) return Infinity;
    const hit = this.castPoint.copy(origin).addScaled(down, t);
    out.height = hit.y;
    return Math.max(0, t);
  }
  /** Ground height only (spawning, recovery, scripts). */
  groundHeight(x: number, z: number, y?: number) {
    return this.sample(x, z, SCRATCH, y).height;
  }
  // --- Time ---------------------------------------------------------------
  evolve(dt: number, time: number) {
    if (!Number.isFinite(dt) || dt <= 0) throw new Error('Invalid weather timestep');
    this.weather.sample(time, this);
    this.surfaceClock += dt;
    if (this.surfaceClock < 0.5) return;
    const step = this.surfaceClock;
    this.surfaceClock = 0;
    // A drained road: rain fills it, run-off and evaporation empty it.
    const evaporation = (1 - this.cloud) * 0.0006;
    this.wetness = advanceWater(this.wetness, Math.max(0, this.rain / 3600 - evaporation), 0.004, step);
  }
  interact() {}
  meanWater() {
    return this.wetness;
  }
}
const SCRATCH: SurfaceSample = {
  s: 0,
  width: 0,
  lateral: 0,
  height: 0,
  normal: new Vec3(0, 1, 0),
  surface: 0,
  water: 0,
  rubber: 0,
  marbles: 0,
  temp: 0,
  grip: 1,
  resistance: 0,
  cell: 0,
  pit: false,
};
/** The festival world handed to code typed against a circuit Track
 * (Vehicle, CollisionSolver, debris). See OpenWorldTrack. */
export function asTrack(world: OpenWorldTrack): Track {
  return world as unknown as Track;
}
