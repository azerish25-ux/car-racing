# MotoGP R1.1 — verified source delivery

## Accepted graphics

R1 graphics: `4014ae6651266e67c5a264ae2dbabf12b9fecd1c`.
R1.1 cockpit correction: `cb189b88b1d4f767d6234d5cae14410f89ea196d`.
R1.1 tree: `7751e2013be6654c2640037b1cc0027024f19efa`.

The R1.1 candidate and the successfully pushed commit are identical. Hosted run
`38941476267`, job `117109916024`, rebuilt twice with the pinned desktop Blender,
then required the complete `npm run check` and the component WebGL test before a
non-forced, guarded push. It removed its temporary patch and one-time workflow.
The existing `c92b6172d54983c7917069e03f5dcadacb6d7740` delivery/GPU-fence fixes and
all intervening history are retained. Physics, wheelbase and suspension anchors
were not changed by the graphics corrections.

## Hosted results on the accepted R1.1 candidate

| Check | Observed result |
| --- | --- |
| Independent Blender exports | Two matching exports; SHA-256 below |
| Lint and catalogue validation | Passed |
| Complete unit suite | 2,989 tests in 353 files passed |
| Strict TypeScript and Vite production build | Passed |
| Component WebGL test | One test passed; ten captures, including four real onboard cameras |
| GPU backend | Chromium / ANGLE / SwiftShader |
| Guarded source publication | Candidate and pushed commit both `cb189b88b1d4f767d6234d5cae14410f89ea196d` |

Build fingerprint: `693c8fe39c92ba8a71383fdb385210f825c8cdf820c3978adda9927a43325ca9`.
Runtime mesh SHA-256: `29aed319fbbc6a70805704c9c88c125b6481abd38514a2619e246f0569dd847f`.
Evidence artifact: `12064323429` (`motogp-cockpit-r11-validation`), ZIP SHA-256
`27340a6099063378a4110db521b5ed29bc0f115a01220daff5e728a450ac04b5`.

The local offline source additionally passed 2,975 tests in 350 files, lint,
content validation, TypeScript and the production build. That local snapshot did
not include all concurrent delivery fixes; the larger hosted counts above belong
to the actual integrated source. They are not interchangeable results.

## Stronger same-instance weather regression

The original dry/wet/dry fixture created a fresh bike for every picture. Its
matching dry hashes proved repeatable construction, not reversal on an existing
material set. The follow-up test retains one production bike, one set of
materials and one renderer through dry at time 2, wet at time 10, held wet at time
10, and rewound dry at time 2. All previous assertions remain in place.

The strengthened canonical test passed locally on Chromium 144 / ANGLE / Mesa
llvmpipe, using the unchanged Playwright deadlines. It covers fourteen captures:
the original ten plus four same-instance weather samples. The observed pixel
hashes were `1685466604`, `2182675473`, `2182675473`, `1685466604`. Geometry,
texture and program counts remained 98, 19 and 45 throughout the sequence. Source
weather frames remained unchanged and every reported WebGL error code was zero.
The code now disposes those resources in a `finally` block.

This follow-up changes only test instrumentation and documentation, not production
rendering or the accepted mesh. Its hosted full-release result must be read from
its own commit, not inferred from the preceding graphics delivery.

## Reference accounting and remaining acceptance

All 100 numbered reference images have individual observations, filenames,
SHA-256 hashes and component mappings in `motogp-reference-r1.json`. All 100
payload hashes match both the supplied ZIP and the repository ZIP. Those archives
differ in five contact-sheet JPEGs, not in the 100 numbered references.

The audit distinguishes **70 partially applied component references** from
**30 reviewed/context-only references**. These are not 70 finished scenes or a
claim that all reference features are implemented. New career scenes, split
screen, training worlds and complete pit/crowd/circuit recreations are not claimed.

The editable `.blend` and `.glb` contain the authored bodywork; mechanical parts
and the rider remain the existing procedural/IK-based Three.js assembly. Further
close-up collar, yoke, controls and panel-return work remains. First-person head
exclusion currently also removes its shadow; a shadow-only proxy remains open.

Neither a successful source push nor a component render certifies the complete
navigation/worker/release matrix, representative consumer-GPU frame rates,
MotoGP 26 / PS5 visual parity, perfection, or the deployed playable site's current
build. Vite's large-chunk warning is retained rather than suppressed.
