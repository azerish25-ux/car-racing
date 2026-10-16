# MotoGP R3 — model detail and actual riding tow

Base source: `6e93a4ef452764f2ee0b69797817f91a908d897e` (MotoGP R2).
This revision extends the existing 100-image [reference record](MOTOGP_R3_REFERENCE_INDEX.md).
All 100 supplied image payloads exactly match the SHA-256 values in the R2 review.
Every original image is separately indexed, but **an indexed image does not imply that its complete scene has been rebuilt**.

## Delivered source changes

1. **Motorcycle slipstream with physical acceleration:** `world.ts` already calculated a leader's
   speed-/distance-/heading-dependent wake and slipstream; `BikeVehicle.step()` ignored
   `this.slipstream`. It now applies a bounded, multiplicative real drag reduction
   in the `Bike` longitudinal force solver, not a cosmetic HUD modifier.
   The high-overlap ceiling is 18%, plus the existing, separate rider-tuck effect.
   Tyre grip, braking force circles and crash dynamics are unchanged.
   `tests/bike-slipstream.test.ts` checks numerical bounds and real speed/acceleration gain.

2. **New GP-R1 cooling-exit geometry:** A reproducible Blender 5.2.2 authoring script
   builds original cambered carbon louvers and flush titanium retainers.
   `src/rendering/gp-cooling-louvers.ts` builds the equivalent meshes synchronously
   on the sprung fairing so wheel/fork travel, livery, recorded weather and replay timing
   are unchanged. High LOD: **896 triangles, two draws**; mid LOD:
   **216 triangles, one draw**; far LOD: none. The geometry reuses existing
   carbon/steel materials and disposal/batching ownership.
   `tests/gp-cooling-louvers.test.ts` checks symmetry, finite geometry, bounds
   and LOD budgets. No real-world team marks, PS5 screenshots or licensed models ship.

## Reproducible Blender authoring

```sh
blender --background --python tools/motogp/author_gp_cooling_louvers.py -- --out /tmp/motogp-r3
```

This emits an editable `.blend` and exportable `.glb` **in the requested output directory**.
The game uses the matching procedural geometry code; it does not fetch or depend
on the authoring GLB at runtime. Both were generated and rendered locally.
Rebuild `tools/motogp/build_gp_bodywork.py` separately for the existing full shell.

## Tested in the development container

- Supplied image archive integrity and exact R2 correspondence: **100/100 SHA-256 matches**.
- Blender 5.2.2 LTS: actual original assets saved to `.blend` and `.glb`;
  standalone component and original full shell plus new detail rendered.
  These are authoring previews, not gameplay captures.
- The pure dynamics integration executed at 48 m/s: with 85% tow,
  measured deceleration improves by approximately **0.543 m/s²** against
  clean air with other conditions held equal.
- Focused TypeScript static compilation of `bike.ts`, `bike-slipstream.ts`
  and `core/math.ts` passed using an installed TypeScript compiler.
- **19/19 seeded real motorcycle race scenarios passed**, with **158 classified riders**
  and nine recoverable falls, no race validation failures, two scenarios in
  rain or changeable weather. The batch includes the built-in motorcycle events.

## Explicit limitations

**GitHub full-workflow validation was queued when this report was written.**
The local container has no complete installed project dependencies and no
hardware GPU/browser test, so the unit suite, full Vite build and eight browser
shards still require their independent CI results. No assertion was removed.

The Blender render confirms geometry and staging, **not photorealism or PS5 fidelity**.
Additional artist-led work is still required for photogrammetry-grade rider anatomy,
track-side world detail, complete wet/night exposure, manufacturer-distinct machinery,
racing AI balancing and consumer-hardware profiling. The user-supplied commercial
reference photographs are reference material only and are not shipped assets.
