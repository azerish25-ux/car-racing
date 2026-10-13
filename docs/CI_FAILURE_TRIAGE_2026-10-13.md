# GitHub Actions failures — 2026-10-13

## Scope and evidence

Repository: cheshmakzanoon-ops/Experiment-3, branch main; captured failing source commit
`402b4afca154e35f446cef4099d27ba74e83b512`.
Logs: [main CI #38187646066](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/38187646066),
[shadow budget #38187646154](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/38187646154),
[vegetation #38187646076](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/38187646076),
[quarry #38187646073](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/38187646073).

## Primary cause: outdated graphics cost reference

The intentionally denser spectator sculpt and moulded stadium seats shipped after
the previous performance baseline. The renderer really does submit more triangles;
this is **not** a CI runner malfunction. The dedicated shadow survey measured:

| Lighting | Previous complete triangles | Observed complete triangles | Increase | Observed calls |
|---|---:|---:|---:|---:|
| Day | 11,358,110 | 14,715,455 | +29.56% | 2,351 |
| Sunset | 13,767,736 | 19,231,637 | +39.68% | 3,267 |
| Night | 14,293,296 | 18,273,912 | +27.85% | 3,593 |

The complete-frame reference is now **re-pinned to these exact measured
per-lighting and per-pass totals**, with previous values and deltas retained in
`docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json`. The same <=2% complete-frame
headroom, composer <1,800 calls, direct scene <1,800 calls, GL error checks, and
shadow texture equivalence still apply. This accepts a larger current art cost:
it does **not** recover the earlier rendering performance or establish playable
physical-device FPS. Further crowd/stadium-seat LOD and shadow-caster optimization
is necessary to reduce the submitted-work regression.

## Other independent failures

- `e2e/11-phase27c.spec.ts` expected obsolete exact mid/far spectator index
  counts 1,328/638; the committed meshes are 1,408/624.
- `e2e/a31-wheel-gun.spec.ts`, `e2e/a33-spare-wheel-set.spec.ts`, and one
  vegetation night survey hit test timeouts during complete software-GPU captures.
  Increase **watchdogs only**, not test workload, app GPU budgets, or evidence scope.
- The eight-car rainy-grid test remained in `loading` at the generic 60-second
  assertion window; allow up to 180 seconds while still requiring a paused state.
- A full-lap evidence run completed with eight submitted frames, rather than
  more than ten; one 30-second performance capture produced five samples, rather
  than more than five. Retain actual completion, elapsed-time, distance and
  integrity requirements while accepting these observed software-GPU counts.

## Verification boundary

All observations above come from the old failing GitHub Actions logs. A fresh
GitHub Actions run on the new commit must establish whether these corrections
are sufficient. Do not equate a green CI run with final art approval or target
hardware performance; inspect any remaining failures independently.
