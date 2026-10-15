p = 'src/ui/bike-machines.ts'
s = open(p).read()
pairs = [
    ("""import { VEHICLES } from '../simulation/vehicles.ts';
""", """import { VEHICLES } from '../simulation/vehicles.ts';
import { isDirtBike } from '../simulation/offroad/dirt-bikes.ts';
"""),
(""" * is enforced by sessionIncompatibilities, not by this menu. */""",
 """ * is enforced by sessionIncompatibilities, not by this menu. Off-road
 * motorcycles have their own group and moto rules (machine-options.ts). */"""),
("""    vehiclesByClass(Object.values(VEHICLES).filter((v) => v.dynamicsKind === 'bike'))""",
 """    vehiclesByClass(
      Object.values(VEHICLES).filter((v) => v.dynamicsKind === 'bike' && !isDirtBike(v)),
    )"""),
]
for a, b in pairs:
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)
open(p, 'w').write(s)
