# FH6 reference pass R4: street trees (agent S)

Scope: trees in Port Ilse's streets and along the country roads, so the seasons read in town.
Before this pass the town streets carried no trees at all (placement rejects the town biome and
everything within 4.5 m of a usable road edge). Sizes the photos cannot resolve are Japanese
street-planting standards (std).

Code:

- `src/simulation/open-world/street-trees.ts` — `streetTreePlan` / `streetTreesForTile`
  (deterministic, cached per structure list), `STREET_TREE`, `streetTreeForm`, `isStreetSpecies`.
- `src/simulation/open-world/placement.ts` — `TREE_SPECIES.STREET_CHERRY / STREET_ZELKOVA /
STREET_MAPLE`, slender `trunkRadius` for them (0.16-0.22 m); `treesForTile` appends the tile's
  street trees whenever the structures are known (physics session and render tile worker), never
  thinned, so every drawn street tree is a trunk collider.
- `src/rendering/open-world/flora-roles.ts` / `season-flora.ts` — role `GINKGO` (8) for the
  street zelkova/ginkgo: fresh green in spring, golden yellow in autumn (linear 0.62,0.42,0.03 …
  0.55,0.26,0.02), bare in winter; street cherry/maple map to the existing roles.
- `src/rendering/open-world/vegetation.ts` — `Vegetation.street`: same instanced foliage/bark
  materials and season shading as every tree, but the crown instance is raised on a clear stem
  and leans 1.1 m toward the road; also used on HIGH/ULTRA (photographic mode keeps street trees
  procedural). Light far crowns beyond `VEGETATION_LOD`.
- `src/rendering/open-world/street-tree-dressing.ts` — `StreetTreeDressing`: cast-iron grates in
  the town footways, a seasonal litter ring under every street tree (petals in spring, gold/red
  leaves in autumn), 512 m chunks, hidden beyond 260/380/520 m (MEDIUM/HIGH/ULTRA), none on LOW.
- `festival-renderer.ts` — construct/add/update/dispose; the tree pits are passed to
  `FestivalTownLife` as occupied points so bollards, bicycles, planters and bus stops keep clear.
- Tests: `tests/festival-street-trees.test.ts`.

Placement rules: town streets of Port Ilse: trunks 0.45 m outside the road footprint (the flush
2.4 m footway is drivable, so trunks stand at its back edge, 7.45 m off the centre line, 0.75 m
from the frontage) every 10 m ±0.8 m; only in front of a building (no store lot, coin park,
driveway or gap), never before a konbini or within 2.2 m of a frontage's centre (entrance); not
within junction clearance + 16 m (crosswalks, signals, guard fences, phone booths), 5 m of a town
lamp standard or 4.5 m of a utility pole on the same side, on bridges, or nearer than 6 m to
another street tree. Streets running inland are cherry, streets along the shore zelkova/ginkgo.
Country roads within 1.1 km of Ashvale and 650 m of the castle site: cherry avenues in ~150 m runs
(about half the runs; 85 % on the castle approach), 1.6 m past the shoulder, 9 m apart, on level
verge only (ground within 0.7 m of the road edge, slope < 0.25), never in sharp bends (chevrons).
Temple front (within 70 m of the temple, gate mouth ±6 m kept open): maple row. Result: 750 trees
(539 cherry, 186 zelkova, 25 maple); 284 inside Port Ilse.

| Ref | Measured observation                                                                            | What was implemented (file / symbol)                                                                                                                                                       | Remaining gap                                                                                       |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 015 | Mountain-road cherry avenue: crowns meet over the road, trunks just off the edge, petal carpet. | Ashvale/castle cherry avenues (`streetTreePlan`, 9 m, 1.6 m past the shoulder, crowns 5-6.5 m wide leaning 1.1 m over the road); spring petal ring under each tree (`StreetTreeDressing`). | Crowns do not yet touch across the 7.4 m road; the D petal carpet stays zone-based, not tree-based. |
| 033 | Castle approach: cherries lining the track.                                                     | Avenue runs on the roads within 650 m of the castle site (`architecturePlan().landmarks`).                                                                                                 | No weeping (shidare) form.                                                                          |
| 050 | Touge cherries along the hairpins.                                                              | Avenues stop in sharp-bend zones (chevrons), so hairpins keep D's roadside cherry roles.                                                                                                   | —                                                                                                   |
| 086 | City street at night with street trees silhouetted.                                             | Town trees in every lit street; crowns raised (≥ 2.5 m stem) so the street light pools stay visible.                                                                                       | No light-spill tinting of the crowns (worker R's night pass).                                       |
| 096 | City cherries over a street with a pink haze.                                                   | Inland Port Ilse streets planted with cherries (6.4-7.6 m, 4.9-5.8 m crowns), blossom from D's `owLeafSeason`.                                                                             | Petal haze in the air is not modelled.                                                              |
| 097 | Avenue of uniformly planted street trees.                                                       | One species per street, 10 m spacing, aligned pits with grates.                                                                                                                            | —                                                                                                   |
| 027 | Temple lane with red maples.                                                                    | Maple row (25 trees) along the temple front, gate mouth open; red in autumn (D's maple role), red leaf ring.                                                                               | Approach is the valley road, not a separate lane.                                                   |
| 089 | City arterial with street trees in grates.                                                      | Zelkova/ginkgo along the shore streets (8-10 m, upright 0.8 w/h crowns), golden in autumn (`GINKGO`), 1.0 m cast-iron grates.                                                              | Grate texture is a canvas pattern (no normal map).                                                  |

Validation: `npx vitest run tests/open-world*.test.ts tests/festival-*.test.ts tests/solvane-*.test.ts
tests/traffic.test.ts` 45 files / 335 tests pass (before the footprint fix; the new suite was rerun
after it). `npm run test:open-world`: AI event drives clean (coast-to-summit, thornwood-rally: 0 s
off-route, 0 resets, rivals finish). Its bike free-roam checks fail (sm450 one fall, sbk1000 stalls
at x≈1010) and the traffic spawn check reads 177.9 m vs 180 m; the bike runs are identical with the
street trees removed from the session (same stall and fall at 45.1 s, no bike ever within 3.7 m of
a street tree), and the committed `docs/open-world.json` baseline predates many merged simulation
changes, so these look pre-existing — not isolated for the traffic check.
