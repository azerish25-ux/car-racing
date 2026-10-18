# FH6 reference pass R4 round 2 — festival gameplay depth (agentK)

Area: festival event formats and driving assists in the spirit of the FH6 modes on ref 085
(Horizon Racing, Touge Showdown head-to-head, drift, drag at the drag strip): a touge battle on
the Varda switchbacks, a quarter-mile drag race at the Kestrel strip that agent F dressed, a
Forza-style hold-to-rewind, and the Air / Near Miss skills. Festival code only
(`src/simulation/open-world/**`, `src/session/free-roam.ts`, `src/ui/festival-hud.*`,
`src/rendering/open-world/**`, the festival rules in `src/career/festival.ts` and the festival card
of `src/ui/career-hub.ts`); physics, road geometry, colliders and the existing event routes are
unchanged. Event names and wording are original ("Touge battle", "Drag race").

| Ref | Measured observation | What was implemented (file / symbol) | Remaining gap |
| --- | --- | --- | --- |
| 085 | Game-mode tiles: "Touge Showdown — Head 2 Head Touge Championships" (dusk, leader with tail lamps lit, chaser one to two lengths behind, cherry trees, white rail), "Horizon Racing — Road, Dirt, Cross Country and Street Races", "Horizon Drift — Drifting Championships, Highest Score Wins". Modes are formats of the same open roads, two cars for touge. | Two new event kinds, wired through every kind table: `FestivalEventKind` `'touge'` / `'drag'` (`region-data.ts`), `RACE_KINDS` and `EVENT_KIND_LABEL` "Touge battle" / "Drag race" (`festival-result.ts`), marker/map colours (`markers.ts` `EVENT_COLOURS`: flare red `#ff2a3d`, gantry lime `#c9f31d`), HUD event icons (hairpin, light tree), map Races filter, career rules (`FESTIVAL_RULES` touge rep 6 / 4,500, drag rep 0 / 2,000) and the career hub's star text. | No championship (series of rounds) or online head-to-head; one touge and one drag event. |
| 043 | Touge at blue hour, aerial: two cars ~3 lengths (12–15 m) apart through one hairpin (inner radius ~15–20 m), 2-lane road ~6.5–7 m with a yellow centre line, W-beam on the outside, "急カーブ" painted on the approach, headlights on, dense cedar. | `varda-touge`: downhill from below the Varda summit (502 m) to the first switchback (245 m): 3,501 m measured, four hairpins of R 12–20 m on the 3.5 m-lane mountain road (test `runs the touge down the Varda switchbacks`). Staged at dusk: `FestivalEventSpec.lighting: 'sunset'`; `FestivalSession.stageLighting` switches a day session to golden hour for the run and back after it (unless the player changed it). Live gap to the rival on the event panel (`session.ts` `tougeGap`, from both cars' legal distance–time traces). | The scene's blue-hour grade is the existing golden-hour preset, not a dedicated dusk; the pass keeps its existing furniture (no painted 急カーブ). |
| 044 | Touge at sunset: the chaser 1.5–2 lengths (7–9 m) behind the leader in a hairpin, orange/white delineator posts at the apex, W-beam and fence outside, violet-pink sky. The duel is decided by the gap. | Stars by the margin over the rival at the finish (`starsFor` case `touge`, spec `stars: [-3, 0.001, 2]`: within 3 s 1, win 2, win by 2 s 3); `FestivalResult.margin` (rival still running: measured from the player's own trace — how long ago the player passed the rival's position, `tougeMargin`); results card "Ahead of / Behind your rival by …". Rival on the route driver at skill 0.92 (development run: TC-1 on the autopilot 109.7 s vs the TC-3 rival 101.0 s, no resets). | No lead/chase rounds, contact rule or rematch; apex delineators not added (road furniture belongs to another area). |
| 048 | Night touge start: two cars side by side, door gap ~1 m, at a standing start between red flares at both road edges, rails both sides, heavy radial blur. | Touge grid: both cars side by side 4 m down the route (columns ±1.7 m in the 3.5 m lanes: 3.4 m centres, ~1.5 m door gap with 1.9 m cars), player on the right, 3 s standing countdown with the brakes held (test `starts two cars side by side`). The touge start is a race start, so agent F's arch (11 m) and night flares (8.5 m, beside the towers) stand at it; the grid sits 4.5 m behind the flares so they burn either side of the view ahead, as in the reference (first try at 10 m put them beside the cars, out of the chase view). | At golden hour the flares are not lit (F's flares are night-only); the night look needs the player to choose Night. |
| 077 | Drag meet start: six lanes on a runway ("18" threshold), lanes ~4.5–5 m (car ~40 % of a lane), low printed lane walls ~25 m from the line, one start-light tree per lane ~6–8 m ahead of the staged cars, white start bars per lane, gantry ~35 m past the line, yellow shoulders, grandstands. | `kestrel-drag`: four 5 m lanes (`drag.ts` `DRAG.lane`, `dragLanes`) on the hub's runway launch line; every car staged with its front bumper on the line (`session.ts` `stage`), player in lane 1 (left of centre); a quarter mile measured (`QUARTER_MILE` 402.336 m, `FestivalEventSpec.finish`, `RoutePath.finishAt`) with 840 m of runway beyond to stop. `drag-strip.ts` `DragStrip`: white start bars per lane at the line, a finish line, chequered timing boards on both shoulders, and a portable centre tree 9 m past the line between the middle lanes, drawn only during a run (other events drive through the line). | No lane walls, painted shoulders or burnout boxes; trees on the shoulders plus one centre tree, not one per lane; no grandstands. |
| 078 | Christmas trees: pole ~2.5 m, stacked lamp pairs on a black housing (small pre-stage/stage at the top, ambers, green at the bottom), green lit at the launch; four cars launched side by side. | A full ("sportsman") tree, sequenced: pre-stage on placement, stage after 1 s, an automatic start delay drawn per run (0.6–1.4 s), three ambers 0.5 s apart (one at a time), green 0.5 s after the last; a lane that rolls 0.3 m out of the stage beam before green shows red and never its green (`drag.ts` `dragTree`, `treeLamps`). The hub trees' 28 lamps (agent F's housings, now `FestivalEventDressing.startLamps`) plus the centre tree's 14 are one instanced mesh lit from the presented frame's simulation clock (`DragStrip.update`), lane columns per tree; the HUD shows the player's and the next lane's column (`festival-hud.ts` `dragTree`), so the 3D and HUD trees agree. | Real trees use one tree per lane pair on the centre wall; ours has two shoulder trees and a centre tree. No "win light". |
| 079 | Drag run from the side: a launch with the front lifting, printed barriers ~1 m, crowd. The run is a timed quarter mile. | Per-lane timing slip (`DragTimer`, crossings interpolated between steps so the slip does not depend on the step rate: test at 30/120/240 Hz): reaction from green to leaving the beam, 60 ft (18.288 m), eighth mile (201.168 m) and quarter-mile elapsed time from leaving the line, trap speed over the last 66 ft (20.1168 m); race clock = reaction + elapsed time; results wait up to 4 s for the other lanes. Staged cars are held by the brakes while the throttle is closed (rev against them for a brake-torque launch); a jump start is a red light: disqualified, last, `completed: false`, no stars or pay (`finishRun`). Results card slip (`dragSlipHtml`). TC-1 development run: reaction 0.501 s, 60 ft 2.13 s, eighth 8.39 s, ET 12.87 s, trap 177 km/h. AI lanes react 0.11–0.23 s after green and keep their lane after the finish (`RouteDriver.keepLane`). | No wheel-stand, launch control or burnout; the slip uses the front bumper station on the path (runway bows gently: `RoutePath.locate`). |
| 040 | Drift Attack arch and several cars sliding through the start; a skill-led event format. | Unchanged drift zones (agent F's arch/flags); the skill chain gains Air and Near Miss (below), shown by F's popup. | — |
| 041 | HUD popup "7,850 x2.4 / Ultimate Drift 1,000": a named skill and its points under the chain total. | New named skills through the same popup: `SKILL_TIERS.air` AIR / GREAT / AWESOME / ULTIMATE AIR (260 points a second of air, 0.35–1.5 s off the ground at ≥ 14 m/s, a clean landing on the road; longer flights are falls) and the traffic pass renamed NEAR MISS (`skill-chain.ts`). | No Wreckage (the region has no destructible roadside objects). |
| 042 | "9,058 x3.1 / Awesome Drift 500" with the chain timer bar. | Air awards add to the chain and restart its bank timer like other skills; an impact on landing loses the chain (tests `Air and Near Miss skills`). | — |
| 049 | Festival gate start: four cars leaving under a banner bridge between flags, crowd on the gate. | Race starts keep F's arches and flares; the touge start gets them because it is a race kind. | — |
| 100 | Two cars drifting in tandem on a tree-lined mountain road with a W-beam: the touge's close two-car running. | Touge rival on the same route as the player, live gap in the event panel, side-by-side start. | No tandem/drift battle scoring. |

## Rewind (no reference image; Forza convention)

`rewind.ts` `RewindBuffer`: a ring of frames every 0.1 s of driving time, 10 s deep (101
frames): every car's pose, velocities, wheel spin, gear and engine speed (a motorcycle's own
dynamics state), and the running event's legal progress (`RouteProgress` fields and finish
times relative to the start), clocks, AI route distances, drift-meter state and touge-trace
lengths. Hold Backspace (or the existing configurable Flashback binding; a controller button
rewinds a fixed 3 s): the worker stops integrating and scrubs back at twice real time, posing
the cars and the event clock from the history (`OpenWorldSimulation.scrub`); release restores the
frame at or before the cursor — fresh cars (as a reset) with the recorded state, the event's
progress and clocks — and drops every newer frame, shifting the rest so the history stays in
driving time. A HUD indicator (◀◀ REWIND, history bar, seconds rewound) and a cool streaked veil
show while held. Not available on the drag strip (the start is the event), in a countdown, on a
result or on the autopilot; the history is cleared by a reset, a new machine, travel, the
autopilot and every event start/end, so nothing before them can be restored. Results carry
`rewinds`; the career pays a rewound run but not its clean-route bonus (rewinding undoes the
moments that line measures), the results card and event panel mark it.

## Measurements

Captures 1280 x 720, MEDIUM, software GL, `tc1`, review fixture (`e2e/fixtures/horizon-session.ts`,
new `freeze()` hook: the production worker pause message, to hold a timed instant). Draw calls /
triangles are `renderer.info` of the captured frame.

| View | Draw calls / triangles | Note |
| --- | --- | --- |
| Drag strip, fixed view from 32 m behind the line, free roam (`hub-free`) | 198 / 603,990 | Shoulder trees dark, no centre tree, start bars and boards. |
| Same view, four cars staged (`hub-staged`) | 341 / 723,146 | + three rivals and the centre tree. |
| Same staged frame with the drag-strip module hidden (`hub-staged-no-strip`) | 334 / 709,456 | The module measured in the same frame: **+7 draws, +13.7 k triangles** (lamps, centre tree, paint, boards, posts and their shadow draws). Agent F's static lamp batch it replaces was 1 draw (28 lamps x 80 triangles). |
| Chase camera staged, HUD tree (`drag-staged`) | 285 / 674,614 | Pre-stage + stage lit. |
| Second amber (`drag-amber`) | 288 / 702,262 | 3D and HUD trees on the same lamp. |
| Green (`drag-green`) | 304 / 738,070 | Rivals launching (reaction 0.11-0.23 s). |
| Centre tree inspection at the third amber (`drag-tree-amber-closeup`) | 171 / 569,938 | HUD hidden. |
| Drag result card (`drag-result`) | 286 / 424,000 | TC-1: reaction 0.409, 60 ft 2.132, 1/8 8.394, ET 12.870 s, 177.0 km/h, P3 of 4. |
| Touge start, golden hour (`shots3/touge-start`) | 701 / 2,101,769 | Side by side 4 m down the route, the arch just ahead, countdown 2, gap +0.00 s (first grid at 10 m: `shots/touge-start`, 635 / 2,091,784). |
| Touge 24 s in (`shots/touge-mid`) | 319 / 927,994 | Autopilot-driven capture (marked assisted), rival 2.18 s ahead. |
| Touge start at night (`shots-night2/touge-start`) | 620 / 1,833,080 | Red flares burning either side ahead of the two cars, under the arch (ref 048). |
| Touge 14 s in at night (`shots-night/touge-mid`) | 517 / 2,122,776 | Rival's tail lamps 1.55 s ahead on the switchback road (ref 043). |
| Rewind held 0.9 s (`rewind-hud`) | 425 / 2,189,498 | 1.8 s back, 8.2 s of history left, veil and indicator. |
| Released (`rewind-released`) | 428 / 2,218,718 | "Rewound" message, driving on. |

Per-module cost: drag-strip lamps 1 instanced draw (28 lamps in free roam, 42 during a drag,
100 triangles each, unlit lenses keep a dark dye, lit ones are HDR for the bloom), centre tree 1
draw (only during a drag), start bars and finish line 1 draw (5 quads), chequered finish boards
and posts 2 draws; shadow casters add their shadow draws; the whole strip is culled beyond
1.5 km. Measured in the staged frame above: +7 draws, +13.7 k triangles. Agent F's static hub
lamp batch (1 draw) is replaced by the instanced lamps. Simulation: drag timing is one
`RoutePath.locate` (±30 m window) per car per 120 Hz step during a drag; the rewind history
samples at 10 Hz (≤ 8 cars x 27 doubles a frame) and the scrub integrates nothing.

## Validation

- `npx tsc --noEmit`, `npx eslint` on every changed file, Prettier on the files that were
  Prettier-clean before (`career/festival.ts`, `route-driver.ts`, `route-path.ts`,
  `festival-result.ts` and `career-hub.ts` were not, and keep their style).
- `npx vitest run tests/festival-*.test.ts tests/open-world*.test.ts tests/solvane-*.test.ts tests/traffic.test.ts`
  — 34 files, 269 tests passed (the new file re-run after the last tweaks: 19/19).
  New: `tests/festival-events-r4.test.ts` (19 tests: event data and legality, touge grid and
  margin stars, tree sequence, step-rate-independent drag timing, staging, red light,
  brake-torque launch, 3D lamp sequencing, rewind history bounds, scrub/restore, progress and
  clock restore, no rewind on the strip, history cleared on reset, career payouts for both
  formats and rewound / red-lit runs, Air and Near Miss). Changed: `solvane-driving-detail`
  (the traffic pass is now NEAR MISS).
- `e2e/49-festival-menu-access.spec.ts` was not run: its Playwright config reuses whatever preview
  server holds port 4173, which parallel workers share. The HUD additions are new elements
  (tree, rewind indicator, slip) and one hint string; menu markup and focus order are unchanged
  except one sentence and one key hint in the driving note.
- `npm run test:open-world` — every check passes except `sm450: rode 120 s of free roam on the
  autopilot without a fall` (one fall). The same script on the integration head without this
  work gives byte-identical results (traffic digests 4174570640 / 4024271873, drives 217.8 s and
  141.8 s with no off-route time, the valley sprint, all bike numbers, the same sm450 fall), so
  that failure predates this work and the drives are unchanged by it. `docs/open-world.json` is
  not committed: the committed file predates three earlier events, and the only change this work
  makes is two added event entries (`varda-touge` 3.56 km, 9 checkpoints; `kestrel-drag` 1.30 km
  to the end of its run-out, finish gate at the quarter mile). The regenerated report is kept in
  the scratchpad (`agentK/open-world.after.json`, baseline `agentK/basecopy/docs/open-world.json`).

## Screenshots (scratchpad `agentK/shots/`)

`shots/drag-staged.png`, `shots/drag-amber.png`, `shots/drag-green.png`,
`shots/drag-tree-green.png`, `shots/drag-tree-amber-closeup.png`,
`shots/drag-shoulder-tree-amber.png`, `shots2/hub-free.png`, `shots2/hub-staged.png`,
`shots2/hub-staged-no-strip.png`, `shots2/drag-result.png`, `shots/touge-start.png`,
`shots/touge-mid.png`, `shots3/touge-start.png`, `shots-night2/touge-start.png`,
`shots-night/touge-mid.png`,
`shots2/rewind-hud.png`, `shots2/rewind-released.png` (first rewind attempt with traffic:
`shots/rewind-hud.png`, the car stuck behind a van). No "before" exists for the new formats;
the drag-strip module's cost is measured by hiding it in the same frame (above). Capture script:
`agentK/scripts/capture.mjs` (scenarios drag, drag-closeup, drag-run, hub-cost, touge, rewind).

## Known limits and next steps

1. A proper drag-strip build (lane walls, painted shoulders and burnout boxes, one tree per lane
   pair on the centre wall, win lights, grandstands) needs the road-surface owner; the timing
   and lamp logic are ready for more trees (sockets are data).
2. Touge as a championship (rounds, lead/chase, contact penalties) and a dedicated blue-hour
   lighting preset; the touge currently switches day to golden hour.
3. Rewind restores fresh cars (damage repaired, tyre/brake temperatures reset) and drops the
   unbanked skill chain; a full vehicle state snapshot would make it exact. Controllers rewind a
   fixed 3 s (no held-button path through the input controller).
4. Air awards depend on crests (no ramps in the region); Wreckage needs destructible scenery.
