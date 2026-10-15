import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')


def rep(p, old, new, count=1):
    s = open(p).read()
    assert s.count(old) == count, (p, old, s.count(old))
    s = s.replace(old, new)
    open(p, 'w').write(s)


rep('src/simulation/vehicle.ts', """    this.body.mass = spec.dryMass + this.fuel;""",
    """    if (definition.fuelLoad !== undefined) this.fuel = definition.fuelLoad;
    this.body.mass = spec.dryMass + this.fuel;""")
rep('src/simulation/vehicles.ts', """  /** Body-origin height above the road when placed (m); absent: 0.516. */
  restHeight?: number;""", """  /** Body-origin height above the road when placed (m); absent: 0.516. */
  restHeight?: number;
  /** Fuel (kg) aboard at the start of a sprint session; absent: 24. */
  fuelLoad?: number;""")
b = 'src/simulation/vehicle-catalogue/builder.ts'
rep(b, """  /** Detachable front/rear element masses (kg): wings, splitters, bumpers. */""",
    """  /** Sprint fuel load (kg); absent: the shared 24 kg. */
  fuelLoad?: number;
  /** Detachable front/rear element masses (kg): wings, splitters, bumpers. */""")
rep(b, """    loaded = (sheet.mass + BASELINE.fuel) * G,""", """    fuel = sheet.fuelLoad ?? BASELINE.fuel,
    loaded = (sheet.mass + fuel) * G,""")
rep(b, """      sheet.ai.lateralAero > 0 || sheet.ai.brakingAero > 0 ? sheet.mass + BASELINE.fuel : 0,""",
    """      sheet.ai.lateralAero > 0 || sheet.ai.brakingAero > 0 ? sheet.mass + fuel : 0,""")
rep(b, """    restHeight: round(sheet.cogHeight + 0.01, 3),""", """    restHeight: round(sheet.cogHeight + 0.01, 3),
    ...(sheet.fuelLoad !== undefined ? { fuelLoad: sheet.fuelLoad } : {}),""")
k = 'src/simulation/vehicle-catalogue/small-road.ts'
rep(k, """  torqueCurve: [
    [6000, 12],
    [9000, 19],
    [11000, 24],
    [12500, 25],
    [13500, 23.3],
    [14500, 19],
  ],""", """  torqueCurve: [
    [6000, 13],
    [9000, 21],
    [11000, 26],
    [12500, 27],
    [13500, 25.5],
    [14500, 21],
  ],
  fuelLoad: 6,""")
rep(k, """'Gearbox kart: 125 cc two-stroke, 33 kW at 13 500 rpm""", """'Gearbox kart: 125 cc two-stroke, 36 kW at 13 500 rpm""")
# supercar traction
s = open(k).read()
i = s.index("id: 'sc7'")
head, tail = s[:i], s[i:]
tail = tail.replace("  linkCentreHeight: 0.22,", "  linkCentreHeight: 0.18,", 1)
tail = tail.replace("  tireGrip: 0.78,", "  tireGrip: 0.8,", 1)
tail = tail.replace("    accel0to100: [2.6, 3.8],", "    // Rear-drive launch without launch control on road tyres.\n    accel0to100: [2.6, 4.0],", 1)
open(k, 'w').write(head + tail)
g = 'src/simulation/vehicle-catalogue/gt.ts'
s = open(g).read()
s = s.replace("""  bands: {
    accel0to100: [3.0, 4.2],
    topSpeed: [265, 300],
    braking100Distance: [26, 38],
    lateral80G: [1.3, 1.75],
  },""", """  bands: GT_BANDS,""")
s = s.replace("""export const GT_FRONT_V8""", """/** Slick-shod top GTs stop from 100 km/h at about 1.5-1.6 g (24-27 m). */
const GT_BANDS = {
  accel0to100: [3.0, 4.2],
  topSpeed: [265, 300],
  braking100Distance: [24, 36],
  lateral80G: [1.3, 1.75],
} as const;
export const GT_FRONT_V8""", 1)
i = s.index("id: 'gs4'")
s = s[:i] + s[i:].replace("  tireGrip: 0.82,", "  tireGrip: 0.8,", 1)
open(g, 'w').write(s)
t = 'src/simulation/vehicle-catalogue/touring-club.ts'
s = open(t).read()
i = s.index("id: 'cr1'")
s = s[:i] + s[i:].replace("  tireGrip: 0.76,", "  tireGrip: 0.74,", 1)
open(t, 'w').write(s)
