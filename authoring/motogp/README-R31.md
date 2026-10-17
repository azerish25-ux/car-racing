# MotoGP R3.1 — native authoring assets

The GP aero/cooling and drivetrain runtime implementations are in `src/rendering/`.
The .blend and .glb outputs are editable authoring references, not replacements loaded at runtime.
Source imagery and third-party licensed meshes are not shipped.

## Reproducibility

- `tools/motogp/author_gp_cooling_louvers.py` — original carbon cooling outlet geometry.
- `tools/motogp/author_gp_chain_drive.py` — original artist-editable chain assembly.
- `tools/motogp/export_gp_drivetrain_review.ts` — exact live instance geometry.
- `tools/motogp/review_gp_drivetrain.py` — exact geometry imported into Blender.

`.github/workflows/commit-motogp-r31-assets.yml` uses checksum-verified official
Blender 5.2.2, writes six native/exported files and SHA-256 receipts in this
directory, and fast-forwards main without changing the runtime or forcing any push.
Runtime GP bike models use instance meshes and replay-driven wheel phase.

Blender authoring files are not evidence of PS5 graphical parity.
