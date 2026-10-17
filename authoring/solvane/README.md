# Solvane native detail library

The game loads the actual geometry exported from [`detail-kit.blend`](detail-kit.blend). The five native inspection renders are Blender look-development images, **not** game screenshots. Runtime evidence and the 100-reference attribution are documented in [the continuation report](../../docs/production/SOLVANE_CONTINUATION_VALIDATION.md).

## Source and runtime contract

| Item | Recorded contract |
| --- | --- |
| Authoring tool | Blender 5.2.2 LTS, build `d13f752e3b9c` |
| Editable source | `authoring/solvane/detail-kit.blend` |
| Starting-geometry recipe | `authoring/solvane/build_detail_kit.py` |
| Runtime asset | `public/models/solvane/detail-kit.glb` |
| Runtime manifest | `public/models/solvane/detail-kit.manifest.json` |
| Units and export axes | Metres; Blender Z-up to glTF +Y-up, +Z-forward |
| Recorded asset size | 1,794,216 bytes; loader ceiling 2,000,000 bytes |
| Recorded asset SHA-256 | `aa9da4d19a73889affaf59a5e10ff1d5d8f18f8dbb3195f7d87f4e22734fbb1c` |
| Embedded external resources | None: no textures, screenshots, fonts, external buffers or branded logos |

The saved meshes are editable and have baked manufactured-edge geometry. The Python recipe is the place to change procedural construction parameters; it is not a non-destructive modifier stack preserved on every saved mesh.

The twelve root template names are an application interface:

| Template | Triangles | Material/mesh draws before instancing |
| --- | ---: | ---: |
| `frontage_near` / `frontage_far` | 14,396 / 672 | 8 / 5 |
| `balcony_near` / `balcony_far` | 5,176 / 248 | 2 / 2 |
| `launch_near` / `launch_far` | 19,740 / 1,732 | 11 / 8 |
| `gate_near` / `gate_far` | 1,938 / 772 | 4 / 4 |
| `aero_main` | 3,012 | 1 |
| `aero_flap` | 2,636 | 1 |
| `aero_support` | 552 | 1 |
| `aero_flap_far` | 284 | 1 |

These are **template** counts, not a complete rendered-frame budget. Instanced copies, other scenery, vehicles, shadows and post-processing have separate costs. In the recorded region 1,232 frontage bays and 1,467 balcony placements are planned; only the nearby, visible and quality-budgeted subset is submitted.

## Re-export without overwriting the source

From the repository root, export the saved source into a separate directory:

```sh
blender -b -t 2 --factory-startup --python-exit-code 1 --python authoring/solvane/build_detail_kit.py -- --source authoring/solvane/detail-kit.blend --output-root /tmp/solvane-reexport
cmp public/models/solvane/detail-kit.glb /tmp/solvane-reexport/public/models/solvane/detail-kit.glb
```

`cmp` is the Linux/macOS byte comparison used in validation; on Windows compare SHA-256 values with `Get-FileHash`. Use an appropriate temporary directory on that platform. The re-export path reads the saved `.blend` and does not reconstruct its geometry or save over it. Both the committed-source CI and the resumed local Blender check reproduced the recorded GLB byte-for-byte.

To regenerate the starting library from the Python recipe, **omit `--source`** and use a separate output directory:

```sh
blender -b -t 2 --factory-startup --python-exit-code 1 --python authoring/solvane/build_detail_kit.py -- --output-root /tmp/solvane-generated --render
```

Do not point that command at the working source directory after manual edits: generation writes a new `detail-kit.blend`. `--render` produces the five labelled native inspection images after export; the preview lights and cameras are not part of the runtime GLB.

## Editing and integrating

Preserve root names, material names, local origins, the airfoil/flap pivot relationship and near/far distinctions. The loader requires exactly one of every template, checks the manifest byte count and SHA-256, and rejects external resources. The runtime owns shared geometries/materials once; facade instance matrices have their own disposal lifecycle. A new export must be reviewed together with its regenerated manifest, not deployed against an old hash.

After editing, export to a temporary directory, inspect the source and runtime file, then intentionally replace the GLB and manifest. Run the existing focused contracts and production build:

```sh
npm ci
npx vitest run tests/solvane-detail-kit.test.ts tests/solvane-driving-detail.test.ts tests/solvane-street-light-pools.test.ts tests/solvane-finial-mount.test.ts tests/solvane-asset-loading.test.ts tests/festival-skill-chain.test.ts
npm run build
```

The committed-source browser workflow checks actual loading, the EH-3 wing, frontage/boat presence, Medium and Low views, night lighting and the real keyboard journey. A successful import alone does not establish visual acceptance. The wing flap is a visual air-brake response; this change does not introduce a separately simulated aerodynamic device. Boats remain scenery, and new facade modules do not introduce walkable interiors.

## Reference continuity

[The individual continuation ledger](../../docs/production/SOLVANE_REFERENCE_CONTINUATION.md) distinguishes 39 references informing additions, 55 retained earlier implementations and six context-only images. The native roots' `reference_ids` are broad authoring tags; the narrower ledger defines the actual claimed relationship.

To verify the original reference ZIP locally without extracting or copying its media:

```sh
python tools/solvane/verify_reference_pack.py "path/to/Forza-Horizon-6-Developer-Reference-Pack-100-Images(1).zip"
python tools/solvane/test_reference_pack_audit.py
```

The audit checks all 100 IDs, byte lengths, hashes, filenames and attributed URLs. Its fourteen synthetic tests include tampering, duplicate/missing IDs, unsafe paths and provenance mismatches. No reference images are embedded in the game or required in a public checkout.
