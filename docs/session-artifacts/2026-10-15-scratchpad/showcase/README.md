# APEX art-direction capture suite (live application)

`live-capture.mjs` renders the fixed evaluation framings of
`docs/production/CONTENT_PIPELINE.md` §3 (plus a catalogue venue and the open-world festival)
by driving the real production build: paddock menu → GARAGE & SETTINGS → session → AI DRIVER →
pause / CHANGE CAMERA / ACADEMY lighting / PHOTO STUDIO / WATCH REPLAY. Positions are read from
the read-only `window.apexDiagnostics()`; nothing is injected into the simulation or renderer.
Use it for "before" and "after" boards of the same checkout family so revisions are compared at the
same framings, preset, resolution and backend.

It complements `scripts/ultra-capture.ts` in the repo (a fixed material set rendered through an
isolated fixture); this one exercises the whole game.

## Run

```sh
REPO=/path/to/checkout          # must have node_modules (symlink is fine)
OUT=/path/to/NEW/directory      # must not exist yet
export CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)

# Mesa llvmpipe on a virtual X display (about 2x faster than SwiftShader on 4 CPUs):
xvfb-run -a -s '-screen 0 1920x1080x24' \
  node --experimental-transform-types live-capture.mjs --repo "$REPO" --out "$OUT" --backend mesa

# or headless SwiftShader (the repo's default test backend):
node --experimental-transform-types live-capture.mjs --repo "$REPO" --out "$OUT" --backend swiftshader
```

Without `--url` the script builds `$REPO` with its own Vite config into a sibling temporary
directory (`apex-capture-build-*` under `--build-dir`, default the OS temp directory; removed afterwards; nothing is written into the checkout) and serves it
with `vite preview` on a free port. Pass `--url http://127.0.0.1:PORT/` to use a preview you
already started (`npx vite preview --outDir <build> --port PORT`).

Options

| option | default | |
|---|---|---|
| `--size WxH` | `960x540` | viewport, device scale 1 (render scale comes from the preset) |
| `--preset` | `ultra` | `low`, `medium`, `high`, `ultra`, chosen in GARAGE & SETTINGS |
| `--backend` | `mesa` if `DISPLAY` is set, else `swiftshader` | |
| `--sessions` | `dry,rain,neon,festival` | run a subset; each session starts from the paddock |
| `--build-dir` | OS temp directory | parent of the temporary build (do not point `TMPDIR` at a long path: Chromium's sockets live there) |

A full run took 23 minutes with Mesa llvmpipe on a shared 4-CPU host at ULTRA, 960×540 (a session
prepares in 1–5 minutes, a held frame takes 10–30 s; SwiftShader draws at roughly half that rate).
Progress goes to stdout with elapsed seconds (keep it as `run.log`); `manifest.json` is rewritten
after every shot. The reference "before" board made with it is `../before/ultra-live-9c679ba/`
(integration branch at 9c679ba; `contact-sheet.png` there is a 3×4 overview).

## Output

`NN-slug.png` clean canvas frames (DOM overlays hidden by a capture-only stylesheet for the
screenshot, removed straight after), `08-replay-broadcast-as-seen.png` with the replay letterbox and
lower third, `09-close-photo.png` from the studio's own DOWNLOAD PNG, and `manifest.json`: build
identity, GL renderer string, per-shot notes, player speed / track distance / lap / pit phase, camera,
lighting, exposure meter state, weather presentation, ULTRA module counters, failures and console
errors. `timeline-<session>.json` keeps every polled simulation state of the circuit sessions
(per car: track distance, lateral offset, speed, brake, laps, pit phase), so a pause condition can be
checked or tuned without another run.

## Framings

| # | Session | How it is framed | Judge (§3) |
|---|---|---|---|
| 01 | Aurel dry race | pit assist; paused once released from the box (pit phase 6, > 8 m/s); CHANGE CAMERA → cockpit. Fallback: the recorded release, held replay, cockpit | instruments, glare, hands/wheel |
| 02 | Aurel dry race | after the opening lap (race time > 30 s), paused 120–420 m after the line (start/finish straight past pits and grandstand) above 234 km/h; chase | speed sense, ground contact, silhouette |
| 03 | Aurel dry race | paused when a rival is 1–12 m ahead along the track and 1.8–7.5 m to the side above 29 km/h, so the chase camera frames both (in practice the launch: the polled races string out within seconds); budget the first 60 s of racing. Fallback: the best recorded moment, held replay, chase (carries the replay lens) | rival readability |
| 04 | Aurel heavy rain race | paused in the turn-1 stop, the first braking zone after the line (820–1010 m; NORTH HOOK at 627 m is flat out), above 90 km/h with brake > 0.3 or losing > 3 m/s between samples; chase | spray origin, drying line, reflections |
| 05 | Aurel dry race | ACADEMY SUNSET; paused when the velocity heading is within 26° of the authored golden-hour sun (read from `sky-light.ts`) above 126 km/h; chase. Fallback: best recorded heading, held replay | exposure, flare and shaft restraint |
| 06 | Aurel dry race | ACADEMY NIGHT right after shot 03 (still on the opening lap); paused at least 4 s later with two cars 10–80 m ahead (one after 30 s, any after 90 s); chase | silhouettes, light pools |
| 07 | Aurel dry race | P (pit request) under AI DRIVER, pressed again if a lap passes without entering the pit lane (P toggles, and the AI strategy may already have requested a stop); held once on the pit-lane approach so the first close draw of the box cannot hide the service, then paused in the box during service (phase 2–5); chase. Fallback: the recorded stop, held replay, chase | crew contact, shadows |
| 08 | Aurel dry race | WATCH REPLAY, held at the densest pack moment of the first 40 s, trackside (broadcast) camera | composition, crowd cost, focus breathing |
| 09 | Aurel dry race | PHOTO STUDIO free orbit, azimuth 32°, elevation 8°, 8 m, 50 mm, depth of field | materials, decals, carbon/paint |
| 10 | Neon City race | night by venue; paused after 10 s of racing with traffic ahead; chase | catalogue venue look |
| 11 | Festival | Port Ilse spawn (town), festival menu → Golden hour, 45 s to settle, menu open (held); chase | open-world look |

The dry race is 10 laps of 12 cars from mid-field with the AI DRIVER on from the grid; the shots are
taken in the order 03 → 06 → 02 → 07 → 01 → 09 → 08 → 05, switching lighting only while paused (and drawing two
held frames before resuming, so the sky/shadow re-bake cannot stall the polling).

## Determinism and limits

- Fresh browser context (no saved preferences, so lighting starts at DAY, not LIVE), fixed viewport,
  fixed menu choices, AI driver from tick 0, pause conditions on simulation state, replay holds at
  exact replay times. Software GL draws seconds per frame while the worker simulates in real time,
  so a live pause is reproducible in framing (track position, pit phase, heading), not byte-identical.
- Every live pause re-reads the held state and resumes if a slow draw let the car drift out of the
  framing (up to four tries; the held position, speed, lap and pit phase are in `manifest.json`).
- Live paused frames are "held" frames: TAA history, temporal AO history and CAS sharpening are
  bypassed by design (byte-identical held frames); the motion blur of the moment stays in the image.
  Exposure is whatever the meter had adapted to while driving; it does not adapt while held.
- Replay chase/broadcast views at ULTRA carry the replay lens (thin-lens DOF); live chase does not.
  A replay fallback is named in the shot notes.
- The festival exposes no diagnostics frame, so its waits are timed.
- If a shot cannot be framed, the failure is recorded in `manifest.json` and the suite continues.
