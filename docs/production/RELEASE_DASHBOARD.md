# Release dashboard and release-candidate checklist

Masterplan §24.6, §29.1–29.3, WP03, WP59, WP64.

## 1. Release-facing dashboard

Update on every release candidate. Never mix automated AI runs with human retention, or software-GPU
timings with consumer performance.

| Item | Source | Current |
|---|---|---|
| Source commit and artifact hash | menu `BUILD /` identity; CI artifact digest | — |
| Last validated release | release log | unchanged since the audited failure |
| Required CI | Build and validation (all shards), simulation scenarios, wet presentation | green on 5f46098 after the off-road merge (run 38758404195, all jobs); previously e592b1a (run 38731013547) |
| Open blockers | `STATUS_REGISTER.md` G0 row | F01 publication |
| Hardware captures accepted | `HARDWARE_DEVICE_PLAYTEST_PROTOCOLS.md` §2 | none |
| Human-play findings | playtest notes | none |
| Save/replay compatibility | `tests/session-identity.test.ts`, `tests/replay-clock.test.ts` | passing (automated) |
| Content acceptance count | `CONTENT_PIPELINE.md` packets | 0 accepted (2 circuits, 2 vehicles integrated) |
| Device coverage | device matrix | 0 certified |
| Resource trends | long-session captures | none |
| Rights issues | `docs/ASSET_PROVENANCE.md` | supplied branded assembly unresolved |

## 2. Metrics (definition, denominator, population, period)

| Metric | Definition | Denominator | Population |
|---|---|---|---|
| Race completion | sessions reaching the results screen, excluding player quits | started races | human testers, per build |
| Unexplained interruptions | error screens, worker failures, recording failures | sessions | all automated + human |
| Failed saves | `writeWithBackup` rejections and recovery events | save attempts | all |
| Replay seek errors | seeks not presented within 10 s (`replayStall`, `expiredFences`) | seeks | automated journeys |
| Frame-interval spikes | intervals > 2× target | frames | hardware captures only |
| AI stuck incidents | car stationary > 10 s off pit | AI-race hours | seeded AI races |
| Time to driving | launch → first controllable frame | launches | hardware captures |
| Catalogue evidence | models/layouts with complete packets | approved catalogue | content |

## 3. Release-candidate checklist (§29.3)

- [ ] All required checks green on the **exact** source; publication consumes that artifact, not a rebuild.
- [ ] No unresolved classification, control-loss, save-corruption or critical loading defect.
- [ ] Human full-race acceptance on both circuits (protocol §4).
- [ ] Named hardware and device acceptance.
- [ ] Source/asset rights review complete.
- [ ] Save and replay migration/rejection policy verified (`DECISIONS_AND_RISKS.md` D8).
- [ ] Rollback to the previous known-good build rehearsed.
- [ ] Known-limit statement published (provisional TC-1 art; prototypes not in sessions).
- [ ] Features not accepted are hidden or labelled experimental.

## 4. Source integration and publication (§24.6)

* Integrate serially to the release branch; no pushes while a candidate is being certified.
* Required checks are enforced by repository rules, not convention.
* Keep the distinction between the current source head and the last validated release.
* Publication downloads the validated artifact by digest; rollback re-publishes the previous digest.
