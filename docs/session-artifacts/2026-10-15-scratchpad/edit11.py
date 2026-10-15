p='src/simulation/offroad/dirt-bikes.ts'
s=open(p).read()
old="  crashEnergy: 1800,"
assert old in s
s=s.replace(old,"  // Bar-to-bar contact and soft tyre walls are part of racing in the dirt.\n  crashEnergy: 3200,")
open(p,'w').write(s)

p='src/simulation/offroad/dirt-bike-vehicle.ts'
s=open(p).read()
old="""    if (r.outcome === 'clean' && r.airTime > 0.12) {"""
new="""    // A hop at rolling pace (over a sharp crest, down a backside) is ridden
    // out: pitch decides only a real jump or a hard touchdown.
    const real = r.takeoffSpeed > ROLLING_HOP || r.normalSpeed > 3.5;
    if (r.outcome === 'clean' && r.airTime > 0.12 && real) {"""
assert old in s; s=s.replace(old,new)
old="""/** Nose-up margin (rad) the pitch aid aims for over the landing slope. */"""
new="""/** Take-off speed (m/s) below which a flight is a rolling hop. */
const ROLLING_HOP = 6.5;
/** Nose-up margin (rad) the pitch aid aims for over the landing slope. */"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
