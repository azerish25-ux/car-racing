/** Festival map projection (world map and minimap), shared by the HUD and
 * its tests. The world is Y-up and right-handed: seen from above with
 * north (+z) up the page, east (+x) is on the LEFT, exactly as a camera
 * facing +z sees +x on its left. Drawing +x to the right would mirror every
 * junction and marker against the 3D view. */
export const MAP_SIZE = 2048;
export const MAP_HALF = 4400;
const SCALE = MAP_SIZE / (2 * MAP_HALF);

/** World (x, z) to the pre-drawn map image (pixels, north up). */
export function worldToMap(x: number, z: number): [number, number] {
  return [(MAP_HALF - x) * SCALE, (MAP_HALF - z) * SCALE];
}
/** Map pixel back to world (x, z). */
export function mapToWorld(px: number, py: number): [number, number] {
  return [MAP_HALF - px / SCALE, MAP_HALF - py / SCALE];
}
/** Minimap rotation (rad, canvas clockwise) that puts a car's forward
 * direction (fx, fz) straight up. */
export function minimapHeading(fx: number, fz: number) {
  return Math.atan2(fx, fz);
}
/** Canvas transform [a, b, c, d, e, f] (setTransform) of the heading-up
 * minimap: map image pixels to minimap pixels, the car at the centre. */
export function minimapMatrix(x: number, z: number, heading: number, size: number, range: number) {
  const scale = (size / (2 * range)) * ((2 * MAP_HALF) / MAP_SIZE),
    cos = Math.cos(heading) * scale,
    sin = Math.sin(heading) * scale,
    [mx, my] = worldToMap(x, z);
  // translate(size/2) · rotate(heading) · scale(scale) · translate(-mx, -my)
  return [cos, sin, -sin, cos, size / 2 - cos * mx + sin * my, size / 2 - sin * mx - cos * my] as const;
}
/** A world point on the minimap (pixels). */
export function minimapPoint(px: number, pz: number, x: number, z: number, heading: number, size: number, range: number) {
  const [a, b, c, d, e, f] = minimapMatrix(x, z, heading, size, range),
    [u, v] = worldToMap(px, pz);
  return [a * u + c * v + e, b * u + d * v + f] as const;
}
