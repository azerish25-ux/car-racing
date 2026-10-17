# Production motocross bike and rider evidence

These PNGs are captures of the production `DirtBikeModel`, produced by the normal repository Playwright fixture. They contain original game geometry and graphics. The supplied reference JPGs are not included.

The fixture uses a plain inspection floor and controlled environment lighting so that parts, riding posture, wheel contact and material changes are visible. The track environment is reviewed separately.

## Retained captures

| Capture                                              | What it shows                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [mx450-high.png](./mx450-high.png)                   | 450 class, detailed bodywork, open frame, wheel and control components                     |
| [mx250-high.png](./mx250-high.png)                   | 250 class with its slimmer coloured frame                                                  |
| [standing-side.png](./standing-side.png)             | Standing posture with hands at the bars, ankles at the pegs and flexed knees               |
| [inside-foot-dab.png](./inside-foot-dab.png)         | Counterlean and reachable forward inside-foot extension                                    |
| [rear-components.png](./rear-components.png)         | Original jersey number, rear bodywork, tread, silencer aperture and articulated components |
| [helmet-and-gear.png](./helmet-and-gear.png)         | Swept peak, curved goggles, goggle strap, original kit graphics and woven fabric           |
| [same-instance-mud-1.png](./same-instance-mud-1.png) | Mud and wetness on the same production model used for the dry capture                      |
| [mx450-far.png](./mx450-far.png)                     | Deliberately simplified distant model, retaining tyre radius, helmet peak and goggles      |

[metrics.json](./metrics.json) retains the 15 exterior test samples, including both classes at all three detail levels and the complete same-instance dry → mud → repeated mud → dry sequence. [onboard-and-exterior-metrics.json](./onboard-and-exterior-metrics.json) retains all 21 samples from the final run, including the six production cockpit views. Pixel hashes measure repeatability within this run; they are not cross-platform screenshot baselines.

| Production onboard capture                                         | Pose                                          |
| ------------------------------------------------------------------ | --------------------------------------------- |
| [mx250-production-onboard-0.png](./mx250-production-onboard-0.png) | MX250 seated, straight bars                   |
| [mx250-production-onboard-1.png](./mx250-production-onboard-1.png) | MX250 standing, body forward and bars steered |
| [mx250-production-onboard-2.png](./mx250-production-onboard-2.png) | MX250 standing, braking, leaned and steered   |
| [mx450-production-onboard-0.png](./mx450-production-onboard-0.png) | MX450 seated, straight bars                   |
| [mx450-production-onboard-1.png](./mx450-production-onboard-1.png) | MX450 standing, body forward and bars steered |
| [mx450-production-onboard-2.png](./mx450-production-onboard-2.png) | MX450 standing, braking, leaned and steered   |

## Completed verification

The final focused GPU run after integrating the concurrent MotoGP R2 work passed all 21 samples on 2026-10-16 in **46.842 seconds**. The complete report took 48.743233 seconds. Other CPU validation could run concurrently; elapsed test time is not a graphics benchmark. [test-run.json](./test-run.json) records the source fingerprint, exact result and individually reviewed capture names.

The integrated source includes remote parent `6e93a4ef452764f2ee0b69797817f91a908d897e`. Its production build fingerprint is `85c14e6784442ab806d98b4d4fb0559f02affe8a92d9894ec010ed081b7f97f9`. The fixture bundles the current production model source directly, and the full report is checkpointed with the 655-file validated source record.

```sh
npx playwright test -c playwright.motocross.config.ts e2e/42-motocross-bike.spec.ts
```

The observed backend was WebGL2 through ANGLE / Vulkan SwiftShader. The test built the fixture from current production source with Vite and used Playwright's own Chromium page.

| Detail level | Model triangles, including rider | Scene draw calls, full-bike view |
| ------------ | -------------------------------: | -------------------------------: |
| High         |                           74,562 |                               64 |
| Mid          |                           44,649 |                               60 |
| Far          |                           11,195 |                               45 |

Both classes have these topology counts. Draw calls come from `renderer.info.render.calls` for the controlled scene, which includes its inspection floor. These measurements are not a frame-rate benchmark of a full race on physical gaming hardware.

All captured geometry was finite and all WebGL error checks returned zero. Every hand and ankle endpoint stayed at the deliberate 2 cm geometric inset from its authored contact target, below the 3 cm reach limit. Every pose passed a precise transformed-vertex ground bound of −6 mm. The final upright high-detail model's lowest vertex was approximately +0.024 mm; the distant polygonal tyre's lowest sampled vertex was +4.30 mm.

The same-instance mud sequence retained 76 geometries, 16 textures and 12 shader programs throughout. The wet muddy image differed from the dry image, repeated muddy states produced identical hashes, and clearing mud restored the initial dry hash. The fixture disposes its production model and rendering resources after capture.

All 21 integrated-run captures were individually displayed and inspected. Their pixel hashes, topology, draw calls, resource counts, transformed bounds, contact errors and onboard contract data match the previously retained motocross run exactly on this same backend. This comparison verifies that the shared rider/bike integration preserved the validated motocross model presentation; it is not a cross-platform image baseline.

Full-project TypeScript checking, ESLint and content validation passed before this integrated GPU run. The main integration report records the consolidated CPU compatibility, whole-application build and race validation results. The separately retained [GP compatibility evidence](../compatibility/README.md) covers the integrated R2 road models and their production onboards.

## Corrections made from the actual rendered review

The initial render exposed reversed jersey text, a small telescopic-fork gap and excessively raised seated elbows. These were corrected in the production source. A later review corrected the far tyre's shrinking envelope and restored a low-cost helmet peak and goggles at that level. Tread corners are constrained to the physical wheel radius.

The first floor assertion used a transformed local bounding box, which exaggerates the vertical bounds of a raked circular wheel. The final fixture measures transformed vertices with `Box3.setFromObject(root, true)` and tightens the floor tolerance rather than hiding the issue with a larger allowance.

The full-application review exposed a separate onboard problem: the road-bike eye sat immediately behind the raised motocross number plate. Dirt-bike presentation now selects a helmet-height eye and wider bar framing from the machine's off-road specification, covering MX250, MX450 and SM450. The own rider's helmet and torso are hidden in first person. Both arm segments use a continuous first-person pose that preserves the authored limb lengths and actual grip contacts; returning to chase restores the exact exterior arm transforms. The back of the number plate uses the unprinted moulding region of the original texture.

All six integrated-run onboard images were individually inspected. Real bars, grips and pad remain in frame, the view ahead is clear, and sleeves enter from below without floating elbow caps. Each GPU view also passed three actual control-geometry ray hits, fifteen unobstructed forward rays, control frustum bounds and sleeve-entry bounds. Onboard captures used 29–31 scene draw calls and retained 69 geometries, 12 textures and 11 shader programs. The fixture has no added dashboard: the production HUD carries racing information.

The CPU cockpit contract additionally covers SM450 and three aspect ratios (4:3, 16:10 and 21:9), seated/standing/braked/steered poses, suspension load, production speed-dependent FOV, and exact restoration of the exterior arm pose. That is 12 geometry/camera cases for each of the three machines. The earlier GP eye is retained as a negative control for the MX obstruction. SM450 is covered by these CPU cases; this GPU fixture renders MX250 and MX450. The existing seven road cockpit regressions passed unchanged, including their GP display sightlines and followed-rider visibility switching.
