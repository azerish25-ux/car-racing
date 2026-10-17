# Shared crowd shader verification

The existing Phase 27C crowd test passed in **6.979 seconds** on the final integrated source. It rendered twelve production `CrowdCluster` people with real colour and shadow shaders, checked held and rewound pixels, and exercised the near/mid/far handoff. This component uses the shader reached by Valley generic grandstands and the initial road-venue menu. It does not render a complete motocross venue.

[Test outcome and identities](test-run.json) and [unmodified renderer metrics](crowd-metrics.json) preserve the completed result. The surrounding three-test report took 157.59991 seconds; that combined duration is not the crowd test duration. The full report and trace remain in the recorded release checkpoint. The recorded [browser backend](environment.json) is Chromium WebGL2 on ANGLE/SwiftShader; physical GPU performance was not validated.

## Source and measured checks

The source inventory contains 670 files with SHA-256 `acfc1a799a933ff9c135046aee17daa741366549f7808b8091200accf69f874d`. The production build fingerprint is `a5a1575e169f6475439722adeb3ac6ae569bc91b6d604f14e465faf7eccc6de4`, through parent `d4dd3e541433a0eb7513b0b9124c932911a64bdb`. All 670 production source files, 12 recorded context files, the build identity and main bundles matched the before/after checkpoint records. The fixture bundles these production source imports; it is a component-rendering check, separate from the earlier complete game journey.

The report recorded no page/console errors and WebGL error 0. Pause, time rewind and returning to the handoff state reproduced exact PNG bytes; advancing time changed them. Renderer memory stayed at `{"geometries": 4, "textures": 1}` across the repeat capture. Near, mid and far person meshes contain 6,556, 1,408 and 624 triangles respectively. The controlled handoff had two active levels, and the far state one.

## Retained captures

Every original PNG is preserved at 1280 × 720, in attachment order. The final return-blend image shared the original name `crowd-handoff-52.png`; its retained filename includes `-return` so it cannot overwrite the first blend. The JSON records each original name, ordinal, SHA-256, dimensions and byte count. The release owner records individual visual observations separately.

| Order | Image | Submitted triangles | Draws |
| --- | --- | ---: | ---: |
| 1 | [crowd-time-0.png](crowd-time-0.png) | 78,708 | 4 |
| 2 | [crowd-paused.png](crowd-paused.png) | 78,708 | 4 |
| 3 | [crowd-time-2.png](crowd-time-2.png) | 78,708 | 4 |
| 4 | [crowd-rewind.png](crowd-rewind.png) | 78,708 | 4 |
| 5 | [crowd-repeat.png](crowd-repeat.png) | 78,708 | 4 |
| 6 | [crowd-handoff-52.png](crowd-handoff-52.png) | 95,604 | 5 |
| 7 | [crowd-handoff-300.png](crowd-handoff-300.png) | 7,524 | 4 |
| 8 | [crowd-handoff-52-return.png](crowd-handoff-52-return.png) | 95,604 | 5 |

## Scope limits

The textile condition excludes skin and shoes. It does not exclude accessory tags, so close non-skinned phone or cup shells can also receive the fine relief and the 0.42 roughness floor. This evidence does not label the effect clothing-only.

Arena SX uses its independent stadium crowd. The existing world43 scene omits the generic Valley grandstands and therefore does not compile this shared shader. The eight retained full-game journey captures keep their original 667-source / `7733bb95` / `82b50183` identity; this later component result does not relabel them. Draw counts and exact pixels describe this controlled run, not full-race performance or cross-platform screenshot baselines.
