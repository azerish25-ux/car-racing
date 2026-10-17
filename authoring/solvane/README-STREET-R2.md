# Solvane R2 — street construction and driving presentation

This additive, original Blender library extends the existing detail-kit; it does not replace its shopfronts, balconies, boats or EH-3 wing. The game imports the exported geometry. No reference screenshots, external textures, trademarks or fonts are included in these assets.

## Native source and runtime interface

The editable source is `street-kit.blend`; construction is reproducible with `build_street_kit.py`. Native coordinates are Z-up; glTF coordinates are Y-up and all dimensions are metres. The six named template roots are a stable loader interface.

| Template pair | Near / far triangles | Near / far mesh draws |
| --- | ---: | ---: |
| Awning | 1,518 / 332 | 3 / 3 |
| Wall condenser | 2,674 / 364 | 3 / 3 |
| Drainpipe segment | 716 / 104 | 2 / 1 |

The awning has a shaped, double-sided canvas surface, scalloped valance, panel seams, cassette and folding arms. The condenser has separate recessed fan blades, protective rings/spokes, louvres, cover, housing edges, wall brackets and plumbing. The drainage segment has offset elbows, collars, standoffs and fasteners. The generator corrects the recovered box-face winding and retains a physical underside on canvas rather than relying on two-sided shading of a paper-thin polygon.

`public/models/solvane/street-kit.glb` is 166,988 bytes, SHA-256 `3dbf14c8a2e476ee1e426026e950aaf97de4c905b425accbc4a62bcf94869ca7`. The lossless gzip payload, deliberately named `street-kit.bin` to distinguish application compression from HTTP Content-Encoding, is 50,019 bytes, SHA-256 `2d55c24083a2ffe3150465e76256271cccb75e5a77e39da378e1baab44210906`. Browsers without `DecompressionStream` request the ordinary GLB. Both paths authenticate bytes before parsing; decompression has a fixed expanded-size ceiling.

The manifest records actual template bounds and counts. Re-export it with the geometry; do not weaken integrity checks to accept stale or modified bytes.

## Placement, ownership and budgets

`street-details.ts` uses existing collision-backed building footprints, selects the road-facing facade, varies awning colours, and inserts shallow facade furniture. These are visual props, not new traversable interiors or separately collidable obstacles. A 3.12 m pipe segment describes ground-floor collection rather than an invented roof-level plumbing connection. Repeated modular architecture remains a limitation.

Spatial cells, frustum spheres, distance ordering and near/far hysteresis precede submission. Limits below are **placements per component kind**, not total scene draws or FPS:

| Preset | Near | Far | Near range | Total range |
| --- | ---: | ---: | ---: | ---: |
| Low | 0 | 18 | 0 m | 105 m |
| Medium | 18 | 42 | 48 m | 170 m |
| High | 26 | 64 | 65 m | 215 m |
| Ultra | 32 | 80 | 80 m | 260 m |

The three component kinds share at most fifteen active material/LOD batches. Wet material changes derive from preserved dry values and therefore do not accumulate. Session exit/cancel releases source geometry, materials and per-batch instance buffers; missing optional assets retain base scenery. This is not a whole-frame performance certification.

## Additional runtime changes

The contact field uses physical tyre locations, current suspension/radius telemetry and bridge-aware ground queries. It conforms a small grid to the ground, rejects height discontinuities, fades with wheel clearance/load and clears on travel/rewind. Up to eight nearby vehicles use at most forty patches, 320 triangles and one draw. Low uses a stronger contact cue; higher presets retain a subtler one alongside normal sun shadows. This is approximate local darkening, not ray-traced occlusion or a replacement for all lighting.

The pace coach samples the actual event path, integrates a wet/grip/grade-sensitive speed envelope backwards and includes a 0.7 second look-ahead for the driver cue. Upcoming left/right bends, distance, advisory target speed and prepare/lift/brake actions appear separately from legal road limits and skill scores. Wrong-layer/off-route, reverse, cancelled and finished states suppress the cue. It is original advisory tuning, not a vehicle-specific optimal speed, an autopilot or a commercial game's recovered algorithm.

## Reopen, regenerate and validate

Use a separate output directory to preserve a manually edited source:

```sh
blender -b -t 2 --factory-startup --python-exit-code 1 --python authoring/solvane/build_street_kit.py -- --source authoring/solvane/street-kit.blend --output-root /tmp/solvane-street-roundtrip
cmp public/models/solvane/street-kit.glb /tmp/solvane-street-roundtrip/public/models/solvane/street-kit.glb
cmp public/models/solvane/street-kit.bin /tmp/solvane-street-roundtrip/public/models/solvane/street-kit.bin
npx vitest run tests/solvane-street-kit-r2.test.ts tests/solvane-contact-shadows-r2.test.ts tests/solvane-pace-coach-r2.test.ts
npm run build
```

Omit `--source` to regenerate the initial construction. `--render` produces three **native Blender component inspections**, not in-game screenshots. Reopening the saved source reproduced the local GLB, compressed transport and manifest byte-for-byte with Blender 5.2.2 LTS build `d13f752e3b9c`.

The browser helper `scripts/solvane-r2-browser-review.mjs` exercises actual session loading, matched baseline/candidate cameras and a real event-entry/pace-HUD lifecycle. Its fixed-camera inspections and software-rendered timings remain explicitly distinguished from gameplay and target-device performance. Failed candidates must never be recorded as passes. See the individual [reference ledger](../../docs/production/SOLVANE_R2_REFERENCE_LEDGER.md) for the scope of each image and remaining work. No reference-parity or finished-release claim is made.
