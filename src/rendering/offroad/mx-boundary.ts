import * as T from 'three';
import { mod } from '../../core/math.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { Track, trackPoint } from '../../simulation/track.ts';

export const MX_BOUNDARY = Object.freeze({
  width: 0.68,
  height: 0.58,
  length: 2.1,
  spacing: 2.5,
});

export function isMotocrossVenue(track: Track) {
  const kind = track.circuit.offroad?.kind;
  return kind === 'motocross' || kind === 'supercross';
}

/** Low canvas-covered pads mark the actual collision boundary. A complete
 * footprint check prevents a neighboring hairpin's boundary from drawing
 * walls across a rideable SX lane. The nearer stakes still mark legal track
 * width; this outer row marks the hard limit beyond the shoulder. */
export function buildMotocrossBoundary(track: Track) {
  const surface = Track.offroadOf(track);
  if (!(surface instanceof TrackTerrainSurface) || !isMotocrossVenue(track))
    throw new Error('Motocross boundary requires an MX or SX terrain course');
  const root = new T.Group();
  root.name = 'MX physical boundary padding';
  const p = trackPoint(),
    q = trackPoint(),
    pose = new T.Object3D(),
    rows: T.Matrix4[][] = [[], []];
  let rejected = 0;
  const { width, height, length, spacing } = MX_BOUNDARY;
  for (let s = spacing / 2; s < track.length; s += spacing) {
    track.at(s, p);
    for (const side of [-1, 1] as const) {
      const lateral = side * (track.boundaryAt(p, side) + width / 2),
        x = p.x + p.nx * lateral,
        z = p.z + p.nz * lateral;
      let clear = true;
      // Include the centre and all four horizontal corners, independently
      // of the source station: short-radius curves can fold into another lane.
      for (const [along, across] of [
        [0, 0],
        [-length / 2, -width / 2],
        [-length / 2, width / 2],
        [length / 2, -width / 2],
        [length / 2, width / 2],
      ]) {
        const l = track.nearest(
          x + p.tx * along + p.nx * across,
          z + p.tz * along + p.nz * across,
          q,
        );
        const gap = Math.abs(mod(q.s - s + track.length / 2, track.length) - track.length / 2);
        if (gap > 8 && Math.abs(l) < surface.course.legalWidth(q.width, q.s, l) + 0.15) {
          clear = false;
          break;
        }
      }
      if (!clear) {
        rejected++;
        continue;
      }
      pose.position.set(x, surface.terrain.baseHeight(s, lateral) + height / 2, z);
      pose.rotation.set(0, Math.atan2(p.tx, p.tz), 0);
      pose.updateMatrix();
      rows[Math.floor(s / (spacing * 3)) % 2].push(pose.matrix.clone());
    }
  }
  // Taper the shoulder and bevel the top silhouette with a low-poly convex
  // profile. Blocks share geometry and two original canvas colors.
  const shape = new T.Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height * 0.3);
  shape.lineTo(width * 0.32, height / 2);
  shape.lineTo(-width * 0.32, height / 2);
  shape.lineTo(-width / 2, height * 0.3);
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -length / 2);
  for (let index = 0; index < rows.length; index++) {
    if (!rows[index].length) continue;
    const material = new T.MeshStandardMaterial({
      color: index ? 0xc8c3a5 : 0x263c37,
      roughness: 0.93,
      name: 'MX outer canvas padding',
    });
    const mesh = new T.InstancedMesh(geometry, material, rows[index].length);
    mesh.name = `MX boundary pads ${index ? 'pale' : 'dark'}`;
    rows[index].forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  root.userData.boundaryPads = rows.reduce((sum, row) => sum + row.length, 0);
  root.userData.rejectedLaneFootprints = rejected;
  return root;
}
