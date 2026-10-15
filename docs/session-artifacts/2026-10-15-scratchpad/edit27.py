import re
# --- registry.ts
p='src/career/registry.ts'
s=open(p).read()
def rep(old,new,count=1):
    global s
    assert s.count(old)>=1, old[:70]
    s=s.replace(old,new,count)
rep("""  /** Surveyed jumps (off-road venues), for the landing licence. Read through
   * `surveyedJumps`, which keeps only entries that declare the geometry. */
  jumps?: readonly unknown[];
}""","""  /** Surveyed jumps (off-road venues), for the landing licence. Read through
   * `surveyedJumps`, which keeps only entries that declare the geometry. */
  jumps?: readonly unknown[];
  /** Machine classes the venue admits (terrain venues: motorcycles at a
   * motocross track, cars at a rallycross or stage venue); absent: all. */
  classes?: readonly string[];
  /** Race formats the venue is built for (moto, rallycross, stage); a
   * ruleset with a format races only where the venue declares it. */
  formats?: readonly string[];
}""")
rep("""  classification: string;
  points: readonly number[];
}""","""  classification: string;
  points: readonly number[];
  /** Off-road format (gate motos, joker heats, timed stages), if any. */
  format?: { kind: string };
}""")
rep("""  'motocross',
  'supercross',
  'dirt-bike',
  'enduro',
]);""","""  'motocross',
  'supercross',
  'supermoto',
  'dirt-bike',
  'enduro',
]);""")
open(p,'w').write(s)

# --- ladder.ts
p='src/career/ladder.ts'
s=open(p).read()
rep("""  tier({
    id: 'rallycross',
    discipline: 'off-road',
    name: 'Rallycross',
    classes: ['rallycross', 'motocross', 'supercross', 'dirt-bike'],
    licences: [{ id: 'jump', medal: 'bronze' }],
    reputation: 0,
    championshipReputation: 8,
    payScale: 0.6,
    laps: 4,
  }),""","""  tier({
    id: 'motocross',
    discipline: 'off-road',
    name: 'Motocross and supercross',
    classes: ['motocross', 'supercross', 'supermoto', 'dirt-bike'],
    licences: [{ id: 'jump', medal: 'bronze' }],
    reputation: 0,
    championshipReputation: 8,
    payScale: 0.6,
    laps: 4,
  }),
  tier({
    id: 'rallycross',
    discipline: 'off-road',
    name: 'Rallycross',
    classes: ['rallycross'],
    licences: [{ id: 'jump', medal: 'bronze' }],
    reputation: 10,
    championshipReputation: 20,
    payScale: 0.8,
    laps: 4,
  }),""")
rep("""  motocross: 18000,
  rallycross: 52000,""","""  motocross: 18000,
  supermoto: 21000,
  rallycross: 52000,""")
rep("""/** Build an event definition for `player` at a venue; null with a reason
 * when no ruleset can run it. */""","""/** Does a venue admit a machine class? (Terrain venues name theirs.) */
export function venueTakes(venue: Pick<CareerVenue, 'classes'>, classId: string) {
  return !venue.classes || venue.classes.includes(classId);
}
/** Rulesets for a class at a venue: one with a format only where the venue
 * is built for it, and the venue's own formats first. */
function venueRulesets(
  registry: CareerRegistry,
  classId: string,
  mode: string,
  venue: CareerVenue | undefined,
) {
  const formats = venue?.formats ?? [];
  return rulesetsFor(registry, classId, mode)
    .filter((r) => !r.format || formats.includes(r.format.kind))
    .sort((a, b) => Number(!!b.format) - Number(!!a.format));
}
/** Build an event definition for `player` at a venue; null with a reason
 * when no ruleset can run it. */""")
rep("""  const rules =
    rulesetsFor(registry, spec.player.classId, spec.mode)[0] ??
    // A solo licence session may run under a race ruleset when no practice one admits the class.
    (spec.mode === 'practice' ? rulesetsFor(registry, spec.player.classId, 'race')[0] : undefined);""","""  const venue = registry.venues.find((v) => v.id === spec.venue);
  if (venue && !venueTakes(venue, spec.player.classId))
    return {
      definition: null,
      reason: `${venue.short ?? venue.name} does not admit ${spec.player.classId} machines.`,
    };
  const rules =
    venueRulesets(registry, spec.player.classId, spec.mode, venue)[0] ??
    // A solo licence session may run under a race ruleset when no practice one admits the class.
    (spec.mode === 'practice'
      ? venueRulesets(registry, spec.player.classId, 'race', venue)[0]
      : undefined);""")
rep("""  {
    const venue = venues[0];
    const built =""","""  {
    const venue = venues.find((v) => !loaner || venueTakes(v, loaner.classId)) ?? venues[0];
    const built =""")
rep("""  tiers.forEach((t, tierIndex) => {
    const machines = tierVehicles(registry, t);""","""  tiers.forEach((t, tierIndex) => {
    const machines = tierVehicles(registry, t);
    // A tier races where its classes are admitted (terrain venues name theirs).
    const venues = status.venues.filter((v) => t.classes.some((c) => venueTakes(v, c)));""")
rep("""  const venue =
    test.needs === 'jump' ? status.venues.find((v) => surveyedJumps(v).length) : status.venues[0];
  if (!venue && test.needs === 'jump' && status.venues.length)
    reasons.push(
      'No venue declares a surveyed jump (take-off, landing position and landing slope) yet.',
    );
  const owned = disciplineVehicles(registry, test.discipline).filter((v) =>
    view.owned.some((o) => o.id === v.id),
  );
  const active = view.active[test.discipline];
  const mine = owned.find((v) => v.id === active) ?? owned[0] ?? null;
  const machine = mine ?? loanerVehicle(registry, test.discipline);""","""  const owned = disciplineVehicles(registry, test.discipline).filter((v) =>
    view.owned.some((o) => o.id === v.id),
  );
  const active = view.active[test.discipline];
  const mine = owned.find((v) => v.id === active) ?? owned[0] ?? null;
  const machine = mine ?? loanerVehicle(registry, test.discipline);
  // A venue that suits the test and admits the machine (else any that suits).
  const suits = (v: CareerVenue) => test.needs !== 'jump' || surveyedJumps(v).length > 0;
  const venue =
    status.venues.find((v) => suits(v) && (!machine || venueTakes(v, machine.classId))) ??
    status.venues.find(suits);
  if (!venue && test.needs === 'jump' && status.venues.length)
    reasons.push(
      'No venue declares a surveyed jump (take-off, landing position and landing slope) yet.',
    );""")
open(p,'w').write(s)
