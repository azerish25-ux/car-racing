p='src/rendering/renderer.ts'
s=open(p).read()
old="""/** T-cam lift above the authored pod socket and its downward gaze slope (P7). */"""
new="""/** Chase rig while the followed car stands in its pit box (pit phases 2-5, or
 * 1 and 6 below `speed` m/s): raised and pulled back over the crew, moved to
 * the lane side by `yawDeg` so the gaze crosses the car toward the garage (a
 * three-quarter pit-box view, pitched ~14 degrees down), eased in and out
 * with a `ease` s time constant of presented time. The normal chase put the
 * lens 0.8 m behind the rear-jack operator's helmet. */
export const CHASE_PIT = Object.freeze({
  height: 2.6,
  distance: 7.5,
  yawDeg: 18,
  lookAhead: 1.5,
  lookLift: 0.4,
  speed: 2,
  ease: 0.45,
});
/** T-cam lift above the authored pod socket and its downward gaze slope (P7). */"""
assert old in s; s=s.replace(old,new,1)
old="""  private chaseBasis = new T.Quaternion();"""
new="""  private chaseBasis = new T.Quaternion();
  /** 0..1 blend of the chase rig toward CHASE_PIT (eased in presented time). */
  private pitView = 0;
  private readonly pitPoint = trackPoint();
  private readonly pitSide = new T.Vector3();"""
assert old in s; s=s.replace(old,new,1)
old="""        this.desired
          .set(
            0,
            CHASE.height + speed * CHASE.heightPerMS,
            -CHASE.distance - speed * CHASE.distancePerMS,
          )
          .applyQuaternion(this.chaseBasis)
          .add(this.target);
        this.direction.set(0, 0, 1).applyQuaternion(this.chaseBasis);
        this.gaze.copy(this.target).addScaledVector(this.direction, CHASE.lookAhead);
        this.gaze.y += CHASE.lookLift;"""
new="""        // In the pit box the rig rises over the crew into a three-quarter view.
        const phase = presented[o + F.PIT_PHASE];
        const boxed =
          !bikeFollow &&
          ((phase >= 2 && phase <= 5) ||
            ((phase === 1 || phase === 6) && Math.abs(speed) < CHASE_PIT.speed));
        if (!this.initialized || menu || this.photo || pregame) this.pitView = boxed ? 1 : 0;
        else if (cameraDt > 0)
          this.pitView += ((boxed ? 1 : 0) - this.pitView) * -Math.expm1(-cameraDt / CHASE_PIT.ease);
        const pit = this.pitView * this.pitView * (3 - 2 * this.pitView);
        // Garage side in the chase frame (+1: the car's local +X).
        let garage = 0;
        if (pit > 0) {
          const track = this.circuit.track;
          track.nearest(this.target.x, this.target.z, this.pitPoint);
          this.pitSide.set(1, 0, 0).applyQuaternion(this.chaseBasis);
          garage =
            Math.sign(track.boxLateral()) *
              Math.sign(this.pitPoint.nx * this.pitSide.x + this.pitPoint.nz * this.pitSide.z) || 1;
        }
        const yaw = (pit * CHASE_PIT.yawDeg * Math.PI) / 180,
          height = T.MathUtils.lerp(CHASE.height + speed * CHASE.heightPerMS, CHASE_PIT.height, pit),
          distance = T.MathUtils.lerp(
            CHASE.distance + speed * CHASE.distancePerMS,
            CHASE_PIT.distance,
            pit,
          );
        this.desired
          .set(-garage * distance * Math.sin(yaw), height, -distance * Math.cos(yaw))
          .applyQuaternion(this.chaseBasis)
          .add(this.target);
        this.direction.set(0, 0, 1).applyQuaternion(this.chaseBasis);
        this.gaze
          .copy(this.target)
          .addScaledVector(this.direction, T.MathUtils.lerp(CHASE.lookAhead, CHASE_PIT.lookAhead, pit));
        this.gaze.y += T.MathUtils.lerp(CHASE.lookLift, CHASE_PIT.lookLift, pit);"""
assert old in s; s=s.replace(old,new,1)
open(p,'w').write(s)

p='src/rendering/crew-geometry.ts'
s=open(p).read()
old="""/** Closed tailored limb and chest shapes with identical topology. Instanced"""
new="""/** Role-coded kit over the team colour, so a pit crew does not read as one
 * mannequin army: wheel gunners in the full team colour, tyre carriers a
 * shade lower, jack operators toward charcoal, the release controller toward
 * a light grey, with a small per-person fabric variation (`actor`). Helmets
 * follow the role a little less. Shared cached Colors; do not mutate. */
export type CrewKitRole = 'gun' | 'remove' | 'install' | 'front-jack' | 'rear-jack' | 'release';
const ROLE_KIT: Readonly<Record<CrewKitRole, readonly [number, number, number]>> = Object.freeze({
  gun: [0x000000, 0, 1],
  remove: [0x000000, 0.14, 1],
  install: [0x000000, 0.08, 0.97],
  'front-jack': [0x2a2d31, 0.42, 1],
  'rear-jack': [0x2a2d31, 0.42, 1],
  release: [0x9aa0a6, 0.32, 1],
});
const roleKits = new Map<string, T.Color>();
export function crewRoleColour(car: number, role: CrewKitRole, actor = 0, helmet = false) {
  const id = Number.isInteger(car) && car >= 0 ? car : 0,
    person = Number.isInteger(actor) && actor >= 0 ? actor % 8 : 0;
  const key = `${id}:${role}:${person}:${helmet}`;
  let colour = roleKits.get(key);
  if (!colour) {
    const [mixHex, amount, gain] = ROLE_KIT[role];
    colour = crewTeamColour(id).clone();
    if (mixHex || amount) {
      const share = helmet ? amount * 0.6 : amount;
      if (mixHex) colour.lerp(new T.Color(mixHex), share);
      else colour.multiplyScalar(1 - share);
    }
    // Fabric lots and wear: +-5 % per person, deterministic.
    const jitter = helmet ? 1 : 0.95 + 0.1 * (((person * 37 + id * 11) % 8) / 7);
    colour.multiplyScalar(gain * jitter);
    roleKits.set(key, colour);
  }
  return colour;
}

/** Closed tailored limb and chest shapes with identical topology. Instanced"""
assert old in s; s=s.replace(old,new,1)
open(p,'w').write(s)

p='src/rendering/pit-crew.ts'
s=open(p).read()
old="""    cloth.setColorAt(
      cloth.count,
      // D23: every crew member wears the team's kit.
      crewTeamColour(car),
    );"""
new="""    cloth.setColorAt(
      cloth.count,
      // D23: every crew member wears the team's kit, role-coded.
      crewRoleColour(car, role, this.activeActors),
    );"""
assert old in s; s=s.replace(old,new,1)
old="""    this.heads.setColorAt(this.heads.count - 1, crewTeamColour(car));"""
new="""    this.heads.setColorAt(this.heads.count - 1, crewRoleColour(car, role, this.activeActors, true));"""
assert old in s; s=s.replace(old,new,1)
s=s.replace("import { crewTeamColour, installCrewHelmetFinish } from './crew-geometry.ts';","import { crewRoleColour, installCrewHelmetFinish } from './crew-geometry.ts';\nimport { installNearFade } from './crew-suit.ts';")
old="""    this.cloth = [makeCloth('crew_high', 0), makeCloth('crew_mid', 1)];"""
new="""    this.cloth = [makeCloth('crew_high', 0), makeCloth('crew_mid', 1)];
    // A lens inside the crew dissolves the nearest fabric instead of filling
    // the frame with a helmet (screen-door fade under 1.2 m of view depth).
    for (const batch of this.cloth) installNearFade(batch.material as T.Material);"""
assert old in s; s=s.replace(old,new,1)
old="""    this.gloves = [
      this.batch(crewPerformanceGeometry('glove', true), ACTORS, 0.85),
      this.batch(crewPerformanceGeometry('glove'), ACTORS, 0.85),
    ];"""
new="""    this.gloves = [
      this.batch(crewPerformanceGeometry('glove', true), ACTORS, 0.85),
      this.batch(crewPerformanceGeometry('glove'), ACTORS, 0.85),
    ];
    for (const batch of [this.heads, ...this.gloves]) installNearFade(batch.material as T.Material);"""
assert old in s; s=s.replace(old,new,1)
open(p,'w').write(s)
