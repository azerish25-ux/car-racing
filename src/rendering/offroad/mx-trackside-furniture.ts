import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from '../../core/math.ts';
import { COURSE_CELL } from '../../simulation/offroad/course.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { inStandFootprint } from '../grandstand.ts';
import { terrainFor } from '../terrain.ts';
import { tracksideRigs } from '../trackside.ts';
import { STADIUM } from './stadium-dimensions.ts';
import {
  MX_TRACKSIDE_MODELS,
  mxTracksideParts,
  mxTracksidePalette,
  type MxTracksideModel,
  type MxTracksideMaterial,
} from './mx-trackside-models.ts';

export const MX_FURNITURE_LIMITS = Object.freeze({
  serviceBays: 4,
  indoorServiceBays: 2,
  marshalPosts: 6,
  laneClearance: 0.7,
  serviceRadius: 3.6,
  marshalRadius: 1.55,
  maximumSlope: 0.14,
  maximumResidual: 0.065,
  maximumTriangles: 110000,
});
export interface MxFurniturePlacement {
  kind: MxTracksideModel;
  station: number;
  matrix: T.Matrix4;
  cluster: number;
}
export interface MxFurnitureSite {
  x: number;
  y: number;
  z: number;
  radius: number;
  station: number;
  type: 'service' | 'marshal';
  residual: number;
}

/** Read only the ground already visible in the venue: the MX terrain band
 * and the four-segment terrain skirt. No hidden flattening or physics edits. */
export function mxFurnitureGround(track: Track, x: number, z: number) {
  const surface = Track.offroadOf(track);
  if (!(surface instanceof TrackTerrainSurface)) throw new Error('MX furniture requires terrain');
  const p = trackPoint(),
    l = track.nearest(x, z, p),
    side = l < 0 ? -1 : 1;
  const start = Math.max(p.width + 4, track.boundaryAt(p, side) + 1);
  const t = clamp((Math.abs(l) - start) / 26, 0, 1);
  const road = p.y + p.bank * clamp(l, -12, 12);
  const ground = terrainFor(track);
  const knot = (u: number) => {
    const lateral = side * (start + 26 * u);
    const ry = p.y + p.bank * clamp(lateral, -12, 12);
    const natural = ground.height(p.x + p.nx * lateral, p.z + p.nz * lateral) - 0.08;
    return ry - 0.05 + (natural - ry + 0.05) * u * u * (3 - 2 * u);
  };
  const lo = Math.min(3, Math.floor(t * 4)),
    f = t * 4 - lo;
  const skirt = Math.abs(l) < start ? road - 0.04 : knot(lo / 4) * (1 - f) + knot((lo + 1) / 4) * f;
  const withinBand =
    l >= surface.terrain.lateralMin &&
    l <= surface.terrain.originX + surface.terrain.renderColumns * COURSE_CELL.lateral * 2 &&
    !(p.curvature * l > 0 && Math.abs(l) > 0.85 / Math.abs(p.curvature));
  return withinBand ? Math.max(skirt, surface.terrain.baseHeight(p.s, l)) : skirt;
}

function groundPose(track: Track, x: number, z: number, yaw: number) {
  const y = mxFurnitureGround(track, x, z),
    h = 0.35;
  const gx = (mxFurnitureGround(track, x + h, z) - mxFurnitureGround(track, x - h, z)) / (2 * h);
  const gz = (mxFurnitureGround(track, x, z + h) - mxFurnitureGround(track, x, z - h)) / (2 * h);
  const up = new T.Vector3(-gx, 1, -gz).normalize();
  const right = new T.Vector3(
    Math.cos(yaw),
    gx * Math.cos(yaw) - gz * Math.sin(yaw),
    -Math.sin(yaw),
  ).normalize();
  const forward = right.clone().cross(up).normalize();
  return {
    matrix: new T.Matrix4().makeBasis(right, up, forward).setPosition(x, y - 0.005, z),
    gx,
    gz,
    y,
  };
}

/** Conservative circular envelopes are tested against EVERY centreline
 * segment and its physical boundary, not only the nearest source station.
 * Existing replay-camera supports and the indoor seating remain reserved. */
export function planMxTracksideFurniture(track: Track) {
  const surface = Track.offroadOf(track);
  if (
    !(surface instanceof TrackTerrainSurface) ||
    !['motocross', 'supercross'].includes(surface.kind)
  )
    throw new Error('MX trackside furniture supports motocross and supercross only');
  const indoor = surface.kind === 'supercross';
  const lanes = track.points.slice(0, -1).map((a, i) => {
    const b = track.points[i + 1];
    return {
      x: a.x,
      z: a.z,
      dx: b.x - a.x,
      dz: b.z - a.z,
      width:
        Math.max(
          track.boundaryAt(a, -1),
          track.boundaryAt(a, 1),
          track.boundaryAt(b, -1),
          track.boundaryAt(b, 1),
          surface.course.legalWidth(a.width, a.s, -1),
          surface.course.legalWidth(a.width, a.s, 1),
          surface.course.legalWidth(b.width, b.s, -1),
          surface.course.legalWidth(b.width, b.s, 1),
        ) + 0.1,
    };
  });
  const cameras = tracksideRigs(track);
  const floor = new T.Box3(),
    p = trackPoint();
  if (indoor) {
    for (let s = 0; s < track.length; s += 4) {
      track.at(s, p);
      for (const side of [-1, 1])
        floor.expandByPoint(
          new T.Vector3(p.x + p.nx * p.width * side, 0, p.z + p.nz * p.width * side),
        );
    }
    floor.expandByVector(new T.Vector3(STADIUM.margin, 0, STADIUM.margin));
  }
  const sites: MxFurnitureSite[] = [],
    placements: MxFurniturePlacement[] = [];
  let rejected = 0;
  const accept = (
    s: number,
    side: number,
    setback: number,
    radius: number,
    type: MxFurnitureSite['type'],
  ) => {
    const at = track.at(s, trackPoint()),
      l = side * (track.boundaryAt(at, side) + setback + radius);
    const x = at.x + at.nx * l,
      z = at.z + at.nz * l;
    const reach = radius + MX_FURNITURE_LIMITS.laneClearance;
    if (
      (indoor &&
        (x - reach < floor.min.x ||
          x + reach > floor.max.x ||
          z - reach < floor.min.z ||
          z + reach > floor.max.z)) ||
      inStandFootprint(track, x, z, radius + 0.7) ||
      sites.some((q) => Math.hypot(x - q.x, z - q.z) < radius + q.radius + 1.2) ||
      cameras.some((q) => Math.hypot(x - q.position.x, z - q.position.z) < radius + 2.4)
    )
      return null;
    for (const lane of lanes) {
      const len = lane.dx * lane.dx + lane.dz * lane.dz;
      const u =
        len > 1e-8 ? clamp(((x - lane.x) * lane.dx + (z - lane.z) * lane.dz) / len, 0, 1) : 0;
      if (Math.hypot(x - lane.x - u * lane.dx, z - lane.z - u * lane.dz) < lane.width + reach)
        return null;
    }
    const yaw = Math.atan2(at.tx, at.tz),
      pose = groundPose(track, x, z, yaw);
    if (Math.hypot(pose.gx, pose.gz) > MX_FURNITURE_LIMITS.maximumSlope) return null;
    let residual = 0;
    // Half-metre site grid detects relief between corners, not just corners.
    for (let a = -radius; a <= radius; a += 0.5)
      for (let b = -radius; b <= radius; b += 0.5) {
        if (a * a + b * b > radius * radius) continue;
        const y = mxFurnitureGround(track, x + a, z + b);
        residual = Math.max(residual, Math.abs(y - pose.y - pose.gx * a - pose.gz * b));
      }
    if (residual > MX_FURNITURE_LIMITS.maximumResidual) return null;
    const site: MxFurnitureSite = { x, y: pose.y, z, radius, station: s, type, residual };
    sites.push(site);
    return { site, yaw };
  };
  const add = (
    kind: MxTracksideModel,
    site: MxFurnitureSite,
    yaw: number,
    dx: number,
    dz: number,
    turn = 0,
  ) => {
    const x = site.x + Math.cos(yaw) * dx + Math.sin(yaw) * dz;
    const z = site.z - Math.sin(yaw) * dx + Math.cos(yaw) * dz;
    placements.push({
      kind,
      station: site.station,
      cluster: sites.length - 1,
      matrix: groundPose(track, x, z, yaw + turn).matrix,
    });
  };
  const required = indoor ? MX_FURNITURE_LIMITS.indoorServiceBays : MX_FURNITURE_LIMITS.serviceBays;
  let service = 0;
  // Prefer the start/paddock straight; continue a deterministic bounded search
  // instead of spawning furniture in a lane merely to meet an instance count.
  for (let s = 26; s < track.length - 20 && service < required; s += 13) {
    for (const side of [-track.pit.side, track.pit.side]) {
      const radius = indoor ? 2.05 : MX_FURNITURE_LIMITS.serviceRadius;
      const found = accept(s, side, 1.1, radius, 'service');
      if (!found) {
        rejected++;
        continue;
      }
      const { site, yaw } = found;
      if (!indoor) add('canopy', site, yaw, 0, 0);
      add('tool-trolley', site, yaw, -0.85, -0.45);
      add('pressure-washer', site, yaw, 0.95, -0.57, -0.2);
      add('water-tank', site, yaw, 0.7, 0.77, Math.PI);
      add('speaker-stack', site, yaw, -1.2, 0.83, (-side * Math.PI) / 2);
      service++;
      break;
    }
  }
  let marshals = 0;
  for (let s = 110; s < track.length - 25 && marshals < MX_FURNITURE_LIMITS.marshalPosts; s += 19) {
    for (const side of [-1, 1]) {
      const found = accept(s, side, 0.95, MX_FURNITURE_LIMITS.marshalRadius, 'marshal');
      if (!found) {
        rejected++;
        continue;
      }
      add('marshal-post', found.site, found.yaw, 0, 0, 0);
      marshals++;
      break;
    }
  }
  return { sites, placements, rejected };
}

/** One owned, immutable static model kit per venue. At most five additional
 * draw batches, no animation allocations, extra lights, timers or web requests. */
export class MxTracksideFurniture {
  readonly root = new T.Group();
  readonly plan: ReturnType<typeof planMxTracksideFurniture>;
  readonly stats: Record<MxTracksideModel, number>;
  readonly triangles: number;
  constructor(track: Track) {
    this.root.name = 'MX modelled service bays and marshal posts';
    this.plan = planMxTracksideFurniture(track);
    this.stats = Object.fromEntries(MX_TRACKSIDE_MODELS.map((k) => [k, 0])) as Record<
      MxTracksideModel,
      number
    >;
    const palette = mxTracksidePalette();
    const templates = new Map(MX_TRACKSIDE_MODELS.map((k) => [k, mxTracksideParts(k, 'near')]));
    const batches = new Map<MxTracksideMaterial, T.BufferGeometry[]>();
    for (const placement of this.plan.placements) {
      this.stats[placement.kind]++;
      for (const part of templates.get(placement.kind)!) {
        const g = part.geometry.clone().applyMatrix4(placement.matrix);
        const list = batches.get(part.material) ?? [];
        list.push(g);
        batches.set(part.material, list);
      }
    }
    templates.forEach((parts) => parts.forEach((part) => part.geometry.dispose()));
    let triangles = 0;
    for (const role of Object.keys(palette) as MxTracksideMaterial[]) {
      const list = batches.get(role);
      if (!list?.length) {
        palette[role].dispose();
        continue;
      }
      const geometry = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!geometry) throw new Error(`Invalid MX ${role} furniture batch`);
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      const mesh = new T.Mesh(geometry, palette[role]);
      mesh.name = `MX trackside model batch / ${role}`;
      mesh.castShadow = mesh.receiveShadow = true;
      triangles += geometry.getAttribute('position').count / 3;
      this.root.add(mesh);
    }
    this.triangles = triangles;
    this.root.userData.models = { ...this.stats };
    this.root.userData.triangles = triangles;
  }
  dispose() {
    for (const child of this.root.children)
      if (child instanceof T.Mesh) {
        child.geometry.dispose();
        (child.material as T.Material).dispose();
      }
    this.root.clear();
  }
}
