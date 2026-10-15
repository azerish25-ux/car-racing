/** Convert a bike-frame wheel displacement into a fork-lower local offset
 * (models rake their steering mount by -rake about x, then steer about y). */
export function forkLocalOffset(out: T.Vector3, rake: number, steer: number, target: T.Vector3) {
  return target.copy(out).applyAxisAngle(X_AXIS, rake).applyAxisAngle(Y_AXIS, -steer);
}
const X_AXIS = new T.Vector3(1, 0, 0),
  Y_AXIS = new T.Vector3(0, 1, 0);
