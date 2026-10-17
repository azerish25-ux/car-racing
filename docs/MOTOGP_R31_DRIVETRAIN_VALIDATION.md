# MotoGP R3.1 — drivetrain repair, Blender transfer and GPU validation

This continuation resumes the GP chain work present at `577a6e3ac010ab0ec9e8f5c53e4f1c2c385af2f7`. It corrects measured rendering and animation defects; it does not claim a complete MotoGP/PS5 recreation. The existing GP-R1/GP-R2 integration, suspension, pit-service ownership and simulation forces are retained.

## Measured defect and correction

The former chain repeated a 300-triangle rounded box for every side plate. Instancing reduced draw calls but did not reduce submitted triangles. At a 0.52 m review arm, that component cost **62,112 triangles**. The fixture counted only one copy of each instanced mesh, hiding the cost. With the counter corrected, the actual GP-R1 model failed the unchanged **110,000-triangle** gate at **160,468 triangles**.

The new waisted plate has 44 triangles, retains separate pin lobes and metal faces, and bridges adjacent rollers rather than sitting on a single roller. Two analytic tangents and circular wraps replace the bulging spline. Wheel-driven motion now travels in the correct direction. Alternating inner/outer plates close with an even link count. Repeated frames do not upload matrices again; rewinds restore identical transforms. Extreme finite rotations are normalized before multiplication. Conservative fixed instance bounds restore frustum culling without per-frame bounds rebuilds.

| Measurement | Before | R3.1 |
| --- | ---: | ---: |
| Complete review chain, 0.52 m arm | 62,112 triangles | 12,960 triangles |
| GP-R1 high-detail production model | 160,468 triangles | 107,612 triangles |
| GP-R2 high-detail production model | 149,268 triangles | 98,068 triangles |
| GP-R1 mid / far production model | — | 44,953 / 12,538 triangles |

The review component reduction is **79.1%**. Final WebGL fixture calls are **196** for GP-R1 high, **192** for GP-R2 high, **166** for GP-R1 mid and **85** for far. Existing limits remain 110,000 triangles and 220 calls. These are model-fixture measurements, not complete-race frame-rate claims.

The mirrored left fairing screw heads also had reversed cap winding. Their caps now face outward on both sides; ray-based checks cover all eight heads. No material or lighting workaround hides the defect.

## Tests actually executed

- **47/47 tests across eight files passed**: new chain and louver regressions, existing MotoGP reference geometry, motorcycle bodies, cockpit sightlines, steering detail, pit-service behavior and motorcycle presentation.
- The strengthened chain tests first reproduced seven failures against the former implementation, including triangle costs, pin/plate placement, rotation direction, invalid phase handling and disabled culling. All ten chain cases now pass; both louver-facing cases pass.
- Focused ESLint and local project TypeScript checking passed.
- The original `e2e/41-motogp-reference.spec.ts` passed **all 14 captures** in **119.64 seconds**, without changing its assertions, presets, deadlines or budget limits. GP-R1 high/mid/far, GP-R2 high, wet/dry changes and actual onboard mounts for GP-R1, GP-R2, SBK1000 and SS600 are covered. All reported WebGL errors were zero.

The backend was verified Mesa/llvmpipe WebGL2 through system Chromium under Xvfb (`LP_NUM_THREADS=4`). SwiftShader initialization was unavailable in this container. These are software-GPU checks, not consumer-GPU performance measurements.

### Fixture accounting and preparation

`motogp-reference-review.ts` now multiplies primitive triangles by instance count. It also calls `renderer.compile(scene, camera)` before its first observation, matching production shader preparation. A cold r180 shadow pass otherwise initialized depth variants with an empty light layout, then compiled two additional variants on the next draw. This preparation adds no rendered warm-up frames and changes no source snapshots or weather values; the same-instance resource equality assertion remains unchanged.

The final dry → wet → held-wet → dry sequence retained **111 geometries, 20 textures and 55 programs** throughout. Its image hashes were **2397516771 → 85653062 → 85653062 → 2397516771**. The same bike instance and unchanged input snapshots were verified. Preparation retained the corresponding diagnostic pixel hashes.

## Blender: the actual runtime geometry, not a substitute preview model

Run from the repository root with the locked Node dependencies and Blender:

```sh
node --experimental-transform-types tools/motogp/export_gp_drivetrain_review.ts --out /tmp/gp-r31
blender -b -t 4 --python tools/motogp/review_gp_drivetrain.py -- \
  --input /tmp/gp-r31/gp-drivetrain-runtime.json --out /tmp/gp-r31 --render
```

The exporter records exact runtime vertices, normals, UVs, indices and instance matrices. Blender imports those buffers and exports an editable `.blend`, a `.glb` without the review stage, a PNG inspection render and transfer verification. The executed **Blender 5.2.2 LTS** transfer retained **12,960 expanded triangles, 96 links, three shared mesh datablocks and 289 runtime objects**. Source SHA-256: `224bf3bbda75b957b523489419a7e38d2b869e5e0a6d036972986a62ba21e990`.

The neutral Blender materials and review lights are for component inspection. The runtime retains its existing materials. The standalone Blender render is not a screenshot of a race or a claim of photorealism. Generated native assets and detailed validation logs accompany the downloadable R3.1 bundle; the reproducible tools and implementation are committed here.

## Reference and source boundaries

All **100 supplied image payloads** were rehashed and matched the individual R2 ledger exactly. This continuation specifically reopened **REF 018 and REF 087** for drivetrain layering and rear-assembly context. The other images retain their earlier individual review and scope; a checksum is not a new visual review. No photograph supplies calibrated chain dimensions, tooth counts or physical coefficients, and no source image is added as runtime artwork.

Local validation used the archived `6e93a4e` workspace with the exact current R3 motorcycle modules restored and their Git blob identities checked. It is not a full checkout of concurrent Horizon work. Only the named drivetrain, louver, fixture, new test and authoring/report files are changed by this continuation. Full-current-main CI, complete-game wet/night acceptance, all release browser shards, hardware frame time and deployment remain separate checks. This repair does not certify perfection or commercial PS5 visual parity.
