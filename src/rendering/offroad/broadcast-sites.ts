import { Vector3 } from 'three';
import { clamp } from '../../core/math.ts';
import { Track, trackPoint, surfaceSample } from '../../simulation/track.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { COURSE_CELL } from '../../simulation/offroad/course.ts';
import { inStandFootprint } from '../grandstand.ts';
import type { CameraRig } from '../trackside.ts';
import { STADIUM } from './stadium-dimensions.ts';

/** Encloses the actual procedural replay-camera base, offset support,
 * platform, rails, body and lens. Local +X points away from the nearest lane;
 * the other side mirrors it. A circle around this rectangle gives a
 * conservative clearance from every riding strip, including adjacent lanes. */
export const MX_CAMERA_FOOTPRINT = Object.freeze({
  inward: 0.65,
  outward: 1.275,
  halfDepth: 0.65,
  clearance: 0.55,
  maximumRelief: 0.35,
});
const centreOffset = (MX_CAMERA_FOOTPRINT.outward - MX_CAMERA_FOOTPRINT.inward) / 2;
const radius = Math.hypot(
  (MX_CAMERA_FOOTPRINT.outward + MX_CAMERA_FOOTPRINT.inward) / 2,
  MX_CAMERA_FOOTPRINT.halfDepth,
);
const placed = new WeakMap<Track, readonly Vector3[]>();

export function isMotocrossBroadcast(track: Track) {
  const kind = track.circuit.offroad?.kind;
  return kind === 'motocross' || kind === 'supercross';
}

/** Static terrain datum, shared by the optical-site planner and the physical
 * support. Unlike the paved apron this includes the MX jump/berm relief. */
export function motocrossCameraGround(track: Track, x: number, z: number) {
  const surface = Track.offroadOf(track);
  if (!(surface instanceof TrackTerrainSurface) || !isMotocrossBroadcast(track))
    throw new Error('Motocross camera ground requires an MX/SX terrain');
  const point = trackPoint(),
    lateral = track.nearest(x, z, point);
  return surface.terrain.baseHeight(point.s, lateral);
}

/** Relocate only dirt-venue rigs. The 20 view IDs, coverage, lens and tracking
 * settings are retained; these same static positions subsequently build the
 * visible camera hardware. Search is bounded and cached per immutable Track. */
export function placeMotocrossRigs(track: Track, rigs: readonly CameraRig[]): CameraRig[] {
  const surface = Track.offroadOf(track);
  if (!(surface instanceof TrackTerrainSurface) || !isMotocrossBroadcast(track))
    throw new Error('Motocross broadcast placement requires an MX/SX terrain');
  const known = placed.get(track);
  if (known) return rigs.map((rig, index) => ({ ...rig, position: known[index].clone() }));

  // Every actual centreline segment participates. Using the larger endpoint
  // legal width on either side conservatively contains tape and berm edges;
  // the small extra band covers interpolation at a feature boundary.
  const lanes = track.points.slice(0, -1).map((a, index) => {
    const b = track.points[index + 1],
      width =
        Math.max(
          surface.course.legalWidth(a.width, a.s, -1),
          surface.course.legalWidth(a.width, a.s, 1),
          surface.course.legalWidth(b.width, b.s, -1),
          surface.course.legalWidth(b.width, b.s, 1),
        ) + 0.06;
    return { x: a.x, z: a.z, dx: b.x - a.x, dz: b.z - a.z, width };
  });
  // The indoor seating starts at these four authored floor edges. Keep the
  // complete support inside them, in addition to the ordinary stand exclusion.
  const floor = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const point = trackPoint();
  if (surface.kind === 'supercross') {
    for (let s = 0; s < track.length; s += 4) {
      track.at(s, point);
      for (const side of [-1, 1]) {
        const x = point.x + point.nx * point.width * side,
          z = point.z + point.nz * point.width * side;
        floor.minX = Math.min(floor.minX, x - STADIUM.margin);
        floor.maxX = Math.max(floor.maxX, x + STADIUM.margin);
        floor.minZ = Math.min(floor.minZ, z - STADIUM.margin);
        floor.maxZ = Math.max(floor.maxZ, z + STADIUM.margin);
      }
    }
  }
  const offsets: { along: number; across: number; cost: number }[] = [];
  for (let along = -16; along <= 16; along += 2)
    for (let across = -32; across <= 32; across += 0.25)
      offsets.push({ along, across, cost: along * along + across * across });
  offsets.sort((a, b) => a.cost - b.cost || Math.abs(a.along) - Math.abs(b.along));

  const positions: Vector3[] = [],
    centres: { x: number; z: number }[] = [],
    contact = surfaceSample();
  for (const rig of rigs) {
    const station = track.at(rig.centerS + (track.length / rigs.length) * 0.18, trackPoint()),
      height = rig.position.y - station.y,
      target = track.at(rig.centerS, trackPoint()),
      targetY = surface.terrain.baseHeight(target.s, 0) + 1.1;
    let position: Vector3 | null = null;
    for (const offset of offsets) {
      const x = rig.position.x + station.tx * offset.along + station.nx * offset.across,
        z = rig.position.z + station.tz * offset.along + station.nz * offset.across,
        lateral = track.nearest(x, z, point),
        side = lateral < 0 ? -1 : 1,
        cx = x + point.nx * side * centreOffset,
        cz = z + point.nz * side * centreOffset,
        margin = radius + MX_CAMERA_FOOTPRINT.clearance;
      if (
        (surface.kind === 'supercross' &&
          (cx - margin < floor.minX ||
            cx + margin > floor.maxX ||
            cz - margin < floor.minZ ||
            cz + margin > floor.maxZ)) ||
        inStandFootprint(track, cx, cz, margin) ||
        centres.some((other) => Math.hypot(cx - other.x, cz - other.z) < radius * 2 + 0.5)
      )
        continue;
      let clear = true;
      for (const lane of lanes) {
        const reach = lane.width + margin;
        if (
          cx < Math.min(lane.x, lane.x + lane.dx) - reach ||
          cx > Math.max(lane.x, lane.x + lane.dx) + reach ||
          cz < Math.min(lane.z, lane.z + lane.dz) - reach ||
          cz > Math.max(lane.z, lane.z + lane.dz) + reach
        )
          continue;
        const t = clamp(
          ((cx - lane.x) * lane.dx + (cz - lane.z) * lane.dz) /
            (lane.dx * lane.dx + lane.dz * lane.dz),
          0,
          1,
        );
        if (Math.hypot(cx - lane.x - t * lane.dx, cz - lane.z - t * lane.dz) < reach) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      const nx = point.nx,
        nz = point.nz,
        tx = point.tx,
        tz = point.tz;
      let low = Infinity,
        high = -Infinity;
      // The full horizontal envelope, not merely the lens point, must sit on
      // the rendered terrain band without a steep jump face under its base.
      for (const u of [-MX_CAMERA_FOOTPRINT.inward, 0, MX_CAMERA_FOOTPRINT.outward])
        for (const v of [-MX_CAMERA_FOOTPRINT.halfDepth, 0, MX_CAMERA_FOOTPRINT.halfDepth]) {
          const wx = x + nx * side * u + tx * v,
            wz = z + nz * side * u + tz * v,
            l = track.nearest(wx, wz, point);
          if (
            l < surface.terrain.lateralMin + 0.25 ||
            l > surface.terrain.originX + surface.terrain.columns * COURSE_CELL.lateral - 0.25 ||
            (point.curvature * l > 0 && Math.abs(l) > 0.85 / Math.abs(point.curvature))
          )
            clear = false;
          const y = surface.terrain.baseHeight(point.s, l);
          low = Math.min(low, y);
          high = Math.max(high, y);
        }
      if (!clear || high - low > MX_CAMERA_FOOTPRINT.maximumRelief) continue;
      const eyeY = motocrossCameraGround(track, x, z) + height,
        samples = Math.ceil(Math.hypot(target.x - x, target.z - z) / 0.5);
      // A valid support must still see a rider at its own coverage centre.
      // Check the actual terrain contact path rather than raising the lens
      // independently of its authored physical post to mask an obstruction.
      for (let i = 1; i < samples; i++) {
        const t = i / samples;
        track.sample(x + (target.x - x) * t, z + (target.z - z) * t, contact);
        if (eyeY + (targetY - eyeY) * t < contact.height + 0.2) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      position = new Vector3(x, eyeY, z);
      centres.push({ x: cx, z: cz });
      break;
    }
    if (!position) throw new Error(`No clear ${track.circuit.id} replay-camera site ${rig.id}`);
    positions.push(position);
  }
  placed.set(track, positions);
  return rigs.map((rig, index) => ({ ...rig, position: positions[index].clone() }));
}
