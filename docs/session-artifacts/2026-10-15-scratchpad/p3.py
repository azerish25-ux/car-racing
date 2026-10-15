import sys
root=sys.argv[1]
def patch(path, pairs):
    s=open(path).read()
    for a,b in pairs:
        assert a in s, (path, a[:80])
        s=s.replace(a,b)
    open(path,'w').write(s)
patch(root+'/src/simulation/vehicle.ts', [("""      // Wheel load and tread force act at the patch. The links carry the
      // geometric share of load transfer straight into the tyre (roll centre,
      // anti-dive/squat: suspension.ts), so the spring-borne overturning moment
      // matches the former link-centre application and a full-lock corner
      // still slides rather than rolling the car over.
      this.force.copy(s.normal).scale(t.load);
      b.apply(this.force, this.contactPoints[i]);
      this.force
        .set(0, 0, 0)
        .addScaled(basis.forward, t.fx - rolling)
        .addScaled(basis.lateral, t.fy);
      b.apply(this.force, this.contactPoints[i]);""","""      // Wheel load acts at the patch. Tread forces reach the sprung mass through
      // the suspension links, i.e. at the link centre above the patch;
      // applying them at ground level overstated the overturning moment so a
      // full-lock corner rolled the car over before the tyres could slide.
      // The roll centre and anti geometry (suspension.ts) then route part of
      // that transfer straight into the tyre loads (this.jacking).
      this.force.copy(s.normal).scale(t.load);
      b.apply(this.force, this.contactPoints[i]);
      this.force
        .set(0, 0, 0)
        .addScaled(basis.forward, t.fx - rolling)
        .addScaled(basis.lateral, t.fy);
      this.point.copy(this.contactPoints[i]).addScaled(this.up, spec.linkCentreHeight);
      b.apply(this.force, this.point);""")])
patch(root+'/src/simulation/vehicle-dynamics.ts', [
("""function formula(def: VehicleDefinition): VehicleDynamics {
  const [front, , rear] = def.wheelPositions;
  return Object.freeze({
    tyre: FORMULA_SLICK,
    suspension: defaultSuspension(def.spec.linkCentreHeight, front[2], rear[2], {
      front: { camberGain: 0.3, progression: 0.15, rollCentreGain: -0.4 },
      rear: { camberGain: 0.2, progression: 0.15, rollCentreGain: -0.4 },
    }),""","""/** Formula: low roll centres (push/pull-rod double wishbones), mild anti-dive
 * and anti-squat. With the 0.26 m link-centre correction the effective
 * mass-centre height is ~0.26 m, so tanθ 0.012 is ≈25% anti-dive. */
function formula(): VehicleDynamics {
  return Object.freeze({
    tyre: FORMULA_SLICK,
    suspension: defaultSuspension({
      front: {
        camberGain: 0.3,
        progression: 0.15,
        rollCentreHeight: 0.03,
        rollCentreGain: -0.3,
        antiBrake: 0.012,
      },
      rear: {
        camberGain: 0.2,
        progression: 0.15,
        rollCentreHeight: 0.06,
        rollCentreGain: -0.3,
        antiBrake: 0.008,
        antiDrive: 0.022,
      },
    }),"""),
("""function touring(def: VehicleDefinition): VehicleDynamics {
  const [front, , rear] = def.wheelPositions;
  return Object.freeze({
    tyre: TOURING_SLICK,
    suspension: defaultSuspension(def.spec.linkCentreHeight, front[2], rear[2], {
      front: { camberGain: 0.55, progression: 0.1, rollCentreGain: -0.6 },
      rear: { camberGain: 0.35, progression: 0.1, rollCentreGain: -0.6 },
    }),""","""/** Saloon: strut front (more camber gain, higher roll centre), anti-lift
 * of the driven front axle. */
function touring(): VehicleDynamics {
  return Object.freeze({
    tyre: TOURING_SLICK,
    suspension: defaultSuspension({
      front: {
        camberGain: 0.55,
        progression: 0.1,
        rollCentreHeight: 0.05,
        rollCentreGain: -0.5,
        antiBrake: 0.02,
        antiDrive: 0.015,
      },
      rear: {
        camberGain: 0.35,
        progression: 0.1,
        rollCentreHeight: 0.08,
        rollCentreGain: -0.5,
        antiBrake: 0.01,
      },
    }),"""),
("""export function legacyDynamics(def: VehicleDefinition): VehicleDynamics {
  const [front, , rear] = def.wheelPositions;
  return Object.freeze({
    tyre: def.classId === 'formula' ? FORMULA_SLICK : TOURING_SLICK,
    suspension: defaultSuspension(def.spec.linkCentreHeight, front[2], rear[2]),""","""export function legacyDynamics(def: VehicleDefinition): VehicleDynamics {
  return Object.freeze({
    tyre: def.classId === 'formula' ? FORMULA_SLICK : TOURING_SLICK,
    suspension: defaultSuspension(),"""),
("""  const base = def.classId === 'formula' ? formula(def) : touring(def);""","""  const base = def.classId === 'formula' ? formula() : touring();"""),
])
patch(root+'/src/simulation/tyre-force.ts', [("""/** Camber thrust as an equivalent slip-angle shift: Fy ≈ −Cα·α + Cγ·γ.
 * `inclination` is signed toward +lateral (driver's left). */
export function camberShift(c: TyreConstruction, load: number, state: SlipState, inclination: number) {
  return (c.camberStiffness * Math.max(load, 0) * inclination) / Math.max(1, state.corneringStiffness);
}""","""/** Camber thrust as an equivalent slip-angle shift: Fy ≈ −Cα·α + Cγ·γ.
 * `inclination` is signed toward +lateral (driver's left). Like slip-angle
 * force it is a rolling deflection of the tread: a stationary cambered tyre
 * on a slope produces none, so it builds over the first metres per second. */
export function camberShift(
  c: TyreConstruction,
  load: number,
  state: SlipState,
  inclination: number,
  speed: number,
) {
  return (
    (c.camberStiffness * Math.max(load, 0) * inclination * smooth(0.3, 3, Math.abs(speed))) /
    Math.max(1, state.corneringStiffness)
  );
}""")])
patch(root+'/src/simulation/tire.ts', [("""  const alpha = t.relaxedAngle - camberShift(k, t.load, SLIP, camber),""","""  const alpha = t.relaxedAngle - camberShift(k, t.load, SLIP, camber, vLong),""")])
print('ok')
