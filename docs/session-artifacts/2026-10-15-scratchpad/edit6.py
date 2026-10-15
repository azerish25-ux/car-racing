p='src/simulation/offroad/dirt-bike-vehicle.ts'
s=open(p).read()
old="""    const surface = Math.min(this.surfaceGrip(0), this.surfaceGrip(2));
    d.grip = surface * this.loadGrip * this.bankSupport(surface);"""
new="""    // Smoothed: a hop or a rut edge does not change the rider's lean budget
    // within one step (the core's lean aid assumes a slowly varying grip).
    const surface = Math.min(this.surfaceGrip(0), this.surfaceGrip(2)),
      target = surface * clamp(this.loadGrip, 0.85, 1.15) * this.bankSupport(surface);
    this.smoothGrip = this.smoothGrip > 0 ? this.smoothGrip + (target - this.smoothGrip) * Math.min(1, dt / 0.35) : target;
    d.grip = this.smoothGrip;"""
assert old in s
s=s.replace(old,new)
s=s.replace("""  private loadGrip = 1;""","""  private loadGrip = 1;
  private smoothGrip = 0;""")
old="""        // A foot down props the lean in slow, tight corners.
        if (Math.abs(this.dab) > 0.5) {
          const limit = this.air.dabLean + 0.12;
          if (Math.abs(d.lean) > limit) {
            d.lean = Math.sign(d.lean) * limit;
            d.leanRate *= 0.5;
          }
        }"""
new="""        // A foot down props the lean in slow, tight corners.
        if (Math.abs(this.dab) > 0.5) {
          const limit = this.air.dabLean + 0.12;
          if (Math.abs(d.lean) > limit) {
            d.lean = Math.sign(d.lean) * limit;
            d.leanRate *= 0.5;
          }
        }
        // Over-leaned on loose ground the rear steps out and stands the bike
        // up (a slide, not a fall): the lean beyond the aid's limit is bled off.
        const over = Math.abs(d.lean) - (d.leanLimit + 0.12);
        if (over > 0 && Math.sign(d.leanRate) === Math.sign(d.lean)) {
          d.leanRate *= Math.exp(-12 * dt);
          d.lean -= Math.sign(d.lean) * Math.min(over, 0.6 * dt);
          d.speed = Math.max(0, d.speed - 1.5 * dt);
        }"""
assert old in s
s=s.replace(old,new)
open(p,'w').write(s)
p='src/simulation/offroad/dirt-bikes.ts'
s=open(p).read()
s=s.replace("""  ai: bikeEnvelope(MX450, 1.48, 104 + 75 + 5.5, 34),""","""  ai: dirtEnvelope(MX450, 1.48, 104 + 75 + 5.5, 34),""")
s=s.replace("""  ai: bikeEnvelope(MX250, 1.48, 97 + 75 + 6, 33),""","""  ai: dirtEnvelope(MX250, 1.48, 97 + 75 + 6, 33),""")
s=s.replace("""  ai: bikeEnvelope(SM450, 1.45, 108 + 75 + 6, 41),""","""  ai: dirtEnvelope(SM450, 1.45, 108 + 75 + 6, 41),""")
s=s.replace("""const stations = Object.freeze({""","""/** The road-bike envelope with off-road margins: loose ground, hops over
 * rollers (no braking in the air) and berms ask for earlier braking. */
function dirtEnvelope(b: BikeSpec, wheelbase: number, mass: number, top: number) {
  return Object.freeze({
    ...bikeEnvelope(b, wheelbase, mass, top),
    brakingMargin: 0.5,
    lateralMargin: 0.8,
    slowLateralMargin: 0.74,
  });
}
const stations = Object.freeze({""")
open(p,'w').write(s)
