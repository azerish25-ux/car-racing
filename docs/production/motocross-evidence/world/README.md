# Motocross world component evidence

The retained run of `e2e/43-motocross-world.spec.ts` passed on **2026-10-16** with **1 expected result, no failures and no flaky tests**. The test took **148.701 seconds**; the complete Playwright report took **150.704120 seconds**. Its start time was `2026-10-16T22:16:40.861Z`. The observed browser backend was WebGL2 through ANGLE/Vulkan SwiftShader (Subzero).

## Scene and source scope

The fixture constructs the production `OffroadScene`, including its deformable terrain, gate, stadium, course furniture, particles and loaded tyre shadows, plus production `BikeShells`. It runs an actual seeded eight-rider AI simulation for **10 seconds** and uses its snapshot and deformable terrain export for all bike poses, contact values and ruts.

It prepares the shared procedural materials, attaches the actual `scannedGround` store to the renderer, awaits resident photographed textures, and verifies that the terrain material enters its `APEX_SCAN` shader path. It uses neutral room-environment, directional and hemisphere lighting, the production SX floor light-pool hook, a synthetic backing plane and plain sky/fog. The full application's distant terrain, venue-kit forest, UI and complete renderer pipeline are outside this component scene. The counts below describe these fixed scenes; they are not hardware frame-rate measurements or full-application visual acceptance.

The production build fingerprint was `b8022a153cf429695c7f3af288504a9432b9371283f60a29190805b0034929c2`. Exact SHA-256 hashes for the six relevant source and fixture files are retained in `test-run.json`.

## Loaded soil regression

An earlier full-application inspection exposed broad pink/lavender dirt patches. The terrain's first scan slot was meadow even when the course was largely soil, and the shader used that slot for all broad color variation. The corrected motocross shader explicitly uses the existing **forest** slot for Valley and the existing **dryEarth** slot for Arena. Fine color scans, normals, roughness, grain, course geometry and other-discipline defaults remain unchanged; no extra sampler or asset was added.

The final fixture observes the actual compiled macro sampler, rather than inferring it from a label:

| Venue | Active soil slots | Selected macro | Observed compiled sampler | Resident status |
|---|---|---|---|---|
| Valley Ridge MX | meadow, dryEarth, forest, wetEarth, gravel | forest | `apexScanForestC` | All required slots resident; no failed layers |
| Arena Nord SX | meadow, dryEarth, forest | dryEarth | `apexScanDryEarthC` | All required slots resident; no failed layers |

Every loaded color, normal and ORM map reported the **KTX2** format. The store also loaded concrete and rock registered by other production components. Earlier procedural-only captures did not activate this scan path and are superseded by all images and metrics in this folder. Earlier inspection also corrected the stadium overview to place the camera inside the bowl with the floor visible and added the omitted procedural-material preparation.

All **eight final PNGs were individually displayed and visually inspected**. They show photographed grain and a brown, neutral macro palette without the broad pink/lavender dirt islands. Wet soil darkens while grain and jump shapes remain visible. Authored hardpack, sand and mud zones retain their existing boundaries. `visual-review.json` records the observations and SHA-256 hash for each image.

## Measured rendering work

| View | Draw calls | Triangles | Live particles | Loaded tyre shadows | Deformed cells | Geometries / textures / programs |
|---|---:|---:|---:|---:|---:|---|
| Outdoor riding | 376 | 515,078 | 147 | 16 | 1,821 | 531 / 97 / 24 |
| Outdoor overview | 417 | 289,595 | 147 | 16 | 1,821 | 411 / 86 / 28 |
| SX riding | 334 | 2,264,084 | 83 | 16 | 1,740 | 533 / 82 / 20 |
| SX interior overview | 526 | 2,292,329 | 83 | 16 | 1,740 | 520 / 121 / 22 |

Each configuration captures the **same scene instance** in four states: prepared soil, wet soil, held wet soil and rewound soil. All strict assertions passed across the four configurations and **16 rendered samples**:

- The photographed-soil shader is active, every required scan slot is resident and the observed compiled macro sampler is correct.
- Wet soil changes the rendered pixel hash; holding the wet state repeats that hash; rewinding restores the original prepared-soil hash exactly.
- Geometry, texture and program counts remain unchanged through all four states.
- Every sample reports GL error 0, eight production bike rigs and more than fifty deformed terrain cells.
- The source simulation snapshot and terrain hash remain unchanged.
- The directional MX soil hook remains in the production material chain.
- No page or console errors were reported.

## Files and related CPU coverage

Each camera configuration has two final PNGs and a `*-metrics.json` file containing all four states, including exact hashes, material hooks, scan slots, resident formats and compiled samplers. `test-run.json` records the passing outcome, timing, source identity and fixture scope. No superseded failed result is retained in this folder.

The focused `tests/motocross-environment.test.ts` and `tests/scanned-ground.test.ts` run passed **17/17 tests in 10.22 seconds** after the macro fix. It covers explicit and legacy macro selection, generated shader calls, existing-slot enforcement, cache isolation, idempotent installation and retained scan bindings. Environment coverage also includes the strict backward-time particle reset: a 10 ms reverse seek clears old dust and cannot invent a landing burst from reversed airborne telemetry. TypeScript, focused ESLint and formatting checks passed before this capture run.
