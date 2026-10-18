# FH6 reference pass r4: festival render pipeline image quality

Area owner: agentP. Festival only; circuits unchanged (the one shared change,
`SceneAmbientPass.setObscurance`, is opt-in and never called by the circuit renderer).

## Findings (measured in the running game, `horizonReview.pipeline()`)

- **Shadows stopped at ~70 m.** The festival drew one 140 m car-centred sun map; its far light
  (`FarShadow`) was constructed but never added to the scene or baked, so every building, tree and
  hill beyond the car box was unshadowed, and ULTRA's mid cascade (which requires a baked far map)
  never ran. Inspection/photo views away from the car had no shadows at all.
- **Temporal AA never resolved in the festival, even on ULTRA.** TAA, temporal GTAO and SSR ray
  rotation advance only when `studioFrameDt > 0`, written by the circuit's `StudioFrame`, which is
  idle while the festival draws (and would have reprojected through the circuit's camera).
- **No sun contact shadows**: the scene pass was attached without the sun.
- **SSR** (ULTRA only) masked one of the three festival asphalt materials; never the sea/river.
- **Near map** used a fixed one-texel disc (radius 1), not the PCSS the circuits use.
- Materials: 63 Standard + 33 Physical take the sky IBL; 45 ShaderMaterials (sky, effects, light
  pools, markers, contact decals) and 2 MeshBasic (power lines, cabin display) are unlit by design.

## What changed

| Area | Implementation (file / symbol) |
| --- | --- |
| Shadow ranges | `open-world/festival-shadows.ts` `FestivalShadows`: near map led 0.4 R along the camera view (not the car), texel-snapped, PCSS (`sunPenumbraScale`); half extent 52 / 56 / 64 m (Medium / High / Ultra) = 5.1 / 5.5 / 3.1 cm texels. `FestivalFarShadow` (shared far map, refitted): camera-led square, ±440 / 620 / 760 m at 2048 / 2048 / 4096 = 43 / 61 / 37 cm texels, re-rendered after the camera moves 10 % of it, on lighting/season/quality change, and every 4 s while streaming adds casters (Medium spawn: 156 draws per re-render). High/Ultra also run the mid cascade (`ultra/cascades.ts`, ~110-190 m, every 2nd frame). |
| Casters | Streamed terrain casts (`shadowSide = BackSide`: lit slopes never self-shadow) for ridge/valley relief at the golden hour; L1 distant crowns cast into the far map; photographic impostors cast into every map (High: trees 56-190 m keep shadows in the mid cascade); crown contact discs never. Cars, traffic, riders, effects, markers stay out of the far map (they move). |
| AO / grounding | `festival-quality.ts` `FESTIVAL_AO` via `SceneAmbientPass.setObscurance`: GTAO radius 0.9 -> 1.6 m, intensity 1.15 -> 1.25, fade 90-220 -> 160-380 m (wall/pavement corners, eaves, crowns); sun contact shadows attached (`scenePass.attach(motion, sun)`). PCSS gives contact hardening (crisp at tyres, softer under tall casters). |
| Temporal AA / CAS | `open-world/festival-temporal.ts` `FestivalFrameHistory`: the festival's own studio frame (camera, sun, followed car) each draw; the circuit's uniform values restored on dispose. Medium now runs TAA over 2x MSAA + CAS 0.3. |
| Reflections | SSR mask on asphalt/asphaltMajor/town, sea and river (Medium+), facade glazing (roughness 0.1) on High+; SSR on High always, on Medium only while the road is wet (`FESTIVAL_WET_SSR`, wetness > 0.15). |
| Preset mapping | `festival-quality.ts` `festivalGraphics`: Medium + TAA, CAS; High + SSR, 3 cascades, temporal GTAO, sun shafts. Only controls still at their preset value change (player overrides kept); Low and Ultra unchanged. Hardware assumption (not measured): Medium = GTX 1660 / RX 6600 class at 1080p, High = RTX 3070, Ultra = RTX 4080. |
| Photo mode | `open-world/festival-photo-lens.ts` `FestivalPhotoLens` + `ui/festival-photo-lens.ts` `FestivalPhotoPanel`: thin lens on a 24 mm gate (aperture OFF/f1.4-f16, focus on the car or 0.8-400 m, zoom 18-135 mm), 48-tap gather from the scene depth (foreground taps spread over a sharp subject), exposure ±2 EV, filters (neutral/vivid/cinematic/mono/warm/cool), vignette. Off until an aperture is chosen, so inspection captures (photo mode) are unchanged. No in-game DOF: the gameplay refs' softness is motion blur, not lens. |

## Ledger

| Ref | Measured observation | What was implemented (file / symbol) | Remaining gap |
| --- | --- | --- | --- |
| 001 | Lit road lum 0.15-0.24, car shadow beside the car 0.028 (5-9:1), 0.004 under the bumper; radial speed blur. | Contact shadows + GTAO under cars; PCSS near map. | Speed blur is agent F's; our sun:shade on asphalt stays agent H's 4.8:1. |
| 013 | Street canyon: building shadow across the road (shade 0.044-0.049 vs lit 0.086, 1.9:1, strong sky fill); under-car 0.000-0.007. | Building shadows now reach 440-760 m (far map) instead of ~70 m. | No per-object blur of the background (camera pan). |
| 014 | Neon dusk: paint and glass mirror the signs; warm paving 0.12-0.15, under car 0.001. | SSR on paint/glass (High+), local probe (High). | Neon content is agent L/M's. |
| 016 | Backlit hazy morning: long soft car shadows to camera, sun shafts through cloud. | PCSS; sun shafts on High. | Shafts are screen-space; no in-air volume. |
| 019 | Dappled leaf shadows on cobbles: lit 0.24-0.29, shade 0.040-0.044 (5-7:1); canopy reflected in paint. | Camera-led PCSS near map (5 cm texels), foliage cards cast with alpha. | Leaf shadows are only as detailed as the card atlases. |
| 020 | Lit road 0.28-0.33, car shadow 0.033 (~9:1), eaves deep shade. | GTAO 1.6 m radius for eaves/corners; contact shadows. | - |
| 021 | Photo DOF: foreground grass blur ~10-15 px radius (1080p), car sharp, cone slightly soft. | Photo lens: 85 mm f/2 at ~6 m gives c = 2.4 % (capped 2.2 %) background, foreground -1 to -2 %. | Bokeh shape is a disc gather (no cat's-eye, no chromatic). |
| 026 | Dappled gravel lit 0.452 / shade 0.041 (11:1); shadows continue to the gate at ~80-100 m; dark crown undersides 0.008. | Far map + impostor/crown casting keep tree shadows past the near box; crown GTAO. | Our shade is lighter (agent H's balance, ~5:1). |
| 027 | Backlit golden hour: lit spots 0.488 vs 0.068; haze and shafts around the gate; sky blown. | Terrain/tree shadows at sunset reach the far map; shafts on High. | No volumetric haze. |
| 030 | Balcony and signboard shadows on facades to ~150 m; shaded facade 0.058-0.084 vs lit 0.23-0.31 (3-4:1); glass reflects the street. | Far map (43 cm texels Medium; mid cascade 16-18 cm on High) shades facades; SSR on glazing (High+). | Balcony-scale shadows beyond ~150 m are 2-4 texels on Medium. |
| 035 | Telephoto: road/rail streaks; background softly defocused. | Not done in game (gameplay softness is motion blur); photo lens covers stills. | No in-game telephoto DOF. |
| 039 | Pond mirrors trees and sky with ripples; dappled path lit 0.237 / shade 0.058. | SSR on the river/sea (High always, Medium when wet). | Ponds are not water bodies in this region. |
| 045 | Backlit bridge, truss shadows across the cars, background blown. | PCSS near map casts truss/rail shadows on cars. | Exposure/bloom are agent H's. |
| 052 | Golden forest: beams between trunks, dappled floor. | Sun shafts on High; terrain + tree casting. | Beams are screen-space only. |
| 053 | Dusk city drift, background bokeh/blur. | - | In-game DOF not added. |
| 066 | Wet night: road reflects neon as long streaks (0.47-0.70 vs road 0.04-0.05). | SSR with wet-road streaking (shared `ssr.ts`) on all asphalt: High always, Medium in rain. | Medium dry roads have no SSR. |
| 067 | Night expressway: sodium-lit road 0.149, streaks 0.542. | SSR on wet asphalt; TAA steadies thin rails. | - |
| 069 | Neon night: paint mirrors neon, road 0.02-0.05. | SSR on paint and wet asphalt. | - |
| 086 | Night city: headlight and neon reflections on the road. | As 066. | - |
| 093 | Forest road: dappled road lit 0.205 / shade 0.050 (4:1). | Near PCSS + far map; impostor casting on High. | - |
| 099 | Bamboo grove: gravel 0.60-0.87 lit, culm shadow stripes 0.055 (11-16:1), contact 0.004-0.016. | Bamboo casts (flora) into near/far maps. | Shade stays brighter than the ref. |

## Costs and evidence (1280 x 720, software GL; not hardware frame times)

Captures in `scratchpad/agentP/` (`before/` = integration head 3b6e324 served from a snapshot,
`final/` = this branch; `t1/` = an earlier build of this branch without the street-scale AO):

| View | Before draws / triangles / renderMs | After draws / triangles / renderMs |
| --- | --- | --- |
| town-north, Medium (640, 40, -2700) -> (700, 3, -2520) | 477 / 2,140,542 / 16,453 | 421 / 1,999,378 / 16,118 |
| spawn chase, Medium (t1) | 427 / 2,357,618 / 17,353 | 422 / 2,287,142 / 13,843 |
| town-high, Medium (t1) | 359 / 2,406,082 / 12,961 | 348 / 2,307,310 / 10,888 |
| photo DOF, Medium | - | PHOTO |
| spawn chase, High | - | HIGH |

- Per-frame draws do not grow: the near map now covers the view instead of the car's
  surroundings (behind the camera), which offsets the near map's terrain casters. The far map adds
  141-156 draws per re-render (once per ~44 m of travel on Medium; `lastBakeDraws`).
- `diff-town-north.png` (red = darker after): new street-scale occlusion at wall/ground and
  building-to-building corners and cast shadows on facades 100-300 m away, where the old frame had
  none; frame mean luminance 0.278 -> 0.275.
- The town views look along the shadows (sun from the south-west at 52 deg): most cast shadows fall
  behind the buildings in these framings; the street/forest views were not re-captured within the
  capture budget.

## Known limits / next steps

- The far map ends at its square (no fade): shadows stop ~660 m ahead (Medium); haze hides most
  of it. A fade needs a change to the shared far-shadow GLSL (also patched by the motocross
  terrain shadow), left out.
- Software-GL captures render one frame per ~10 s, so presented time jumps > 2 s between frames
  and the frame history (correctly) treats them as cuts: TAA/CAS cannot be shown in stills; the
  unit test covers the frame history, real hardware is needed for a stability check.
- No reference-hardware timings; draw counts are from the shot tool.
- Next: a mid cascade on Medium if hardware allows (terrain programs then use 16 samplers);
  ground-bounce tint of the IBL by local albedo; an in-air (volumetric) shaft pass.
