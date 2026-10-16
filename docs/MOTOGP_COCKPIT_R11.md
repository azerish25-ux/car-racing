# MOTOBOUND — MotoGP R1 recovery and R1.1 cockpit correction

## Delivery boundary

R1 was integrated on `main` as `4014ae6651266e67c5a264ae2dbabf12b9fecd1c` after hosted Blender, lint, content, focused regression, production build and WebGL checks. The earlier staging commit was not the graphics implementation. The successful delivery run is `38937264998`.

The 100-image audit remains in `MOTOGP_100_REFERENCE_R1.md` and `motogp-reference-r1.json`. Each source image has its own observation, hash and component mapping. Context-only rows do not claim new tracks, career scenes, menus or off-road features. Neither R1 nor this correction certifies PS5 parity, perfection, consumer-hardware frame rates, a full release-matrix pass, or deployment of the latest playable site.

## Why the interrupted delivery failed

The former mesh digest was not reproducible. Small UV interpolation differences on beveled rear fins and wing end fences also affected attribute-aware medium-detail decimation. Reconstructing those planar UVs from final coordinates removed that variation without relaxing the integrity gate or changing the high-detail positions/normals. The pinned desktop Blender archive and deterministic factory-startup invocation are recorded in `tools/motogp/authoring-runtime.json`. Three independent local R1 bakes and two independent hosted R1 bakes matched.

## R1.1: defects found by using the real first-person camera

The R1 exterior GPU fixture never proved that the dashboard was readable from the actual onboard lens. Inspection exposed a downward-facing display, an unsuitable mount, a closed fairing occupying the instrument space, and the rider's own helmet intersecting the camera view.

This correction opens a rounded instrument recess in the original Blender cowl, turns the display towards the rider, and calibrates the mount and lens together. Full-fairing catalogue bikes share that corrected upper cowl while retaining their separate tanks, tails, exhausts and aero. GP-R2 retains its box wings; it does not become a duplicate GP-R1. The shared cowl has both high and medium meshes. All geometry remains in the existing metre-scale chassis frame; no physics, wheelbase, fork travel or grip anchor is moved to disguise a visibility failure.

The followed rider's head/helmet is excluded in first-person only. Tail, chase, broadcast, menus and orbit photography explicitly restore it, and other riders are unaffected. This visibility exclusion also excludes that head's shadow in first-person; a dedicated first-person shadow proxy remains future work. The renderer selects the motorcycle lens explicitly rather than inheriting the hidden Formula car's supplied-player lens.

The corrected dashboard remains driven only by recorded speed, gear and RPM. Non-finite gearbox samples display neutral rather than a false reverse indication. Repeating a held snapshot does not upload the same texture again.

## Verification contracts

`tests/bike-cockpit-view.test.ts` checks GP-R1, GP-R2, SBK-1000 and SS600 with four landscape aspect ratios, three lean angles, and three suspension/load states: **144 camera/pose combinations**. Each projects all four display corners and casts nine visibility rays, for **1,296 sampled sightlines**. These tests require the entire display to remain inside the view margin, its face to point toward the lens, and all sampled rays to reach the display without an opaque obstruction. Hidden ancestors are respected; the check does not simply ignore all motorcycle geometry.

The same production mount and lens are used by the WebGL fixture. It preserves the previous high/mid/far, fallback-bike, wet/dry reversibility, resource-budget and zero-error assertions, and adds four real onboard captures. This is component-level GPU validation, not the complete game/navigation suite. User head-look can intentionally turn away from the instruments; the contract covers the forward riding view.

The existing suspension, pit-service, bike-session, geometry and catalogue tests remain required. The original full project CI/release gates are not skipped or weakened. The delivery workflow verifies the transported patch and two independent new Blender mesh exports before building or publishing, and refuses a non-fast-forward/concurrent `main` update.

The expected R1.1 geometry digest is `29aed319fbbc6a70805704c9c88c125b6481abd38514a2619e246f0569dd847f`. The editable `.blend` and standard `.glb` accompany the deterministic runtime mesh. The authoring script, not a reference screenshot, produces those assets.
