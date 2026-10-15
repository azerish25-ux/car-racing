import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')


def rep(p, old, new, count=1):
    s = open(p).read()
    assert s.count(old) == count, (p, old, s.count(old))
    s = s.replace(old, new)
    open(p, 'w').write(s)


v = 'src/simulation/content-validation.ts'
rep(v, """import { VEHICLES, type VehicleDefinition } from './vehicles.ts';""",
    """import { VEHICLES, type VehicleDefinition } from './vehicles.ts';
import { TIRE_FAMILIES } from './tire-families.ts';
import type { DifferentialSpec } from './differential.ts';""")
rep(v, """    e.push(`${at}: AI aero terms need a downforce reference (and vice versa)`);
  return e;
}""", """    e.push(`${at}: AI aero terms need a downforce reference (and vice versa)`);
  e.push(...validateCatalogueFields(def));
  return e;
}
/** Driveline, tyre family, power unit and setup baseline (catalogue fields). */
function validateCatalogueFields(def: VehicleDefinition): string[] {
  const e: string[] = [],
    at = `vehicle ${def.id}`;
  const diff = (d: DifferentialSpec | undefined, name: string) => {
    if (!d) return;
    if (!['open', 'lsd', 'locked'].includes(d.type)) e.push(`${at}: ${name} type ${d.type}`);
    if (!inRange(d.preload, 0, 2000)) e.push(`${at}: ${name} preload outside 0-2000 N m`);
    if (!inRange(d.power, 0, 1) || !inRange(d.coast, 0, 1))
      e.push(`${at}: ${name} ramp ratios must be in 0-1`);
  };
  const line = def.driveline;
  if (line) {
    diff(line.front, 'front differential');
    diff(line.rear, 'rear differential');
    diff(line.centre, 'centre differential');
    if (line.centre && !inRange(line.centre.frontShare, 0.05, 0.95))
      e.push(`${at}: centre frontShare outside 0.05-0.95`);
    if (def.drivetrain === 'awd' && !line.centre) e.push(`${at}: awd needs a centre differential`);
    if (def.drivetrain !== 'awd' && line.centre) e.push(`${at}: centre differential without awd`);
  } else if (def.drivetrain === 'awd') e.push(`${at}: awd needs a driveline`);
  if (def.hybridAxle) {
    if (!def.hybrid) e.push(`${at}: an axle motor needs the hybrid flag`);
    if (!line) e.push(`${at}: an axle motor needs a driveline`);
    if (!inRange(def.hybridAxle.minSpeed, 0, 100)) e.push(`${at}: axle motor speed outside 0-100 m/s`);
  }
  if (def.tireFamily) {
    const family = TIRE_FAMILIES[def.tireFamily];
    if (!family) e.push(`${at}: unknown tyre family ${def.tireFamily}`);
    else
      for (const [name, grip] of [
        ['tireGrip', def.tireGrip],
        ['tireGripRear', def.tireGripRear ?? def.tireGrip],
      ] as const)
        if (!inRange(grip, family.grip[0], family.grip[1] * 1.2))
          e.push(`${at}: ${name} ${grip} outside the ${family.name} range`);
  }
  const engine = def.spec.engine;
  if (engine) {
    if (!inRange(engine.inertia, 0.001, 2)) e.push(`${at}: engine inertia outside 0.001-2 kg m²`);
    if (!inRange(engine.clutchCapacity, 10, 5000)) e.push(`${at}: clutch capacity outside 10-5000 N m`);
    if (!inRange(engine.frictionBase, 0, 200) || !inRange(engine.frictionPerRad, 0, 1))
      e.push(`${at}: engine friction out of range`);
    const peak = Math.max(...def.spec.torqueCurve.map((p) => p[1]));
    if (peak > engine.clutchCapacity * 1.6) e.push(`${at}: clutch capacity far below peak torque`);
  }
  if (def.restHeight !== undefined && !inRange(def.restHeight, 0.1, 2))
    e.push(`${at}: restHeight outside 0.1-2 m`);
  if (def.fuelLoad !== undefined && !inRange(def.fuelLoad, 0, 200))
    e.push(`${at}: fuelLoad outside 0-200 kg`);
  for (const [key, value] of Object.entries(def.setupDefaults ?? {})) {
    if (!Object.hasOwn(SETUP_LIMITS, key)) e.push(`${at}: unknown setup default ${key}`);
    else if (!finite(value)) e.push(`${at}: setup default ${key} not finite`);
  }
  for (const [key, limit] of Object.entries(def.setupLimits ?? {})) {
    const global = SETUP_LIMITS[key as keyof typeof SETUP_LIMITS];
    if (!global) e.push(`${at}: unknown setup limit ${key}`);
    else if (!limit || !(limit[0] <= limit[1]) || limit[0] < global[0] || limit[1] > global[1])
      e.push(`${at}: setup limit ${key} must lie within ${global[0]}-${global[1]}`);
  }
  return e;
}""")
