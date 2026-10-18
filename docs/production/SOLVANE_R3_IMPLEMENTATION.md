# Solvane R3 — architectural depth and driving presentation

This is a selective source update for the Forza Horizon-inspired Festival/Solvane section of MOTOBOUND. It is not a standalone game, a full repository replacement, or a release approval.

## Implemented graphics

Original Blender-authored casement, storefront and shuttered assemblies replace flat window impressions at close range. Seven material-separated mesh parts provide bevelled frames, meeting stiles, transoms, door pulls, projecting sills, drip grooves and angled shutter louvres. The actual editable source is `authoring/solvane/facade-joinery.blend`; the exported GLB and quantized runtime mesh are included.

Supported houses, shops, apartment blocks, farm buildings and terminals have actual wall openings. Window panes sit 0.21 m inside the exterior plane, with real inward-facing reveals; no opaque wall triangle hides the panes. Complete bays respect corners, storey bands, parapets and the full width of the shutter/sill assembly. The original road layout, building footprints and collision boundaries are unchanged. A shop window is not an enterable room.

Plaster, brick and stone use explicit material identity, not a guess based on pixel hue. Brick courses use 0.245 × 0.078 m units; dressed-stone courses use 0.61 × 0.285 m units. Mortar and surface relief are filtered at small screen footprints. Subtle grit and roughness variation break uniform surfaces without extra texture downloads. Glass has separate window/interior/blind cues and bounded evening illumination; these are shaded room suggestions, not ray-traced or modelled interiors.

Joinery is selected through 64 m spatial cells, the camera frustum and facade facing. Each quality tier has both an instance and triangle budget. Base recessed openings remain present even when decorative joinery is out of range.

| Quality | Maximum active assemblies | Joinery triangles | Selection range |
|---|---:|---:|---:|
| Low | 24 | 20,000 | 55 m |
| Medium | 80 | 90,000 | 95 m |
| High | 144 | 180,000 | 140 m |
| Ultra | 192 | 280,000 | 180 m |

The joinery subsystem uses at most seven material batches **per pass**. That is not the whole scene's draw-call count. The full medium capture increased from 427 calls / 1,017,845 triangles in the recovered baseline to 441 calls / 2,070,245 triangles in R3. This includes the cost of actual wall openings and the renderer's passes. Software-render timings do not establish a hardware FPS improvement; real-device profiling and further distant-building optimization remain necessary.

## Implemented driving presentation

The chase rig reads chassis-local forward/lateral velocity, yaw rate and longitudinal load. It uses restrained drift-follow, look-ahead, speed widening and acceleration/deceleration offsets instead of random shake. The camera's held-target spring is solved analytically. Regression tests compare 30, 60, 120 and 144 Hz and cover invalid input, reverse motion, pauses and discontinuities. The existing terrain and camera-boom clearance protections are retained.

The new drift card presents observed angle, direction and build/hold/recover guidance. Speed and angle admission use the existing Festival skill constants. It does not invent score, alter currency, steer the car, change tyre physics or certify that countersteer input was correct. The side label describes the body angle relative to its travel direction, not a command to turn the steering wheel that way. The card is suppressed for invalid/airborne/reverse/slow motion and hidden during assisted driving, unsuitable road/event states and overlays. Menu, map and photo mode hide it immediately, including while the simulation is paused.

## Integration map

`build_joinery.py` owns native mesh generation and saved-source re-export. `facade-layout.ts` owns bay planning and the actual wall-hole/reveal/pane geometry. `facade-joinery.ts` owns decoded Blender mesh instancing, selection budgets and resource lifetime. `buildings.ts` combines this with the original regional massing and material pipeline.

`chase-dynamics.ts` owns bounded camera cues and the exact held-target spring. `drift-feedback.ts` owns the pure drift-advice calculation. `festival-renderer.ts` derives observed motion, updates the camera and selects joinery. `free-roam.ts` passes the cue to `festival-hud.ts` and its responsive stylesheet. This pass does not edit the MotoGP, motocross or shared vehicle-physics implementation.

## Reproduce authoring and checks

Use the project's pinned dependency lock and Node 22.16.0, and the supplied Blender 5.2.2 LTS authoring tool. From the repository root:

```sh
npm ci
npm run generate:player-lods
npm test
npm run lint
npm run validate:content
npm run build
```

The generated player LOD file is deliberately ignored by Git. Run the normal `npm test` entry point (which runs its generation hook), or explicitly generate it before invoking Vitest directly.

To inspect/re-export the saved source without rebuilding its meshes:

```sh
blender -b --python-exit-code 1 --python authoring/solvane/build_joinery.py -- --source authoring/solvane/facade-joinery.blend --root /tmp/solvane-r3-reexport
```

Compare these three files against the checkout: `src/rendering/assets/solvane-joinery.mesh.json`, `public/models/solvane/facade-joinery.glb`, and `public/models/solvane/facade-joinery.manifest.json`. Native Blender re-opening and byte-identical re-export were actually exercised; the delivered evidence contains the log and result.

The isolated facade and HUD review scripts are `scripts/solvane-r3-capture.mjs` and `scripts/solvane-r3-hud-review.mjs`. For a **before** capture, `R3_BASELINE_REF` must identify the pre-R3 version, not an already-updated HEAD. Set `R3_STAGE=before` or `after`, and `R3_OUT` to a separate evidence directory. The facade fixture uses deliberately isolated, identical lighting for both sides.

`scripts/solvane-r3-offline-session.mjs` bundles the actual FestivalSession and both production workers, loads the actual committed asset bytes through a documented offline fixture bridge, and can exercise real input with `R3_INPUT_JOURNEY=1`. It is not a server/navigation test. The tested Mesa backend uses the same bounded 120-second GPU watchdog as `scripts/browser-backend.ts`; it does not lower application quality or disable the watchdog.

## References, provenance and limits

The individual 100-image ledger contains observations, mappings and remaining work, with all original image SHA-256 hashes verified. Inspection is not completion. The native source's reference ID list records studies and inspiration, not acceptance. No Forza textures, models, logos or reference photos are included in the update.

The local validation checkout was reconstructed from remote `e53f010a132546cef81aaa33732a6267f55bfd8c` plus the verified Solvane R2 source overlay. It is **not** the complete later combined-main tree. The five existing files modified by this update were independently checked against their GitHub blob identities at `d7ef2a03f7dce0edc3360d2347acda9c900b0973` and all matched. Apply only the selective patch; do not overwrite or push the reconstructed repository as a replacement for current main.

The captured medium session, actual keyboard movement and lifecycle checks passed. The HUD component tests deliberately use synthetic state and do not prove a complete human drift run. Scripted physics route results are separately labelled. HTTP/CDN/secure-origin behavior, actual user hardware, a full human playtest, every district/weather state, full combined-main CI and commercial-reference visual parity are not approved by this pass.

Detailed validation counts and source hashes are in `SOLVANE_R3_VALIDATION.json`. Initial failed diagnostic attempts are retained rather than relabelled as passes. The source package is a local checkpoint; no new R3 game changes were pushed through GitHub in this turn.
