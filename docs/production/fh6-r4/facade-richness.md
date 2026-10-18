# FH6 reference pass R4 round 3: facade richness and urban density

Worker: agentM. Scope: the building facades and street density of Port Ilse (city) and
Ashvale (village): facade materials and glazing, signage density, skyline massing and
village plot dressing. Sizes the photos cannot resolve are Japanese standards and are
marked (std).

Modules:

- `src/rendering/open-world/facade-richness.ts` (new) — GLSL the district facade material
  calls: `owCityPane` (interior-mapped rooms, coverings, joinery, glass tint),
  `owRoom` (box-room trace: back wall with shelving/counter/racks/furniture, floor,
  ceiling with light panel, side walls), `owNeighbour` + `URBAN_REFLECTION_GLSL`
  (street-canyon reflections in city glass), `owCityWall` (large tile, precast panels,
  composite panels, rain streaks), `owFrosted` (balcony glass).
- `src/rendering/open-world/buildings.ts` — city buildings at their visual height,
  facade skins (punched / ribbon / curtain wall), frosted balconies, side-wall services
  (`Buildings.services`), roof railings, engawa on minka (`Buildings.engawa`), shinkabe
  timber lines on village plaster; `rich` uniform (LOW keeps the cheap glass).
- `src/rendering/open-world/facade-layout.ts` — `ribbon` / `curtain` variants (one band
  per floor in lites), office finishes (`WALL_FINISH.largeTile/precast/panel`, codes 7-9),
  pane tags and wall-height packing (`RecessOptions.paneTag`, `wallTop`).
- `src/rendering/open-world/japan-architecture.ts` — `extraFloors` (visual storeys on
  the collider footprint), `skin`, `visualStructure`, `SKIN`.
- `src/rendering/open-world/festival-signage.ts` — tenant-box columns, more projecting
  signs per frontage, flat lit boards, side-wall billboards, stand signs, LED screens,
  village gardens (boundaries, gates, toro, shrubs, stepping stones, pots, inuyarai,
  benches); new atlas regions (64 tenant tiles, bamboo, hedge, stones).
- `src/rendering/open-world/led-screens.ts` (new) — `LedScreens`: merged animated LED
  faces (one draw, original abstract loops).

| Ref | Measured observation                                                                                                                                                                                                                                                                                                                                                                   | What was implemented (file / symbol)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Remaining gap                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 012 | Harbour house: wall AC condenser ≈0.8 × 0.55 m on a bracket with its pipe run, downpipe, roller shutter, bicycle; blue-grey siding over a brick-tile dado.                                                                                                                                                                                                                             | Every city building gets a service side wall (`Buildings.services`): 100 mm drain and 50 mm gas riser near the rear corner, AC condensers on brackets at ~45 % of the floors with refrigerant lines back to the riser, a meter cabinet pair at street level. Shopfronts show closed (13 %) or half-open roller shutters (7 %, bottom 0.9-1.5 m) with 80 mm corrugation (`owCityPane`).                                                                                                                                                                                                      | No brick-tile dado band on the single-storey harbour houses.                                                              |
| 013 | Autumn street: taupe small-tile mid-rise (≈#b8a89a) and brick-red tile block (≈#a0604a), window bays with pale blinds drawn to different heights, deep reveals, shop fascia; elevated expressway behind.                                                                                                                                                                               | Venetian/vertical blinds (40 mm slats, derivative-faded) lowered from the head to 25-100 % in 30 % of punched windows and 60 % of office lites, cream/white/pale-yellow (`owCityPane`); the existing 0.21 m reveals now frame an interior. Brown tile (0x7d5d4c) and terracotta tile join the office palette (`OFFICE`).                                                                                                                                                                                                                                                                    | No elevated expressway; tile colours are palette picks, not per-street matched.                                           |
| 014 | Night shopping street: columns of 10-20 small lit tenant boxes (≈0.5-0.6 m square) stacked one per floor in alternating colours, vertical neon boards, lit pastel interiors with ceiling lights on upper floors, charcoal panel front with paired AC units, meter boxes, pipes, potted plants, stand signs.                                                                            | 505 tenant-box columns (`FestivalSignage.column`): 0.56 × 0.5 × 0.3 m boxes, 6-24 per column, one per tenant from 64 original trade tiles (`TENANTS`, 64 × 64 px atlas band), 1 in 8 boxes neon-bright, flicker 7 %. Projecting signs now 3-6 per block frontage (≥1.3 m apart). Lit rooms show their interior (`owRoom`, ceiling panel + lamp falloff, ~40-55 % lit at night). Charcoal large tile (0x4d4a47) and slate panel (0x56606a). Stand signs (0.46 × 0.9 m, a third of doors), pots on machiya/minka fronts.                                                                      | Signs give painted ground pools only (town-life), no light on facades/cars; no potted plants on city fronts.              |
| 020 | Village street: dark timber machiya, koshi lattice ground floor, pent roof, plaster upper, plants at the door, utility poles.                                                                                                                                                                                                                                                          | Machiya fronts get inuyarai (curved split-bamboo guards, 0.9 m high, 0.5 m out) either side of the door, a timber bench (shogi, 1.8 × 0.45 m) on half, 2-4 glazed pots with clipped foliage (`FestivalSignage.inuyarai`, `bench`, `pots`).                                                                                                                                                                                                                                                                                                                                                  | Buildings keep the 6 m country-road setback, so the street is still wider than the reference.                             |
| 030 | Tokyo street by day: terracotta tile mid-rise (≈#c0623f) with window bands behind beige curtains and balcony slabs; beige stone large-format tile (≈0.6 × 0.3 m grid); violet aluminium-panel block (≈#7f7589); blue glass curtain-wall tower in ≈1.5 m modules; wall billboards with lamp arms; rooftop billboards; stacked boards on every floor; 8-10 storeys round a ≈20 m street. | Large-format tile finish 7 (600 × 300 mm, 3 mm joints; 0xcdbfa6 beige, 0xb5b0a6 granite, 0xdedad0 white), composite-panel finish 9 (1.0 × 0.5 m, 0x7f7589 violet), curtain walls (1.5 m lites, 0.12 m spandrels, tinted glass, ×2.6 coated reflection) on the tallest offices (`owCityWall`, `facadeLayout` 'curtain'). Side-wall billboards up to 9 × 4.5 m with lamp arms high on blocks ≥7 storeys; LED screens on a third of ≥9-storey side walls and on curtain-wall fronts (27 in town, `LedScreens`). Visual storeys make Harbour Front and Market Street 7-12-storey canyons.       | Ads are original generic designs; no colossal facade-height posters; street is still the existing 9.2 m road + pavements. |
| 034 | Rural two-storey house at dawn: tiled main and pent roofs, upper veranda, koinobori, clipped pines.                                                                                                                                                                                                                                                                                    | Minka fronts get an engawa either side of the entrance (0.85 m deck 0.45 m above the base course, posts at ≤1.8 m, dark skirt, kutsunugi-ishi step; `Buildings.engawa`).                                                                                                                                                                                                                                                                                                                                                                                                                    | No koinobori; pines are the vegetation module.                                                                            |
| 038 | Alley: grey mosaic-tile walls, teal awnings, vending machine, meter boxes on the walls, wires, crates.                                                                                                                                                                                                                                                                                 | Meter cabinets and risers on every city service wall; blank party walls above the ground floor wherever another building stands within 4 m of a side wall (`ArchitecturePlan.partyWall`; one wall quad per storey); services move to the open side.                                                                                                                                                                                                                                                                                                                                         | No new awnings (the existing canopies stay); no crates.                                                                   |
| 039 | Park skyline: glass towers of 25-40 storeys with grid facades and setbacks.                                                                                                                                                                                                                                                                                                            | Curtain-wall towers (32) with visual storeys to 12-14 and coated-glass reflections; the centre of Port Ilse now averages ≈8+ storeys (`architecturePlan.extraFloors`).                                                                                                                                                                                                                                                                                                                                                                                                                      | Nothing above 14 storeys (45 m); no tower setbacks or crowns.                                                             |
| 053 | Dusk drift: canyon of tall stacked vertical signs, lit windows, street trees.                                                                                                                                                                                                                                                                                                          | Denser projecting signs and tenant columns, lit interiors at dusk/night; every third sign slot starts one storey higher so the boards stagger up the facade.                                                                                                                                                                                                                                                                                                                                                                                                                                | Street trees are another module.                                                                                          |
| 056 | Rural plot: two-storey house with white plaster in a dark timber frame grid, a stone-and-hedge boundary, clipped pine, sheds with roller shutters.                                                                                                                                                                                                                                     | Minka gardens (`FestivalSignage.garden`): boundary 2.4-3.6 m in front of the house with a gate gap — clipped hedge (0.9 m) on a dry-stone course (0.56 m), split-bamboo fence (1.56 m, kenninji-gaki texture with rails) or a plastered wall (1.1 m) with a tiled cap on a stone footing — returns back to the house, gate posts, a 1.4 m granite toro, clipped shrub mounds, stepping stones to the door, pots; skipped on plots with >1.2 m fall or <0.8 m road clearance. Shinkabe: dark posts every 1.82 m and nuki rails every 0.9 m on about half the village plaster walls (shader). | Pines and garden trees are vegetation; sheds unchanged.                                                                   |
| 064 | Winter village from the hill: compact plots, every roof white.                                                                                                                                                                                                                                                                                                                         | Gardens and engawa sit under the existing snow shading (sky-facing faces whiten).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Village layout is the existing placement.                                                                                 |
| 066 | Neon night, wet: signs reflected in glass and car paint.                                                                                                                                                                                                                                                                                                                               | City glass at night reflects facades across the street with lit windows and small sign boxes in saturated colours (`owNeighbour`), replacing the PMREM sky where the reflected ray meets buildings.                                                                                                                                                                                                                                                                                                                                                                                         | Reflections are procedural, not the actual signs; car paint unchanged.                                                    |
| 069 | Night race street: flat lit boards on each floor of the facades, stacked boards, a pink-lit tower with a full window grid, rooftop billboards.                                                                                                                                                                                                                                         | Flat lit boards (≤4.2 × 0.62 m, tenant tiles) between the window bands on 2-3 floors of two thirds of commercial blocks; offices lit at ~55 % at night with cool lamps; LED screens.                                                                                                                                                                                                                                                                                                                                                                                                        | No facade washes (coloured floodlight on walls).                                                                          |
| 086 | Wide night street: big lit billboards, louvred upper floors, office window grid.                                                                                                                                                                                                                                                                                                       | Side-wall billboards and LED screens; ribbon office windows with blinds glowing when lit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | No louvre facades.                                                                                                        |
| 089 | Office block: ribbon windows with pale blinds (≈#d8cfa8) at different heights, white precast grid; apartments with balconies, exterior stair, roof tank, antennas.                                                                                                                                                                                                                     | Ribbon windows (`facadeLayout` 'ribbon': 1.65 m band 0.85 m above each floor, 0.45 m from the corners, 1.2 m lites, transom on half): 124 office blocks; precast finish 8 (sealant joints at floor and sill lines, 1.65 m verticals; 0xd5d1c6, 0xc1bcb0, 0xa29e95). Half the apartment balconies get frosted glass in 1.2 m aluminium frames (`owFrosted`); roof railings (posts ≤3 m, two rails) on blocks ≥8 storeys and a third of the others.                                                                                                                                           | Balcony glass is opaque-frosted (no see-through).                                                                         |
| 097 | Dark brick-red tile office with horizontal ribbon windows reflecting the sky and the buildings opposite.                                                                                                                                                                                                                                                                               | Ribbon glass reflects a varying skyline of facades (window grid, filtered) below the sky (`URBAN_REFLECTION_GLSL`), Fresnel from three's IBL; tinted glass on a third of ribbon offices.                                                                                                                                                                                                                                                                                                                                                                                                    | Reflection geometry is generic (no true screen-space reflection).                                                         |

## Measured dimensions used (real-world values where a photo is ambiguous)

- City storey 3.2 m (placement); visual storeys stack at the same 3.2 m, on the collider
  footprint, never overhanging it. Colliders (`regionStructures`) are unchanged: a car
  cannot reach a roof, so height above the collider top is visual only.
- Ribbon band: sill 0.85 m, head 2.5 m (≤ storey − 0.12 m), 0.45 m from each corner,
  lites ≈1.2 m (std, aluminium sashes); curtain wall: 0.12 m spandrel each side of the
  floor line, 1.5 m modules (ref 030), mullions 70 mm.
- Large-format tile 600 × 300 mm, 3 mm joints (std); precast panels 1.65 m wide, joints at
  the floor line and at the 0.8 m sill line, 15 mm sealant (ref 089); aluminium composite
  panels 1.0 × 0.5 m, 10 mm open joints (std).
- Room trace: depth 3.5-6 m (rooms) / 5.5-8.5 m (shops), sill 0.82 m, ceiling 0.18 m above
  the head; shelving 0.36 m shelf pitch from 0.15 to 1.95 m, goods 90 mm (std).
- Blinds 40 mm slats; curtains 120 mm folds; shutters 80 mm corrugation (std).
- Tenant boxes 0.56 × 0.5 × 0.3 m, columns 0.24 m off the wall (ref 014: ≈0.5-0.6 m);
  flat boards ≤4.2 × 0.62 m; stand signs 0.46 × 0.9 × 0.22 m; side billboards ≤9 × 4.5 m;
  LED screens 16:9 with a 0.25 m bezel, 0.3 m deep.
- Services: drain Ø100 mm, gas riser 50 mm, AC condenser 0.8 × 0.55 × 0.29 m on a bracket,
  meter cabinets 0.6 × 0.42 m and 0.45 × 0.32 m at 1.75 m (std, ref 012).
- Roof railing: posts ≤3 m apart, rails at 0.55 and 1.08 m above the coping (std 1.1 m).
- Village: engawa deck 0.85 m deep at 0.45 m above the base course, posts ≤1.8 m (std);
  shinkabe posts at 1.82 m (one ken) and nuki rails at 0.9 m (std); hedge 0.9 m on a
  0.56 m dry-stone course; kenninji fence 1.56 m; plastered garden wall 1.1 m + tiled cap;
  boundary 2.4-3.6 m in front of the house; toro 1.4 m; inuyarai 0.9 m high, 0.5 m out.

## Facade shading notes

- Every pattern is metric and derivative-filtered (`fwidth` fades to the average before it
  aliases); city pane hash inputs are snapped (room id stored at 1/256 bucket centres,
  pane tag rounded) because interpolated "constant" attributes otherwise flip hash bits
  per pixel and speckle the glass (found and fixed during this pass).
- The traced room runs only where a pane resolves (≳5 px); smaller panes and every pane on
  LOW take the room's average radiance, so distant facades cost about the old shader.
- City glass reflects the street canyon (`owNeighbour`) only where three's IBL specular
  is active (`USE_ENVMAP`); LOW drops it with the room (`Buildings.rich`).
- The facade material stays one program, one draw per 512 m district; LED screens add one
  draw (own material, range-culled with the skyline signage).

## Cost (MEDIUM, 1280 × 720, SwiftShader, `horizonReview.state().render`)

"Before" is the integration head this branch started from (afa4048; the garden view on
3b6e324, which only adds agent G's car bodies). "After" columns: `after2` is the first
commit (2cc4b52, windowed side walls everywhere); `final` is the branch head (f856762:
party walls, far-pane path, calmer glass), captured for three views only under the time
budget. Same camera per row.

| View                                        | Before draws / triangles | After draws / triangles      |
| ------------------------------------------- | ------------------------ | ---------------------------- |
| Spawn chase, day                            | 419 / 2 325 168          | 419 / 2 410 302 (after2)     |
| Street canyon (590, 6.2, -2601) → east, day | 354 / 2 421 144          | 359 / 2 550 432 (final)      |
| Facade close-up (612, 7.5, -2604), day      | 482 / 2 609 378          | 487 / 2 712 734 (final)      |
| Street canyon, night                        | 363 / 2 445 784          | 367 / 2 589 482 (final)      |
| Skyline from the harbour, 40 m up, day      | 409 / 2 317 584          | 414 / 2 428 012 (after2)     |
| Skyline from the harbour, night             | 417 / 2 340 496          | 420 / 2 566 882 (WIP after1) |
| Ashvale street, day                         | 359 / 1 823 400          | 363 / 1 844 844 (after2)     |
| Ashvale garden (-772, 92.8, 752), day       | 405 / 2 462 384          | 408 / 2 466 694 (after2)     |

Draws: +0 to +5 per view (the LED screen mesh, a few more signage/street chunks). The
facade material is still one program and one draw per 512 m district.

Region totals (Node build): building mesh 1 036 676 → 1 071 746 triangles (+3 %: visual
storeys, services, railings and engawa, offset by party walls that are one quad per
storey and ribbon bands that replace punched bays; openings 38 048 → 27 504). Signage
48 520 → 118 812 triangles in 41 chunk meshes + 1 LED mesh: 1 606 signs (was 970), 505
tenant columns, 616 billboards/boards, 27 LED screens, 229 lanterns incl. garden toro;
2 659 lit fixtures for the town-life pools (was 1 503). Building construction ≈4-7 s on
the loaded shared host (was ≈2-6 s in the same conditions).

Shader cost: the traced room runs only on panes ≳5 px wide; the rest of the glass, and all
of it on LOW, take a constant average. SwiftShader `renderMs` is too noisy on the shared
host (load 30-45 during these captures) to quote as a GPU cost; no GPU timing was taken.

Evidence (`scratchpad/agentM/`): `before/*.png`, `before-garden/ashvale-garden.png`,
`after2/*.png` (spawn, canyon, facade, skyline, Ashvale street and garden), `after1/*.png`
(WIP incl. night skyline), `final/*.png` (canyon day/night, facade close-up at the branch
head), `dbg/*.png` (isolated facade test scene: day/night, near/far).

Validation: `npx tsc --noEmit` clean; eslint/prettier clean on changed files;
`vitest run tests/festival-*.test.ts tests/open-world*.test.ts tests/solvane-*.test.ts
tests/traffic.test.ts`: 38 files, 299 tests passed (new `tests/festival-facade-richness.test.ts`:
visual storeys on the collider footprint, colliders unchanged, centre/main-street rise,
ribbon/curtain partitions, party walls only beside neighbours and only up to their roofs,
stable pane tags, signage density and LED screens; the signage triangle cap in
`festival-japan-architecture.test.ts` was raised 120 k → 160 k for the intended density).

## Known limits

- Visual storeys have no colliders above the existing collider top (by design: unreachable).
  The camera-clearance boom still uses the collider height, which is lower than the drawn
  roof; a camera pushed above a roof could clip into the visual storeys.
- Interiors are an illustration (box room, no furniture parallax beyond the room box).
- Street reflections are procedural facades, not the real neighbours or signs.
- Garden boundaries are boxes with canvas textures; hedges are not volumetric.
