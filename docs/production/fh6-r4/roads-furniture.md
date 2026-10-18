# FH6 reference pass R4: roads, road markings and roadside furniture

Worker: agentB. Scope: Japanese road markings, guardrails, utility poles and lines, mirrors,
chevrons, signs and expressway furniture in the festival region (Solvane). Colours are sRGB
samples from the 1920x1080 references (5-21 px boxes, linear in brackets). Sizes a photo
cannot give are Japanese road standards and are marked "(std)".

Modules: `src/rendering/open-world/roads.ts` (markings, anti-skid, rails, barriers, bridge
railings, T-piers), `road-layout.ts` (shared bend/junction analysis), `road-glyphs.ts` (painted
text atlas), `road-signs.ts` (sign atlas), `road-furniture.ts` (poles, lines, mirrors, chevrons,
delineators, signs, expressway lamps and gantries), `retro-reflect.ts` (headlight return).
Wiring: `festival-renderer.ts` (construct, add, `update`/`setNight`, sockets into
`StreetLightPools`, dispose). Tests: `tests/festival-road-furniture.test.ts`.

Region totals (Node build of the shipped data): 48 town zebra crossings, 162 painted glyphs,
480 m of anti-skid over 6 hairpins, 536 m of expressway concrete barrier (460 m with noise
wall), 654 utility poles (205 with transformers), 614 line spans (29,862 ribbon segments),
42 convex mirrors, 45 chevron boards, 957 delineators, 147 signs, 479 expressway lamps
(+479 light-pool sockets; town keeps its 240), 19 gantries. Road merged geometry 439,160 ->
504,920 triangles; furniture 240,566 triangles in 786 meshes over 239 chunks of 256 m,
distance-culled (LOW 220 / MED 420 / HIGH 640 / ULTRA 860 m; lines fade by 160-620 m).
No colliders added; every furniture anchor is tested to lie outside every road footprint.

| Ref | Measured observation | What was implemented (file / symbol) | Remaining gap |
| --- | --- | --- | --- |
| 002 | Mountain/circuit road: grey worn asphalt, white edge line ~15-20 cm, low white pipe fence on the outside, grey concrete kerb wall. | White 0.15 m edge lines on two-lane roads (`roads.ts` `markings`); white-painted rail steel with grime and rust bleed (`paintedSteel`). | No pipe-fence variant of the guardrail. |
| 013 | City street under a multi-deck grey concrete expressway; white lane/stop lines; signal arms. | Expressway bridges stand on one 2.0 x 2.6 m column under a 1.6 m crosshead (`piers`, `prism`); town stop lines (`junctionMarkings`). | No traffic signals. The authored expressway never crosses the town grid, so a street under a viaduct cannot exist without a road-network change (outside this brief). |
| 020 | Village road: solid orange centre line (sun, blur-mixed #e7a473), white edge line; grey concrete poles with crossarms; 3-5 wires sag across and along the road. | Orange 0.15 m centre line `0xe0952e` (`markings`, `noOvertaking`); concrete poles 12 m, φ190-350 mm (std), 30-45 m apart, crossarm with three insulators, low-voltage arm, transformers on ~30%, yellow/black sleeve; three HV conductors, one LV bundle and two telecom cables per span with 0.45-0.85 m sag at 35 m (`utilityPoles`, `pole`, `lines`); service drops across town streets to the frontage (`serviceDrop`). | Poles only on one side of each road; no drops on country roads; ribbons are unlit dark lines. |
| 024 | Red anti-skid across the full lane on a forest bend: sun #a9665a (0.40/0.13/0.10), shade #683d3e; white W-beam #f9f3ee in sun; orange line #dfac6e. | `antiSkidMaterial` (albedo 0x704a45, aggregate grit, greyer wheel paths, wet darkening) across the carriageway of every bend tighter than R60 (mountain) / R90 (country) plus 18 m run-in (`bendZones`, `bendMarkings`). Rendered R/G 2.1-3.1 against the references' 2.3-3.0. White rails. | Only 6 hairpins in the network meet the radius rule, so surfacing is rare. |
| 030 | Dense city street: black bollards, yellow tactile strip, cones, dark grey lamp standards. | Town lamp standards kept galvanised grey (`lampPoleMaterial`). | Bollards, tactile paving and sign poles not built. |
| 035 | Fuji road: white post-and-cable fence (posts ~1 m, ~2 m apart), white edge line. | White delineator posts with amber blocks every 50 m, staggered sides, on unrailed country/mountain edges (`delineators`). | Guard-cable fence not built (it would be a ghost fence: no colliders off the rail runs). |
| 037 | Under the viaduct: big grey columns and soffit, galvanised W-beam, yellow/black stripes at the pier foot, 0.15-0.2 m white lane line. | T-piers on expressway bridges; yellow/black hazard pattern in the sign atlas (`SIGN.hazard`, used as pole sleeves). | Hazard wraps not applied to piers. |
| 043 | Night hairpin from above: orange centre, white edges, painted 急カーブ before the bend (glyphs ~2-2.5 m long), red surfacing through it, white rail with amber reflectors ~8 m apart on the outside. | 急カーブ / 左カーブ / 右カーブ painted 6 m before each surfaced bend in the approach lane, 2.4 x 1.35 m glyphs 0.7 m apart, upright for and read far-to-near by the approaching driver (`phrase`); optical speed bars before the text; amber delineators on every second rail post (8 m) with headlight retroreflection (`retro-reflect.ts`). | No lamp at hairpins. |
| 044 | Hakone hairpin: W-beam, mesh fence above it, orange centre, red/white post cones. | White rails on round φ140 mm posts (std), beam centre 0.63 m (std) (`railSegment`). | Post cones and mesh fence not built. |
| 045 | Bridge race: steel truss diagonals, multi-bar railing, dark asphalt, white lines. | Non-expressway bridges: 0.4 m concrete kerb plus a three-rail railing to 1.1 m with posts every 2 m (`bridgeSegment`, `bridgeRailing`). | No truss or cable superstructure. |
| 048 | Night touge in red flare light; W-beam both sides catching it. | White rails take local light; delineators return headlights. | Flares are event props (out of scope). |
| 050 | Spring switchbacks from above: orange centre, white edges, 左カーブ text, white rails on bend outsides, ladder-like white bars at the edge before bends. | Same marking system; optical speed bars (減速マーク) 0.45 m deep, 0.8 m in from the edge line, 3.3-5.8 m apart over ~45 m (`bendMarkings`). | No lamps at mountain bends. |
| 056 | Wet rural road: orange centre, white edge, white/grey W-beam, concrete poles with many sagging wires, red/white banded post. | Orange centre where bends limit sight on country roads (28% of their length; white 6 m / 9 m broken elsewhere, `noOvertaking`); poles and lines; red/white banded posts at minor country junction mouths (`junctionFurniture`). | Most country roads are straight in the network, so their centre line is mostly white broken. |
| 059 | Mountain road by a corrugated shed wall; low pipe rail, red surfacing at the bend, poles, yellow warning diamond. | Yellow bend-warning diamonds 60 m before each surfaced bend in both directions (`bends`, `postSign`). | No snow shed / corrugated wall. |
| 067 | Night expressway: orange-lit road, tall lamp standards, ~4-5 m ribbed sound wall, viaduct alongside. | 10 m lamp standards every 40 m on alternating sides, heads emissive at night, each a `StreetLightPools` socket (`expressway`); ribbed 3 m noise wall on the concrete barrier where a railed expressway passes within 700 m of a town (`barrierSegment`, `soundWallMaterial`). | Pools keep the existing warm-white colour, not sodium orange; walls only on the collision-backed runs, never ghost walls. |
| 069 | Night city: blue guide signs, red/white bollard, crossing sign. | Speed-limit discs (town 30, country 50, mountain 40; red ring, blue numerals) about every 1.4 km per direction (`speedSigns`). | Blue guide and pedestrian signs not built. |
| 070 | Snow corridor: one solid orange centre line on dark wet asphalt. | Orange line material (`yellow` layer, worn-paint shader). | Snow walls belong to season/terrain. |
| 071 | Shuto in rain: very saturated orange line (#fe8e47 lit), white dashed lanes, tan concrete wall, green girder bridge. | Expressway orange double centre line, 8 m / 12 m white lane lines and 0.2 m edge lines (std). | No orange lane-divider variant or girder bridge. |
| 075 | Daikoku: multi-level viaducts on round columns, lamp posts on parapets at regular spacing, green sign. | Expressway lamps stand on the parapet top over bridges; T-piers; green guide gantries. | Square columns, no ramps or loops. |
| 089 | Elevated city expressway: full-lane red/brown surfacing (#5d3f37), white dashed line, dark concrete wall with chevron board. | Anti-skid material; concrete barrier on railed expressway runs. | The expressway has no bend sharp enough to be surfaced. |
| 090 | Autumn country road: concrete poles on one side, 3-5 sagging wires over the road, white edge line, white W-beam far off. | Poles and lines; ribbons widen to 0.75 px and fade by coverage so distant lines do not alias (`WireBatch`, `wireMaterial`). | Lines run beside the road, they do not cross it outside town. |
| 091 | Suspension bridge: towers, main cable, hangers, multi-bar railing, lamps, thick white edge lines. | Bridge railing (045); expressway lamps on parapets. | No suspension structure. |
| 092 | Urban expressway curve: concrete wall with red/white chevron boards, red surfacing, double orange line, wide white edge line, viaduct overhead. | Concrete F-barrier 0.95 m on railed expressway runs; double orange centre line. | Red/white wall chevrons not placed (no sharp expressway bends). |
| 093 | Forest road: twin orange centre lines, white three-pipe fence, tall lamp. | Single orange centre on two-lane roads, double on the expressway. | No guard-pipe fence. |
| 094 | Fuji road: orange centre, white edges, red band of surfacing, W-beam. Asphalt #605855 vs surfacing #855a54 (R x1.9, G x1.0, B x0.9). | Anti-skid albedo set between this ratio and ref 024's. | - |
| 096 | Town street with red-tinted pavement and a dark green pedestrian fence. | Town crossings, stop lines, crossing-ahead diamonds and 止まれ on minor arms (`junctionMarkings`). | Coloured town pavement and pedestrian fences not built (fences would sit in the drivable footway with no collider). |
| 097 | Expressway: green overhead guide boards (kanji over English, arrows, 出口 EXIT) on a grey gantry; galvanised rail on a concrete curb. | 19 gantries: twin-chord beam on two tubular legs outside the footprint, 5.4 x 2.7 m green boards over each carriageway with invented kanji names above the region's English names, an 出口 EXIT panel (`gantry`, `road-signs.ts`). | Boards are not routed to each junction's real destinations. |
| 100 | Hairpin: yellow board with a black chevron on a single post (~2 m), W-beam, orange centre. | Yellow/black chevron boards 0.45 x 0.6 m at 1.0-1.6 m every ~9 m round the outside of each surfaced bend, double-faced so each direction sees the right arrow, retroreflective; convex mirrors (φ800, 3.4 m orange pole) on hairpins and opposite minor junction arms (`bends`, `mirror`). | Retro return at night is strong enough to wash the board's yellow toward white within ~20 m. |

## Cost (MEDIUM, 1280x720, same view before -> after)

Whole frame, from the browser captures (`renderer.stats`; asynchronous asset loads and ambient
traffic differ between runs, so these carry a few calls / ~100k triangles of noise):

| View | Draw calls | Triangles |
| --- | --- | --- |
| spawn chase, day | 378 -> 401 | 2,273,663 -> 2,253,571 |
| spawn chase, night | 377 -> 400 | 2,238,059 -> 2,226,795 |
| Varda hairpin, day | 116 -> 123 | 612,682 -> 641,618 |
| Varda hairpin, night | 116 -> 123 | 621,026 -> 641,618 |
| coast expressway | 151 -> 161 | 941,344 -> 958,822 |
| Ashvale valley road | 294 -> 308 | 862,052 -> 861,886 |

Isolated (Node, frustum + furniture culling, no shadow pass), road meshes before -> after and
furniture by tier LOW/MED/HIGH/ULTRA:

| View | Roads calls / tris | Furniture calls | Furniture tris |
| --- | --- | --- | --- |
| spawn chase | 83 / 117,300 -> 87 / 120,906 | 6 / 16 / 24 / 36 | 3.4k / 13.3k / 21.4k / 29.8k |
| hairpin | 34 / 69,528 -> 38 / 97,144 | 3 / 3 / 3 / 5 | 1.3k / 1.3k / 1.3k / 1.4k |
| expressway | 53 / 85,734 -> 48 / 86,096 | 6 / 13 / 21 / 30 | 1.5k / 6.5k / 10.8k / 17.0k |
| valley | 204 / 238,048 -> 213 / 283,168 | 3 / 6 / 10 / 14 | 2.3k / 4.3k / 5.7k / 7.7k |

Draw-call measures taken: white and orange paint share one layer via a vertex tint; concrete,
paint and galvanised furniture share one material with a per-vertex metal flag; guardrail posts
(the one world-wide instanced draw) are 12-triangle open prisms; bridge railing posts live in the
chunked rail geometry. Build time (Node, shared CPU): roads ~2.1-3.7 s (baseline ~2.2-3.6 s),
furniture 0.35-1.1 s. New shader programs: anti-skid, road text, painted steel (beam, posts),
noise wall, retroreflective delineators and signs, furniture body, overhead lines.

Captures: `scratchpad/agentB/before/*.png`, `scratchpad/agentB/after/*.png`, strips with the
matching reference in `scratchpad/agentB/compare/*.jpg`. The inspection camera jumps far from
spawn, so terrain near the hairpin and valley cameras is still uncarved coarse LOD in both
before and after (lavender water plane, green ribbons, road partly under grass): a capture
limitation of the inspection path, not of this change.
