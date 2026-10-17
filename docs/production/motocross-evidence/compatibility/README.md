# Integrated MotoGP compatibility evidence

This is the actual **`e2e/41-motogp-reference.spec.ts`** fixture rerun after integrating the motocross changes with concurrent MotoGP work through `31626200d4a79e8173f70d587a14c09176d0aa7f`. It includes the close-detail chain on both GP prototypes and preserves the shared road rider/onboard behavior. The motocross model and full-race environment have separate evidence.

The run passed on **2026-10-17**: **1 test passed in 98.383 seconds**, with report duration **100.480165 seconds**. One browser worker and one GPU fixture were active. All **667 production source files and 12 verification context files**, plus both built main bundles, matched the frozen record before and after the run. Its production build fingerprint is `82b5018336f9fb2c9ae1c2fcc7d11d1c3011209ec2e1c8471be5111c033c52e8`. [test-run.json](./test-run.json) records the frozen source identity and verification hashes.

```sh
npx playwright test -c playwright.motocross.config.ts e2e/41-motogp-reference.spec.ts
```

The observed backend was WebGL2 through ANGLE / Vulkan SwiftShader. Vite bundled the frozen production model source into Playwright's test-owned Chromium page. This is a controlled compatibility check, not a main-application FPS measurement.

## Geometry and draw budgets

The model counter now expands every `InstancedMesh.count`. The unchanged budgets are **fewer than 110,000 constructed model triangles** and **fewer than 220 scene draw calls**. All six exterior cases pass, and GP-R1 high/mid/far geometry decreases strictly.

| Exterior case | Scene draw calls | Expanded model triangles | Submitted color/transmission triangles |
| ------------- | ---------------: | -----------------------: | -------------------------------------: |
| GP-R1 high    |              196 |                  107,732 |                                214,568 |
| GP-R1 mid     |              166 |                   44,953 |                                 89,057 |
| GP-R1 far     |               85 |                   12,538 |                                 24,318 |
| GP-R2 high    |              192 |                   98,068 |                                195,876 |

`triangles` counts the entire constructed bike/rider model, including each repeated chain instance. `submittedTriangles` is separately read from `WebGLRenderer.info.render.triangles`: it includes repeated color/transmission submissions and is not a unique-model count. The installed renderer resets this counter after the shadow pass. The 110,000 model gate is not applied to the repeated-pass count.

## Preparation and weather reversal

An earlier integration run recorded the very first cold draw and failed resource equality when two shadow-depth shader programs appeared on the second draw. Its failed report and complete returned weather sequence remain preserved. No production material change or resource-tolerance increase was used to resolve it.

The fixture now records **three identical dry preparation draws**, matching the production renderer's preparation-before-presentation behavior. GP-R1's program counts are **54 → 56 → 56**. GP-R2 records **54 → 56 → 56**, with its prepared resources at **108 geometries, 19 textures and 56 programs**. The diagnostic retains the actual added program keys. The second and third preparation draws must have equal resources and no newly compiled third-draw programs; each subsequent sample must match that prepared resource state.

One retained GP-R1 bike, material set and renderer then passes dry → wet → held wet → rewound dry. All four states keep **111 geometries, 20 textures and 56 programs**. Their hashes are **3337082380 → 3286093876 → 3286093876 → 3337082380**. The wet state changes the pixels, holding it repeats the pixels, and rewinding dry restores them exactly. Every source frame remains unchanged; all result records report GL error 0 and the test reports no page or console errors.

## Production onboard views

The four views use the production mount and lens. Every instrument passes all nine visibility samples, the facing threshold and all clip-space corner bounds.

| Bike    | Scene draw calls | Visible instrument samples | Instrument facing |
| ------- | ---------------: | -------------------------: | ----------------: |
| gpr1    |               37 |                      9 / 9 |          0.960782 |
| gpr2    |               37 |                      9 / 9 |          0.960782 |
| sbk1000 |               33 |                      9 / 9 |          0.960782 |
| ss600   |               35 |                      9 / 9 |          0.960782 |

All fourteen final PNG files were individually compared by SHA-256 with the corresponding captures from the preceding `d90b8bb6` build. **All fourteen are byte-identical.** Each therefore retains its existing individual visual observation, explicitly linked to that earlier local image inspection in `visual-review.json`; no new image-display pass is claimed for these identical files. The authored GP exteriors retain their body silhouettes, component shading, road helmet/leathers and tucked pose. Each onboard keeps readable gear/speed/RPM digits and an open forward view, without the rider's own helmet or torso obstructing it. Existing translucent windscreens soften part of the display contrast; the GP-R2 screen covers more of the display than the other profiles. The three-quarter exterior angle does not expose the entire chain route, so its geometry, bounds and replay-driven phase are validated separately by the focused CPU cases.

## Retained files

- `0-gpr1-high-dry.png` and `3-gpr2-high-dry.png` retain the two GP exterior cases, including the integrated GP-R2 chain. The four `*-production-onboard.png` files retain all production cockpit cases.
- [metrics.json](./metrics.json) retains all eleven original JSON attachments: six exterior results, four onboard contracts and the complete retained-instance weather sequence.
- [visual-review.json](./visual-review.json) records a separate observation and file hash for every one of the fourteen captured images.
- [test-run.json](./test-run.json) records the exact command, result, source/build identity and metric definitions.
- [chain-integration](./chain-integration/README.md) retains the measured GP-R1 topology/disposal repair and its 16-test CPU validation from that earlier integration stage. Its source hashes distinguish it from this final browser run.
- Existing `r2-interface/` and `r2-environment/` evidence folders are preserved unchanged.

The complete HTML report, original attachments, decoded JSON, source-integrity checks and validated source record were checkpointed as `motocross-release-validation/gp41-camera-clearance` before releasing the shared browser slot. The prior `gp41` checkpoint remains untouched. This successful run has no retained `trace.zip`, because the configured trace policy is `retain-on-failure`. The initial failed run and the preceding passing 07d7e8b and `d90b8bb6` runs remain separate historical checkpoints. No production source, GPU backend, budget or weather equality threshold changed during this final verification.
