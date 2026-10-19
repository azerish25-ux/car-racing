# Motocross mechanical realism and practice targets — 2026-10-19

This pass improves how the motocross bike's parts connect, how different soils respond to light, and what the rider can learn from each jump. It builds on `88e604b078a0ac42f50fa278706ca2d81182831d`, including that commit's MotoGP work. New presentation is procedural Three.js geometry and shader code, using the existing materials, terrain and simulation.

## Playing the new objective

Choose **OUTDOOR MX** or **STADIUM SX**, select MX250 or MX450, and choose **Learn the jumps**. In solo practice, the approach HUD shows the number of distinct landing targets cleared: five at Valley Ridge and four at Arena Nord.

Use the existing approach cue to line up a jump. A target requires an observed player-controlled takeoff, a flight longer than 0.2 seconds, touchdown inside that jump's surveyed downslope, and clean contact through the 0.25-second suspension settlement. Clearing the same jump again confirms it without increasing the count. A smooth landing outside the pocket explains whether it was short or long; a rough settling phase explains why the target was not cleared.

Throttle raises the nose in flight and either brake lowers it. If the rider keeps a brake held until its wheel has slowed substantially, the HUD says **RELEASE THE BRAKE**. Release before touchdown so ground contact can bring the wheel up to rolling speed. The cue uses the actual held pedal, wheel rotation and flight state, and appears only while the player owns the controls. Existing whip recovery and caution messages retain priority.

Progress belongs to the current practice run. Watching a replay preserves completed targets and cancels an unfinished attempt. An actual rewind, a new track, or a different machine/assist combination starts a new checklist. Autopilot, off-course travel, cautions, pit travel, crashes and teleport-like discontinuities cannot earn targets. Creek Kicker has no authored downslope and is excluded. The objective adds no speed bonus, career currency or physics override.

Code: `src/simulation/offroad/landing-challenge.ts`, `src/ui/motocross-brake-cue.ts`, `src/ui/offroad-hud.ts`, `src/ui/interface.ts` and `src/ui/motocross-presentation.ts`.

## Mechanical presentation

The rear damper now connects an upper chassis mount to a lower swingarm mount. Its body remains rigid, the piston slides, and the spring changes pitch while retaining coil diameter and wire thickness. Actual transformed mounting points drive the assembly through suspension travel, steering, body pose and replay seeks. This is an original direct-mounted visual mechanism; it does not claim a manufacturer's linkage or force curve.

Front and rear brake castings have separate jaws, pads and carriers around the rotor. The rear caliper follows the swingarm independently of wheel rotation and wheel removal. A flexible front hose connects the handlebar route to the sliding fork clip through suspension travel. Dynamic buffers and angular samples are reused, and repeated snapshots avoid redundant geometry uploads.

Code: `src/rendering/offroad/motocross-mechanics.ts` and `src/rendering/offroad/dirt-bike-model.ts`. These shared dirt-bike components also receive geometry/attachment checks on SM450. The separate MotoGP bike model is not replaced.

The actual-game review also exposed four large Formula tyre blankets being placed around each motocross bike at the gate. Both the ordinary grid preparation and the optional pre-race presentation now exclude these props for motocross entrants. Supporting gate staff remain, and reusing the same views with Formula frames restores their original props and matrices. Code: `src/rendering/grid-preparation.ts` and `src/rendering/grid-presentation-view.ts`.

## Soil and wetness

Terrain vertices now carry the existing area-integrated hardpack, loam, sand and mud fractions into the material shader. This keeps the appearance tied to the same course data as the simulation and photographed ground layers.

Loam and mud show larger angular fragments with softer shoulders; hardpack exposes smaller chips; sand remains finer and rougher. Compaction reduces loose fragment relief. The existing wheel-pass pattern presses differently into each material. Pore relief and restrained cavity shading add structure without changing the terrain silhouette or collision surface.

Wet film concentrates in compacted grooves, deformed lows and flatter hollows. The actual triangle slope limits retention on steep jump faces, and filling pores smooths the normal response. Fine detail fades as it becomes smaller than a pixel. This adds shader math and a four-float terrain attribute, with no new textures, meshes, draw calls or triangles for the soil layer.

A replay correction restores session soaking alongside terrain depth and compaction when seeking before the first exported terrain state. Later wet film can no longer remain over an earlier dry geometry state.

Code: `src/rendering/offroad/mx-soil-morphology.ts` and `src/rendering/offroad/terrain-view.ts`.

## Wheel contact after flight

Previously, the adapter assigned both wheel speeds directly to rolling speed at touchdown. Player MX250/MX450 landings now preserve airborne angular speed and synchronize each wheel as it actually carries suspension load. A bounded tangential impulse exchanges momentum between the rotor and chassis, stopping at rolling equality or the remaining friction budget.

The existing drive, brake and cornering demands reserve their grip first. The additional impulse cannot claim that force twice, and each impulse dissipates relative-contact energy. Its force contributes to ground travel, pitch feedback and the existing tyre telemetry. Airborne trajectory and the first touchdown remain unchanged by this contact correction.

This is a conservative correction for wheel-speed mismatch inherited from a qualifying flight, layered over the existing rolling core. It does not replace that core with a complete dynamic tyre/drivetrain solver. AI, supermoto and insignificant terrain hops retain their calibrated path. In measured locked-front-wheel examples, pickup took 25–83 ms and changed speed measured 0.3 seconds after touchdown by −0.058 to −0.283 m/s. Those are outcomes of the tested runs, not fixed penalties.

Code: `src/simulation/offroad/wheel-pickup.ts` and `src/simulation/offroad/dirt-bike-vehicle.ts`.

## How the 100 references were used

All 100 numbered originals were recovered and their hashes checked against the repository's reference index. All were visually reviewed on labeled contact sheets; 17 selected originals were additionally inspected at full resolution. The archive SHA-256 is `d8c8fbb62974432e8feafa853917deb45765dccc18be7d1da8ece9be512a9c73`.

The per-image [reference review](motocross-reference-review-20261019.json) preserves filenames, supplied source URLs and hashes, earlier observations, this pass's rationale, and existing implementation paths. Thirty-one images support principles transferred into this pass, 47 check retained systems, and 22 provide context. These are review decisions, not counts of new features.

| Observed principle                                   | Representative references | Application                                            |
| ---------------------------------------------------- | ------------------------- | ------------------------------------------------------ |
| Attached suspension through extension and whip poses | 006, 011, 026, 031        | Chassis-to-swingarm damper and fixed spring dimensions |
| Brake casting, rotor clearance and routed hose       | 005, 012, 027             | Caliper jaws/carriers and flexible fork hose           |
| Coarse earth beside compacted wheel passages         | 035, 044, 054, 058, 065   | Material-specific fragment and tyre-impression shading |
| Damp hollows below drier ramp faces                  | 043, 059                  | Slope-limited film and pore smoothing                  |
| Loaded rear tyre with a free front wheel             | 068, 087, 092, 095, 096   | Per-wheel loaded-contact pickup                        |
| Readable landing corridor and subordinate guidance   | 086, 100                  | Solo downslope targets and held-brake feedback         |

The earlier helmet/goggles, bodywork, knobbies, wandering tyre passages, roost, spectator and recoverable-whip work is retained. ATV/UTV, snow/desert/tropical settings and branded events remain reference context. No supplied screenshot is packaged as a game texture. Still images guide appearance and riding readability; they do not measure friction, inertia or gameplay thresholds.

## Measured rendering cost

The same production equipment fixture was captured before and after on ANGLE SwiftShader. Counts include the complete bike/rider fixture scope.

| MX250 / MX450 detail | Before triangles | After triangles | Before calls | After calls |
| -------------------- | ---------------: | --------------: | -----------: | ----------: |
| High                 |          104,266 |         105,874 |           67 |          71 |
| Mid                  |           49,997 |          50,833 |           63 |          67 |
| Far                  |           11,971 |          11,971 |           45 |          45 |

High detail adds 1.54% triangles; mid adds 1.67%. High/mid retain 16 textures and 18 programs; far retains 10 textures and 13 programs. Four extra geometry objects support the new near/mid components. The terrain attribute adds 758,880 bytes for the outdoor course and 488,432 bytes for the stadium course; it does not increase their mesh or triangle count.

## Validation and reproduction

The [validation record](motocross-validation-20261019.json) records the exact application hashes, build identity, unit/static checks, browser outcomes, resource measurements and scope of the physics probes.

The production build, full ESLint check and content validation passed. The broad unit run completed 3,562 cases across 428 files: 3,554 passed, with eight failures confined to two existing CLI test files whose child-process output was blocked by the restricted runner. Both unchanged files passed with normal process access (10/10 cases). A later gate-prop regression run passed 38/38 cases, including the two newly added cases that were absent from the broad run's initial discovery. Together these runs cover all 3,564 distinct current cases; this is a combined result, not a claim that the initial command exited successfully.

Seven final browser checks passed across the bike, terrain, interface, practice and actual-game specifications. The new practice check uses production CSS and the loaded Saira font at 390 and 1,280 pixels for both venues. The actual-game journey passed eight-rider starts, manual throttle input followed by explicitly enabled autopilot, more than 100 metres of course progress, a qualifying flight and touchdown, chase/onboard cameras, pause and return to the paddock on both venues. All six final gate/chase/onboard screenshots were visually reviewed; both gates have the intended crew and gate without the Formula tyre blankets.

The complete game journey used **Low**, selected through the visible settings form. An earlier attempt at default **Medium** exhausted its riding wait on ANGLE SwiftShader, with a GPU fence pending for about 168 seconds and no observed qualifying flight. Low completed both venue flows in 5.1 minutes of wall time. The isolated detailed bike/material/shadow captures passed separately; the Low functional result does not establish Medium/High gameplay performance. Consumer-GPU frame rates remain unmeasured.

The existing off-road calibration passed all 20 jump cases. Separate fixed-seed, eight-rider, three-lap race probes finished every rider: Valley Ridge recorded zero crashes; Arena Nord recorded two, within the existing bounds. These exercise the production AI race behavior and do not substitute for a human difficulty assessment.

The optional target probe runs a fixed, bounded 18-case matrix through the full production `Simulation` and actual target tracker. Every case begins manually eligible 12 metres before the face, at a documented rolling approach speed, and thereafter uses public inputs. All 18 targets were earned across 6,262 snapshots, with no ineligible/off-course samples, crashes or rebounds. Clean feedback held through 0.267–0.275 seconds of observed settlement. Reproduce it from the repository:

```sh
node --experimental-transform-types scripts/motocross-target-feasibility.ts
```

Add `--out report.json` to save the complete result. This checks scripted feasibility, using the production landing forecast for pedal decisions. It does not establish beginner ease or a whole manual lap from the gate; the smallest observed placement margin was 0.197 m.

The new mechanical tests cover full 4 × 4 fork/rear travel combinations, mount attachment, shaft overlap, constant spring dimensions, rotor clearance, hose endpoints and resource reuse. Contact tests cover momentum/energy bounds, loaded-wheel behavior, 120/240/480 Hz convergence, real flights and exact input-journal resimulation. HUD checks cover settlement, unique targets, replay, control ownership, caution priority and production CSS/font layout.

These results support improved mechanical and material realism. The world and rider still have a procedural appearance. Software-GPU correctness and geometry counts do not establish consumer-GPU frame rates or photographic/AAA parity.
