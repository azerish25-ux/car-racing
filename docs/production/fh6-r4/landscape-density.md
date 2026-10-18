# FH6 reference pass r4: landscape density and ground cover (agent J)

Scope: the whole-frame density gap of the festival region (Solvane): bald, smooth
"green felt" hills with a few tufts and isolated trees, against the references'
continuous grass carpets, wooded hills that read as textured canopy, understory
along road edges, rock outcrops on the mountain slopes and varied ground. Colours
are sRGB medians (p20..p80) of boxes in the 1920x1080 references, sampled with
`scratchpad/agentD/tools/sample.py` (as published, after the game's grade); sizes
are read against the cars in frame (a road car's wheel is ~0.65-0.75 m, the SUV's
~0.8 m).

## Code

- `src/rendering/open-world/ground-cover.ts` — `GroundCover`: the grass carpet and
  the understory. Square patches of clumps aligned to the 4 m terrain grid are
  instanced around the camera (near grass 4 m patches of 120 clumps, far grass 4 m
  patches of 36 larger clumps, understory 8 m patches of 16 clumps; 3 crossed cards
  per clump; one draw per ring, CPU frustum culling per patch, front to back). The
  vertex shader places every clump on the drawn ground from one RGBA32F texture of
  the 3 x 3 finest terrain tiles around the camera (`fillGroundWindow`: carved
  height on the physics triangles, grass mask, clear metres past the usable road
  edge, forest, farm and flat-paddy weights), turns each patch by one of the eight
  symmetries of the square and hashes every clump in world space (no visible
  repeat), thins and enlarges clumps with distance, presses them flat under the
  player's car, sways them with the studio wind and colours them per season; the
  terrain's meadow takes the blades' shaded base tone under the carpet
  (`TERRAIN_CARPET`), fading out with it, so no pale ground shows between clumps.
  Reach (MEDIUM / HIGH / ULTRA): grass 46 / 64 / 80 m (full density to 13 / 17 /
  21 m), understory 105 / 150 / 190 m; LOW draws none.
  Procedural 2048 x 512 atlas (`coverAtlas`): meadow blades, blades with nodding
  panicles, clover-like low leaves, fern fronds, a leafy shrub, verge weeds with
  flower heads, sasa (kumazasa) and bleached winter tufts; green = shading, red =
  accent, alpha = coverage.
- `src/rendering/open-world/far-canopy.ts` — `FarCanopy`, `planCanopyTile`: crowns
  on the drawn terrain tiles of levels 2-4 (1-4 km tiles, beyond the planted
  levels), one camera-facing quad per crown, one instanced draw per tile; crown
  shape (lobed broadleaf / sugi spire), leaf clumps, shadowed gaps and a sphere-like
  normal in the fragment shader; species, proportions and season from the near
  trees (`floraRole`, `ROLE_FORM`, `owLeafSeason`, `owLeafSnow`).
- `src/rendering/open-world/rocks.ts` — `RockOutcrops`, `planRockTile`: faceted
  boulders and crags on the rock layer of the drawn near tiles (levels 0-1), half
  sunk, granite colour of the terrain rock layer with lichen/moss and winter snow,
  one instanced draw per rocky tile, distance-culled.
- `src/simulation/open-world/terrain-field.ts` — `forestDensity` gains `hillWoods`
  (woods on the rolling hills, the massif flanks and the edge ranges, never on the
  Ashvale valley floor); `biome(..., forest?)`.
- `src/simulation/open-world/placement.ts` — the same trees for physics and
  rendering (`treesForTile` reads the shared density; early hash rejection keeps the
  output identical and the cost down).
- `src/simulation/open-world/terrain-tiles.ts` — `TerrainCarver.build` also reports
  `edge` (clearance past the usable road edge, measured `edgeSpan` m beyond the
  carving reach on request) and `cut` (cutting depth). Heights unchanged.
- `src/rendering/open-world/tile-data.ts` / `src/workers/*` — finest tiles carry the
  ground-cover masks (`cover`); rock only in real road cuttings (fills stay grassed).
- `src/rendering/open-world/terrain-material.ts` — shared meadow colour
  (`OW_MEADOW_GLSL`: macro, patch and forest-floor variation, season), plot-based
  crops instead of contour stripes, flower farms only in the flower zone, rock scans
  on fixed projections, olive summer meadow.
- `src/rendering/open-world/terrain.ts` — `nearTiles`, `canopyTiles`, `finestTile`,
  `version` for the new layers.
- `src/rendering/open-world/vegetation.ts` — `VEGETATION_LOD`: the finest procedural
  tree tiles switch to the next level's light crowns (no trunks, no shadows) beyond
  110 / 160 / 230 / 320 m (LOW..ULTRA); every collider tree stays drawn.
- `src/rendering/open-world/flora.ts` — flora cards lit on both faces.
- `festival-renderer.ts` — construct, add, update, dispose (and `stats.landscape`).
- Tests: `tests/festival-landscape-density.test.ts`.

## Ledger

| Ref | Measured observation | What was implemented (file / symbol) | Remaining gap |
| --- | --- | --- | --- |
| 003 | Winter time-attack: the hill behind the track is one continuous conifer canopy dusted with snow (#728192, p20 #606d79, p80 #8b97a6); spires readable up to the ridge, no ground between crowns. | `TerrainField.hillWoods` puts the hills and massif flanks under forest (forest biome 13 % -> 35 % of the land on a 64 m survey grid; land steeper than 0.12 rise/run: 21 % -> 56 % wooded); the same density feeds placement (trunk colliders), the terrain forest floor and `FarCanopy` beyond the planted tiles; winter snow on the up-facing crown parts (`owLeafSnow`) and conifer spires (`planCanopyTile`: conifers above 260 m and in the sugi zones as on the near trees). | Far crowns are camera-facing quads: no snow load shape; near conifers keep the shared atlas spire. |
| 016 | Summer lakeside: forested ridges in layers (near canopy #354733, p20 #22321c, p80 #57788a with haze), meadow at the road #61682e with tall grass ~0.6-0.8 m against a 0.7 m wheel, orange lilies. | Hill woods on the ridges; far canopy with lobed crowns and lit/shaded halves; grass carpet (`GroundCover`) 0.3-0.55 m (+25 % seed heads), meadow summer tone moved toward olive (`owMeadowSeason` summer x(1.0, 0.93, 0.68): rendered verge #596e2e before). | No lilies (verge weeds flower white/yellow); grass shorter than 016's tall roadside grass. |
| 019 | Garden: boulders 1-2 m (#93876d, p80 #beb29e) with fern and bamboo-grass clumps at their feet. | `RockOutcrops` faceted boulders (plane-cut icosphere) 0.6-2.4 m with a few 3.5-7 m crags, granite colour of the terrain rock layer with lichen/moss on the tops; sasa and fern cards in the understory. | No garden composition (rocks follow the terrain rock layer, not paths or gates). |
| 021 | Spring hillside: carpet of grass 30-40 cm (half the 0.8 m wheel) mixed with low clover-like leaves, median #65642f (p20 #515222, p80 #807742); no ground visible. | Near grass ring of 120 clumps per 4 m patch (3 cards, ~75 blades each) at full density to 13 m (MEDIUM), thinning with larger clumps to 46 m; clover tile (10 % of open meadow clumps, white heads); blades dark at the base, lit at the tips, coloured from the terrain's own meadow GLSL (`owMeadowColour`) so they fade into it. | Card blades, not individual geometry; clover is a minor share. |
| 022 | Alpine: grey crags in shade #333336, sunlit scree #ac9d89 (p20 #877867, p80 #c3b6a4), boulder field 0.3-2 m, grass tongues between. | Rocks on the terrain rock layer (`planRockTile`: chance (rock - 0.32) x 0.9 per 6 m cell, plus 5 % on open ground above 330 m), half sunk, colour 0.17-0.30 linear grey-brown with grain, cracks, moss; the rock layer's photographed scan now uses fixed projections (no herringbone streaks over the cuttings). | No scree slopes of small stones; crags are single boulders, not cliff geometry. |
| 024 | Forest touge: tall pines over a dense green undergrowth at the guardrail (#495a5b with blur; foliage p20 #274035). | Understory ring: shrub band 1.4-10 m past the usable road edge (denser in the woods), fern/sasa on the forest floor. | Shrubs are cards (no volume up close); no roadside trees leaning over the road. |
| 026 | Temple drive: clipped shrubs 0.6-0.8 m high in continuous bands along the gravel (#3f3d1f, p80 #827d50). | Shrub tile (dense small-leaved bush, 0.75-1.45 m) in the verge band; colour by season (autumn reds, bare grey-brown in winter). | No clipped hedge shapes or temple planting plan. |
| 029 | Sea of clouds: azaleas (#af2704) in the foreground, conifer spires on the ridges. | Existing azalea roles (D); far canopy spires on conifer sites; understory weeds flower in summer. | No dedicated azalea field layer. |
| 032 | Meadow at golden hour: grass #453c14 (p20 #292605, p80 #655528) to the camera with tan nodding seed heads, susuki plumes behind; forested ridges on both sides. | Seed-head tile: nodding panicles with fine spikelets, 6/22/50 % of clumps in spring/summer/autumn (none on the mown verge), accent colour (0.30, 0.22, 0.11) summer -> straw in autumn; backlight through the blades (sun-facing translucency). Hill woods put the side ridges under trees. | Panicles are painted cards; golden-hour translucency is a simple term. |
| 036 | Vista: susuki slopes in front, mid-distance forested hills as a textured mass (#38433a, p20 #2c312e), cone behind. | `FarCanopy` on 1-4 km tiles (crown spacing 9/14/22 m x 1.15 on MEDIUM, gathered placement density so the canopy covers like the near trees) with shadowed gaps (clump noise, crown occlusion), lit/shaded crown halves; hills wooded by `hillWoods`. In game the wooded far hills read #243f52 (blue) in the first pass; albedo raised to (0.074, 0.10, 0.02). | Distant canopy still bluer than 036 (the aerial perspective is the atmosphere worker's); no individual tree silhouettes on far ridgelines. |
| 039 | City park: rounded shrubs (#474b2c, p80 #818151), cherries, lawns. | Shrub cards and lawn grass (town ground carries none: parks inside towns stay paved/turf). | No park layer inside the towns. |
| 043 | Touge at blue hour from above: unbroken dark canopy (#06110d) to the horizon ridges. | Hill woods and far canopy make continuous forest over the hills; near tiles keep the placement trees. | Night colour is the lighting worker's. |
| 050 | Spring hairpins from above: shrubs and young trees fill every gap between road loops, grass to the guardrails (#616248 mid-tones). | Embankment fills are grassed (rock only where the carve cut > 0.4 m), understory in the gaps; terrain under trees is forest floor. | The camera at 150 m sees no blades (ground cover stops when the camera is far above). |
| 051 | Flower farm: striped beds on one hillside, forested hills around (#4c4946 hazy). | Flower plots gathered where the wildflower zone is strongest (`owFloraZone` > 0.76, 30 % of plots) instead of 14 % of all farm plots; hill woods around. | Flower beds remain terrain colour (no 3-D flowers in the beds). |
| 052 | Autumn forest: ferns 0.5-1 m under the trees, leaf litter #30210f. | Fern and sasa cards on the forest floor (floor weight from the tile's forest density), ferns golden-brown in autumn and dry in winter; the existing autumn litter tint. | Fern cards are flat; no fallen logs. |
| 060 | Snow monsters and dark crags (#6c6568, p80 #a7a6bc) in deep snow. | Rocks take snow on their upward faces in winter; conifers keep snow (D). | No juhyo snow masses. |
| 093 | Cedar avenue: a low green undergrowth band along both road edges under the trunks (#282f1b, p80 #515a40). | Understory shrub band past the road edge, denser in forest (`want` = floor 0.9 + verge 0.3-0.8 + margin 0.45). | Undergrowth is cards; sugi crowns from the shared atlas (D). |
| 098 | Sunset roadside: grass 30-60 cm at the camera with red flowers, olive-brown in the low sun (#3b280f). | Verge weeds with flower heads and grass carpet beside every rural road; flowers white/yellow/purple by zone. | No red-flower variant at the verge. |

## Measurements (software GL, 1280x720 unless noted)

Before = integration head 26d3498 served from an export; after = this branch.
Captures in `scratchpad/agentJ/before/` and `after/` (sheet `ba-1.jpg`);
`it1/` holds 960x540 captures of an earlier state of this branch (ashvale-aerial,
forest-hill, chase-thornwood) and `cost/` the per-layer attribution (960x540).

| View | Before draws / tris | After draws / tris | Notes |
| --- | --- | --- | --- |
| Varda pass east (-1904, 262, 3030), MEDIUM | 603 / 2.80 M | 622 / 3.44 M | Per layer (hidden one at a time, before `VEGETATION_LOD`): ground cover 3 draws / 64 k, far canopy 20 / 175 k (87 k crowns drawn of 316 k planned in 81 tiles), rocks 4 / 66 k, trees 91 / 1.65 M; the tree LOD then saved 1.06 M. |
| Valley sprint start, chase camera, MEDIUM | 463 / 0.85 M | 462 / 0.95 M | 135 grass + 164 understory patches. |
| Meadow (1535, 101.9, -75) at 1.5 m, MEDIUM | 395 / 1.60 M | 401 / 1.86 M | Grass carpet under the susuki field cards (flora, agent D). |
| Ashvale aerial at ~150 m, MEDIUM (960x540, earlier state) | 386 / 1.60 M | 412 / 2.08 M | No blades from this height; hills wooded, far canopy, plot fields. |
| Forest hill from the valley road, MEDIUM (960x540, earlier state) | 329 / 3.99 M | 359 / 4.54 M | Before the tree LOD. |
| Spawn chase (Port Ilse), MEDIUM | 424 / 2.43 M | not recaptured | Town ground carries no cover; only the far canopy beyond the town changes. |

Rendered colours (sRGB medians, same tool): grass embankment at the sprint start
#596e2e before the summer tone change (021 #65642f, 016 #61682e); wooded far hills
#243f52 in the first pass (036 #38433a): the canopy albedo was raised after it.
Region: forest biome 13 % -> 35 % of the land; placement trees per 256 m tile
54 -> 153 on average (1.6 -> ~2.6-2.9 ms per tile in Node, identical in the physics
and render workers).

Validation: `tsc`, eslint, `vitest` (festival-*, open-world*, solvane-*, traffic,
terrain*) pass; `npm run test:open-world`: every route, drive, race and traffic
check passes with the same numbers as the baseline; the only failure
(`sm450: rode 120 s of free roam on the autopilot without a fall`, 1 fall at
1.36 km) fails identically on the baseline export (pre-existing).

## Known limits

- Grass, understory and far crowns are cards/quads: up close blades are painted,
  clumps still read individually on slopes facing the camera at 20-40 m; the
  carpet ends at 46 m (MEDIUM) where the darkened ground fades back to the terrain.
- Hill woods follow the hill noise, not slope, so some steep open meadows stay
  open and some flat hilltops are wooded; the southern farmland plain stays open.
- Far canopy sits on the 1-4 km tiles only; the 512 m tiles keep the light card
  crowns of the near trees; distant canopy reads bluer than 036 through the haze.
- Rocks have no colliders (kept 10 m past the road edge on the finest tiles, on
  ground steep enough to stop a car); no scree fields or cliff geometry.
- The extra trees raise MEDIUM triangles in wooded vistas by ~0.6-1 M even with
  the tree LOD; draw calls rise by ~20.
