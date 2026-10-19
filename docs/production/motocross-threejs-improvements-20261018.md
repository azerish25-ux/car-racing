# Motocross Three.js improvements — 2026-10-18

This pass improves the existing motocross and supercross presentation and adds a recoverable aerial whip with meaningful landing consequences. It uses procedural Three.js geometry, material/shader work and the existing simulation and asset systems. The comparison baseline is `bdca8de5d36e282840d52316d106a2d99626924f`.

## Reference evidence and scope

All **100 numbered images** in `Motocross_PS5_100_Developer_Reference_Images(2).zip` were visually reviewed on labeled contact sheets. Nine key originals were inspected at full resolution: 004, 024, 031, 042, 059, 072, 086, 092 and 095. All 100 unique image hashes match the pack index. Archive SHA-256: `d8c8fbb62974432e8feafa853917deb45765dccc18be7d1da8ece9be512a9c73`.

The companion `motocross-threejs-reference-review-20261018.json` retains every original observation, filename, source URL and image hash. Each image maps to feature keys that resolve to the changed paths, retained systems and context. Eighty images support transferred principles in 11 implementation groups; twenty remain checks on existing systems or context. These counts do not represent 100 new features.

| Reference family | Representative images | Application in this pass |
| --- | --- | --- |
| Bike and protected rider shape | 001, 003–006, 011–012, 020, 031, 081–082 | Helmet eye opening/chin, curved goggles, moulded plastics, tread and material separation |
| Worked dirt and damp ruts | 007, 024, 042–043, 046–047, 050, 059, 072, 092 | Broken wheel paths, compacted lows, aggregate and local roughness |
| Dirt motion | 002, 013, 023, 054, 058, 066, 068, 094–096 | Dense irregular clods inside softer translucent dust |
| Human stadium background | 010, 028, 043, 048–049, 069, 071, 091 | Mixed spectator silhouettes, muted clothes and deterministic motion |
| Air control and readable approach | 006, 031, 053, 057, 068, 072–073, 084–086, 100 | Whip/release/landing loop, flight-path camera and concise feedback |

## Graphics changes

Prepared earth now uses five independently wandering, interrupted wheel-pass channels, staggered cleat/rake impressions and fine mineral breakup. Dark compacted grooves contrast with rougher raised soil; damp smoothing stays localized. Derivative filtering suppresses unresolved detail. **Both MX and SX use the resident mineral-earth macro**, and worked loam uses its fine detail, removing enlarged forest needles from prepared track surfaces. Physical soil fields, terrain vertices and authored jump profiles remain unchanged. Relevant code: `mx-soil-detail.ts` and `terrain-view.ts` under `src/rendering/offroad/`.

The same 2,400-slot roost system now gives solid clods irregular shaded silhouettes and dust a softer billowing envelope. Emission still comes from existing loaded-wheel contact and slip; one particle draw is retained (`roost.ts`).

The rider gains an actual recessed eye opening and integrated projecting chin guard, a narrower peak, conformed vents and smaller curved smoke/iridescent goggles. Radiator shrouds gain a continuous crown. Plastics carry subtle mould grain and scuffs, and knobby tyres use chamfered lugs plus their own rough rubber material. Powder/wet-clump mud and per-material exposure preserve readable upper gear and number boards. Existing rider IK, chain drive, chassis layout and shared texture ownership remain. Relevant code: `motocross-gear.ts`, `motocross-detail.ts`, `dirt-bike-model.ts`, `mud.ts` and `src/rendering/rider.ts`.

Stadium spectators reuse the existing shared human kit in the lower four rows and analytic silhouettes farther away. Stable pose cohorts, clothing/skin zones and subdued colors remove repeated peg-like figures. Audience motion reads snapshot `H.TIME`; pause and backward seeks reproduce the same state. The original bowl, chairs, occupancy and authored structures remain (`stadium.ts`, `index.ts`).

## Gameplay: whip, release, land

On MX250/MX450 in motocross/supercross, steering in flight banks and yaws the bike. **Release steering before touchdown to square the wheels.** Sport progressively assists recovery; Raw preserves greater player authority. Existing throttle/brake pitch control remains.

Yaw is bounded to 0.6 radians (about 34°). The centre of mass keeps its actual flight path: a whip supplies no lateral air force or bonus speed. At an actually yawed touchdown, incoming momentum is resolved into the turned tyre axes; sideways motion becomes real slide. A qualifying severely crossed landing can trigger the existing lowside recovery. Ordinary non-yawed slides retain their original recovery behavior.

The airborne chase camera follows velocity so a sideways bike does not turn the view away from the landing corridor. HUD feedback says **BRING IT BACK**, warns of **CROSSED LANDING**, and shows **WHIP LANDED** only after a clean qualifying touchdown completes the 0.25-second suspension settlement. Existing caution priority, rhythm targets and AI line choice remain. Code: `dirt-bike-vehicle.ts`, `riding-feedback.ts`, `chase-camera.ts`, `renderer.ts`, `offroad-hud.ts` and `interface.ts`.

## Verification sequence

The full regression run covered **418 files and 3,471 tests**. It passed 3,463 tests; eight existing review-tool CLI cases failed because the restricted runner returned empty `spawnSync` pipes with `EPERM`. The same Node binary, source and tests passed all **10 cases in the two affected files** with normal subprocess pipes. No test or application code was changed for that rerun.

The normal production application passed the complete MX450/Valley Ridge and MX250/Arena Nord journey: visible menu entry, an eight-rider gate, manual throttle, explicitly enabled AI riding with measured course progress and a qualifying flight/touchdown, chase/onboard cameras, pause and paddock return. The separate seeded three-lap MX and SX race checks both finished all eight riders.

After the full suite and player journeys, the only source adjustment changed the detailed stadium threshold from three rows to four, plus its explanatory comment. The unchanged **23-test** crowd/authored-kit/environment group, TypeScript production build and scoped lint passed after that adjustment. All three final terrain/crowd WebGL tests passed, covering wetness restoration and both shadow filters. Their results are recorded in `motocross-threejs-validation-20261018.json`, together with source fingerprints and the exact runtime distinction above.

## Measured geometry and practical limits

| Same-scope measurement | Baseline | Current |
| --- | ---: | ---: |
| Occupied stadium seats | 14,821 | 14,821 |
| Submitted crowd triangles | 4,090,596 | 1,635,194 |
| Complete stadium submitted triangles | 4,476,956 | 2,021,554 |
| Stadium mesh batches | 15 | 15 |
| MX450 + rider, high detail | 95,730 triangles / 67 calls | 104,266 / 67 |
| MX450 + rider, mid detail | 49,229 triangles / 63 calls | 49,997 / 63 |
| MX450 + rider, far detail | 11,195 triangles / 45 calls | 11,971 / 45 |

The crowd contains 2,573 sculpted lower-row people and 12,248 visible distant silhouettes. The actual player camera exposed the first simpler row, so the final visual adjustment extends the detailed group from three rows to four. Its submitted triangle budget falls **60.0%**, including reserved near-cohort cards hidden by the shader. Equipment gains geometry where silhouettes need it; texture and geometry allocation counts remain unchanged, while high/mid shader programs rise from 16 to 18. These are resource/primitive measurements, not frame-rate predictions.

Equipment comparisons ran the same production WebGL fixture on ANGLE SwiftShader, with zero reported GL errors. The focused stadium/authored-kit/environment run passed 23 tests. Its new checks cover exactly one representation per seat, bounded geometry, clothing/pose variety and deterministic time/seek behavior. Final application and regression results are recorded in `motocross-threejs-validation-20261018.json`.

The source images guide visual principles; gameplay thresholds were calibrated in the simulation. The pack metadata describes PS5-available titles, but capture hardware was not independently verified. ATV/UTV, desert/snow/tropical venues and pyrotechnics are reference context. Existing world lighting and outdoor crowds are retained. The shared mud shader continues to serve its existing offroad users. Consumer-GPU frame rates and photorealistic parity were not measured by these software-GPU checks.
