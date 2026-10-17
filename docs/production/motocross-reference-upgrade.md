# Motocross reference upgrade

## Outcome and scope

The motocross work improves the existing MX250/MX450 presentation, rider equipment and contact poses, prepared soil, course markers, stadium construction, dirt effects, player air control, chase camera and paddock/HUD flow. It applies observations from all **100 individually inspected reference images** to the existing outdoor motocross and stadium supercross modes.

The complete image-by-image record is [motocross-reference-map.json](./motocross-reference-map.json). Each numbered record contains the supplied filename and provenance metadata, the reviewer's visual observation, an implementation application, existing code paths and any scope or filename caveat. Its `validation` section records the actual verification commands and results.

The reference package mixes storefront, publisher and review-gallery material; its platform labels are supplied metadata rather than verified capture hardware. The game uses original in-engine assets informed by those images. No source JPG, licensed race logo or branded portrait was added.

The implementation started from commit `f91463cf506f6feced1a4db9c43af48ac3632410`. The existing TypeScript/Three.js asset pipeline provides the articulated parts, original geometry, materials and shader hooks used here. The completed feature work described below does not depend on a Blender export.

The combined implementation preserves concurrent MotoGP R2/R3/R3.1/R4 and Festival work through `d4dd3e541433a0eb7513b0b9124c932911a64bdb`. This includes the road-bike construction and cameras, motorcycle readout, MOTOBOUND branding, shared braking, GP slipstream, cooling outlets, repaired animated chains, radial calipers, disc glow, paint and crowd detail, the incoming authoring/review workflows, and the Festival graphics/gameplay work. One selected-machine showroom contract serves both vehicle families while the motocross menu, status column and instruments retain their dedicated presentation.

The independent [incoming-change preservation audit](./motocross-evidence/validation/remote-preservation.json) accounts for all **198 incoming paths**: **179 match incoming bytes exactly** and **19 have reviewed combined differences**. There are no missing files, mode mismatches or unexplained differences. Festival-specific source, tests, documentation and image assets remain exact incoming bytes.

The current GP integration preserves the incoming R3.1 chain repair and keeps the new radial calipers within the original complete-model budget. A measured caliper tessellation correction reduces the GP-R1 high model from 110,708 to **109,764 expanded triangles**, below the unchanged 110,000 ceiling, while retaining exact caliper outer bounds and mirrored rotor-slot clearance. Instance buffers still dispose exactly once, and the GPU checks retain the original render-call limit. The [earlier chain repair](./motocross-evidence/compatibility/chain-integration/README.md) is kept as historical evidence; [current R3.1/R4 evidence](./motocross-evidence/compatibility/r31-r4/README.md) records the final construction and tests.

## Open the upgraded modes

Choose **OUTDOOR MX** or **STADIUM SX** in the paddock, select **MX–450** or **MX–250**, then choose a ride preset and **ENTER CIRCUIT**. The venue shortcut selects a compatible eight-rider race. Presets change the existing session controls and leave entry under the player's control.

| Preset          | Session          | Riding aids |
| --------------- | ---------------- | ----------- |
| Learn the jumps | Solo practice    | Sport       |
| Race the pack   | Eight-rider race | Sport       |
| Full control    | Eight-rider race | Raw         |

Use the configured steering/throttle/brake controls to ride. In flight, throttle raises the nose, either brake lowers it, and steering banks the bike; releasing steering asks it to level. The default `C` key changes the camera, `Escape` pauses, and `G` explicitly enables or disables the existing AI demonstration. The race briefing retains the normal start and pre-race presentation options.

## Reference coverage and interpretation

The supplied `REFERENCE_INDEX.csv` has 100 rows. All 100 numbered source files were found, all 100 recorded SHA-256 values matched the actual extracted files, all 100 source hashes are distinct, and every record resolves to one or more of **35 existing implementation paths**. The reproducible [reference integrity record](./motocross-evidence/reference-integrity.json) includes the supplied archive and CSV identities, full image decode and dimension checks, the normalized reference-array identity, and exact hashes, dimensions and review methods for 90 registered output captures across the retained validation stages. The source images remain reference material outside the repository.

| Reference numbers | Individual reviewer | Main contribution                                                     | Count |
| ----------------- | ------------------- | --------------------------------------------------------------------- | ----: |
| 001–032           | `bike_rider`        | Bike mechanics, moulded plastics, rider gear, reachable contact poses |    32 |
| 033–052           | `terrain_fx`        | Course surfaces, route markers, shoulders, stadium structure          |    20 |
| 053–076           | `riding_camera`     | Rider framing, air/landing readability, forward course visibility     |    24 |
| 077–086           | `riding_camera`     | Paddock hierarchy, selected machine presentation, ride guidance/HUD   |    10 |
| 087–100           | `terrain_fx`        | Wet/dry soil response, dust/clods, contact, light/venue hierarchy     |    14 |

Every reviewer opened each assigned full original numbered image before implementation. A map entry means that the stated observed principle informed the stated code. It does not mean that every vehicle, landscape, animation, event effect or feature in that image was reproduced. Existing physical systems are identified as retained when the improvement is how they are shown, controlled or explained.

The inspection also caught misleading filenames. These are preserved as provenance rather than silently rewritten:

| Reference | Supplied label            | What the reviewer actually observed                                                        |
| --------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| 057       | Synchronized stadium jump | An outdoor spaceport course with a long visible landing sequence                           |
| 058       | Multi-bike stadium launch | Several bikes carving a banked stadium corner                                              |
| 063       | Stadium start gate        | Riders climbing a dirt face at different heights                                           |
| 064       | Crash and congestion      | Heavily leaned and occluded bikes; the still image alone does not establish a fallen rider |
| 082       | Two bikes in a garage     | Three motorcycles of different sizes                                                       |
| 088       | Crash with heavy roost    | Coarse rutted soil and contacting/leaning bikes, with little visible airborne roost        |
| 091       | Crowd and fire            | A crowd and hard rider highlights, without visible flames                                  |

ATVs, UTVs, snow, desert/coastal courses, promotional portraits and flame/laser shows contribute such principles as scale, ground contact, scene layering or focal hierarchy. They are not presented as newly implemented vehicles, environments or game modes. The sideways bikes in references 031, 057 and 072 informed visible undersides and controlled bank/level behavior; they do not establish a complete whip or freestyle trick system.

## Graphics and presentation changes

### Motorcycle construction and rider equipment

The motocross model now uses tapered closed body panels and shaped number boards, an open perimeter/cradle frame, layered cast engine forms, radiator fins and hoses, controls/cables, a visible linked chain, pierced sprockets/rotors, laced wheel details, denser staggered tread, serrated open pegs, seat gripper ribs and an open layered exhaust outlet. Original entrant graphics distinguish the machines without importing reference brands. The existing articulated fork, swingarm, wheel and detail-level hierarchy remains the basis of the model.

The rider gains a shaped helmet peak and chin area, curved goggles, vent/strap detail, textile normal/roughness and folds, entrant kit graphics, and layered boots with soles, ankle structure and buckles. Motocross-specific pose branches refine torso counterlean, elbows, standing height and the forward inside-foot dab. These changes address visible gaps, rigid primitive shapes and unreachable limb targets while preserving the road-rider path.

Implementation: `src/rendering/offroad/dirt-bike-model.ts`, `src/rendering/offroad/motocross-detail.ts`, `src/rendering/offroad/motocross-gear.ts`, `src/rendering/rider.ts`.

### Dirt surface, course and arena

Prepared soil detail follows the course's longitudinal and lateral coordinates, so rake marks and tyre lines turn with the track. The motocross material adds local grain, groomer/tread cues and wet groove contrast, and removes a duplicate color decode that had crushed the soil tones. These are shading changes over the existing physical profile; they do not invent extra collision-affecting jump displacement.

The full-app material review also found that terrain slot ordering chose a meadow scan for broad dirt variation, including stadium terrain with no turf cells. Outdoor MX now explicitly uses the resident forest-floor scan and SX uses dry earth for those two broad taps. Fine scanned grain, normals and roughness are retained, and the shader cache key distinguishes the selected slots and macro. The revised environment fixture exercises the actual loaded scan path.

The course gains stakes, paired takeoff/landing markers at the surveyed jump stations, original sagging banners, canopies, a holeshot arch, and uneven shoulder grass/stone groupings. Stadium lanes gain padded boundaries. Arena structure uses separate open-web chords and diagonals, supports, housed round lamp banks, split seating decks, aisles, crowd color variation, concourses and original event/ribbon boards. The start gate is visibly built from open welded bars while retaining the existing gate-drop timing and race rules. Outdoor distant relief is adjusted for the motocross venue.

Complete-game inspection exposed inherited road-circuit furniture cutting across the stadium lanes. The full scene now uses low, tapered canvas padding at the actual outer collision boundary. Placement checks the whole pad footprint against neighboring riding lanes. Tall catch fences, the circuit pit complex, braking boards and freestanding circuit light towers are excluded from MX/SX; the stadium uses its own bowl and roof lamps. Formula start-light gantries, staggered grid boxes and paved tyre-rubber ribbons are also excluded from these two dirt disciplines. The real drop gate, course markers, holeshot arch, finish line and race-control signals remain integrated.

The inherited paved pit road and its white edge ribbons are also excluded from MX/SX, where that template crossed neighboring dirt lanes. Appropriate paved venues retain those surfaces. A separate renderer-level correction hides only roadside pole, mast and lamp-head meshes in the two dirt formats. The four actual point lights retain their selection and day/night behavior, the analytic ground-light pools remain active, and the authored stadium lamp banks remain visible. This keeps the tight riding lanes clear while retaining the existing night illumination.

The separate replay-camera platforms also receive a complete footprint correction. Final screenshot review found five inherited stadium platforms inside adjacent legal lanes, plus four more inside the regression clearance band. A static terrain-aware placement pass now retains all twenty optical viewpoints and matching physical platforms in each venue, with full geometry clear of every legal lane, a further 0.4 m band, grandstands and the stadium seating. Foundations conform to the actual soil, and dense production-terrain sightlines to each camera's own course center remain clear. All 880 original camera records across 44 other venues match exactly. The [placement evidence](./motocross-evidence/validation/camera-placement.json) distinguishes the twenty outdoor and sixteen stadium horizontal relocations from the five original lane crossings; the [earlier stadium captures](./motocross-evidence/gameplay/pre-camera-clearance/README.md) preserve the detected defect.

Implementation: `src/rendering/ground/soil-splat.ts`, `src/rendering/offroad/mx-soil-detail.ts`, `src/rendering/offroad/terrain-view.ts`, `src/rendering/offroad/mx-course-dressing.ts`, `src/rendering/offroad/stadium.ts`, `src/rendering/offroad/start-gate.ts`, `src/rendering/offroad/index.ts`, `src/rendering/offroad/mx-boundary.ts`, `src/rendering/venue-kit/index.ts`, `src/rendering/venue-kit/theme.ts`, `src/rendering/circuit.ts`, `src/rendering/renderer.ts`, `src/rendering/venue-lighting.ts`, `src/rendering/studio/light-pools.ts`, `tests/motocross-venue-integration.test.ts`.

### Contact and dirt effects

The bounded roost pool separates small ballistic clods from expanding, fading dust. Emission responds to tyre load/slip and soil moisture; wet conditions suppress the lighter dust component. A real touchdown can produce a short burst from the newly published landing speed. Regular contact emission is explicitly disabled while airborne, and existing particles continue evolving after takeoff. Small loaded-tyre contact shadows sample the actual course profile and rut depth and disappear in flight, leaving the existing renderer's detached vehicle shadow to describe height.

Implementation: `src/rendering/offroad/roost.ts`, with the existing `O.AIRBORNE`, `O.LANDING_SPEED`, `O.MOISTURE`, rut and wheel-load channels. No new snapshot channel is required.

### Paddock, ride choices and HUD

The existing paddock has direct outdoor MX/stadium SX entry, original dirt-series styling and venue cards, and three descriptive convenience presets: solo assisted practice, an assisted eight-rider race, and an eight-rider race with assists off. Those presets use the existing `sport` and `raw` aid settings; there is no third physical difficulty model.

The selected motocross machine uses a real snapshot with its definition, wheel dimensions and suspension sag. A dedicated smaller showroom orbit uses the bike's center-of-gravity datum so the complete bike and gear are visible. One shared `previewMachine(id)` callback records the selected machine for every vehicle family. It builds a single display-only menu frame using the motocross pose helper for MX250/MX450 and the retained R2 preview for other machines. Selection during graphics-settings preparation is deferred and applied when preparation completes; the renderer is reset for that new pose only in the menu. Live worker snapshots keep their values and buffer identity, preserving pause acknowledgements and transferred-buffer recycling when a race returns to the paddock.

Machine context reflects the actual selected definition. Event cards and briefing describe the gate, surface and race distance. The compact ride HUD uses course feature names/distances, live airtime, measured touchdown feedback and actual recovery state while retaining peripheral race timing and speed/gear information. The R2 road-bike readout is retained for road-machine presentation, and its panel opts out of motocross so that the dirt mode has one instrument set. Motorcycle telemetry follows every presented snapshot; the existing car cadence also refreshes after a significant time change.

Rev lights, the RPM arc and shift guidance use the selected dirt bike's actual engine limits. The left gauge shows fuel, and the tyre panel identifies the two physical tyres as front and rear. Formula-specific battery, DRS and start-light controls are hidden in motocross. Controls help follows the selected venue in the paddock and the actual loaded circuit during a session. The masthead and control hint use dirt-series/rider terminology when those venues are selected. The route card and ride presets span the full setup width. Short screens scroll the fields above a reserved row for the original ENTER CIRCUIT submit button; the action stays visible, every native control is reachable, and leaving motocross restores the original form structure.

Race alerts, jump guidance and the actual radio-caption component share a flowing status column. Compact landscape keeps that column beside the instrument area; portrait and desktop retain a centered presentation. Leaving motocross restores each original DOM parent. Initial telemetry updates on the first snapshot, and a sparse presentation refreshes after sufficient simulation progress, so a slow render cannot leave the template position, lap count, fuel and revs on screen.

Implementation: `src/rendering/offroad/menu-bike.ts`, the motocross menu branch in `src/rendering/renderer.ts`, `src/main.ts`, `src/ui/motocross-presentation.ts`, `src/ui/motocross.css`, `src/ui/motocross-status.ts`, `src/ui/event-cards.ts`, `src/ui/race-briefing.ts`, `src/ui/offroad-hud.ts`, `src/ui/f1-hud.ts`, `src/ui/interface.ts`.

Venue changes now close the disposed renderer's decoded-texture cache to new requests, let existing loads and format fallbacks finish, and release its KTX2 worker pool exactly once. Resident texture clones retain their shared image data, and the replacement renderer has an independent pool. This repairs a real lifecycle leak without cancelling in-flight decodes or weakening the renderer's GPU preparation fences. Unused circuit and venue-kit palette materials also participate in the renderer's deduplicated cleanup, and the main light releases its shadow targets. Complete-venue regression tests return scanned-material registrations to their original baseline and verify that shared resident source images survive.

## Player control and landing behavior

The existing dirt-bike adapter already supplied independent long-travel front/rear suspension, sprung heave/pitch, tyre contact/load, berm support, dab, terrain-following takeoff, ballistic flight, rear-wheel reaction torque, Sport pitch assistance and crash/remount state. The upgrade builds on that calibrated model.

| Input or behavior                 | Result in this change                                                                                                    | Bound or compatibility condition                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Normal brake during player flight | Slows the finite front-wheel spin and supplies a nose-down reaction; the touch brake therefore also has an air-pitch use | Front spin cannot become negative; stopped front-wheel braking adds no further wheel reaction torque                              |
| Throttle / rear brake             | Retains the existing rear-wheel nose-up/nose-down reaction                                                               | Existing clutch control channel remains rear brake for bikes                                                                      |
| Raw pedal weight shift            | Rider braces forward under braking and draws back under drive                                                            | Body target clamped to −0.3…+0.8; uses existing controls                                                                          |
| Left/right in flight              | Banks the chassis; releasing the input levels it                                                                         | Desired bank is ±0.52 rad in Raw, ±0.36 rad in Sport; rate limited to 1.8 rad/s and actual lean bounded by the bike specification |
| Sport near touchdown              | Progressively reduces requested bank while retaining existing slope-targeted pitch aid                                   | Uses the existing predicted landing time; does not change the ballistic travel direction                                          |
| AI flight                         | Continues its surveyed rear-brake/pitch solution                                                                         | The new front-brake player reaction and air-bank control are skipped for AI                                                       |
| Touchdown telemetry               | Publishes the new landing record on the `AIRBORNE` falling edge                                                          | The same record refines suspension-bottom severity during the following 0.25 s                                                    |

Air banking does not steer or boost the horizontal trajectory. No additional body-control input, trick reward, boost, yaw-whip mechanic or protocol field was introduced. The focused release test exposed excessive angular reversal lag during short tabletops; the bounded roll acceleration was adjusted so releasing the input begins returning the machine promptly within the same real flight.

The physical landing thresholds remain the existing calibration and are centralized in `LANDING_RULES` where shared. A real pitch-judged flight requires takeoff speed above 6.5 m/s and airtime above 0.12 s. The default MX front-crash pitch error is below −0.46 rad with normal impact speed above 1.5 m/s; the rear-crash error is above +0.62 rad with normal impact speed above 2 m/s. Rough-section pitch tolerance is multiplied by 1.5. Actual bottom-out crashes still use the selected bike's shaft-speed threshold, not a UI intensity.

`assessMotocrossLanding()` provides **presentation feedback**, not an additional crash decision. Its input `bottomIntensity` is the decaying normalized `O.BOTTOM` value, not bottom-out shaft speed. An actual rider-state crash produces recovery feedback. Otherwise it distinguishes clean, ordinary, hard, nose-low and nose-high landings. A clean message requires low measured normal speed, very little bottom intensity and pitch close to a slightly rear-wheel-first slope match. The HUD refreshes the grade for the first quarter second so a later bottom-out can replace an initially clean reading. That refinement ends on a new takeoff; a tiny rebound cannot replace the prior jump's airtime or attach a new impact to its grade. Replay discontinuities clear transient jump state, including short backward seeks.

Implementation: `src/simulation/offroad/dirt-bike-vehicle.ts`, `src/simulation/offroad/riding-feedback.ts`. Course definitions, surveyed jump target speeds, engine power, vehicle gearing and snapshot layout are retained. The separate route-following and recovery repairs below address AI behavior around those calibrated features.

## Race reliability repairs

The complete seeded race gate exposed failures in the pre-existing off-road implementation. Replaying the exact fixed three-lap SX session on the unchanged base commit reproduced the same crash counts and unfinished riders as the upgraded source before these repairs. The work therefore includes fixes needed for the requested improvement in actual riding and racing:

- **Local barrier contact:** a chassis corner could project onto the adjacent stadium lane while the bike center was still on its original lane. The other lane supplied an opposite-facing wall normal and pushed the bike farther off course. Dirt-bike barrier contact now uses a bounded local projection when a corner leaves the center station's neighborhood. Road bikes and four-wheel vehicles keep their original branch.
- **Deep terrain contact:** crossing a discontinuous neighboring-lane profile could place the suspension far beyond its mechanical travel. The resulting bump-stop spring force produced an artificial launch. A positional contact correction acts only when overlap exceeds full travel by more than 12 cm, leaving 15 mm of compliant bump-stop penetration. Incoming velocity, normal suspension stroke, spring/damper calibration and landing-crash thresholds are preserved. The real Raw/Sport regression reduced peak altitude from about 46/44 m to below 5 m and still penalized the bad approach with the normal crash/remount sequence.
- **Consistent steering path:** the off-road planner's held jump lane and wet/rut adjustment must feed both aim points and their curvature. The base bike driver now exposes protected sampling hooks with unchanged road-bike defaults; the dirt driver supplies its actual route. Overlapping straight-feature windows hold one continuous lane through a connected jump/roller sequence.
- **Rejoining and recovery:** a misaligned rider reduces its speed while turning back. A beached rider's existing four-second marshal-assistance trigger now considers real forward drive effort rather than excluding a target speed of exactly 4 m/s. Brief traffic-braking interruptions pause that accumulated effort while the bike remains stationary. Actual movement, flight, remounting or leaving active racing resets it. Assistance still requires a current drive request and the original four seconds of unsuccessful drive, so a rider continuously waiting in a queue receives no push. Four production-controller regressions distinguish interrupted attempts, a held queue, actual movement and a real remount.
- **Checkpoint-safe recovery:** long marshal restarts now use the visible remount/push sequence through the existing five-second interval. The previous discontinuous move could skip a timing gate, correctly fail its checkpoint test, and force an extra circulation. Continuous recovery crosses each real gate normally; it does not manufacture lap progress, classification or finish times.
- **Air-to-ground controls:** the AI air-pitch solver used to overwrite the shared throttle and rear-brake input. A touchdown during the first physics substep could therefore carry its airborne rear brake into the following grounded substep, locking the rear tyre despite a clean impact. Its calculated pedals now stay local to flight and are published as telemetry, leaving the planner's ground command intact. Actual in-air reaction torque, player pedal behavior and landing thresholds are unchanged. Two regressions fly real MX250/MX450 takeoffs, observe active air braking and check the immediately following grounded step.
- **Shared-braking tyre heat:** the retained shared braking model reports full force demand, which can exceed normal tyre utilization when a braked wheel becomes unloaded. The MX250/MX450/SM450 adapter now bounds the utilization used for its tyre-temperature target to 0–1.5 and generates tyre contact work only while the machine is grounded and riding. Flight and crash recovery therefore add no tyre-work energy or wear from a stale contact sample; existing temperatures continue their passive exchange. The guard preserves the shared braking response and the road-bike thermal branch.
- **Touchdown settlement:** a clean, committed clear could be mistaken for riding in the gap during its first grounded update, applying nearly full braking while the suspension was still settling. The planner now recognizes a real matching landing for the existing settlement interval and retains the upstream desired speed, including traffic and caution restrictions.
- **Collision velocity feedback:** positional separation between two bikes could be read back as vertical velocity, causing a tilted contact to inject artificial speed. The dirt adapter now differentiates its own previous authoritative height, so external overlap correction does not become a fabricated heave velocity. Real no-contact motion and normal placement/reset remain unchanged.
- **Safe jump abort after steering intervention:** the heading guard runs after jump planning and can materially slow a committed approach. It now marks that same locked plan as a roll when it actually lowers the approach target before the face. The plan retains its identity and locked state, preventing immediate re-selection as a clear. Mirrored MX250/MX450 approach regressions exercise the actual controller and real takeoff/landing.
- **Motocross caution procedure:** the shared director previously escalated a persistent dirt-course hazard to VSC and a safety car. An explicit motocross ruleset opt-out now retains spatial yellow/double-yellow warnings, their caution speeds and penalties without deploying a pace car. Existing road, MotoGP and Supermoto defaults remain enabled. Production-controller tests cover both dirt venues, clearing hazards, unaffected riders and the retained road procedures.
- **Pit-service eligibility:** motocross motos and supercross heats already disable in-race service. The inherited road tyre strategy could nevertheless request a stop and park a healthy rider indefinitely. AI requests, player requests and physical pit-service updates now respect the loaded `service.pitStops` flag. Permitted road, motorcycle and Supermoto service retains its existing behavior.

The final race results and unchanged validation bounds are recorded in the validation section. No timeout, crash-count or classification gate is loosened to accept a failing race.

## Motocross chase camera

The dedicated rig is selected for the motocross class; existing Formula/MotoGP camera branches and shared showroom constants remain in place. Its raised, wider frame fits the full rider and more neighboring lane width. It follows physical heading, looks partway into the next course bend when the rider is aligned with the route, and eases its gaze down toward the landing surface during flight. A small air pullback keeps extended suspension and the landing corridor visible without following the chassis nose into the sky.

The base desired eye is 5.4 m behind and 1.72 m above the bike anchor, with bounded speed and air adjustments. Field of view runs from 56° to at most 63°. Camera roll is limited to 0.055 rad before the user's motion gain is applied. A small analytically damped landing dip is also scaled by that motion setting; zero motion removes roll and landing shake.

The camera samples the same terrain used for tyre contact. Both the desired eye and the final spring-filtered eye keep at least 1.05 m terrain clearance, and three sightline probes guard against a crest engulfing the view behind the rider. Presentation time drives smoothing and impacts, so pausing holds the camera state and replay/reset discontinuities clear the prior flight/landing response. Photo orbit is excluded from the chase clearance override.

Implementation: `src/rendering/offroad/chase-camera.ts` and the restricted motocross branches in `src/rendering/renderer.ts`.

## Motocross onboard view

The dirt-bike cockpit has a separate helmet-height mount and a wider view for the raised handlebar. It follows the machine's off-road specification, covering MX250, MX450 and the shared SM450 platform. The inherited GP windscreen socket was only centimeters behind the front number plate, which blocked the complete-game view. The new view keeps the real bar pad, grips and levers visible while clearing the plate and central driving corridor. Only the followed rider's own helmet and torso are hidden for that view. Continuous sleeves retain both authored arm lengths and real grip contacts; leaving first person restores the exact exterior arm transforms. The number board has an unprinted back. Other riders retain their full rig, and existing road-bike mounts remain unchanged. MX250, MX450 and SM450 pass 12 pose/aspect cases per machine, including production speed-dependent FOV and a negative control with the old obstructed mount. The GPU fixture additionally renders six seated, standing/steered and braking/leaned MX250/MX450 cockpit views; its SM450 coverage is CPU geometry/camera verification.

Implementation: `src/rendering/bike.ts`, `src/rendering/offroad/dirt-bike-model.ts`, `src/rendering/rider.ts` and the selected-bike onboard call in `src/rendering/renderer.ts`.

## Validation record

The complete production journey passed on the camera-clearance build preserving remote `main` through `3162620`, with **667 source files**. Its frozen source digest is `7733bb95ae33dc962eb2e6d07b2d3480dac3276a50753733268a68b22f500d36`; its build fingerprint is `82b5018336f9fb2c9ae1c2fcc7d11d1c3011209ec2e1c8471be5111c033c52e8`. The [journey record](./motocross-evidence/gameplay/test-run.json) retains its source, twelve context files, bundle identities and matching before/after checks. Browser and race records identify the source they actually exercised. The archived [camera-clearance build](./motocross-evidence/validation/camera-clearance-build/README.md) preserves that complete-journey build unchanged.

The final build then integrates the incoming changes through `d4dd3e5`: **670 source files**, source digest `acfc1a799a933ff9c135046aee17daa741366549f7808b8091200accf69f874d`, and build fingerprint `a5a1575e169f6475439722adeb3ac6ae569bc91b6d604f14e465faf7eccc6de4`. The [runtime-delta record](./motocross-evidence/validation/r31-r4-isolation.json) accounts for six modified and three new runtime paths while 661 original files are unchanged. Dirt geometry, terrain, camera, HUD and dirt simulation retain their completed-journey code. Shared material allocation, the Valley crowd shader and the GP road-physics branch have separate final controls. The latest GP, MX and crowd renderer tests all pass on this exact 670-source build; their 43 new original captures were individually displayed and reviewed.

Component captures separate the machine, environment and interface for inspection. The final journey exercises the normal application and simulation worker. Software rendering establishes functional and visual behavior in this environment; it does not establish a consumer-device frame rate.

| Check | Actual result | Evidence and scope |
| --- | --- | --- |
| Individual reference review and integrity | **100/100 passed** | Every supplied JPG and CSV field checked, 100 matching/distinct hashes, individual observations retained, all **35** mapped implementation paths present; [integrity record](./motocross-evidence/reference-integrity.json) |
| Combined R2 CPU integration | **219 tests in 28 files passed** | [Per-file record](./motocross-evidence/validation/r2-combined-cpu.json): camera, cockpit, models, HUD/menu, worker pause, renderer lifecycle, full venues and retained road behavior; this run precedes the later focused AI/R3 changes |
| R3/Festival shared CPU integration | **34 tests in 9 files passed** | [Per-file record](./motocross-evidence/validation/r3-shared-cpu.json): Festival models/effects, shared spray, GP cooling and slipstream; scope through the incoming R3/Festival integration |
| Final integrated riding and physics | **69 tests in 7 files; 37.63 s** | Actual landing, heading-abort, bike contact and recovery witnesses, thermal compatibility, player controls, mixed bike behavior and race-control contracts; [regression evidence](./motocross-evidence/races/r2-control-regression.json) |
| Complete dirt venues and lighting | **8 tests in 2 files; 15.26 s** | Both complete MX/SX scenes exclude inherited pit asphalt/edge ribbons and road hardware; actual lights, analytic pools and stadium lamps remain, with night/day/night and paved Aurel controls |
| Replay-camera course clearance | **53 tests in 2 files passed** | [Actual geometry and control evidence](./motocross-evidence/validation/camera-placement.json): all 40 full platform footprints, terrain-seated foundations and center-view sightlines; all 880 original camera records across 44 other venues retained |
| Earlier GP chain integration | **16 tests in 3 files passed** | [Historical construction and ownership evidence](./motocross-evidence/compatibility/chain-integration/README.md); its chain geometry is superseded by the incoming R3.1 repair, with current CPU/GPU evidence below |
| Final GP geometry/material integration | **38 distinct latest passing cases in 9 files** | [Original CPU reports and repair evidence](./motocross-evidence/compatibility/r31-r4/cpu-validation.json): exact caliper envelope/rotor slots, chain, louver, glow, paint, material ownership and actual MX/SM construction; overlapping batches remain separate |
| GP R4 physics and dirt controls | **20 tests in 3 files; 19.24 s; 36 controlled states** | [Production-adapter evidence](./motocross-evidence/validation/r31-r4-physics.json): GP axle fade, retained non-GP forces and actual dirt-step bypass; historical race fingerprints are explicitly reconciled |
| Motocross caution eligibility | **29 tests in 4 files; 35.24 s** | Actual spatial MX/SX yellow/double-yellow and clearing without VSC/SC; retained Formula, GP and Supermoto procedures |
| Loaded soil macro selection | **17 tests in 2 files; 10.22 s** | Outdoor forest-floor and stadium dry-earth selection, shader variants and existing-slot/no-extra-sampler contract |
| Texture loader lifecycle | **22 tests in 4 files; 5.87 s** | Pending roles, both fallback orders, repeat disposal, resident source preservation and replacement-renderer isolation |
| Venue material and shadow ownership | **17 tests in 4 files; 27.75 s** | Both complete venues release orphan registrations, unused template maps and main shadows once while preserving resident scans |
| Final complete lint and content validation | **Passed** | [Build checks](./motocross-evidence/validation/final-build-checks.json), with complete lint and content logs on the frozen final source |
| Final production build and TypeScript | **Passed; 652 modules; Vite 18.83 s** | `npm run build`; final 670-source build, main JavaScript 14,709.31 kB / 4,390.80 kB gzip; existing large-chunk warning remains |
| Final production bike/rider GPU fixture | **Passed; 21 captures; 40.767 s** | [Final bike evidence](./motocross-evidence/bike/r31-r4/README.md): MX250/MX450 detail levels, contacts, exact mud restoration and six unobstructed onboards on the final 670-source build; the [earlier R2 record](./motocross-evidence/bike/README.md) remains intact |
| Production terrain/arena GPU fixture | **Passed; 16 samples; 148.701 s** | [World evidence](./motocross-evidence/world/README.md): both venues, actual resident scans and wet/held/rewound state; controlled component scene on its recorded source snapshot |
| Responsive motocross interface | **Passed; 4 viewport/scale combinations; 24.647 s** | [Interface evidence](./motocross-evidence/interface/README.md): 17 individually reviewed captures, actual fonts, native submit, all ten controls reachable, radio/proximity and telemetry; preserved R2 snapshot |
| Retained road motorcycle interface | **Passed; 9.578 s** | [Road interface evidence](./motocross-evidence/compatibility/r2-interface/README.md): four captures and six layouts, GP readout, car presentation and MFD restoration; preserved R2 snapshot |
| Retained road environment | **Passed; 45.488 s** | [Road environment evidence](./motocross-evidence/compatibility/r2-environment/README.md): ten captures, four resident scan layers, tyre-mark families and bounded wet/held/rewind state; preserved R2 snapshot |
| Final GP GPU compatibility | **Passed; 14 captures; 107.540 s** | [Final compatibility evidence](./motocross-evidence/compatibility/r31-r4/README.md): both prototypes under the unchanged model/render budgets, four road onboards and stable prepared weather state on the final 670-source build; the [earlier 667-source pass](./motocross-evidence/compatibility/README.md) remains intact |
| Final shared crowd shader | **Passed; 8 captures; 6.979 s** | [Crowd evidence](./motocross-evidence/validation/shared-crowd/README.md): actual colour/depth/shadow programs, movement, exact pause/rewind, near/mid/far handoff and bounded resources on the final 670-source build |
| Complete application journey after camera clearance | **Passed; 8 captures; 661.875 s** | [Production gameplay evidence](./motocross-evidence/gameplay/README.md): both selected machines/venues, held eight-rider gate, manual throttle, explicit AI demonstration, actual progress/flight/touchdown, chase/onboard, held pause and paddock return; exact 667-source snapshot retained |
| Original full off-road suite | **Passed: 20 calibrations, 3 starts, 10/10 races** | [Final regression record](./motocross-evidence/races/final-regression.json): all **74 entrant starts classified**, zero retirements and failures on the recorded source; original validators/limits unchanged, with the later 13/14 fingerprint comparison and road-step bypass [documented separately](./motocross-evidence/validation/r31-r4-physics.json) |

The complete application reporter ran for **685.546460 seconds**. All eight final captures have separate root-owned observations and exact file hashes. Shared cgroup memory sampled inside that reporter window peaked at **7,287,103,488 bytes (6.786644 GiB)** under the 8 GiB limit; 137 samples fall inside the reporter window, six later samples are excluded from its maximum, and every bracketing cumulative-event delta is zero. The [memory record](./motocross-evidence/gameplay/memory-summary.json) keeps both test and reporter windows and the original raw samples. This is measured software-renderer execution, not a physical-device FPS result.

The final sequential crowd/GP/MX reporter took **157.599915 seconds** in total, with exactly three expected passes and no errors, flaky results or skips. Its duration is not attributed to any one component test. All 670 source files, twelve context files and both main bundles match before and after that run. The 21 final MX PNGs are also byte-identical to the earlier R2 captures, but they were freshly displayed for this final review.

The focused groups overlap the broader runs and each other. Their counts are separate verification results, not a sum of unique tests. GPU durations in the table are individual test durations; retained JSON also records complete reporter durations. CPU reporter timestamp windows are labelled separately in the [CPU evidence guide](./motocross-evidence/validation/README.md).

The exact before/after records are in [race-before-after.json](./motocross-evidence/races/race-before-after.json), with earlier diagnostic and integration passes explicitly retained. The fixed three-lap stadium race changed from **4/8 classified at the original timeout with 42 crashes** to **8/8 in 274.57 seconds with zero crashes**. The built-in wet outdoor event changed from six healthy riders retiring in prohibited pit service to **10/10 in 777.94 seconds with one crash and no retirements**. The final six-lap stadium event classifies **10/10 in 564.64 seconds with five crashes**, with two for its worst rider and a longest measured stop of 13.49 seconds. The longer dry outdoor moto also classifies **10/10 in 390.28 seconds with two crashes**. All ten final scenarios appear in the [full regression record](./motocross-evidence/races/final-regression.json).

These are deterministic seeded scenarios and do not establish every-seed success or crash-free racing. The original validator limits each rider to `max(1, ceil(laps / 2))` crashes, so a six-lap race permits three per rider. The unchanged continuous-stop limit is twenty seconds; the final wet event stays within it at 17.67 seconds. No timeout, stop, crash or classification threshold is widened for this upgrade. After the final GP R4 integration, 13 of the original 14 race-related source/script hashes remain identical; the only change is the shared road `BikeVehicle`. The [physics evidence](./motocross-evidence/validation/r31-r4-physics.json) verifies that the dirt adapter bypasses that changed step and retains identical forces across the controlled temperature variants. The full race gate is preserved as its actual earlier run and was not rerun or relabeled after that delta.

The focused riding tests reach a production surveyed takeoff rather than fabricating private flight state. They verify front-brake pitch response and finite wheel spin, both signs of air bank, release leveling, Sport/Raw distinction, unchanged AI reaction to the unused front pedal, immediate touchdown snapshots, repeatable bounded state and presentation grades. The camera tests project a full rider/bike envelope at 0, 15 and 32 m/s, sample every surveyed jump in both motocross venues for terrain/sightline clearance, and check pause/reset, restrained landing motion, zero-motion behavior and convergence at 30/60/144 Hz.

### Recheck the committed reference map

Run from the repository root. This verifies the committed mapping without requiring copyrighted source images in the checkout:

```sh
python - <<'PY'
import json
from pathlib import Path

data = json.loads(Path('docs/production/motocross-reference-map.json').read_text())
records = data['references']
assert len(records) == 100
assert sorted(r['number'] for r in records) == list(range(1, 101))
assert len({r['suppliedMetadata']['sha256'] for r in records}) == 100
for r in records:
    assert r['id'] == f"{r['number']:03}"
    assert r['visuallyInspected'] and r['observation']
    assert r['implementation']['application'] and r['implementation']['files']
    assert all(Path(p).is_file() for p in r['implementation']['files'])
print('100 unique reviewed references; every implementation path exists.')
PY
```

## Remaining limits

The supplied stills are aesthetic/reference evidence, not reliable measurements of tyre friction, suspension travel, AI behavior, frame rate or gameplay timing. The existing calibration stays authoritative except for the explicitly described controls and contact/path reliability repairs. The actual in-engine model, shaders, effects and UI are the deliverable; no claim is made that all depicted objects or commercial-game features exist here.

A full whip/trick system, stunt scoring, new ATV/UTV classes, new snow/desert/coastal courses, a replacement garage environment, fireworks/laser shows and literal source branding are outside the implemented scope. The existing physical terrain and race progression are retained; the documented motocross caution opt-out and enforcement of existing pit-service eligibility correct the shared race procedures. Hardware performance certification requires separate real-device testing. The retained captures and measured fixture budgets make the implemented visual changes reviewable without treating software-rendered timings as a gaming benchmark.
