# Motocross bike follow-up: fresh reconstruction

The interrupted follow-up was not published before scratch was reset. These current files were reconstructed against `7b67f94e3f1e8cb41edb118368d35e771e47c85c`, and tested again. They are not described as recovered copies of lost source or evidence.

## Implemented

- Replaced the fixed spline chain with 96 rollers and 192 paired link plates in two instanced draws for high/mid MX detail. High plates have actual rounded pin lobes and a narrow waist (44 triangles); mid plates use 12-triangle boxes. Far detail continues to omit the chain.
- Derived chain phase only from supplied rear wheel rotation, with identical held snapshots skipping instance uploads and rewind restoring exact buffers.
- Rebuilt the taut loop at the actual axle span while cancelling the parent's nonuniform Z scale, retaining circular sprocket wraps through suspension travel.
- Reused owned instance bounds, matrices, materials and geometry. The existing entrant mud shader samples instance positions; the shared rigid rear sprocket keeps its original material-local coordinates.
- Joined both 6 mm terminal balls to the actual yawed 140 mm lever blades.
- Made bike disposal idempotent, disposing instance buffers and detaching the rider before its separately owned geometries are released.
- Extracted GP's existing analytic loop and 44-triangle plate helper without changing its output. Five arm lengths and eight phases produce byte-identical before/after 5,180,989-byte geometry/instance witnesses: SHA256 `e0a15b8e695156b9b20c352ea0fb905c716862eb827098d96827a01c70c233be`.

## Verification

`tests-r2.json` is the native Vitest JSON for 36 passing cases in five files (8.42 s). This includes 15 MX chain/ownership cases, four actual merged aluminium lever contact cases, 14 existing GP chain cases and three existing MX onboard cases. The original onboard aspect/pose checks were unchanged.

`tests-r1.json` retains the initial 32-pass/four-fail result. The new contact inspector encountered zero-area bevel faces in RoundedBoxGeometry; excluding those area-free faces avoids a division by zero in Three's closest-point routine. Actual contact threshold remains 5.5 mm, and all four old detached placements remain negative controls exceeding the 16 mm noncontact threshold. Production geometry was not changed to mask this inspector failure.

ESLint for all nine owned files and whitespace verification passed. The parent agent owns the full production build, source freeze, and fresh GPU runs. This package claims no current GPU, whole-suite CI, deployment, or hardware performance result.

## Browser coverage prepared

The existing E2E 42 views, contact checks, onboard visibility and same-instance mud sequence are retained. Its triangle budget now counts all instances. Eight new drivetrain views show MX450/high and MX250/mid at moving, held and rewound phases, checking image/hash/buffer changes, exact restoration and stable resource counts under the existing render limits. These captures remain pending until the parent actually runs them.

## Reference continuity

The original 100-reference mapping remains intact. The old `motocrossChain` static mesh function is superseded by `MotocrossChainDrive` and the shared helper. Chain evolution relates to references 005, 010, 012, 027 and 031; the lever correction relates to 002 and indirectly 020. This reconstruction does not claim to have re-opened all 100 original images or to recover the lost follow-up images.
