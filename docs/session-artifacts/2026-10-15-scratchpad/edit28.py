p='src/simulation/offroad/venues.ts'
s=open(p).read()
old="""  return Object.freeze({
    ...circuit,
    offroad,
    jumps: Object.freeze(built.jumps.map((j: JumpSurvey) => Object.freeze({ ...j }))),
  });"""
new="""  const bikes = kind === 'motocross' || kind === 'supercross';
  return Object.freeze({
    ...circuit,
    offroad,
    jumps: Object.freeze(built.jumps.map((j: JumpSurvey) => Object.freeze({ ...j }))),
    // What races here (career/registry.ts reads these).
    classes: bikes ? OFFROAD_CLASSES.bikes : OFFROAD_CLASSES.cars,
    formats: Object.freeze([bikes ? 'moto' : kind === 'rallycross' ? 'rallycross' : 'stage']),
  });"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
p='src/simulation/circuits.ts'
s=open(p).read()
old="""  /** Surveyed jumps (terrain venues) for the landing licence (career/registry.ts). */
  jumps?: readonly unknown[];
}"""
new="""  /** Surveyed jumps (terrain venues) for the landing licence (career/registry.ts). */
  jumps?: readonly unknown[];
  /** Terrain venues: the machine classes admitted and the formats raced. */
  classes?: readonly string[];
  formats?: readonly string[];
}"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
p='src/simulation/offroad/dirt-bikes.ts'
s=open(p).read()
old="""  cgHeight: 0.85,
  cgToFront: 0.74,
  cgToRear: 0.73,"""
new="""  cgHeight: 0.85,
  cgToFront: 0.75,
  cgToRear: 0.73,"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
