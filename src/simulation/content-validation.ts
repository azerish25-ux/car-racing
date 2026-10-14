import { CIRCUITS, STANDARD_PIT, type CircuitDefinition } from './circuits.ts';
import { DEFAULT_OPTIONS, SETUP_LIMITS } from './config.ts';
import { EVENTS, RULESETS, eventSession } from './events.ts';
import { VEHICLES, type VehicleDefinition } from './vehicles.ts';

/** Content contracts (WP14, masterplan §6.3/§14.4): every definition is
 * checked at build time with explicit units and bounds, and each failure says
 * what is wrong and where. A data-driven game without validation merely
 * relocates bugs from TypeScript into content files. */
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inRange = (v: unknown, lo: number, hi: number) => finite(v) && v >= lo && v <= hi;

export function validateVehicleDefinition(def: VehicleDefinition): string[] {
  const e: string[] = [],
    at = `vehicle ${def.id}`,
    s = def.spec;
  if (!/^[a-z0-9-]{2,32}$/.test(def.id)) e.push(`${at}: id must be 2-32 lowercase characters`);
  if (!Number.isInteger(def.version) || def.version < 1) e.push(`${at}: version must be >= 1`);
  if (!inRange(s.dryMass, 50, 4000)) e.push(`${at}: dryMass ${s.dryMass} kg outside 50-4000`);
  if (s.inertia.length !== 3 || !s.inertia.every((v) => inRange(v, 1, 20000)))
    e.push(`${at}: inertia must be three values in 1-20000 kg m²`);
  if (!inRange(s.wheelRadius, 0.1, 0.6)) e.push(`${at}: wheelRadius outside 0.1-0.6 m`);
  if (!inRange(s.wheelInertia, 0.05, 10)) e.push(`${at}: wheelInertia outside 0.05-10 kg m²`);
  if (!inRange(s.maxSteer, 0.05, 0.8)) e.push(`${at}: maxSteer outside 0.05-0.8 rad`);
  if (def.wheelPositions.length !== 4) e.push(`${at}: four wheel positions required`);
  else {
    const [fr, fl, rr, rl] = def.wheelPositions;
    if (!(fr[2] > rr[2] && fl[2] > rl[2])) e.push(`${at}: front wheels must be ahead of rear (+Z)`);
    if (!(fr[0] < 0 && fl[0] > 0 && rr[0] < 0 && rl[0] > 0))
      e.push(`${at}: wheel order is FR(-X), FL(+X), RR(-X), RL(+X)`);
    const wheelbase = fr[2] - rr[2];
    if (Math.abs(wheelbase - s.wheelbase) > 0.05)
      e.push(
        `${at}: wheel positions give ${wheelbase.toFixed(2)} m, spec wheelbase ${s.wheelbase} m`,
      );
  }
  const g = s.gearRatios;
  if (g.length < 3 || !(g[0] < 0) || g[1] !== 0)
    e.push(`${at}: gearRatios must be [reverse<0, 0, forward...]`);
  for (let i = 3; i < g.length; i++)
    if (!(g[i] > 0 && g[i] < g[i - 1]))
      e.push(`${at}: forward gear ${i - 1} must be shorter than ${i - 2}`);
  if (!(s.idleRPM < s.downshiftRPM && s.downshiftRPM < s.shiftRPM && s.shiftRPM <= s.limiterRPM))
    e.push(`${at}: require idle < downshift < shift <= limiter RPM`);
  const curve = s.torqueCurve;
  if (curve.length < 2) e.push(`${at}: torque curve needs two points`);
  for (let i = 0; i < curve.length; i++) {
    if (!(curve[i][1] > 0)) e.push(`${at}: torque at ${curve[i][0]} rpm must be positive`);
    if (i && !(curve[i][0] > curve[i - 1][0])) e.push(`${at}: torque curve rpm must increase`);
  }
  if (def.hybrid !== (s.motorPowerW > 0 && s.maxBatteryJ > 0))
    e.push(`${at}: hybrid flag disagrees with motor power/battery`);
  if (!def.hybrid && (s.motorPowerW !== 0 || s.regenPowerW !== 0 || s.maxBatteryJ !== 0))
    e.push(`${at}: a non-hybrid has no motor, regeneration or stored energy`);
  if (!inRange(def.tireGrip, 0.3, 1.5)) e.push(`${at}: tireGrip outside 0.3-1.5`);
  if (!inRange(def.aero.downforce, 0, 2) || !inRange(def.aero.drag, 0.1, 3))
    e.push(`${at}: aero scale outside downforce 0-2 / drag 0.1-3`);
  if (!def.halfExtents.every((v) => inRange(v, 0.1, 4)))
    e.push(`${at}: halfExtents outside 0.1-4 m`);
  for (const key of def.setupKeys)
    if (!Object.hasOwn(SETUP_LIMITS, key)) e.push(`${at}: unknown setup key ${key}`);
  if (!def.setupKeys.includes('frontWing') && def.aero.downforce > 0.5)
    e.push(`${at}: a high-downforce car must expose its wings`);
  const ai = def.ai;
  for (const key of ['lateralBase', 'brakingBase', 'topSpeed', 'referenceMu'] as const)
    if (!inRange(ai[key], 0.1, 500)) e.push(`${at}: ai.${key} must be positive`);
  for (const key of ['lateralMargin', 'slowLateralMargin', 'brakingMargin'] as const)
    if (!inRange(ai[key], 0.1, 1)) e.push(`${at}: ai.${key} must be in 0.1-1`);
  if ((ai.lateralAero > 0 || ai.brakingAero > 0) !== ai.downforceReference > 0)
    e.push(`${at}: AI aero terms need a downforce reference (and vice versa)`);
  return e;
}
export function validateCircuitDefinition(def: CircuitDefinition): string[] {
  const e: string[] = [],
    at = `circuit ${def.id}${def.short ? ` (${def.short})` : ''}`;
  if (def.design.length < 8 || def.design.length > 512) e.push(`${at}: 8-512 control points`);
  def.design.forEach(([x, z], i) => {
    if (!finite(x) || !finite(z) || Math.abs(x) > 1e5 || Math.abs(z) > 1e5)
      e.push(`${at}: control point ${i} is not finite/in range`);
    const [px, pz] = def.design[(i + def.design.length - 1) % def.design.length];
    if (Math.hypot(x - px, z - pz) < 1) e.push(`${at}: control points ${i - 1} and ${i} coincide`);
  });
  for (let i = 0; i < 64; i++) {
    const u = i / 64;
    if (!inRange(def.halfWidth(u), 4, 20)) e.push(`${at}: half-width at u=${u} outside 4-20 m`);
    if (!finite(def.elevation(u, false))) e.push(`${at}: elevation at u=${u} not finite`);
    if (!finite(def.crossFall(u, false)) || !finite(def.bankGain(u)))
      e.push(`${at}: banking profile at u=${u} not finite`);
  }
  if (!inRange(def.maxBank, 0, 0.3)) e.push(`${at}: maxBank outside 0-0.3 rad`);
  const p = def.pit ?? STANDARD_PIT;
  if (p.side !== 1 && p.side !== -1) e.push(`${at}: pit side must be 1 or -1`);
  if (!(p.divergeEnd < p.divergeStart))
    e.push(`${at}: pit lane must diverge before it is parallel`);
  if (!(p.mergeStart < p.mergeEnd)) e.push(`${at}: pit merge must end after it starts`);
  if (!(p.limitAfter <= p.mergeStart + 20 && p.limitBefore <= p.divergeStart))
    e.push(`${at}: speed limit zone must lie inside the pit lane`);
  if (!(p.firstBox > 0 && p.firstBox + 11 * p.boxSpacing < p.mergeStart))
    e.push(`${at}: twelve garage boxes must fit before the merge`);
  if (!(Math.abs(p.boxLateral - p.offset) < 4)) e.push(`${at}: boxes must sit beside the lane`);
  if (!(p.entry < p.divergeStart && p.entry > p.divergeEnd))
    e.push(`${at}: pit entry line must be on the diverging section`);
  if (!(p.holdLine > p.limitAfter && p.holdLine < p.mergeEnd))
    e.push(`${at}: release hold line must be between the limit end and merge end`);
  for (const zone of def.drsZones)
    if (![zone.detect, zone.start, zone.end].every(finite)) e.push(`${at}: DRS zone not finite`);
  return e;
}
/** Validate every registry entry and cross-reference; empty means valid. */
export function validateContent(): string[] {
  const errors: string[] = [];
  for (const def of Object.values(VEHICLES)) errors.push(...validateVehicleDefinition(def));
  for (const def of Object.values(CIRCUITS)) errors.push(...validateCircuitDefinition(def));
  const classes = new Set(Object.values(VEHICLES).map((v) => v.classId));
  for (const rules of Object.values(RULESETS))
    for (const cls of rules.allowedClasses)
      if (!classes.has(cls))
        errors.push(`ruleset ${rules.id}: no registered vehicle of class ${cls}`);
  const ids = new Set<string>();
  for (const event of EVENTS) {
    if (ids.has(event.id)) errors.push(`event ${event.id}: duplicate id`);
    ids.add(event.id);
    try {
      eventSession(event, DEFAULT_OPTIONS);
    } catch (error) {
      errors.push(`event ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}
