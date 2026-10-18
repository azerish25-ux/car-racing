# FH6 reference pass R4 — gameplay feel and presentation (agentF)

Area: in-race HUD, skill/drift feedback, tyre smoke, chase camera, speed sensation,
event dressing and festival site. Festival section only; every change is either a
festival module or gated to the festival renderer. Measurements are from the
supplied reference frames at 1920 x 1080 (or the stated size) and are scaled to the
game's 720 p review captures with 1 HUD unit = 1 px at 720 p (`--hud-u`).

| Ref | Measured observation | What was implemented (file / symbol) | Remaining gap |
| --- | --- | --- | --- |
| 001 | Time-attack pack, low front three-quarter camera. Road surface streaks horizontally across the lower 40 % of the frame, scenery left of centre blurred, cars sharp. Streak length ~60–90 px at 1080 p near the frame edge. | Festival speed blur: the shared depth-reprojected camera blur attached to the festival scene pass with a festival shutter (settings strength x 1/60 s x 2.4) and a 6 %-of-width streak bound, ramped in between 4 and 22 m/s; the followed car is locked sharp (`rendering/open-world/speed-blur.ts` `FestivalSpeedBlur`, `FESTIVAL_BLUR`). | Photo-mode pan blur (camera tracking a car past the lens) is not modelled; LOW has no blur by preset. |
| 024 | Rear three-quarter at speed: trees streak radially (~3–5 % of width), car and near guardrail sharp, slight wheel blur. | Same blur; radial streak follows the attached camera's translation and yaw. | No wheel-spoke rotational blur. |
| 025 | Car meet: line-array speaker towers (truss mast ~9–10 m, two hangs of ~8 black cabinets, J-curve), 3 x 3 m pop-up gazebos, 1 m printed crowd barriers, cones, crowd behind fences. | Festival hub at Kestrel and the harbour welcome corner: instanced line-array towers (`event-dressing.ts` `speakerGeometry`, 0.36 m truss to 9.4 m, 8 cabinets 0.9 x 0.26 x 0.55 m in a J), printed barrier skins along the strip. | Crowd is low-poly standing figures (`festival-crowd.ts`), static (no cheering animation); no cones or gazebos. |
| 040 | "Drift Attack" arch: magenta banner (~#e5167f) ~1.6–2 m tall across the road at ~5.5–7 m, teal/cyan italic type, white towers with printed panels; peaked white tents to the right; thick low tyre smoke from the rear wheels. | Truss arch over every drift-zone, race and speed event start with an original "DRIFT ZONE / ドリフト" magenta banner in cyan italic type (and "SOLVANE FESTIVAL / START", "SPEED" strips), printed tower skins, clear height >= 5.35 m (`event-dressing.ts` `arch`, `bannerAtlas`). Drift smoke as below. | Towers are dark steel truss, not the white printed pylons; no crowd on the arch. |
| 041 | In-race HUD at 1080 p: circular minimap r ≈ 145 px centred (195, 880), thin light ring, white roads, cyan route (~7 px), player arrow ~55 px below centre, N marker on the ring; rev gauge r ≈ 140 px centred (1720, 890) sweeping 0–8 from 130° to 360° (screen, clockwise) with magenta 7–8 redline, gear "3" in a ~33 px ring, italic "039" digits ~95 px tall with the leading 0 dimmed, "MPH" above; bottom-centre panel 400 px wide: "Current Best 232,655 PTS" bar, icon + "Drift Attack" + "x2.0", cyan "83,828 PTS" between double chevrons; top-centre popup "7,850" yellow italic ~45 px + grey "x2.4", "Ultimate Drift 1,000" below; neon-lime chevron feather flags. | HUD rebuilt to that layout with original styling (`ui/festival-hud.ts` / `.css`): canvas-clipped circular heading-up minimap ±420 m, player 10 % of the diameter below centre, cyan route with dark casing, rotating N on the ring, road/limit pill below; SVG arc gauge (`GAUGE`, `gaugeScale`, `gaugeTicks`) 225° from 135° to 360°, per-machine scale to the next thousand above the limiter, magenta redline from 90 % of the limiter, gear ring, italic km/h digits with dimmed leading zeros; skill popup (yellow chain points, x multiplier, named skill + points, bank timer bar, pop animation per award); bottom-centre event panel (Current Best from the save, format icon, event name, lap/progress, big cyan live value between chevrons, time row, progress bar). Skill names/tiers from `skill-chain.ts` `SKILL_TIERS` / `skillName`. | Font is the app's Saira (synthesised italic), not FH's typeface. Gauge shows km/h only. No player-name/club pills. |
| 042 | Same HUD in a later frame: yellow 78 px bar at the top of the popup with a marker (chain timer), "9,058 x3.1 / Awesome Drift 500"; dense white-grey smoke filling the lower right of the frame around the rear wheels; lime flags at the corner apex and outside. | Chain timer bar (bank countdown) above the score; `AWESOME DRIFT` tier; drift smoke; drift-zone flags on the outside of corners (`event-dressing.ts` `driftFlags`). | Popup marker triangle omitted. |
| 046 | Festival stadium: white pagoda marquees (~5 x 5 m, peaked) in clusters, blue gazebos, fences, giant mascot balloons. | Instanced 5 x 5 m pagoda marquees (eaves 2.5 m, peak 4.6 m, concave roof, valance, back wall, counter) at the Kestrel hub and harbour corner (`tentGeometry`). | No stadium, no balloons (mascots are FH-specific), no gazebo variety. |
| 047 | Stadium infield from above: tents in rows of 3–6 at 7–8 m pitch, perimeter fences with printed skins. | Tent rows at 7.5 m pitch beside the Kestrel strip, placed only where clear of every road (+3.2 m) and building footprint. | Layout is linear along the runway, not a fenced infield. |
| 048 | Night touge start: red flares with tall red smoke columns either side, heavy radial blur, light trails along guardrails. | Night start flares beside every race and drift start arch (`start-flares.ts` `FestivalStartFlares`): a flickering white-red core and a red-lit smoke column ~7.5 m tall widening to ~4 m and leaning downwind, analytic per puff (no CPU state), one instanced draw shown only at night within 420 m of a start. Speed blur applies at night as by day. | Flares do not light the road or cars (no extra lights); no guardrail light trails. |
| 049 | Festival gate: dark banner bridge with magenta edges and a white pill sign, ~6–7 m high with people on top, square signage towers (lime/magenta/white), magenta crowd barriers. | "SOLVANE FESTIVAL" start banner (charcoal strip, magenta rails, white pill, magenta type) on every race start arch. | No walkway/people on the gate; signage towers simplified to printed truss skins. |
| 050 | Aerial touge: a drifting car leaves a white smoke trail ~30–40 m long along its arc that lingers several seconds. | Smoke puffs live 3.4–5.6 s, are born along the path actually driven between frames (frame-rate independent), drift slowly (0.9 1/s relaxation) and grow to ~2.5–3 m radius, giving a 30–40 m trail through a 2 s slide (`drift-smoke.ts`; test `lays the same trail at 20, 60 and 144 Hz`). | Smoke is billboards (no volumetric lighting); trail is not sorted per puff. |
| 053 | Dusk city drift, low camera (~0.9 m): background buildings and signs streak radially, car sharp. | Speed blur as above; chase rig re-measured (below). | No dedicated low "bumper" chase camera. |
| 054 | Limited-edition hardware art: palette magenta #e5187f, lime #c8f02a, teal #1aa8c0, white; triple chevrons >>> as a motif. | HUD/banners use magenta #e5167f / #ff2d8a, lime #c9f31d, cyan #22d3e6 / #2fd8ee; chevrons on banners, flags and the event panel. | Brand art itself not reproduced (trademarked). |
| 055 | Map reveal: satellite terrain (forest greens, lighter farmland, snow), white paved roads, orange-red dirt tracks, turquoise shallows into dark blue sea. | Minimap/world-map painter restyled: forest/field greens, turquoise shallows to dark sea, white paved roads, orange dirt (`festival-hud.ts` `paintMap`). | Still a 256-cell shaded height map, not a photographic satellite texture. |
| 062 | Season calendar graphic: black header cards, lime date bands, white cards, magenta corner field, season icons. | Palette reused for the pause menu (yellow header band, lime selection outline). | Season icons/calendar UI not built. |
| 065 | PC spec infographic: teal faceted background, lime/magenta column headers, white cards with magenta rules. | Pause menu restyled on a deep teal field (contrast kept >= 4.5:1). | Faceted triangle background not drawn. |
| 072 | Night festival: tents lit blue/purple from inside, magenta flags along the strip, floodlights, fireworks, Ferris wheel. | At night marquee fabric glows violet-blue (`materials.fabric` emissive 0x5b4cff x 0.35), printed banners and flags are self-lit (0.6 / 0.45). | No fireworks, floodlight towers, Ferris wheel or grandstands. |
| 076 | Meet: speaker line arrays on truss towers, teal stage, white peaked marquee ~6 x 6 m, teardrop flags. | Speaker towers, marquees and teardrop pennants (tinted magenta/teal/lime/white, original "S" mark) at the hub and harbour corner. | No stage. |
| 077 | Drag strip start: two truss towers (~0.6 m) ~7–8 m tall with a lime-yellow printed beam banner (~1.2 m) across ~25 m, black LED boards on the towers, drag start-light trees, yellow shoulders, pennants, grandstands. | Kestrel launch: 41 m lime gantry ("SOLVANE FESTIVAL / 祭" strip, 1.2 m) on 0.55 m truss towers to 8.2 m, LED boards (4.6 x 2.7 m) showing the festival strip, start-light trees on both shoulders (7 lamp rows, green lit), pennants and printed barriers along both edges, and ~770 standing spectators two to three deep behind the barriers (`festivalHub`, `festival-crowd.ts` `crowdLine`). | No grandstands, no lane walls, no painted yellow shoulders (road surfaces are another worker's area); spectators are simple figures. |
| 078 | Christmas-tree lights: pole ~2.5 m, stacked pairs of round lamps on a housing, green lit at the bottom when launched. | Start-light housings 0.42 x 1.9 m on 2.6 m poles with 7 pairs of 0.15 m lamps (blue pre-stage, amber, green lit, red). | Lights are static (not sequenced with the launch run). |
| 079 | Drag run side view: magenta/white printed crowd barriers ~1 m, peaked tents, standing crowd, pan blur on the foreground rail. | Printed barrier panels 2.3 x 0.85 m on 1.1 m frames along the strip; standing spectators behind them (1.55–1.9 m, ~0.72 m apart, mixed clothing palette). | No pan blur; no grandstand. |
| 080 | Convenience-store meet: tall vertical feather banners (~4 m) beside the lot, pop-up gazebos, crowd barriers. | Feather flags (4.4 m) are used for drift zones; welcome corner marquees/pennants. | Store/brand content intentionally excluded. |
| 084 | Pre-order card: magenta / teal fields, black lower panel, white icons in black circles. | Event-panel format icon in a white-ringed circle on the event colour. | — |
| 085 | Game-mode tiles: teal faceted background, yellow header band with level badge, image tiles with white bold title, yellow subtitle and a yellow foot stripe, lime outline on the selected tile. | Pause menu: yellow header band, dark tiles with a 3 px yellow foot, lime 3 px outline on the selected option, yellow section headings and subtitles (`festival-hud.css`, CSS only; menu structure and e2e flows unchanged). | Tiles have no imagery; no level/XP badge. |
| 088 | Key art: watercolour brush frame, cherry petals, snow-capped volcano. | — | Loading-screen art not in scope. |
| 100 | Two-car drift: thick white smoke streams from all rear tyres, ~2–3 m tall and several metres wide, densest at the tyre, thinning over ~10 m behind; many dark tyre arcs on the road. | Drift smoke from sliding, loaded, dry sealed tyres of every car in the frame (rears at 30 puffs/s at full slide, fronts 30 %), scaled by slip and slip power, lit by the key light with a sky fill, soft ground fade, near-camera fade (`drift-smoke.ts` `FestivalDriftSmoke`, `DRIFT_SMOKE`). Existing rubber trails kept. | Smoke does not interact with wind direction from weather; no smoke colour from tyre compound. |

## Chase camera (ref 041/042 framing)

At rest the reference frames put the horizon at ~40 % of the frame height, the rear
bumper at ~92 %, the roof at ~52–55 % and the car about 30 % of the frame width. With the
festival's 57° vertical FOV that needs the eye ~1.9 m above the road and ~5 m behind the
car's centre with ~6° of look-down. `RIGS.chase` changed from
`{ distance 5.8, height 1.85, lookAhead 9, lift 0.82 }` to
`{ distance 5.0, height 1.45, lookAhead 8, lift 0.08 }` (perMs 0.018 → 0.016). The R3
motion cues (`chase-dynamics.ts`, FOV +11° at 270 km/h) are unchanged and still tested.
Measured on the spawn capture (EH-3 at rest): before — horizon 46 %, roof 58 %, bumper
97 %, car 24 % of the width; after — horizon 41 %, roof 51 %, bumper 91 %, car 30 %.

## Measurements and budgets

Captures: 1280 x 720, MEDIUM, software GL (SwiftShader), `eh3` unless noted, review
fixture `e2e/fixtures/horizon-session.ts` (its new `drive()` hook re-sends the production
input message every 50 ms while GPU frames are held, then holds the worker so the captured
frame keeps the car's speed, slip and skill state). Draw calls / triangles are
`renderer.info` of the captured frame.

| View | Before (draws / triangles) | After (draws / triangles) | Note |
| --- | --- | --- | --- |
| Spawn chase + HUD, day | 377 / 2,232,327 | 387 / 2,199,295 | Closer chase rig sees slightly less street; +10 draws are the harbour start arch, welcome corner and shadows. |
| Drive 4 s from spawn (151–158 km/h) | 356 / 1,924,906 | 368 / 1,882,750 | Speed blur costs no draw (gathered in the existing scene-pass composite, 12 taps/pixel while moving). |
| Arch inspection (harbour start) | 282 / 1,999,281 | 293 / 2,029,073 | Arch 2 draws + shadows, pennants, marquees, speaker, crowd. |
| Pause menu over spawn | 363 / 2,145,871 | 379 / 2,108,879 | CSS-only restyle. |
| Night drive (85 / 120 km/h) | 355 / 1,958,609 | 383 / 2,026,700 | Not the same position (different speeds); flares are 1 draw. |

Per-module cost: start arch 2 draws (~2.6–3.9 k triangles, +2 shadow draws); a drift
zone's flags 1 instanced draw (1.5–3.5 k triangles); Kestrel hub 8 draws (~116 k triangles
including ~770 spectators at ~110 triangles each; spectators hidden on LOW); harbour corner
4 draws (~10.5 k); drift smoke 1 draw only while puffs are alive (pool 900 MEDIUM, 1 600
HIGH/ULTRA, none on LOW); night flares 1 draw within 420 m of a start at night; speed blur
0 draws (MEDIUM shutter 0.35, HIGH 0.5, LOW off, settings slider respected). All
placements are distance-culled (arches 900 m, flags 650 m + extent, hub 1 500 m, scaled
x0.45 on LOW and x0.75 on MEDIUM) and frustum-culled by their bounding spheres. Event
dressing total: 12 arches, 87 drift flags, 19 marquees, 4 speaker towers, 33 pennants,
832 spectators, ~173 k triangles across the whole region.

## Validation

- `npx tsc --noEmit`, `npx eslint` on every changed file, Prettier.
- `npx vitest run tests/festival-*.test.ts tests/open-world*.test.ts tests/solvane-*.test.ts tests/traffic.test.ts`
  (new: `tests/festival-presentation-r4.test.ts` — smoke admission/slip scaling, frame-rate
  independent trail, teleport/rewind clearing, blur stillness and car lock, dressing budget,
  placement off the carriageway and on the ground, banner clearance, night flares, crowd
  placement, gauge scale; `tests/festival-skill-chain.test.ts` — named skills, tiers,
  awards, lost chains).
- `npx playwright test e2e/49-festival-menu-access.spec.ts` (6/6) and
  `scripts/solvane-r3-hud-review.mjs` (17/17 cases: drift card never overlaps the new
  gauge or minimap at desktop, portrait, compact and landscape sizes).
