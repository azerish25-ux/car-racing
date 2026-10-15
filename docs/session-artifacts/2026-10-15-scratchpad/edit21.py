p='src/rendering/rider.ts'
s=open(p).read()
def rep(old,new):
    global s
    assert old in s, old[:70]
    s=s.replace(old,new,1)
rep("""  /** 0 coasting .. 1 hard braking. */
  braking: number;
  steer: number;
}
export type RiderDetail = 'high' | 'mid' | 'far';""","""  /** 0 coasting .. 1 hard braking. */
  braking: number;
  steer: number;
  /** Off-road (WP41): 0 seated .. 1 standing on the pegs. */
  standing?: number;
  /** Foot dab: -1 right foot down .. +1 left foot down. */
  dab?: number;
  /** Body fore/aft over the bike: -1 back (throttle) .. +1 forward. */
  body?: number;
}
export type RiderDetail = 'high' | 'mid' | 'far';
/** Road leathers, or an off-road kit (textile jersey and pants, peaked
 * helmet with goggles, tall boots). */
export type RiderKit = 'leathers' | 'motocross';""")
rep("""  constructor(
    colours: RiderColours,
    readonly detail: RiderDetail = 'high',
  ) {
    const sides = detail === 'high' ? 20 : detail === 'mid' ? 12 : 6;
    const leather = new T.MeshPhysicalMaterial({
      color: colours.primary,
      roughness: 0.48,
      metalness: 0.02,
      clearcoat: 0.25,
      clearcoatRoughness: 0.55,
      name: 'Rider leathers',
    });
    const panel = new T.MeshPhysicalMaterial({
      color: colours.secondary,
      roughness: 0.52,
      clearcoat: 0.2,
      clearcoatRoughness: 0.6,
      name: 'Rider leather panels',
    });""","""  constructor(
    colours: RiderColours,
    readonly detail: RiderDetail = 'high',
    readonly kit: RiderKit = 'leathers',
  ) {
    const sides = detail === 'high' ? 20 : detail === 'mid' ? 12 : 6;
    const mx = kit === 'motocross';
    // Textile kit: matte woven fabric with a soft sheen, no lacquer.
    const leather = new T.MeshPhysicalMaterial(
      mx
        ? { color: colours.primary, roughness: 0.84, sheen: 0.35, sheenRoughness: 0.7, name: 'Rider jersey and pants (textile)' }
        : {
            color: colours.primary,
            roughness: 0.48,
            metalness: 0.02,
            clearcoat: 0.25,
            clearcoatRoughness: 0.55,
            name: 'Rider leathers',
          },
    );
    const panel = new T.MeshPhysicalMaterial(
      mx
        ? { color: colours.secondary, roughness: 0.86, sheen: 0.3, sheenRoughness: 0.75, name: 'Rider kit panels (textile)' }
        : {
            color: colours.secondary,
            roughness: 0.52,
            clearcoat: 0.2,
            clearcoatRoughness: 0.6,
            name: 'Rider leather panels',
          },
    );""")
rep("""    // Aero hump (spine protector and airbag housing) on the back.
    if (detail !== 'far')""","""    // Aero hump (spine protector and airbag housing) on the back.
    if (detail !== 'far' && !mx)""")
rep("""    if (detail !== 'far') {
      const shield = part(this.head, visorGeometry(0.004), visor);
      shield.position.copy(shell.position);
      // Rear aero spoiler on the helmet.
      const fin = part(this.head, new T.BoxGeometry(0.16, 0.025, 0.07), helmet);
      fin.position.set(0, 0.24, -0.12);
      fin.rotation.x = -0.35;
    }""","""    if (detail !== 'far' && mx) {
      // Off-road helmet: a peak over the eye port, a chin bar and goggles
      // on their strap in place of a visor.
      const peak = part(this.head, new T.BoxGeometry(0.2, 0.012, 0.13), helmet);
      peak.position.set(0, 0.26, 0.16);
      peak.rotation.x = -0.32;
      const chin = part(this.head, new T.BoxGeometry(0.12, 0.06, 0.08), helmet);
      chin.position.set(0, 0.05, 0.17);
      chin.rotation.x = 0.5;
      const goggle = part(this.head, new T.BoxGeometry(0.17, 0.05, 0.03), visor);
      goggle.position.set(0, 0.17, 0.165);
      const strap = part(this.head, new T.TorusGeometry(0.14, 0.012, 6, sides), glove);
      strap.position.set(0, 0.17, 0.02);
      strap.rotation.x = Math.PI / 2;
    } else if (detail !== 'far') {
      const shield = part(this.head, visorGeometry(0.004), visor);
      shield.position.copy(shell.position);
      // Rear aero spoiler on the helmet.
      const fin = part(this.head, new T.BoxGeometry(0.16, 0.025, 0.07), helmet);
      fin.position.set(0, 0.24, -0.12);
      fin.rotation.x = -0.35;
    }""")
rep("""      if (detail !== 'far') {
        // Elbow slider, knee armour and the replaceable knee slider puck on""","""      if (detail !== 'far' && mx) {
        // Knee braces over the pants and elbow guards.
        const brace = part(this.shins[i].group, new T.CylinderGeometry(0.06, 0.058, 0.16, sides), armour);
        brace.position.set(0, 0.02, 0.0);
        const guard = part(this.forearms[i].group, new T.SphereGeometry(0.042, sides, sides / 2), armour);
        guard.scale.set(1, 1.3, 0.9);
        guard.position.set(side * 0.01, 0.02, -0.02);
      } else if (detail !== 'far') {
        // Elbow slider, knee armour and the replaceable knee slider puck on""")
rep("""      const foot = new T.Group();
      part(foot, new T.BoxGeometry(0.085, 0.09, 0.27), glove).position.set(0, -0.02, 0.06);""","""      const foot = new T.Group();
      part(foot, new T.BoxGeometry(0.085, 0.09, 0.27), glove).position.set(0, -0.02, 0.06);
      // Tall off-road boots up the shin.
      if (mx) part(foot, new T.CylinderGeometry(0.058, 0.05, 0.3, sides), glove).position.set(0, -0.17, 0);""")
rep("""    const lean = pose.lean,
      offset = pose.offset,
      tuck = T.MathUtils.clamp(pose.tuck, 0, 1),
      braking = T.MathUtils.clamp(pose.braking, 0, 1);
    const [pelvis, shoulder, joint, hip, pole, target] = this.v;
    // Hang off: the hips slide toward the inside and drop off the seat.
    pelvis.copy(this.seat);
    pelvis.x += offset * 0.6;
    pelvis.y -= Math.abs(offset) * 0.15;
    pelvis.z += braking * 0.05 - tuck * 0.05;
    pelvis.y -= tuck * 0.03;""","""    const lean = pose.lean,
      offset = pose.offset,
      tuck = T.MathUtils.clamp(pose.tuck, 0, 1),
      braking = T.MathUtils.clamp(pose.braking, 0, 1),
      standing = T.MathUtils.clamp(pose.standing ?? 0, 0, 1),
      dab = T.MathUtils.clamp(pose.dab ?? 0, -1, 1),
      body = T.MathUtils.clamp(pose.body ?? 0, -1, 1);
    const [pelvis, shoulder, joint, hip, pole, target] = this.v;
    // Hang off: the hips slide toward the inside and drop off the seat.
    pelvis.copy(this.seat);
    pelvis.x += offset * 0.6;
    pelvis.y -= Math.abs(offset) * 0.15;
    pelvis.z += braking * 0.05 - tuck * 0.05;
    pelvis.y -= tuck * 0.03;
    // Off-road: up on the pegs (knees flexed) and fore/aft over the bike.
    pelvis.y += standing * 0.3;
    pelvis.z += standing * 0.04 - body * 0.1;""")
rep("""    const pitch = T.MathUtils.lerp(1.05, 1.42, tuck) - braking * 0.3 + Math.abs(lean) * 0.1;""","""    let pitch = T.MathUtils.lerp(1.05, 1.42, tuck) - braking * 0.3 + Math.abs(lean) * 0.1;
    // An off-road rider sits up; standing, bends at the hips over the bars.
    if (this.kit === 'motocross') pitch = 0.42 + braking * 0.1 + Math.abs(lean) * 0.08;
    pitch = T.MathUtils.lerp(pitch, 0.78 + body * 0.25, standing);""")
rep("""      // Feet on the pegs; the inside knee opens toward the road when hung off.
      const out = inside ? 0.35 + Math.abs(offset) * 1.4 : 0.25;
      pole.copy(hip).add(target.set(side * out, 0.15, 0.55));
      twoBone(this.thighs[i], this.shins[i], hip, this.pegs[i], pole, joint);""","""      // Feet on the pegs; the inside knee opens toward the road when hung off.
      const out = inside ? 0.35 + Math.abs(offset) * 1.4 : 0.25;
      pole.copy(hip).add(target.set(side * out, 0.15, 0.55));
      // A dabbed foot leaves its peg toward the ground ahead of it.
      const down = side * dab > 0 ? Math.abs(dab) : 0;
      if (down > 0) {
        target.set(side * 0.34, -0.86, 0.32).add(this.pegs[i]);
        target.lerpVectors(this.pegs[i], target, down);
        twoBone(this.thighs[i], this.shins[i], hip, target, pole, joint);
      } else twoBone(this.thighs[i], this.shins[i], hip, this.pegs[i], pole, joint);""")
open(p,'w').write(s)
