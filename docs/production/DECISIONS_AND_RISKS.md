# Decisions, risks and stop/go rules

Masterplan §1.4, §27.5, §28, WP16, WP63. Decisions marked **proposed** are the technical director's
recommendation and need the producer/owner's signature before they bind scope. Reversal cost is how
expensive it would be to change course later.

## 1. Decision log

| # | Decision | Status | Alternatives considered | Evidence | Reversal cost | Review |
|---|---|---|---|---|---|---|
| D1 | First commercial target is **Windows PC**, offline-first; the browser build remains a supported demonstration and development route. | proposed | Browser-first; console-first | No platform commitment found in the repository (§1.4) | medium | at G1 |
| D2 | Keep **Three.js + TypeScript** through G1/G2. WebGPU only via WP61's bounded experiment. | proposed | Engine rewrite; immediate WebGPURenderer | `onBeforeCompile`-based stack is WebGL-only (§17.10) | high | after G2 |
| D3 | Handling target: **approachable simulation with explicit assists**; no hidden grip, pose corrections or position-dependent power. | proposed | Arcade; hardcore-only | AI and assists already use normal controls (§13.1) | high | at G1 playtests |
| D4 | Preserve the supplied player assembly as a source asset until an approved derivative exists; branding approval is separate. | adopted (repository practice) | Silent replacement | `docs/SUPPLIED_PLAYER_RUNTIME.md` | low | WP07 |
| D5 | The full multi-discipline vision is a roadmap; only the next gate is committed work. | proposed | Commit the full catalogue | §5, §25 | — | every gate |
| D6 | A **separate vehicle** is a distinct VehicleDefinition with its own mechanics *and* visual/audio identity; liveries and trims are not models. | adopted | Count liveries | `vehicles.ts`, `validateVehicleDefinition` | low | — |
| D7 | An **accepted layout** has route, pit/grid, AI, recovery, cameras and a full human + AI race (§14.3). | adopted | Loadable spline | `CONTENT_PIPELINE.md` | low | — |
| D8 | **Records across physics changes**: records carry vehicle and physics version; a physics change bumps `SIMULATION_VERSION`, which opens new boards and leaves old ones readable but separate. Pre-identity ghosts read as Formula/physics v1. | adopted | Silent mixing; deletion | `session-identity.ts`, `tests/session-identity.test.ts` | low | each physics change |
| D9 | **Assists and online categories**: assisted laps never enter competitive categories; local boards show the assist used. Online categories split by assist policy (WP52). | proposed | Mixed boards | §22.5 | medium | G7 |
| D10 | **Branding**: original names, liveries, riders and series identities only; licensed content needs documented clearance (§18.6). | adopted | — | `docs/ASSET_PROVENANCE.md` | — | per asset |
| D11 | **Ongoing-funding services** (online racing, UGC moderation, cloud saves) are not launch dependencies of the offline car release. | proposed | Launch with online | §5.3 | medium | G3 |
| D12 | Presentation gates must have a bounded wait with an expiry counter (F01). | adopted | Unbounded fence wait | `REPLAY_CLOCKS_AND_F01.md` | low | — |
| D13 | Vehicle physics content is data (`VehicleDefinition`); a new family that cannot be expressed in the four-wheel solver gets its own dynamics adapter, never optional Formula fields. | adopted | One universal interface | `bike.ts` prototype kept separate | medium | G4 |

## 2. Non-negotiable decisions (§28.1) and where they stand

| Question | Answer recorded |
|---|---|
| Is the first commercial release offline-first? | Proposed yes (D1, D11). |
| Which hardware profile is required? | Core PC profile in `HARDWARE_DEVICE_PLAYTEST_PROTOCOLS.md`; machines not yet named. **Open.** |
| Accessible simulation or arcade? | Proposed accessible simulation with explicit assists (D3). |
| Fictional versus licensed branding? | Fictional/original (D10). |
| What counts as a separate vehicle? | D6. |
| What counts as an accepted layout? | D7. |
| How do old records survive physics changes? | D8. |
| Which assists affect online categories? | Proposed D9. |
| Which services require ongoing funding? | D11 list. |

## 3. Risk register (§28)

| Risk | Evidence / cause | Consequence | Mitigation in place | Next action | Owner |
|---|---|---|---|---|---|
| Repeated replay-release failure | F01 | Source not publishable | Mechanism fixed, regressions, diagnostics | Hosted green run, publish (WP02–03) | Runtime lead |
| Dense assets × passes | 800k-triangle distant player tier; shadow/mirror submissions | Pacing, grid limits | Shadow-pass LOD substitution for crowd/seats | Hardware captures; WP07 derivative | Rendering + tech art |
| Single-family assumptions | Global vehicle, fixed wheels | Fragile new classes | Per-entry definitions, per-vehicle AI envelopes | Second family adapter only when needed | Technical director |
| Route ambiguity | Horizontal nearest progress | Broken overpasses | Layer-aware progress, RouteGraph | First stacked venue | Track/tools lead |
| Premature motorcycle roster | Rider/controls not accepted | Art on weak riding | Prototype isolated from sessions | G4 slice before roster | Motorcycle lead |
| Cosmetic terrain sold as simulation | — | Lost trust | Terrain contact = rendered displacement = AI cost | G5 slice | Terrain lead |
| Unbounded scope | All disciplines requested | Nothing ships | Status register; gates | Producer enforces WIP limit | Producer |
| Shader/backend churn | WebGL-specific stack | Regressions | D2 | WP61 only after G2 | Rendering R&D |
| Shared-file collisions | Large `main.ts` | Lost changes | Records and replay clock extracted | Session/profile controllers | Runtime lead |
| Commercial rights | Supplied branded material | Distribution blocked | D4, D10 | Rights inventory | Producer |
| Weak human validation | No playtests recorded | Tests pass, racing unsatisfying | Protocol written | Run G1 sessions | Design + QA |
| Device overclaims | Axis input ≠ wheel support | Unsafe FFB, unhappy players | No FFB claimed | Device matrix | Input lead |
| Online underestimation | No service | Cost/abuse surprises | Workload measured (WP49) | WP50–54 | Network lead |
| Creator-content abuse | — | Crashes, harm | Inert, bounded import | Moderation design | Security |
| Save/replay incompatibility | New entity families | Lost progress | Backups, recovery, identity, schema rejection | Termination/quota tests | Persistence owner |
| Art inconsistency | Many families | Patchwork look | Capture suite defined | Art director, kits | Art director |
| Provisional art shipped as final | TC-1 greybox body | Quality gap | Labelled provisional in code and register | Final exterior/interior | Vehicle art |

## 4. Stop/go rules (§28.2)

* Pause vehicle-volume production if the first optimized asset cannot meet the accepted scene budget.
* Pause new track art if tools cannot produce correct timing, AI and recovery (`validate:content`
  and RouteGraph validation must be clean first).
* Pause bike roster work if the rider slice is not convincing to target players.
* Pause ranked online launch if collision reconciliation or result integrity fails under expected
  latency/loss.

A stop redirects work to the blocker; it does not cancel the vision.

## 5. Work-in-progress limit (§27.5)

At most one new vehicle and one new venue may be in production at a time until the previous one has a
complete acceptance packet (`CONTENT_PIPELINE.md`). Defect correction, tooling and release support
reserve at least 25% of planned capacity.
