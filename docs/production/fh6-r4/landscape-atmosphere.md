# FH6 reference pass r4: distant landscape, landmark volcano, atmosphere, lighting

Area owner: agentA. Festival only (Solvane Coast); circuit visuals unchanged.

Colour samples are sRGB hex of 9x9 patches of the 1920x1080 reference (linear in
brackets where used for calibration); sizes are measured on the frame and
converted with the stated assumptions. Scratch tools: `scratchpad/agentA/tools/px.py`
(patch sampler) and `crop.py` (gridded crops).

## Ledger

| Ref | Measured observation | What was implemented (file / symbol) | Remaining gap |
| --- | --- | --- | --- |
| 006 | Volcano at the frame edge behind a track, morning sun from behind-left. Summer: almost no snow, faint streaks only in the top ~20 % (gully lines). Flank #b5cde4 (lin 0.46/0.62/0.78) against horizon sky #f6f6f8: luminance ratio 0.64, very low contrast. | `DISTANT_SNOW.cone[summer]` = 3300 m: snow only as gully streaks above ~3000 m (`distant-landscape.ts` COLOR_GLSL `streak`/`tongue`); flank tint from `fhAerial` (`festival-atmosphere.ts`). | Our clear day is cleaner than this hazy morning (we model the 021/036 air). No depth-of-field. |
| 016 | Backlit morning: cone at upper left, snow on top ~35 % of the visible cone with ragged tongues (snow #88a6be in shade, body #7092ab), 4+ ridge layers each lighter (near #50748b, far #95b1c5), valley fog filling the lowest valley (white #e0e6ea) with tree tops poking through. | Ranges with crests running parallel to the region edge (`DistantRelief.sample`, `crest` term) give the layered silhouettes; `DISTANT_MIST` valley mist on low relief (`vDistant.y` = `valley`) shaded as a level sunlit surface. | Mist is a surface colour on the far relief, not a volume: no tree tops through it, no mist inside the drivable region. |
| 017 | Golden hour into the sun: everything in warm aerosol haze (#e0ad85 near horizon, sky by the sun #fedfb0), cone a warm low-contrast silhouette #ddb89b only ~5 % darker than the sky beside it. | `FESTIVAL_AIR.haze.sunset` = 5.5 (aerosol x3.4 of the day) and the sun-side glow (`fhApSunGlow`, power 9) make the into-sun ranges dissolve warm. | Exact orange of the haze is the physical golden-hour palette (`skyFogPalette`), not tuned to 017. |
| 021 | The canonical cone: summit plateau ~40 px of 680 px base width at the snow line; slopes 25 deg near the top, ~20 deg average to the snow line; snow on ~50 % of the visible height (spring), sunlit snow #dbdae2 (lum 0.71), shaded #a2adc8, lower body strongly blue #5c77a5 (lin 0.11/0.19/0.39) against horizon #b2c0da (lin 0.45/0.53/0.70) - haze share ~(0.25, 0.36, 0.55) per channel. | Profile `DISTANT_RELIEF.volcano.profile` (monotone cubic): rim 3720 m at r 300 m, 28 deg at 0.5-1 km, 26->21 deg to 4 km, 15->8 deg on the apron, 35 km wide; 44 radial gullies (78 m deep) + a deep west ravine and a SW shoulder. Spring snow line 2250 m. Air: Rayleigh x1.15 + aerosol 1.6 (`festivalExtinction`) leaves (0.75, 0.58, 0.32) of R/G/B at 26 km to 1.5 km height (test `keeps a distant cone readable...`). In game (a4/spawn-day) the flank reads #5882c1 (lin 0.10/0.23/0.54) and the sunlit cap #e0d8d5 (lum 0.70). | Gully count/depth are procedural, not this mountain's actual erosion pattern; no rock texture inside the snow field. |
| 029 | Summer golden hour, sea of clouds: 5+ ridge layers in orange haze (far #f4c8af, mid #e4a884, near #8a644f), fog filling valleys (#d49664-#e5a069), sun blown out. | Same sunset air + `DISTANT_MIST.sunset` (valley mist 0.85) on the distant ranges. | No in-region valley fog at the player's elevation; no volumetric sun shafts through mist. |
| 031 | Cone over a lake: rim ~45 px wide, long gentle shoulder on one side, snow ~ top 50 %, sunlit snow warm #f4e6d4, shaded #9ba6b5, body purple-blue #626b91. (Logo ignored.) | Shoulder (`volcano.shoulder`, +240 m at 3.3 km on the SW flank) and the oval cone (`re` scaling) break the lathe symmetry; snow albedo 0.80-0.88 lit by the scene sun. | No lake reflection of the cone (sea reflection only). |
| 032 | Low sun, layered ridges toward it: near hill #51504e, mid #86817e, far #afa39f, farthest #c5b0ab (warm), sea on the right. | Layered ranges + sun-side glow; sea extended to 160 km (`water.ts`) so the distant coast meets open water. | Pink-lit cloud streaks come from the photographed dome, not modelled. |
| 035 | Telephoto of the cone in winter: snow down the whole visible cone, sunlit #e1d8da, shade #acb0be, exposed rock on the lower right flank #6a7998, fine radial gullies everywhere. | Winter snow line 900 m on the cone, 380 m on the ranges (`DISTANT_SNOW`), forests under snow read grey-white (`snowCover`); a4/winter shows the whole cone white with gully shading. | At game distances (>= 24 km) the fine gully detail of this telephoto is below a pixel; nothing finer than the 44 geometric gullies + streak noise. |
| 036 | The game-camera view: cone ~100 px tall over the cloud band in 1080 (~4.6 deg at an assumed 50 deg vfov -> ~37 km), 640 px wide; snow top ~40 % with tongues; flank #5f80b5 (lin 0.11/0.22/0.46), mid ridges #486694, near ridges #39547e; a white cloud band hiding the cone's foot; sky #a6c1e6 at the horizon. Measured ridge colours fit ground x T + horizon x (1-T) with Rayleigh-only optical depth at 7 and 12 km within 0.02 linear. | Calibration target of `FESTIVAL_AIR` (Rayleigh x1.15, aerosol 1.6) and of the cloud band (`DISTANT_MIST.day`, broken band at 1050-1420 m). In game from the Varda pass (a6/pass-east, 29.5 km) the flank reads #5581ba (lin 0.09/0.22/0.49) against 036's #5f80b5, the horizon sky #b1c5df against #a6c1e6, and the cone rises ~5 deg over the plain; looking north (a6/north-high) the range layers read #4a72a7 and #3b5f8e against 036's #486694 / #39547e. | Our cap is cream-white (#e0d8d5) where 036's is blue-white (#d3d6e6): the sun's warm key still dominates the snow. |
| 043 | Blue hour: sky #668cd3 (lin 0.13/0.27/0.65), ridge layers #446cab and #345381, forest near-black #041222, far snowy range top right. | Night keeps the same layered extinction with the night in-scatter; the moonlit cap and a dark cone silhouette stand at the end of the spawn street (a4/night); distant alpine sectors (1.6-2.5 km crests) carry snow in winter/spring. | The game has no blue-hour lighting; 'night' is darker than this and the grade keeps the shared night profile. |
| 044 | Dusk, lilac haze: far ridge #c6b5c7, mid #a599aa, near #6f6474, sky #eae8ef. 3-4 layers. | Layered ranges + sunset air. | Lilac hue of 044 not matched (our golden hour is warmer). |
| 046 | Bright hazy aerial view: cone #b7d6f3 vs sky #dcf2fe (ratio 0.76), snow #d3ebfe; forest ridge at ~3 km already blue #567e95. | Cloud cover raises the aerosol level (`haze` day 1.6 + 9 x cover). | Clear-day presets keep the cleaner 036 air; 046's haze appears only with cloud. |
| 047 | Clear midday: snow #d2e2fa (blue cast), lower body #8ea6d6, far ridges #84a3d4, near ridge #54667d; cumulus. | Same air; snow takes the sky-blue IBL. | - |
| 051 | Backlit afternoon, warm-pink haze #ceb6b2, jagged snowy alpine range above forested ridges. | `alpine` sectors of the ranges reach 1.6-2.5 km and carry snow in spring (1350 m line). | Our alpine crests are noise ridges, not the jagged granite of 051. |
| 054 | Promotional (controller ad). Landscape content only: the snowy cone is the festival backdrop above cherry trees. Product, logos, text excluded. | Informs the placement: the cone is framed from the festival's starting street. | Excluded otherwise. |
| 063 | Winter golden hour: cone backlit as a warm grey silhouette #b2a499 with no visible snow, frosted trees. | Backlit cone in sunset air (snow in shade is dim, sun glow behind). | - |
| 064 | Winter overcast/snowfall: distant snowy mountains #dfe8f9 almost merge with the sky #e4edfa, mid ridges #8893ad, snowy forests grey-white. | Winter snow lines + snowy-forest colour; overcast raises aerosol. | Falling snow is weather, not part of this area. |
| 065 | Promotional (PC spec sheet). Informs only the quality ladder: Low 1080p/60 to Extreme RT. | Distant landscape is 2 draw calls on every tier with tiered resolution (`DISTANT_MESH` low/medium/high). | Rest excluded. |
| 079 | Late-summer cone behind a drag strip: blue-grey body #7d8daf, faint snow streaks near the top only; telephoto slopes ~25 deg upper. | Summer snow = streaks above ~3000 m. | - |
| 082 | Cone above a shop roof, snow down ~50 % with a ragged edge, shaded snow #aabdd7, sky #a5bdd9, cumulus. | Spring/autumn snow lines with noise + tongues. | - |
| 083 | Dusk of 082: violet sky gradient #444190 -> #c796d3 at the horizon, cone a purple silhouette #5c3e7b. | Golden hour veils distant ground in a pink-lilac (`FESTIVAL_AIR.goldenHaze`, ratio from 044/051): the cone reads mauve #6e6f8d with a peach cap #caab94 at the end of the spawn street (a4/sunset), no longer blue. | No violet blue-hour sky (the dome is the photographed set); the cone is lighter than 083's silhouette. |
| 088 | Painterly key art (logos ignored): cone in hazy overcast with a cloud band across its mid-slope. | Cloud band around the cone. | - |
| 094 | Clear midday telephoto: rim plateau ~70 px wide; left shoulder; snow edge ragged at ~2/3 of the visible height with tongues; snow #d2d5e8, body #6d80ab, sky #789cd8. Slopes 27 deg upper, 19 deg lower. | Profile + shoulder + gully tongues as above. | - |
| 098 | Sunset side-light: cone in shadow, body #80635f, snow #a07e7c (pink in shade), sky #efc7a8, ridges near the sun #e49769. | Sunset air (aerosol 5.5, warm veil) and sun glow; the golden sun lights the cone's west face: cap #caab94, flank #6e6f8d (a4/sunset). | Our flank is still bluer than 098's #80635f. |

## Implementation summary

### Placement (measured in the game, not guessed)
- The spawn chase camera stands at about (554, 6.7, -2604) on Harbour Front and looks **east**
  (+x; +z is on the screen's right), not north. A volcano to the north would never be in the
  spawn view, so the cone is east across the bay: centre (26550, -2830), 26.0 km from the spawn,
  0.5 deg left of the street axis (the Port Ilse Street Loop beacon stands 1.5 deg right of it).
  From the Varda pass road (-2729, 512, 2932) it is 29.5 km away, bearing ~97 deg, with the
  whole region in front of it (the 036 composition); the Kestrel runway (E-W) points at it.
- Test `frames the cone above the region...` ray-marches the ground (field inside the square,
  relief outside) and asserts >= 1.3 km of the cone stands clear from the spawn and >= 2 km from
  the pass.

### Geometry (`distant-relief.ts`, `distant-landscape.ts`)
- `DistantRelief`: pure height model from the region seed. Cone: monotone-cubic profile
  (crater floor 3550 m, rim 3720 m at r = 300 m; mean slopes 28 deg at 0.5-1 km, 26->21 deg to
  4 km, 15->8 deg to 11 km, a 2-4 deg apron to ~20 km), +-5 % oval, SW shoulder (+240 m),
  44 meandering V gullies up to 78 m deep (fading below 9 km), a 110 m ravine down the west face.
  Ranges: ridged crests along the region edge (tangential wavelength 3.8 km, radial 1.5 km) +
  isotropic peaks, 0.5-1.4 km relief within 9 km of the terrain edge (each layer stands over the
  region's own 0.6-0.8 km edge hills seen from the Varda pass), 1.7-3.2 km alpine sectors far
  out and a far wall (+650 m beyond 22 km) so no viewpoint sees the mesh rim (land heights
  p50 970 m, p90 1.9 km); the coast continues the
  region's (z ~ -2350 with coves); a foothill plain around the cone. The seam lies 25 m under
  the streamed terrain's own edge heights (sampled on the coarse tile's 512 m vertices).
- Two meshes, one `MeshStandardMaterial` (lit by the scene sun/sky/IBL), no colliders, no
  shadows: ranges on a polar grid (terrain edge -> 42 km, geometric rings) with the cone's disk
  and drowned cells dropped; the cone on its own polar grid (rings crowd to the summit).
  Low / Medium / High: 30k / 60k / 99k triangles, always 2 draw calls; built once per tier on
  the loading screen (`prestream`), 0.26-0.46 s in node.
- Shader ground cover: mixed conifer/broadleaf canopy (season tints), scrub, scoria above a
  noisy 2350 m tree line, rock on steep range faces, snow above the season's line with gully
  tongues and radial streaks (`DISTANT_SNOW`: cone 2250/3300/2750/900 m, ranges
  1350/2600/1750/380 m for spring/summer/autumn/winter), snowy forest grey-white. Low cloud:
  `DISTANT_MIST` valley mist on low relief and a broken cloud band at 1050-1420 m around the
  cone, shaded as level sunlit surfaces (normal -> up).

### Air and sky (`festival-atmosphere.ts`)
- `fhAerial`: per-channel transmittance of Rayleigh (x1.15, 8 km scale height) + aerosol
  (1.2 km, Angstrom 1.3, haze 1.6 day / 5.5 golden hour / 2.5 night, +cover, +rain) with the
  closed-form mean density along each sightline, in-scatter = art-bible horizon luminance in
  the references' hue (`FESTIVAL_AIR.hazeTint`: day = 036's horizon B/R 2.07, golden hour the
  pink-lilac veil of 044/051; back to the deck grey under cloud) plus the sun-side glow
  (cos^9). Installed on every festival material (`FestivalAtmosphere.install`, skipping
  cars/effects/overlays and materials without three's fog chunks); FogExp2 stays only for
  those, with a matched density (~5.6e-5). The old fog put 8 km at 82 % grey-brown haze (the
  clear-day photo's desert horizon colour); now ridges at 8 km keep ~81 % of green, the cone's
  flank at 26 km keeps (0.75, 0.58, 0.32) of R/G/B.
- Photographed dome: the clear-day photo (kiara-5-noon) has 360 deg of desert mesas up to 9 deg
  and the overcast one (waterbuck-trail) hills to 11 deg; their skyline is raised to 9.8 / 11.5
  deg for the festival and the band below fades to the same horizon colour (`photoHorizon`,
  opt-in uniform, 0 for circuits).
- Terrain biome snow (above ~600 m) now follows the season's ranges snow line: no white
  "dunes" on summer horizon hills (before/north-high), white in winter.
- Grade: `BroadcastGradePass.profileAdjust` (opt-in, null for circuits) with `festivalGrade`:
  day saturation x1.05, vibrance +0.06, contrast +0.01; golden hour saturation x1.04, highlights
  x(1.02, 0.99, 0.95), shadows x(0.98, 0.99, 1.03); night unchanged.
- Camera far 26 km -> 90 km (depth precision is set by the 0.3 m near plane; nearer than 26 km
  nothing changes). The festival sea plane grows from 48 to 160 km.

### Evidence (software GL captures, 1280x720, Medium)
Scratch folder `scratchpad/agentA/`: `before/` (base commit dd11859 served from an archive),
`a4/` (after, commit 2e90375: all six views), `a6/` (after, final commit 85e2a51: north-high,
pass-east, spawn-day, sunset), sheets `before-after-a4.jpg`, `before-after-final.jpg`.
Final set in `final/` (a6 for spawn-day, pass-east, north-high, sunset; a4 for night and
winter, unchanged since). Views: `spawn-day` (chase at the spawn), `pass-east` (inspection from the Varda pass road
(-2729, 515, 2932) toward the cone), `north-high` (same point looking north), `sunset`,
`night`, `winter` (chase at the spawn). The spawn car settles either on the road or on the
pavement between runs (physics, not this change), so some pairs are framed differently.

| View | Before draws / triangles | After draws / triangles |
| --- | --- | --- |
| spawn-day (both on the road) | 373 / 2,238,479 | 375 / 2,265,757 (a4), 375 / 2,289,501 (a6) |
| pass-east | 277 / 813,974 | 279 / 882,980 (a6) |
| north-high (cone outside the frustum) | 89 / 583,766 | 90 / 618,500 (a6) |
| winter (both on the road) | 375 / 2,230,583 | 372 / 2,261,845 |

The module's own cost is fixed: 2 draw calls, 30k / 60k / 99k triangles (Low / Medium /
High+Ultra); the rest of the difference is traffic and streaming variance between runs.

### Known limits
- Low cloud is a surface colour on the far relief (no volume, no mist inside the region).
- The 0.99999 depth tests of AO, SSR and ULTRA light shafts treat geometry beyond ~30 km as
  sky (no AO there - correct - no SSR hit, shafts can start over the farthest ranges).
- 24-bit depth quantises ~180 m at 30 km: where the cone's apron meets the ranges the two
  meshes share one material and height function, so overlaps do not show.
- The distant ranges are smooth-shaded noise relief (no tree or rock texture); the cone's
  44 gullies are procedural, not the real mountain's erosion pattern.
- The photographed clear-day sky keeps its own clouds above 9.8 deg; below, a blurred band.
