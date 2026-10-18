# FH6 reference pass R4 round 2: town life, street density and integration fixes

Worker: agentI. Scope: the festival towns' street life (Port Ilse, Ashvale), parked cars and
meets, the hub crowd, and integration fixes over the merged round-1 work (headlight glare on
traffic, traffic body shapes, the temple site, leftover European kit and signs, spring petal
density). Sizes the photos cannot resolve are Japanese standards and are marked (std).

Modules:

- `src/rendering/open-world/headlight-beam.ts` — dipped-beam light pattern (projected map on the
  followed car's SpotLight; `festival-cars.ts` aims it along the lamp horizontal).
- `src/rendering/traffic-cars.ts` — rounded traffic bodies (`station`, `sectionRing`, `cap`,
  `band`, `lampLayout`) and `ParkedCars` (static instanced parked bodies sharing the traffic
  finish and plates).
- `src/rendering/open-world/town-life.ts` — `FestivalTownLife`: street kit (bicycles,
  bollards, guard fences, planters, cones, water barricades), junction signals and pedestrian
  signals, manhole covers, bus stops, phone booths, coin parks, night light pools.
- `src/rendering/open-world/parked-cars.ts` — `parkedSites`: store lots, coin parks, hub meet.
- `src/rendering/open-world/festival-crowd.ts` — `FestivalSpectators`: the game's authored
  crowd sculpts (crowd.ts / human-kit) standing on the festival crowd lines.
- `src/rendering/open-world/season-flora.ts` — per-surface petal/leaf drift (town, major).
- `src/simulation/open-world/region-data.ts` — the chapel landmark moved (temple site).
- `src/rendering/open-world/buildings.ts` (temple podium), `solvane-details.ts` (European
  shopfronts withdrawn), `horizon-dressing.ts` / `festival-signage.ts` (European names
  replaced; signage exports its lit fixtures as `lights` and `fixtures`).

LEDGER_TABLE

LEDGER_NUMBERS
