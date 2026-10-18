# Motocross authored assets and riding feedback — 17 October 2026

## Delivered source, not a release approval

This pass improves the existing Outdoor MX and Stadium SX. It does not replace
MOTOBOUND, reproduce every reference object, or establish commercial-game visual
parity. The actual implementation and editable Blender source are integrated as
normal repository files, rather than depending on temporary candidate archives.

The original design baseline was `5b31aef72d14f4bd35e567f126aac0a0bc327d9f`.
The recovered local validation baseline includes the MotoGP changes through
`7e423d18b4d7ea1b2478bb23ed70e6a367d57adf`. Integration preserves the subsequent
Solvane R2 commit `d54bc6829a716dc7e4af095ceaa0729214e45cda`. The latter's additional
source was not part of the local full-suite run; combined committed-source CI
must be assessed separately.

## Implemented changes

**Riders.** Original Blender-authored torso and four limb profiles add a shaped
waist, rib cage, shoulders, asymmetric clothed volume, tension folds and collar.
High and mid detail replace the MX garment surfaces while retaining the existing
skeleton, grip/peg anchors, first-person hiding and pose solver. Far detail is
retained. The separate MotoGP leather/boot implementation is preserved in the
shared rider module. The editable Blender file contains apparel and track pads,
not an entire assembled motorcycle or complete venue.

**Track edges.** Rounded, slightly compressed canvas pads use original MOTOBOUND
graphics, stitching, weave, wear, normal and roughness maps. The repeated mesh is
limited to 256 triangles and instanced in bounded batches. Collision envelopes
and course/prop clearance checks remain unchanged. Corrected UV orientation
prevents mirrored graphics; welded rounded edges avoid hard box-face normals.
Garment caps and number-plate backs/bevels have non-singular UVs without reducing
texture filtering or changing the accepted exterior geometry.

**Arena.** Recessed concourse entrances, gallery/service walls, mullions, ledges,
safety rails and secondary roof members add structural detail. Instanced seated
legs/arms and moulded chairs improve spectator placement. The arena retains its
bounded structure/crowd mesh budget and does not add dynamic lights.

**Riding.** Approximate jump-lip guidance shares the existing surveyed AI
calibration. It distinguishes building drive, holding the line, easing before
the face and rolling an under-speed feature. A practice-only three-clean-landing
objective reads real snapshot transitions and suspension settlement. Rebounds,
bottom-outs, crashes, seeks and venue changes cannot double-count a landing.
The advice does not add grip, automatic throttle, currency or locked content.
AI shoulder recovery now measures chassis displacement and actual drive effort;
wheel-spin pulses no longer continually reset the stationary assistance clock.

**Ground-normal loading.** Eligible linear BC7 ground normals are copied once to
CPU-backed RGBA8 mip arrays using the GPU's decoded samples. Every authored mip,
resolution, filter, anisotropy setting and texture transform is preserved.
LinearSRGBColorSpace from the shipped KTX2 loader is accepted alongside
NoColorSpace, without applying the operation to sRGB colour textures. The
8 MiB per-map eligibility cap remains; larger or unsupported textures stay
compressed. Renderer state is restored before asynchronous readback yields,
pending work is drained during disposal, and the arrays survive renderer
replacement. No photographic source asset or ground shader is downgraded.

Existing photographed soil, deforming ruts, terrain shadows, most mechanical
bike detail, chain animation and weather effects are retained, not presented
as new work from this pass.

## All 100 reference images

`motocross-reference-review-20261017.json` records every source filename, SHA-256,
individual visual observation, implementation decision and new/retained code
mapping. All 100 numbered images were reviewed as individually labelled tiles;
all 100 source hashes were rechecked against the supplied archive. This is not a
claim of full-resolution inspection of every image.

Eleven images are explicitly context-only. ATV/UTV modes, snow, beach,
desert/trials venues, pyrotechnics and licensed sponsor artwork are not silently
represented as implemented. Reference photographs are not distributed as game
art. A reference mapping is not a claim that every associated acceptance test
has passed.

## Reproduce and reopen the native source

```sh
blender -b -t 2 --factory-startup --python-exit-code 1 \
  --python authoring/motocross/build_kit.py -- \
  --output /tmp/mx-rebuilt.mesh.json
cmp src/rendering/assets/mx-authored-kit.mesh.json /tmp/mx-rebuilt.mesh.json

blender -b -t 2 --factory-startup --python-exit-code 1 \
  --python authoring/motocross/verify_saved_kit.py -- \
  --report /tmp/mx-native-reopen.json
```

Blender 5.2.2 LTS reproduces the runtime SHA-256
`cedd5be0c520542a2362e6fb796736391fd46d5619b7cb7b6fa4b71f66149ed9`.
The separate reopen verifier reads the committed `.blend`, rather than
regenerating it, and compares every position, normal, UV and index at both
runtime detail levels. All 12 part/detail combinations passed locally.

## Validation recorded for this continuation

The adjacent `motocross-validation-receipt.json` records actual results and
source/evidence identities. The completed local full run passed **3,388 tests
in 408 files**, with lint/content validation and the source-stability guard.
TypeScript and the Vite production build also passed. The subsequent changes
are additive verification helpers, browser coverage and delivery documentation;
the production runtime remains the one exercised by that full run.

The original isolated motorcycle/pose/mud and compact-interface checks passed
on Mesa/llvmpipe. The normal-residency component checks additionally cover both
linear metadata labels and renderer replacement. Offline verification using the
repository's shipped Basis transcoder proves byte-identical sampled texels at
all 11 mip levels for forest floor, dry earth and wet earth, before and after
renderer replacement. It is a texture-component test, not an application test:

```sh
CHROMIUM_PATH=/path/to/chromium \
  MX_NORMAL_PROOF_OUTPUT=/tmp/mx-normal-proof \
  xvfb-run -a node --experimental-transform-types \
  authoring/motocross/verify_normal_fidelity.mjs
```

The local managed-browser policy blocks application navigation; it was not
bypassed. Complete world and real-input player journeys remain separate hosted
checks. Earlier world/journey attempts timed out before this corrected normal
path was verified. Do not report those as passed, or assume a queued rerun has
succeeded. The earlier integrated offroad scenario run passed, but it is not a
new combined-main release result.

The focused workflow now validates committed files read-only and no longer
requires expiring transfer artifacts or writes candidate blobs. The repository's
full release gates in `.github/workflows/ci.yml` remain unchanged. No new release,
live deployment, APK, target-device frame rate or reference-level photorealism
is certified by this source checkpoint. Full-scene visual refinement, particularly
rider/helmet finish and crowd realism, remains necessary.
