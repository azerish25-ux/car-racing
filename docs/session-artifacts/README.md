# Session artifacts (2026-10-15)

This is a record of a long multi-agent session on this repository. All source code is in git history. The two folders here keep everything else the session produced outside the repository: captures, tools, reports and logs.

The session was stopped at the owner's request on 2026-10-15 at about 23:00 UTC. All work was committed and pushed first.

## Where the work is

| Branch (origin) | State |
|---|---|
| `claude/peaceful-einstein-dedc7t` | The integration branch: every finished, merged workstream. |
| `claude/peaceful-einstein-dedc7t-photoreal-skies` | Finished, **not merged**: the third-party asset register, the reproducible build (`scripts/assets/`), the runtime loaders (`src/rendering/assets/`), photographed CC0 skies with image-based lighting on every venue, and the credits view. Its gates passed in its own worktree. It must be merged and re-validated against the integration branch. |
| `claude/peaceful-einstein-dedc7t-photoreal-ground-wip` | **Work in progress**, built on the skies branch: scanned ground texture sets, and photographed ground on tracks, verges, terrain and off-road courses. The last commit holds documentation edits that were uncommitted when the session stopped. Not validated after those edits. |
| `claude/peaceful-einstein-dedc7t-photoreal-vegetation-wip` | **Work in progress**, built on the skies branch: photoreal tree species with impostor card atlases (KTX2), vegetation loaders, venue and festival integration, and a test file. Committed as found at the stop. Not validated. |
| `claude/peaceful-einstein-dedc7t-ai-grid-stall-wip` | **Work in progress**: unfinished AI and traffic edits so cars stuck behind a stalled pole-sitter pass it. Not validated. |
| `claude/peaceful-einstein-dedc7t-offroad-stuck-wip` | **Work in progress**: unfinished off-road AI, course and dirt-bike edits for the rider left parked in `valley-ridge-mx-moto-2`, plus coverage of every off-road event in `scripts/offroad-races.ts`. Not validated. |

The look-dev tracks for figures (riders and drivers), architecture and props, and vehicle materials had not started when the session stopped.

## Open items at the stop

- **Hosted CI** for 9e923c8 was dispatched, and its scheduled check-in was cancelled with everything else. The previous run (38797906905) failed in two GPU fixture specs; 9e923c8 fixes both, and the fixes pass locally. The integration head 10fa22c also carries the merged polish work: bike pits, setup, ghosts, two-moto meetings and air audio; car cockpits, interiors and the setup screen; and the festival career and traffic. Its full suite was stopped before it finished, but its targeted tests pass (135 tests in 12 files). Dispatch `Build and validation` on the head to confirm.
- **Grid stall:** in a headless repro, AI cars behind a stalled car on the grid never pass it. The repro script is `2026-10-15-scratchpad/ci/wet-follow.ts`, and the fix is on the grid-stall WIP branch.
- **Stuck motocross rider:** the rider parked in `valley-ridge-mx-moto-2`. The fix is on the off-road WIP branch.
- **Visual quality:** the owner judged the procedural look cartoony. The photoreal branches above are the response, and they are not merged yet. Three hosts are blocked by the environment's network policy: `polyhaven.com`, `dl.polyhaven.org` and `ambientcg.com`. Allowing them would unlock more scanned assets.

## Folders

- `2026-10-15-scratchpad/`: curated copy of the session scratchpad. `INVENTORY.tsv` lists every scratchpad file. For each it records whether the file was committed (as is, or as a JPEG for large PNG captures) or why it was left out. Files left out:
  - repository copies used for comparison (their code is in git)
  - build outputs, npm and tool caches, and browser traces
  - 2.3 GB of raw downloaded textures and HDRIs, which can be downloaded again from the URLs in `asset-scout/manifest.tsv`
  - intermediate texture builds that the pushed branches' build scripts regenerate

  Notable contents:
  - `showcase/`: the 12 feature screenshots sent to the owner and their contact sheet, with the capture tool.
  - `art/`: before/after captures of the art-direction pass.
  - `lookdev/`: photoreal look-dev captures.
  - `asset-scout/`: licence-checked asset inventory and previews.
  - `ci/`: CI repro scripts and logs.
- `2026-10-15-workflows/`: the orchestration scripts (`scripts/*.js`) and every agent's final report for each workflow run (`wf_*.md`).
