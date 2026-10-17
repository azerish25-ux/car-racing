# MotoGP GP-R brake realism revision R4 (original work)

## Scope and reference evidence

The supplied 100-image MotoGP26 reference archive was individually checked against its SHA-256 manifest (100/100 exact). The existing `docs/MOTOGP_R3_REFERENCE_INDEX.md` contains per-image observations and remains the full one-by-one audit. This R4 revision specifically addresses closer brake hardware visible in REF 001/003/018/020/022/028/060/096. Photographs are **visual context**; neither PS5 imagery nor copyrighted game meshes are shipped.

This is an incremental fidelity milestone, **not** a claim that all 100 scenes were rebuilt or that the browser renderer has reached Unreal Engine/PS5 photorealism.

## Delivered

- A new original high-detail, four-piston radial brake-caliper source authored in Blender 5.2 LTS, with independent jaw bodies, hydraulic line, pad backing, piston registers, forged bridges and bolts. Run: `blender --background --python tools/motogp/author_gp_radial_caliper.py -- --out /tmp/gp-radial-caliper`.
- `src/rendering/gp-radial-caliper.ts` constructs a production-quality bounded version with four material batches and a real central disc clearance. GP-R1 and GP-R2 use this at high LOD only, fixed to fork lowers. Mid/distant models and non-GP bike families retain economical parts. No suspension or wheel-spin ownership changes.
- A deterministic, bounded GP brake heat fade uses the pre-existing physics disc temperature. Normal temperatures and non-GP families remain unchanged; beyond 850 C excessive use reduces maximum brake torque progressively by up to 22%, and subsequent cooling recovers it.
- Focused unit tests cover geometry bounds, materials, both sides, finite buffers, and temperature curve.

## Remaining quality gates

Check CI/build, Chromium/Firefox browser render and GPU draw/triangle budgets on low/mid/high presets. Reassess brake sizing on a replay with wheel rotation and fork travel. Broader photorealism requires professionally authored rider meshes and motion capture, calibrated reflectance/normal maps, photogrammetry for circuit assets and spectator improvements with LOD checks.

## R4b: light and spectator surface calibration

GP-R1 and GP-R2 carbon rotors now stop showing exaggerated bright-orange emissive light at ordinary race temperatures. A smooth temperature response begins above 620 C, saturating at a restrained 0.58 scale at 1080 C; the hue shifts to deep red. Non-GP vehicle material behavior remains unchanged. The crowd's existing sculpted near LOD now includes a fine anisotropic textile relief and roughness variation, mathematically filtered out at long-distance pixel footprints to avoid shimmering; no spectator mesh or draw-call growth. These are visual-only functions, not additional forces or state. See `tests/gp-disc-glow.test.ts` and `tests/gp-crowd-textile.test.ts`.
