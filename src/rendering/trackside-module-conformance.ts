import * as T from 'three';
import { Track, trackPoint } from '../simulation/track.ts';
import { clamp } from '../core/math.ts';
import { WEATHERING_ATTRIBUTE, rubberWear, weatheringStream } from './trackside-weathering.ts';

/** Shared metre-space display conformance; no simulation geometry is changed. */
export function conformTracksideGeometry(
  template: T.BufferGeometry,
  track: Track,
  start: number,
  end: number,
  side: number,
  span: number,
  reverse = false,
) {
  if (
    ![start, end, side].every(Number.isFinite) ||
    end <= start ||
    ![-1, 1].includes(side) ||
    !Number.isFinite(span) ||
    span <= 0
  )
    throw new Error('Invalid trackside module span');
  const g = template.clone(),
    p = g.getAttribute('position'),
    a = track.at(start, trackPoint()),
    b = track.at(end, trackPoint()),
    la = side * track.boundary(start, side),
    lb = side * track.boundary(end, side);
  // Barrier-space coordinates for weathering, from the template (+x is away
  // from the track on both sides of this mirrored conform).
  g.setAttribute(
    WEATHERING_ATTRIBUTE,
    new T.BufferAttribute(
      weatheringStream(
        p,
        g.getAttribute('normal'),
        start,
        end,
        span,
        1,
        reverse,
        rubberWear(track, (start + end) / 2),
      ),
      4,
    ),
  );
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * side,
      y = p.getY(i),
      z = clamp(p.getZ(i) / span, 0, 1),
      t = reverse ? 1 - z : z,
      l0 = la + x,
      l1 = lb + x;
    p.setXYZ(
      i,
      (a.x + a.nx * l0) * (1 - t) + (b.x + b.nx * l1) * t,
      (a.y + a.bank * clamp(l0, -12, 12)) * (1 - t) + (b.y + b.bank * clamp(l1, -12, 12)) * t + y,
      (a.z + a.nz * l0) * (1 - t) + (b.z + b.nz * l1) * t,
    );
  }
  // A one-axis reflection needs matching winding; normals must remain outward.
  if (side * (reverse ? -1 : 1) < 0) {
    const ix = g.index!;
    for (let i = 0; i < ix.count; i += 3) {
      const tmp = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, tmp);
    }
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
