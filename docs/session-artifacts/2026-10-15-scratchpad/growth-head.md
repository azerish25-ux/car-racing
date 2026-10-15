
**Catalogue growth (WP30, 35 machines; 54 registered with the 19 above).** Thirty-one cars are
appended to `CATALOGUE` from physical target sheets in `vehicle-catalogue/` (`single-seaters.ts`,
`prototypes.ts`, `gt-layouts.ts`, `touring-club-2.ts`, `dirt-2.ts`, `experimental.ts`,
`road-festival.ts`) and four road motorcycles to `BIKE_ADDITIONS` (`bike-definitions.ts`),
registered after the catalogue so every existing snapshot index and content hash is unchanged
(the 19 earlier hashes are pinned by `tests/vehicle-catalogue-growth.test.ts`). Dirt bikes and
supermoto belong to the off-road programme and are not part of this list. New classes:
`formula-feeder`, `formula-entry`, `historic-aero` (1970s), `historic-turbo` (1980s),
`historic-prototype`, `vintage`, `historic-rally`, `experimental`, `supersport`, `classic-bike`
and the open-world `road-bike` (no race ruleset, like `road`). New rulesets: feeder-formula sprint
(DRS where the car has it), heritage sprint (one historic class per grid), historic masters (three
single-seater eras on one road, scored per class), historic-rally heat, unlimited showcase and the
motorcycle class sprint. Every machine of a racing class enters at least one built-in event (22
new events, including the first events for JF-2, RL-2 and SBK-1000). One solver addition: the
fan-assisted floor of XF-2 (`VehicleDefinition.fan`, PHYSICS_MODEL.md §4), present on no other
definition; and one new tyre family, the 1970s–80s historic slick (grip 0.68–0.90).

Bands were written with each brief before the first measurement and none was changed afterwards;
where a first measurement fell outside, the definition moved (gearing, low-rpm torque, tyre grip
or stagger, brake capacity, mass), never the band. The brief's "about" figures are design intent;
the bands are the acceptance criteria. Measured at 1/240 s (`docs/vehicle-calibration.json`; every
value inside its band at 1/120 s as well, largest timestep drift 0.24 %):

| Machine | Class | Drive (diff) | 0–100 s | Top km/h | 100–0 m | g @ 80 | Sound family |
|---|---|---|---:|---:|---:|---:|---|
