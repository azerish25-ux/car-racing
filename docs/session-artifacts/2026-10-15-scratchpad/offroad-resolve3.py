p='src/simulation/events.ts'
s=open(p).read()
old="""<<<<<<< HEAD
/** Every class a practice, qualifying or time-trial session admits. */
const SOLO_CLASSES: readonly VehicleClass[] = Object.freeze([
  ...ALL_CLASSES,
  ...BIKE_CLASSES,
  ...OFFROAD_CLASSES.bikes,
]);
=======
const ALL_BIKE_CLASSES: readonly VehicleClass[] = Object.freeze([
  ...BIKE_CLASSES,
  'supersport',
  'classic-bike',
  'road-bike',
] as const);
>>>>>>> claude/peaceful-einstein-dedc7t
"""
new="""const ALL_BIKE_CLASSES: readonly VehicleClass[] = Object.freeze([
  ...BIKE_CLASSES,
  'supersport',
  'classic-bike',
  'road-bike',
] as const);
/** Every class a practice, qualifying or time-trial session admits. */
const SOLO_CLASSES: readonly VehicleClass[] = Object.freeze([
  ...ALL_CLASSES,
  ...ALL_BIKE_CLASSES,
  ...OFFROAD_CLASSES.bikes,
]);
"""
assert s.count(old)==1; s=s.replace(old,new)
old="""<<<<<<< HEAD
    allowedClasses: SOLO_CLASSES,
=======
    allowedClasses: Object.freeze([...ALL_CLASSES, ...ALL_BIKE_CLASSES]),
>>>>>>> claude/peaceful-einstein-dedc7t
"""
assert s.count(old)==3; s=s.replace(old,"""    allowedClasses: SOLO_CLASSES,
""")
assert '<<<<<<<' not in s and '>>>>>>>' not in s
open(p,'w').write(s)
