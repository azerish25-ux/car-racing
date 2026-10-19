/** Local WGS84 metric frame. X is WEST and Z is NORTH so Three.js's
 * right-handed Y-up world is not a mirror of the geographic streets.
 * This also agrees with the existing festival map's +X-left projection. */
export const CHARLOTTETOWN_ORIGIN = Object.freeze({ longitude: -63.1295, latitude: 46.2385 });
const phi = (CHARLOTTETOWN_ORIGIN.latitude * Math.PI) / 180;
const a = 6378137,
  e2 = 6.69437999014e-3,
  w = Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
const lonScale = (((Math.PI / 180) * a) / w) * Math.cos(phi);
const latScale = ((Math.PI / 180) * a * (1 - e2)) / w ** 3;
export function geographicToWorld(longitude: number, latitude: number): [number, number] {
  return [
    -(longitude - CHARLOTTETOWN_ORIGIN.longitude) * lonScale,
    (latitude - CHARLOTTETOWN_ORIGIN.latitude) * latScale,
  ];
}
export function worldToGeographic(x: number, z: number): [number, number] {
  return [
    CHARLOTTETOWN_ORIGIN.longitude - x / lonScale,
    CHARLOTTETOWN_ORIGIN.latitude + z / latScale,
  ];
}
