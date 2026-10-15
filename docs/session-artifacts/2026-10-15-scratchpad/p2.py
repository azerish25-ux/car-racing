import sys
p=sys.argv[1]
s=open(p).read()
def rep(a,b):
    global s
    assert a in s, a[:80]
    s=s.replace(a,b)
rep(""" * Geometry: camber gain and bump steer per metre of hub travel; roll centre
 * and side-view anti geometry put the geometric (link) share of load transfer
 * straight into the tyre loads — the tread force acts at the contact patch
 * with jacking ΔN = −(h_rc/y)·Fy − tanθ·Fx·sign(z) — instead of shrinking the
 * moment by applying tread forces above the patch. */""",
""" * Geometry: camber gain and bump steer per metre of hub travel. Load
 * transfer: tread forces enter the chassis at the vehicle's link-centre
 * height above the patch (VehicleSpec.linkCentreHeight), the calibrated
 * correction between the rigid body's reference point and the effective
 * roll/pitch mass centre that keeps total load transfer at its calibrated
 * value. Roll-centre height and side-view anti geometry then split that
 * transfer into an elastic share (springs/bars: body roll and pitch) and a
 * geometric share that the links put straight into the tyre loads,
 *     ΔN = −(h_rc/y)·Fy − tanθ·Fx·sign(z),
 * without changing the total, and jack the body when outer and inner forces
 * differ. Zero heights reproduce the former, purely elastic transfer. */""")
rep("""/** Default geometry reproduces the former link-centre load-transfer moments:
 * roll centre and anti slopes at `linkHeight` above the patch. */
export function defaultSuspension(
  linkHeight: number,
  frontZ: number,
  rearZ: number,
  overrides: { front?: Partial<AxleSuspension>; rear?: Partial<AxleSuspension> } = {},
): SuspensionDefinition {
  const axle = (z: number, camberGain: number): AxleSuspension => ({""",
"""/** Default axles reproduce the former model (no camber gain, purely elastic
 * load transfer, linear springs) apart from the damper knee; overrides add
 * a vehicle's geometry. */
export function defaultSuspension(
  overrides: { front?: Partial<AxleSuspension>; rear?: Partial<AxleSuspension> } = {},
): SuspensionDefinition {
  const axle = (camberGain: number): AxleSuspension => ({""")
rep("""    rollCentreHeight: linkHeight,
    rollCentreGain: 0,
    antiBrake: linkHeight / Math.max(0.3, Math.abs(z)),
    antiDrive: linkHeight / Math.max(0.3, Math.abs(z)),
  });
  return Object.freeze({
    front: Object.freeze({ ...axle(frontZ, 0), ...overrides.front }),
    rear: Object.freeze({ ...axle(rearZ, 0), ...overrides.rear }),
  });""","""    rollCentreHeight: 0,
    rollCentreGain: 0,
    antiBrake: 0,
    antiDrive: 0,
  });
  return Object.freeze({
    front: Object.freeze({ ...axle(0), ...overrides.front }),
    rear: Object.freeze({ ...axle(0), ...overrides.rear }),
  });""")
open(p,'w').write(s)
