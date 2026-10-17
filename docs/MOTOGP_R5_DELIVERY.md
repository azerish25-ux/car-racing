# MotoGP R5 — composite shell, rider, tyre and spectator integration

This is an original-asset implementation in MOTOBOUND's production Three.js and simulation modules. It is not a replacement mini-game, an image-generated mock-up or a claim of PS5/Unreal Engine parity. Concurrent Festival and motocross source must be preserved when integrating this revision.

## Implemented changes

The GP-R1 has a rebuilt Blender composite shell: a compact broad nose, recessed open ram-air throat, thin removable side panels with actual cooling apertures, open-top containment pan, sculpted tank with a filler cap, shallow saddle, compact tail and cambered joined aero blades. The saved native source contains 38 authored mesh objects. Runtime bodywork has **16,684 high-detail / 4,050 mid-detail triangles**, in six material batches. The non-GP `upperHigh` and `upperMid` cowl data remain exactly unchanged.

Original livery art is projected onto the real shell rather than floating circular number plates. The atlas uses MOTOBOUND's original identity and entrant number; it contains no reference screenshot or real team branding. The single merged decal layer retains the material ownership/disposal path.

Road riders use shaped racing boots with a heel counter, thin sole, toe/ankle protection and instep articulation. Leather uses metre-scale filtered grain and drape rather than large plastic-looking bumps. The torso and aero hump are reshaped without changing the hand/peg targets or the two-bone pose solver. The existing motocross kit remains separately owned.

GP tyres now display their recorded compound, wear, surface temperature and contact water. Slick, intermediate and wet drainage appearances share the original crown/contact geometry. Grooves are **material relief**, not new collision cuts. Held and rewound observations restore the same uniforms and pixels; they do not accumulate arbitrary shader time.

The six baked spectator body variants have revised shoulder/neck transitions, seated clothing folds, fitted caps and everyday shoes. Seated and standing soles are constrained to the existing stair-tread plane after simplification, preventing a small geometric penetration found by the original crowd oracle. Their original **6,556 / 1,408 / 624** triangle counts are unchanged. All non-spectator crew/head/hand payloads remain unchanged. Stable per-seat gaze and torso variation use the same colour and shadow deformation, not random per-frame motion.

Rain finish composition now runs after the full dry/scanned roughness chain and before physical lighting. This fixes dry kerb, runoff and tyre code silently overwriting the earlier wet response. The actual asphalt road retains its separate recorded-water shader and is not wetted twice. No new track layout, venue geometry or off-track fluid simulation is claimed.

Requested engine braking now enters the existing rear-wheel combined-grip/load-transfer calculation. It no longer subtracts velocity outside that solver. Throttle/shift/disengagement conditions remain explicit, rear grip bounds the force, and engine braking does not heat the brake disc as though a friction brake had been applied. This is a reduced-order game model, not a coefficient inferred from a reference image.

## Reference record

The [individual ledger](MOTOGP_R5_REFERENCE_REVIEW.md) and [machine-readable record](motogp-reference-r5.json) cover all 100 original images. **73 records link to partially transferred visual cues; 27 remain reviewed context.** Listing an image does not mean its whole scene, faces, UI, licensed teams or venue have been recreated. Indoor training, press/media presentations and unrelated scene content remain outside this revision.

```sh
python tools/motogp/build_r5_reference_audit.py
```

That command verifies the actual ZIP payloads against the retained per-image hashes and reproduces the ledger. It does not perform or claim a new visual review.

## Authoring and checks

The authoritative procedural recipe and editable native counterpart are both retained. Generate into a **separate** directory, inspect, then intentionally replace the assets; do not overwrite a manually edited native project by accident.

```sh
blender -b --factory-startup -t 2 --python-exit-code 1 --python tools/motogp/build_gp_bodywork.py -- --out /tmp/motogp-r5
node --experimental-transform-types scripts/author-humans.ts spectator
python tools/motogp/verify_r5_assets.py
npm run check
npm run test:bikes
```

`verify_r5_assets.py` checks the exact runtime JSON, retained catalogue cowl and non-spectator payloads, indices, finite attributes, geometry budgets, tread clearance and GLB structure. Two independent local Blender bakes reproduced the runtime JSON SHA-256. **Native `.blend` and `.glb` files are not claimed byte-identical between independent generations.**

Inspect the saved native shell without rebuilding it:

```sh
blender -b --factory-startup -t 2 --python-exit-code 1 --python tools/motogp/review/bodywork.py -- --source authoring/motogp/motobound-gp-bodywork.blend --out /tmp/motogp-r5-native-review
```

The original WebGL model and circuit checks retain every assertion, camera, geometry limit, timeout and quality setting. Additional tyre coverage checks actual rendered differences and constant resource use.

```sh
APEX_BROWSER_BACKEND=mesa xvfb-run -a npm run test:e2e -- e2e/41-motogp-reference.spec.ts e2e/42-motogp-environment.spec.ts e2e/gp-r5-tyre-review.spec.ts
```

## Refined continuation

The refined nose has broader, flatter shoulders, a genuinely cut rounded letterbox inlet, recessed hollow duct, and carbon wing returns. The formed front fender has a transverse crown, tapered ends and a closed 2 mm return. GP-R1's side silencer has a rolled titanium outlet and a recessed bore/baffle rather than sealed black cylinders; GP-R2 retains its different exhaust layout. Missing vertex colours on otherwise bare GP titanium are now explicitly neutral, while heat-coloured header attributes remain untouched.

GP paint is dielectric, with restrained clearcoat and idempotent per-entrant calibration. A transmissive screen no longer combines its transmission result with another alpha-blended double layer. Road-rider visors use dark dielectric optics and the leathers carry original vector-drawn works-team seams, panel inserts and small partner marks. The conformal fairing atlas uses the game's original vector lettering rather than relying on platform font availability.

Spectator clothing now mixes stable everyday dark/neutral garments with coloured supporters instead of evenly repeated primary-colour shirts. The same garment function and per-seat phase are used at geometric and far-card LODs; skin is not colour-graded. Shared spectator shading benefits other circuit sessions as well; motocross bike/rider kit and retained crew/head/hand geometry remain outside the new GP material calibration.

## Reproducible native assets

The earlier hosted checksum failure was isolated to **39 paint-normal scalar components**, differing by at most **0.000002** between Blender builds. Positions, UVs, indices and material groups matched. Lossless formatting could not solve a numeric difference. The new exporter explicitly uses micrometre-grid integer face cross products and Decimal-normalized area-weighted normals. This is a versioned smoothing/export change, not a substituted acceptance hash for the old file.

Both a fresh native build and reopening the retained `.blend` reproduce the new runtime JSON. The saved-source route does not rebuild geometry or overwrite the source:

```sh
blender -b --factory-startup -t 2 --python-exit-code 1 --python tools/motogp/reexport_saved_gp.py -- --source authoring/motogp/motobound-gp-bodywork.blend --out /tmp/motogp-r5-reexport
cmp src/rendering/assets/gp-bodywork.mesh.json /tmp/motogp-r5-reexport/gp-bodywork.mesh.json
python -m unittest discover -s tools/motogp -p test_deterministic_normals.py -v
```

Native GLB material values are look-development approximations; runtime entrant colour, livery and weather are installed by Three.js. The unchanged catalogue cowl keeps its previous export convention. Native `.blend`/`.glb` files need not have byte-identical serialization between independent builds.

## Complete assembled-model exchange

The review tools also export the complete colour-visible GP-R1 and GP-R2 production models, including their rider, wheels, chain, cockpit and materials, into GLB and editable packed Blender inspection projects. They expand the two instanced chain groups into explicitly linked component nodes and omit the invisible shadow-only helmet duplicate. The initial standard exporter could not read RGBA8 data-texture objects; the exchange path now transfers the same pixel arrays into export-owned canvases without mutating runtime texture sources.

These models are exported in a **held pose**, not a new animation rig. The game's IK, wheel/chain animation, weather and tyre shaders remain in the TypeScript implementation. Standard glTF PBR and the Blender inspection lights are not equivalent to the complete game shader pipeline. The separate native inspector verifies the imported visible triangle and mesh counts before saving its project. Its inspection collection must not be confused with runtime scenery.

```sh
xvfb-run -a node tools/motogp/review/export-runtime.mjs /tmp/motogp-exchange
blender -b --factory-startup -t 2 --python-exit-code 1 --python tools/motogp/review/import-runtime.py -- --source /tmp/motogp-exchange --out /tmp/motogp-exchange-native
```

## Concurrent-source preservation

The refined implementation was reconciled with the authenticated source archive at `5b31aef72d14f4bd35e567f126aac0a0bc327d9f`. All 4,063 Git blob identities and the exact source tree `36b2a3f1b2f0b553683e7fdcc79e4da8df82edb4` were verified. Fifty-eight newer files were brought into the local baseline, with **zero overlapping R5 edits overwritten**. These include the shared GP chain geometry refactor, motocross chain/terrain work, camera regressions and Festival documentation.

The subsequently inspected `8060d6fc` differs from this archive only in three workflow files. The upgrade patch does not replace those workflow files. The local archive-recovery commits are explicitly local virtual baselines; they are not represented as fetched GitHub commit objects. A subsequent full check must use the combined source; precursor test counts are not silently relabelled.

## Acceptance boundaries

The full local lint, unit, content, type, build, original motorcycle scenarios and original WebGL gates must be run on this final integrated source. Validation results are recorded separately after execution, not inferred from this implementation description. The old precursor test counts and failed hosted deliveries do not certify this revision.

Local browser policy blocks normal full-game navigation. Production-component WebGL inspection and native simulation are distinct from a complete application input journey. A constructor-based whole-circuit High inspection encountered a software-GPU context loss and did not pass its original preparation deadline; it is not claimed as a successful game capture. Full release CI, normal startup, hardware performance, live deployment and commercial-reference visual parity remain separate acceptance gates.
