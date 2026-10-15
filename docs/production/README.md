# Production documents

Response to the *AAA Racing Production Master Plan* audit (pinned source `a8800c73`). Code changes are
listed in `git log a8800c7..HEAD`; these documents hold what cannot be code.

| Document | Masterplan sections |
|---|---|
| [STATUS_REGISTER.md](STATUS_REGISTER.md) | F14, WP04, §25 gates, §26 work packages |
| [REPLAY_CLOCKS_AND_F01.md](REPLAY_CLOCKS_AND_F01.md) | F01, §24.2, §24.7 |
| [DECISIONS_AND_RISKS.md](DECISIONS_AND_RISKS.md) | §1.4, §27.5, §28, WP16, WP63 |
| [HARDWARE_DEVICE_PLAYTEST_PROTOCOLS.md](HARDWARE_DEVICE_PLAYTEST_PROTOCOLS.md) | §4.3, §7.6, §20.6, §21.1–21.2, §23, WP05, WP21, WP31 |
| [RELEASE_DASHBOARD.md](RELEASE_DASHBOARD.md) | §24.6, §29, WP03, WP59, WP64 |
| [CONTENT_PIPELINE.md](CONTENT_PIPELINE.md) | §10, §14, §15, §17, §18, WP27, WP29–WP30 |
| [RENDERING_PIPELINE.md](RENDERING_PIPELINE.md) | §17, §17.5, §17.6, WP27, WP28 |
| [DETAILS_D001_D100.md](DETAILS_D001_D100.md) | §19 |
| [PROGRAMME_PLAN.md](PROGRAMME_PLAN.md) | §4, §5, §11–§13, §20–§23, §25–§27 |
| [GAME_DESIGN.md](GAME_DESIGN.md) | §4–§5, §11–§12 expanded: disciplines, journey, economy, racecraft |
| [ARCHITECTURE_SERVICES.md](ARCHITECTURE_SERVICES.md) | §6 |
| [ONLINE_SLICE.md](ONLINE_SLICE.md) | §22, WP50–WP54 |
| [PHYSICS_MODEL.md](PHYSICS_MODEL.md) | §7 vehicle physics: tyres, suspension, drivetrain, aero, ground materials, integration (simulation v2) |
| [OPEN_WORLD.md](OPEN_WORLD.md) | §4–§5 festival discipline: region, road network, free roam, events |

Commands added: `npm run validate:content`, `npm run test:vehicles`, `npm run test:server`,
`npm run test:catalogue-races`, `npm run test:online`, `npm run test:open-world`.
