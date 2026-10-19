# MOTOBOUND

**Circuit racing. Open roads. Two wheels or four.**

[![CI · main](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/workflows/ci.yml?query=branch%3Amain)

MOTOBOUND is an independent browser-based motorsport game built with TypeScript and Three.js. It brings together circuit racing, motorcycles, off-road competition and an open-world festival, with vehicle simulation driving the handling, sound and presentation.

[Run locally](#run-locally) · [Controls](#controls) · [Development](#development) · [Documentation](#documentation)

> **In development.** The game is not a finished commercial release. Visual polish, target-hardware performance and release validation remain ongoing. Online racing is an [experimental networking implementation](docs/production/ONLINE_SLICE.md), not a public multiplayer service.

## The game

| Area | Current scope |
| --- | --- |
| Racing | Free practice, ghost time trials, qualifying, Grand Prix and endurance events. |
| Machines | Multiple car classes, road-racing motorcycles and off-road machines, with vehicle-specific setup and assists. |
| Locations | A circuit catalogue, dedicated off-road venues and the Solvane Coast festival region, with free roam, traffic and local events. |
| Festival | Sixteen activities, rolling speed and drift challenges, clean-driving skill chains, a route-preview map, and paused orbit/zoom photo mode. |
| Racecraft | AI rivals, changing weather, tyre temperature and wear, fuel, damage, pit stops and race control. |
| Progression | Career events, garage ownership, unlocks and festival rewards. |
| Presentation | Cockpit and external cameras, authored 3D assets, photographic skies, scanned ground materials and state-driven audio. |
| Driver tools | Replays, flashback, telemetry, lap comparison and CSV export. |

Feature availability depends on the vehicle, event and graphics preset.

## Run locally

**Requirements:** Node.js **22.12 or newer**, npm, and a browser with WebGL2 and Web Worker support. Automated browser validation uses Chromium.

```sh
git clone https://github.com/cheshmakzanoon-ops/Experiment-3.git motobound
cd motobound
npm ci
npm run dev
```

Open the local address printed by Vite. Start with **Free practice** and **Sport** assists, or press **G** during a circuit session for an AI-driving demonstration. **Garage & Settings** contains graphics options, input bindings and calibration.

To build and preview the production bundle:

```sh
npm run build
npm run preview
```

The output is written to `dist/`. Serve it over HTTP or HTTPS; do not open `index.html` directly. Development, build and unit-test commands prepare the required player-model detail assets automatically. The first browser load also prepares bundled assets and shaders.

## Controls

Default circuit-session keyboard controls:

| Input | Action |
| --- | --- |
| **W / S** | Throttle / brake |
| **A / D** | Steer left / right |
| **[ / ]** | Downshift / upshift |
| **C** | Change camera |
| **P** | Request or cancel a pit stop |
| **G** | Toggle AI demonstration driving |
| **T / R** | Open telemetry / replay |
| **X** | Flashback |
| **Escape** | Pause |

Bindings are configurable; gamepad and touch inputs are also supported. On motorcycles, the brake input operates the front brake and the clutch binding (**Left Shift** by default) operates the rear brake. See the [complete default bindings](src/input/bindings.ts).

In **Session → Festival · open world**, **T** opens the Solvane map and **R** resets to the road. Stop at a discovered race marker and press **Enter** to start; speed and drift zones activate as you drive through their entry. **Escape** opens the festival menu, including the garage, time of day, discovered-event travel and photo mode. Keyboard focus and standard gamepad **D-pad / A / B** work through the menu, map and photo controls.

## Development

Dependencies are pinned in [`package-lock.json`](package-lock.json). Use `npm ci` to reproduce the toolchain.

| Command | Purpose |
| --- | --- |
| `npm run check:stable` | Lint, content validation, unit tests, type checking and build, with source-change detection. |
| `npm run test:physics` | Vehicle dynamics, race control, wet pit stops and integrated driving scenarios. |
| `npm run test:vehicles` | Vehicle calibration checks. |
| `npm run test:offroad` | Off-road calibration and race scenarios. |
| `npm run test:open-world` | Festival region, routes, traffic and motorcycle scenarios. |

Run the browser suite against a production build:

```sh
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Playwright starts the preview server automatically. The full script list is in [`package.json`](package.json), and live validation results are in [GitHub Actions](https://github.com/cheshmakzanoon-ops/Experiment-3/actions). The badge above tracks `main`, not every feature branch.

### Source layout

```text
src/simulation/   Vehicle physics, race rules, AI and world simulation
src/rendering/    Vehicles, environments, cameras and visual effects
src/career/       Progression, garage and event rewards
src/session/      Session lifecycle and festival integration
src/input/       Keyboard, gamepad and touch controls
src/audio/       Audio synthesis and spatial sound
src/storage/     Persistence, recordings and telemetry
src/ui/          Menus, HUD and settings
src/workers/     Simulation workers and data transport
tests/           Unit and integration tests
e2e/             Browser validation
assets/, public/ Source assets and bundled runtime resources
scripts/, tools/ Validation and asset tooling
```

## Documentation

| Reference | Contents |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Application structure and simulation/rendering boundaries. |
| [Physics model](docs/production/PHYSICS_MODEL.md) | Vehicle dynamics, tyres, suspension, drivetrain and surface interaction. |
| [Circuit catalogue](docs/CIRCUIT_CATALOGUE.md) | Venues, layouts and implementation notes. |
| [MotoGP Three.js riding update](docs/MOTOGP_THREEJS_REFERENCE_REVIEW.md) | 100-image trace, forged wheels and tyre finish, bike grounding, corner guidance and GP racecraft. |
| [MotoGP R2 improvements](docs/MOTOGP_R2_DELIVERY.md) | All 100 reference reviews, bike/rider and circuit changes, motorcycle interface, braking corrections and visual evidence. |
| [Motocross reference upgrade](docs/production/motocross-reference-upgrade.md) | All 100 motocross references, detailed bikes and riders, dirt and stadium scenery, riding/camera updates, race reliability and actual gameplay evidence. |
| [Open-world festival](docs/production/OPEN_WORLD.md) | Solvane Coast, free roam, events, traffic and known limits. |
| [100-image festival reference record](docs/production/HORIZON_REFERENCE_IMPLEMENTATION.md) | Individual observations and original implementations for every supplied reference, with code links and limits. |
| [Festival upgrade validation](docs/production/HORIZON_UPGRADE_VALIDATION.md) | Final screenshots, real driving/event evidence, test results and the guarded production build. |
| [Solvane Blender continuation](docs/production/SOLVANE_CONTINUATION_VALIDATION.md) | Native detail assets, all eight committed-source validation jobs, actual game captures and the 100-reference continuation ledger. |
| [Solvane authoring guide](authoring/solvane/README.md) | Editable Blender source, template contracts, safe re-export and reference-integrity verification. |
| [Production documents](docs/production/README.md) | Design, implementation status, development plans and validation protocols. |

### Assets and attribution

The project combines procedural content, Blender-authored models, supplied player assets and third-party resources. Source details and applicable terms are recorded in [asset provenance](docs/ASSET_PROVENANCE.md), [supplied-player documentation](docs/SUPPLIED_PLAYER.md) and the [bundled third-party credits](public/assets/third-party/CREDITS.txt). This README does not grant an additional asset licence.

The repository URL remains `Experiment-3`. Older engineering documents and internal identifiers may still use the previous project name; historical reports describe their recorded revisions rather than the current build.
