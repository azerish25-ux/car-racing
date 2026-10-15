# Workflow run wf_ef3f8a4a-fe2: agent reports

Final report of every completed agent, verbatim (journal results).

## capture before

{
  "scratchDir": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba",
  "images": [
    {
      "shot": "01 cockpit, low speed, pit exit (Aurel, live, held after release from the box at 46 km/h, cockpit camera)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/01-cockpit-pit-exit.png",
      "preset": "ultra"
    },
    {
      "shot": "02 chase, high speed, main straight (Aurel, live, 294 km/h, 238 m after the line, past the pits and grandstand)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/02-chase-main-straight.png",
      "preset": "ultra"
    },
    {
      "shot": "03 side-by-side, two cars (Aurel, live chase, closest equivalent: the launch at 37 km/h with the car diagonally ahead 10 m up and one lane across; the AI field strings out within seconds of the start)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/03-side-by-side.png",
      "preset": "ultra"
    },
    {
      "shot": "04 wet braking into turn 1, heavy rain (Aurel rain race, live chase, lap 1, 206 km/h, brake 0.17, s 951 m. This is the first braking zone after the line; NORTH HOOK, named as T1 at 627 m, is taken flat out)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/04-wet-braking-turn1.png",
      "preset": "ultra"
    },
    {
      "shot": "05 sunset into the sun (Aurel, ACADEMY SUNSET, live chase, heading within 26 deg of the authored golden-hour sun, 141 km/h)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/05-sunset-into-sun.png",
      "preset": "ultra"
    },
    {
      "shot": "06 night traffic (Aurel, ACADEMY NIGHT, opening lap, live chase behind the field)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/06-night-traffic.png",
      "preset": "ultra"
    },
    {
      "shot": "07 pit entry and service (Aurel, P pit request + pit assist, live, held in the box at pit phase 2, crew around the car, chase)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/07-pit-service.png",
      "preset": "ultra"
    },
    {
      "shot": "08 wide replay/broadcast (WATCH REPLAY held at 9.18 s, trackside broadcast camera, pack on lap 1, clean canvas)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/08-replay-broadcast.png",
      "preset": "ultra"
    },
    {
      "shot": "08 wide replay/broadcast as seen by the player (letterbox, lower third and replay HUD kept)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/08-replay-broadcast-as-seen.png",
      "preset": "ultra"
    },
    {
      "shot": "09 close photo of a car (PHOTO STUDIO free orbit, az 32, el 8, 8 m, 50 mm, DOF, exported with the studio's DOWNLOAD PNG, pit lane)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/09-close-photo.png",
      "preset": "ultra"
    },
    {
      "shot": "10 catalogue venue: Neon City at night (night by venue, race traffic, live chase, 215 km/h)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/10-neon-city-night.png",
      "preset": "ultra"
    },
    {
      "shot": "11 open-world festival, Port Ilse town, golden hour (festival menu set to Golden hour, car at spawn, chase camera, held with the menu hidden)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/11-festival-town-golden-hour.png",
      "preset": "ultra"
    },
    {
      "shot": "contact sheet of all of the above (3x4 overview, not a framing)",
      "path": "/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ultra-live-9c679ba/contact-sheet.png",
      "preset": "ultra"
    }
  ],
  "method": "All 11 framings came out of one run of a new script that drives the real production app: 0 failures, 0 console errors, about 23 minutes. The script and its run instructions are in /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/capture-suite/live-capture.mjs and /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/capture-suite/README.md. I did not change scripts/ultra-capture.ts, because it renders an isolated fixture and does not run the game.\n\nHow it works:\n- Builds the checkout with Vite into a temporary directory (nothing is written into the repo) and serves it with vite preview.\n- Opens it at 960x540, device scale 1, in a fresh browser context, so no saved preferences and lighting starts at DAY.\n- Picks Ultra in GARAGE & SETTINGS, then starts each session from the paddock form with the AI DRIVER on from the grid.\n- Pauses with Esc when conditions read from the read-only window.apexDiagnostics() hold (track distance, speed, rival gaps and lateral offsets, pit phase, heading against the golden-hour sun from sky-light.ts).\n- Uses only the existing controls: CHANGE CAMERA, ACADEMY lighting, P pit request, PHOTO STUDIO and its DOWNLOAD PNG, WATCH REPLAY with the seek bar, and the festival menu's time of day.\n- Nothing is injected into the simulation or renderer. The only page change is a stylesheet that hides the HUD, menus and replay bar for each clean screenshot; it is removed straight after.\n- Writes manifest.json (build identity, GL renderer, held player state, camera, lighting, exposure and Ultra counters per shot), timeline-<session>.json files of every polled state, and run.log.\n\nBuild and backend: integration branch claude/peaceful-einstein-dedc7t at 9c679ba. The branch moved while I worked; f00a161 was HEAD when I started. Images were rendered with Mesa llvmpipe through ANGLE on Xvfb (`--backend mesa`), about twice as fast as SwiftShader here; `--backend swiftshader` also works. Before/after boards should use the same backend.\n\nSessions: Aurel 10-lap race, 12 cars, clear, mid-grid start, for shots 01, 02, 03, 05, 06, 07, 08 and 09. Aurel 3-lap race in heavy rain for 04. Neon City 3-lap race for 10. The festival for 11.\n\nClosest equivalents and limits:\n- 03 is the launch, at 37 km/h with the car diagonally ahead. In the recorded races the AI field spreads out within seconds, so a rolling side-by-side at racing speed hardly occurs.\n- 04 is the first braking zone after the line, at about 950 m. NORTH HOOK, named as turn 1 at 627 m, is taken flat out.\n- Night and sunset on Aurel come from the ACADEMY lighting buttons, switched only while paused.\n- 11 is a stationary car at the Port Ilse spawn. The festival exposes no position data, so its waits are timed.\n- Paused frames are the app's held frames: TAA, temporal AO history and sharpening are bypassed by design, and exposure is whatever the meter had adapted to while driving.\n- 08 uses the replay lens. 09 uses the photo-studio look (no auto exposure or lens effects).\n- A pause can land late while a slow software-GL frame blocks the page. The script re-checks the held state and resumes if the car has left the framing.\n- Fallbacks are built in: 01, 03, 05 and 07 fall back to a held replay moment if the live pause misses. None was needed in the final run.\n- Software GL proves the look, not performance."
}

## critique:materials

{
  "issues": [
    {
      "shot": "01, 02, 06, 07, 09, 10 (every sunlit or floodlit view of the racing surface and pit lane)",
      "problem": "Asphalt reads as pale, warm greige concrete. In 02 the sunlit road measures sRGB (139,131,121), brighter than the turf beside it (124,127,76) and only about 2.5x darker in linear than the kerb white (211,204,194). The pit lane in 01, 07 and 09 is beige at (127-138, 120-132, 112-115). At night (06, 10) the floodlit road is a flat light grey. On a real circuit the asphalt sits clearly below the grass and 5-7x below the line paint, so the road should be the darkest large surface in the frame.",
      "cause": "circuit-finish.ts:20 ASPHALT_TONE = [1.58, 1.68, 1.72] multiplies the warm surface-detail.ts:13 palette asphalt [106,101,96] (B/R 0.91), giving an effective linear albedo of about 0.18-0.19 (the comment says ~0.19, and tests/road-detail.test.ts:461-462 lock it to 0.15-0.22). Real race asphalt is about 0.08-0.12. The same surfaceMaterial('asphalt') is used for the race road, the pit lane (circuit.ts pitMat) and the venue-kit run-off.",
      "fix": "Retune to an effective linear albedo of about 0.10-0.11, near neutral: palette asphalt to about [100,99,97] and ASPHALT_TONE to about [1.0, 1.02, 1.05]. Keep the chip, meso and line contrast so polished aggregate still reads. Change the test window to 0.08-0.13. adaptive-exposure.ts meters the road and car region, so exposure will rise by about 0.7 EV: re-check that the sky does not clip and re-key METER_KEY.day if it does. Constants only, so no cost on any preset.",
      "files": "src/rendering/circuit-finish.ts, src/rendering/surface-detail.ts, tests/road-detail.test.ts, src/rendering/exposure-meter.ts (verify only)",
      "value": 8,
      "cost": 2
    },
    {
      "shot": "02, 03, 04, 05, 06, 08, 10 (every view with a kerb or painted run-off)",
      "problem": "The kerbs look like candy canes. In 02 the red measures (213,32,43), an ink-pure red with almost no green or blue, and the white (211,204,194) is close to paper. Stripe edges are razor-clean. Straights carry no rubber, dust or grime. The 1.75 m green run-off band (84,138,96) with crisp white chevrons reads like fresh vinyl, not rolled paint that cars have driven over.",
      "cause": "studio/kerb-runoff-finish.ts KERB.colours[0] = [0xbc0a14, 0xecebe6]: the red is linear 0.50/0.003/0.007, a pigment no real paint has, and the white is linear 0.84. Blue 0x2a4fa0 and RUNOFF.bands[0] 0x3b8a50 are similarly saturated. kerbWear comes only from kerbUsage = exp(-(d/1.2)^2), so kerbs away from the racing line get zero rubber, and chips scale with .25+.6*usage.",
      "fix": "Red to about #a82a26 (linear ~0.39/0.024/0.019), white to about #cfccc3 (~0.61), blue to about #2c4a86, green band to about #3f6e4c. Give kerbWear a floor of 0.15-0.2 over the track-side 30 %, and put brown dust in the ridge troughs using the existing ridgePhase. Add tyre-dirt spray and a slight wear breakup to the run-off band and chevrons, and soften the stripe boundary by about 1 cm of paint overlap. Update tests/kerb-runoff.test.ts:70-73 and the P9 test in tests/studio-look-contracts.test.ts. Constants and a few ALU instructions, so no measurable cost.",
      "files": "src/rendering/studio/kerb-runoff-finish.ts, tests/kerb-runoff.test.ts, tests/studio-look-contracts.test.ts",
      "value": 7,
      "cost": 2
    },
    {
      "shot": "01, 02, 03, 05, 07, 09 (apron and terrain turf); 03, 06 (gravel)",
      "problem": "The turf is khaki or hay coloured: in 02 it measures (124,127,76), with red equal to green, and it is as bright as the road. It reads as felt or painted card next to the dark forest, not as mown summer grass. Gravel reads as pale sand.",
      "cause": "studio/grass-gravel-finish.ts:21 GRASS_TINT = [2.17, 1.66, 2.46] times the surface-detail palette grass [89,101,53] gives a linear albedo of (0.217, 0.216, 0.088). That is G/R = 1.0 and a luminance of about 0.2, where real mown turf in the visible band is about 0.08-0.12 with G/R about 1.5-1.8. The 'dry' mix vec3(1.12,1.04,.85) in circuit-finish.ts (grass) and dryLand (terrain) push it further toward yellow. GRAVEL.color #b9a98a is linear ~0.48/0.40/0.25, the colour of sand.",
      "fix": "GRASS_TINT to about [0.75, 0.88, 1.25], which gives linear ~(0.075, 0.115, 0.045) and keeps saturation at about 0.4. Reduce the dry-patch tint to about (1.06,1.03,0.9). Keep the mow lean and sheen. The terrain shares GRASS_TINT, so the apron/terrain seam stays closed. Set GRAVEL.color to about #8f8470 (linear ~0.27) and update tests/near-grass.test.ts. Retune together with the asphalt issue so road and verge separate in value and hue. No cost.",
      "files": "src/rendering/studio/grass-gravel-finish.ts, src/rendering/circuit-finish.ts, tests/near-grass.test.ts",
      "value": 7,
      "cost": 2
    },
    {
      "shot": "09 (clearest), 01, 07 (also any night pit view)",
      "problem": "The yellow pit-box markings are unlit. In 09 the part of the line inside the car's shadow measures (215,190,97), the same as the sunlit part (200,180,106), while the asphalt around it falls to about 25. The lines glow like stickers over the ground, ignore car shadows and contact occlusion, never get wet, and will glow at night.",
      "cause": "circuit.ts:742 in infrastructure(): `const yellow = new T.MeshBasicMaterial({ color: 0xe7c969 })` is created once per garage (12 unlit materials). The start-grid boxes in grid() correctly use a lit MeshStandardMaterial with installCircuitFinish(paint, 'paint').",
      "fix": "Create one shared MeshStandardMaterial({ color: 0xd2b04a, roughness: 0.6 }) outside the loop. Apply installCircuitFinish(m, 'paint'), installCarGrounding(m) and installLightPools(m), and set userData.weatherSurface = 'paint', the same treatment as the grid paint. Draw count is unchanged and there are fewer programs. The extra lighting cost covers a few hundred pixels.",
      "files": "src/rendering/circuit.ts",
      "value": 6,
      "cost": 1
    },
    {
      "shot": "04 (wet braking into T1, heavy rain); applies to every rain session",
      "problem": "In heavy rain the circuit reads as an overcast dry track. The asphalt is a uniform grey satin, (45,46,52) near the camera and (76,81,89) mid-frame. Neither the red car ahead, its rain light, the barriers nor the tree line reflects in it, and there are no puddle mirrors or darkened wheel tracks. The kerb white stays (165,164,162) matte with crisp stripes, and the lines and the green run-off band show no water sheen.",
      "cause": "(a) The kerb, white and runOff materials in circuit.ts are MeshStandard with only the weather-presentation.ts response: darkening of 0.12 (kerb) or 0.10 (paint) and roughness clamped to 0.34. They have no water-film lobe and do not sample the wet planar reflection (WET_REFLECTION_GLSL is installed only on the road). (b) In materials.ts installWetRoad, cells that are wet but not puddled get clearcoat = wet*0.58 and clearcoatRoughness of about 0.22. The planar reflection is then fetched at LOD sqrt(0.22)*5 \u2248 2.3, plus the 7-tap streak, which is a blur. Puddles need waterMm of 0.65-1.5 and wet-detail.ts puddleField. (c) Porous darkening of x0.58-0.6 on a 0.19 albedo leaves wet asphalt at about 0.11, where real wet asphalt is about 0.04-0.06.",
      "fix": "Once rain exceeds about 6 mm/h (roadWeather.x), treat the film as thicker than the macrotexture on every wet cell: clearcoat 1 and clearcoatRoughness 0.06-0.10. Bias puddles toward the edges and braking zones, and darken porous asphalt to about x0.45. Make kerb, white and run-off MeshPhysical with a water film: reuse library.ts installWetSurface with porosity ~0.1, wetAmount 1, puddles 0.2 and water F0 0.0204. Give them the WET_REFLECTION_GLSL sample; they already have vFinishWorld. Also confirm through renderer diagnostics (wetReflection.passes, presented H.WATER) that the planar pass ran in this capture. Compile the kerb and paint film behind a define enabled only on high and ULTRA, so low and medium do not get slower.",
      "files": "src/rendering/materials.ts, src/rendering/studio/wet-detail.ts, src/rendering/wet-reflection.ts, src/rendering/circuit.ts, src/rendering/weather-presentation.ts, src/rendering/materials/library.ts",
      "value": 9,
      "cost": 5
    },
    {
      "shot": "07 (crew kneel on grass), 01, 09",
      "problem": "The pit box is half turf: in 07 the crew kneel on olive grass beside the car, and in 01 and 09 a grass strip runs between the garage-side boards and the lane. A real pit lane is paved from the pit wall to the garages. The lane itself is a uniform light grey with no box burnouts, oil or fluid stains, wheel-gun scuffs or traffic band, so it reads as a car park.",
      "cause": "In circuit.ts (~line 280) the pit ribbon uses `offset: (s,t) => track.pitOffset(s) + (t*2-1)*3.6`, which covers only \u00b13.6 m around the lane centre (about 17.4-24.6 m). The box centre is at boxLateral 24.1 m and the pit-side wall at |pitOffset|+5 \u2248 26 m (simulation track.ts boundaryAt), so the apronWithSkirt grass shows through in the service area. pitMat gets installWetRoad and installCarGrounding only, not installRoadDetail or installWetDetail, so it has no rubber, repairs or stains.",
      "fix": "Widen the pit ribbon asymmetrically, from pitOffset-3.6 on the track side to the pit-side boundary on the garage side. That keeps the same material and draw with a couple more columns. Add a small pit-detail hook on pitMat: a pair of launch-rubber marks leaving each box (reuse the LAUNCH_RUBBER mark maths keyed on track.boxS(i)), an oil and fluid stain at each box centre, a darker traffic band along the fast lane, and worn paint near the box lines. Optionally lighten and smooth the working lane toward epoxy concrete. No extra draws on any preset.",
      "files": "src/rendering/circuit.ts, src/rendering/studio/road-detail.ts (shared rubber helpers)",
      "value": 7,
      "cost": 4
    },
    {
      "shot": "05 (into the golden-hour sun), 02, 03 (also 04, 08)",
      "problem": "Into the sun (05), every tree glows a flat cream-beige: shadowed lower tiers and canopy interiors are as bright as the lit edges, and the conifer whorl tops look snow-capped. In 02 and 03 the belt conifers are smooth, evenly shaded green cones stacked like toy Christmas trees, with crisp silhouettes and no light through gaps.",
      "cause": "studio/foliage-shading.ts TRANSLUCENCY (lines ~51-59) adds 0.35*pow(dot(-V,L),4)*diffuseColor*directionalLights[0].color after lights_fragment_end. That is the raw, unshadowed sun colour with no thickness or occlusion weighting and no chlorophyll tint. The header says it is gated by the crown's shadow; the code is not. In studio/belt-trees.ts, BELT_TREES.crownNormal = 0.4 leaves each whorl skirt shaded as its own cone, needles [0.095,0.15,0.1] are fairly bright and bluish, and the notched coverage exists only at the rim tips.",
      "fix": "Move the translucency into an RE_Direct wrapper, as materials/library.ts LEAF_GLSL already does, so it uses the shadowed directLight.color. Multiply it by vBeltShade.x or the crown occlusion and a thickness term, tint it (1.05,1.12,0.55), and drop it to about 0.2 with pow 6. In belt-trees, raise crownNormal to about 0.7 and darken needles to about [0.05,0.075,0.04]. Add per-whorl random droop and tip length, deeper notches, and occlusion on whorl tops near the leader so the tiers merge into one ragged mass. Shader cost is unchanged.",
      "files": "src/rendering/studio/foliage-shading.ts, src/rendering/studio/belt-trees.ts",
      "value": 7,
      "cost": 4
    },
    {
      "shot": "10 (Neon City at night), 11 (festival town)",
      "problem": "Building surfaces read as CG blocks. In Neon City, identical 4x8 window grids repeat across every block, and about half the panes are flat full-white emissive squares at (198,204,202) with no blinds, interiors, frames or reflections, like Minecraft offices. In Port Ilse, walls are flat vertex colours with no plaster or brick at street scale. Windows are painted flush with no frame, sill or depth (the reveal only darkens albedo), and panes alternate between dead black and beige.",
      "cause": "In venue-kit/materials.ts facadeTextures(), one 256x512 canvas holds 4x8 cells. The lit set is drawn once per texture (random.next() < 0.55) with fixed tones '#bfe6ff' and '#ffd79a', then tiled at 14x28 m (structures.ts). The facade material has roughness 0.55 and metalness 0.15 (metallic concrete), and venue-kit/index.ts sets emissiveIntensity 1.6 at night. In open-world/buildings.ts facadeMaterial(), glass is vec3(0.025) at roughness 0.06 in the wall plane, the reveal is albedo x0.65, and walls are vertexColors with only a low-frequency streak.",
      "fix": "In Neon City, hash per window in UV-cell plus per-building space instead of baking it: lit share and brightness 0.15-1.0, a 2700-5000 K tint, a blinds or curtain gradient with a dark ceiling band as a cheap interior hint, and a random UV offset per building. Set facade metalness to 0 and make panes dielectric glass at roughness 0.05 that reflect the probe. Night emissive about 0.4-0.8. In the festival town, add a one-tap parallax interior offset and normal-tilted reveals and sills in facadeMaterial, plus plaster or brick micro-normal from the library recipes (textures.get('concrete-rough','normal')). These are a few ALU instructions and one shared texture.",
      "files": "src/rendering/venue-kit/materials.ts, src/rendering/venue-kit/index.ts, src/rendering/venue-kit/structures.ts, src/rendering/open-world/buildings.ts",
      "value": 6,
      "cost": 5
    },
    {
      "shot": "11 (festival town street)",
      "problem": "The town street reads as dark hex or cobble tiles: sharp-edged blotches of 20-30 cm repeat every 0.64 m in a regular grid all the way to the vanishing point. That is a texture-tiling tell, not laid asphalt.",
      "cause": "In materials/procedural.ts aggregate(..., patched=true), patchMask = smoothstep(.52,.58, fbm(uv, 3.0, 3)) is baked into the 0.64 m asphalt tile (materials/library.ts asphalt() default tile 0.64). That makes three hard-edged patches per tile, repeated. open-world/roads.ts uses variant 'patched' for town streets. Library asphalt has no distance convergence and no meso layer, unlike the circuit's studio/road-detail.ts installAsphaltDetail (microFade 15-40 m, 4.5 m meso tile), so the micro tile also moir\u00e9s at range.",
      "fix": "Take the patches out of the baked tile. Add them in the library asphalt shader in world space at 2-6 m, as rectangular cut-and-fill repairs aligned to the road like road-macro.ts ROAD_REPAIR_GLSL. Add a 4-5 m meso tone and fade the micro tile to its mean between 15 and 40 m by porting installAsphaltDetail's microFade. Gate the extra meso tap behind the high or ULTRA define if open-world performance on low and medium matters.",
      "files": "src/rendering/materials/procedural.ts, src/rendering/materials/library.ts, src/rendering/open-world/roads.ts",
      "value": 6,
      "cost": 3
    },
    {
      "shot": "07 (pit service, crew fill the frame)",
      "problem": "The crew look like toys. Ten identical helmets (~(51,62,112)) carry one broad, soft highlight, like matte plastic balls, with no lacquer reflections, livery or visor depth. The overalls are a uniform, spotless royal blue, identical on every person, with no fabric sheen.",
      "cause": "pit-crew.ts:197 builds the helmet batch with this.batch(..., roughness 0.35, metalness 0.08): a MeshStandard with metalness on paint and no clearcoat. crew-geometry.ts installCrewHelmetFinish only lowers roughness on the lens. crew-suit.ts sets suitCol to the team tint (PLAYER_CREW_COLOUR 0x1b2a5e) with no per-person variation or soiling, and crew-pose.ts uses roughness .86 with no cloth sheen.",
      "fix": "Helmets: MeshPhysical with metalness 0, roughness 0.35, clearcoat 1 and clearcoatRoughness 0.04 for sharp sky reflections, a livery band or number in the helmet hook, and a dark visor at roughness 0.05. Overalls: per-person tint jitter of about \u00b16 % value from vCrewPerson, knee, glove and brake-dust grime on the legs, and a Nomex rim sheen (MeshPhysical sheen 0.6 / sheenRoughness 0.8, or a cheap Fresnel rim in the existing hook). This is one instanced batch, so the cost is small.",
      "files": "src/rendering/pit-crew.ts, src/rendering/crew-geometry.ts, src/rendering/crew-suit.ts, src/rendering/crew-pose.ts",
      "value": 5,
      "cost": 3
    },
    {
      "shot": "08 and 08 as-seen (broadcast replay, daylight)",
      "problem": "The LED sponsor spans along the pit straight and the turn-1 barrier blow out to white tubes with a blue fringe, and the wordmark is unreadable. In daylight a real LED board reads as a saturated, legible panel on a dark glossy face, not as neon.",
      "cause": "studio/trackside-branding.ts:48 LED_EMISSIVE = 2.5, added at :179 as totalEmissiveRadiance += vBrandLed * 2.5 * diffuseColor.rgb, unconditionally day and night and on top of the lit vinyl albedo. White and light-blue wordmark texels therefore clip after exposure and bloom.",
      "fix": "Scale the LED term with the day/night state, about 0.6-0.9 in daylight and about 2.0 at night (the same uniform venue-kit/index.ts already toggles). Render it as a display: a dark substrate (albedo about 0.04, roughness 0.3, so daylight reflects off the face), an LED pixel matrix of about 12 mm pitch at 50 % fill that converges to its mean before it aliases, and the wordmark colour as emission instead of albedo times gain. No cost change.",
      "files": "src/rendering/studio/trackside-branding.ts",
      "value": 4,
      "cost": 1
    }
  ]
}

## critique:lighting

{
  "issues": [
    {
      "shot": "06 night traffic (also 10 road)",
      "problem": "ACADEMY NIGHT looks like dim daylight, not a floodlit venue. The grass verges glow brighter than the racing surface (verges (114,125,123) and (154,154,123) against asphalt (57,57,57)). The road is one even grey all the way to the vanishing point, with no specular sheen or streaks from the lamps. Lamp heads are small dots with no glare. The grandstand, trees and hills are lit by a single directional 'sun' from the day azimuth, and stars are visible above a floodlit circuit.",
      "cause": "studio/light-pools.ts treats each luminaire as an isotropic point (E = I*h/r^3) sitting on the pole, lateral 12 m, height 9 m, with the two rows staggered every 40 m. On the CPU twin, irradiance peaks at 3.96 on the verge under the poles, while the centreline sums to an almost constant 1.12-1.24 (within 5 %). Only directDiffuse is added (POOL_GLSL), never specular. The night key (daylight.ts circuitLightState night: sun 0.6 along SUN_OFFSET, RIBBON_KEY_SHARE.night 0.3) lights the whole landscape from one direction. headGain 12 makes the lamp heads only about 100x brighter than the road, where real luminaires are 1e5-1e6x brighter.",
      "fix": "1) Model aimed floodlights: weight each lamp by a beam toward the track (I*cos^6 of the angle off an aim vector about 30 deg below horizontal across the track). The racing surface then gets the peak and keeps broadcast-uniform light, and the verge behind the pole line drops to 0.2-0.3. 2) Add a GGX specular term for the 2 nearest lamps per side, using the material roughness, so the asphalt shows floodlight sheen and glints. 3) Scale the night directional key by distance from the track (1 to 0.05 over 30-80 m, from the track distance field) so forest and hills fall to moonlight. 4) Raise headGain from 12 to about 600; this depends on the bloom fix in the ULTRA bloom finding. 5) Add a faint warm light dome to the night fog and sky near the horizon, and multiply stars by about 0.1 when the venue is floodlit.",
      "files": "src/rendering/studio/light-pools.ts, src/rendering/daylight.ts (circuitLightState night, CELESTIAL), src/rendering/venue-lighting.ts",
      "value": 8,
      "cost": 5
    },
    {
      "shot": "04 wet braking turn 1",
      "problem": "The rain is heavy (24 mm/h, mean track water 0.93), yet the track looks like dull grey satin. There is no reflection of the player car, of the car ahead or of its rain light, no bright sky band in the far road, and no streaks. The frame has no specular highlights at all (99.9th-percentile luminance 0.67).",
      "cause": "The road hook in materials.ts sets material.clearcoat = wet*mix(0.58,1,puddle) and clearcoatRoughness = mix(0.26, mix(0.22,0.055,puddle), wet), plus rain ripple and variance. Everywhere outside the puddle mask is therefore a 0.58-strength, roughly 0.22-roughness water film, about a +/-15 deg GGX lobe. ultra/ssr.ts lowers SSR confidence with roughness and falls back to the blurred probe. Puddle coverage is limited by studio/wet-detail.ts PUDDLES, and the water F0 of 0.02 leaves only a faint lobe.",
      "fix": "Drive the film from water depth, not only the puddle mask. When track water is at least about 0.5 mm, set clearcoat to 1 and clearcoat roughness to 0.05-0.08 across the racing surface, with ripples on top; use 0.12-0.15 only on the emerging dry line. Grow puddle coverage with depth. Keep SSR confidence near 1 up to roughness 0.15. In the SSR resolve, stretch reflections vertically (3-5x along the view-projected normal) so rain lights and the bright horizon become long streaks.",
      "files": "src/rendering/materials.ts (road wet hook), src/rendering/studio/wet-detail.ts, src/rendering/ultra/ssr.ts, src/rendering/wet-reflection.ts",
      "value": 8,
      "cost": 4
    },
    {
      "shot": "01, 02, 03, 07 (also 05, 11)",
      "problem": "The fair-weather sky reads as cartoon 'cotton-ball' cumulus. Dozens of small, similar-sized, evenly spaced lens-shaped puffs with soft airbrushed edges and flat slate-grey bases fill the sky down to the horizon. There are no cloud streets, no clustering, no ragged fractus edges and no variety of cloud type. In 02 the overhead cloud's base (102,111,125) is even darker than the blue sky beside it. The sky takes up the top third of every day shot.",
      "cause": "studio/sky-clouds.ts: the clear preset (cover 0.12, read through CLOUD_THRESHOLDS) keeps only the 0.5-2 km Worley fragments. Each one is an 'ellipsoidal dome 0.7-1.15 R high' (aspect = mix(0.42,1.0,..)*mix(0.8,1.15,broad), around line 395), with a crisp 25-115 m skin and extinction 0.04/m (cloudLayer), so every cell becomes an opaque rounded blob of the same type. Bases receive only SKY_LIGHT.cloudBounce 0.12 and cloudMultiple 0.032 (sky-light.ts). The 3072-px panorama (0.117 deg per texel) is magnified about 2.5x at 1080p and 5x at 4K, so ULTRA gets softer edges still.",
      "fix": "1) Flatten humilis to an aspect of 0.25-0.5 R for radii under 1 km; keep 0.7-1.15 only for the few clusters over 2 km. 2) Give the 5 km cluster and street modulation more weight than the 0.5-1 km octaves, so cover gathers into groups and leaves open blue sky. 3) Lower extinction from 0.04 to about 0.025 and raise edge erosion from 0.55 to 0.8, so edges become translucent and ragged. 4) Raise cloudMultiple to about 0.07 and cloudBounce to about 0.2, so bases sit at 0.55-0.65 of the tops. 5) Bake the ULTRA panorama at 6144x1536, or add view-time cloudDetail erosion in the dome shader. 6) Recalibrate CLOUD_THRESHOLDS so dome cover stays the same.",
      "files": "src/rendering/studio/sky-clouds.ts, src/rendering/sky-light.ts (SKY_LIGHT cloud terms)",
      "value": 8,
      "cost": 6
    },
    {
      "shot": "01, 02, 03, 07, 08 (also 11)",
      "problem": "The clear sky is an alpine-clean, saturated blue right down to the horizon. In 01 it runs from (64,106,162) at the zenith to (119,156,191) just above the trees, still at 0.38 saturation, where a real summer horizon whitens toward neutral. Distant ridges, meanwhile, are flattened into pale cut-out silhouettes (02, 07, 08 mountains). The result is layered 'matte painting' depth rather than continuous air.",
      "cause": "sky-light.ts sets SKY_LIGHT.haze.day = [7,11,16]. With atmosphere.ts mieScattering 3.996e-6 and a 1200 m scale height, that is an aerosol optical depth of 0.034/0.053/0.077 at 550 nm; typical summer values are 0.1-0.2. Aerial perspective is unrelated to that haze: studio/aerial-perspective.ts uses amount = 1 - exp(-depth^2), which is FogExp2's squared response, with daylight.ts fogDensity 0.00055 + 0.00025*cover. Ridges 2-5 km away therefore reach 50-95 % haze, where a 40 km-visibility day leaves about 25-35 %. Grade vibrance 0.16 then saturates the muted sky further.",
      "fix": "Raise haze.day to [18,26,38] (AOD about 0.09/0.12/0.18) and haze.sunset to about [22,28,36], then re-prewarm. Replace the squared response with Beer-Lambert: amount = 1 - exp(-tau), tau = sigma*d*heightMean. Take sigma from the same atmosphere (Rayleigh plus Mie*haze at the datum, about 1.0-1.4e-4 per metre on a clear day) and use the 1200 m Mie scale height instead of 150 m. Ridges then keep 60-70 % of their contrast, and the fog colour equals the dome's horizon. Keep rain as an added sigma (about 1.5e-3 at 24 mm/h). Performance cost is zero on every preset.",
      "files": "src/rendering/sky-light.ts, src/rendering/atmosphere.ts, src/rendering/studio/aerial-perspective.ts, src/rendering/daylight.ts (daylightState fogDensity)",
      "value": 7,
      "cost": 3
    },
    {
      "shot": "05 sunset into the sun",
      "problem": "The into-the-sun shot looks milky, like a soft-focus filter rather than hard golden backlight with beams. The backlit tree line on the right is brighter than the side-lit one on the left: mean (141,119,72) with its 5th percentile at 77/255, against (97,90,67). Silhouettes and the car lose their dark core.",
      "cause": "Three veils stack over the same region. 1) ultra/light-shafts.ts uses strength.sunset 0.16 (0.185 after the haze factor; matches diagnostics) with a long radial gather (decay 0.965, 24 taps plus a squared second gather) over a broad HG g 0.76 mask capped at 40, composited additively over the occluders. 2) The aerial-perspective sun glow uses sunPower 8, a lobe about 23 deg wide. 3) The ULTRA energy bloom (mix 0.035, two-thirds of it in the wide levels) is amplified by lens dirt 0.9 (studio/lens-effects.ts).",
      "fix": "Light shafts: strength.sunset 0.16 to 0.06, decay 0.965 to 0.94; restrict the mask to within about 8 deg of the sun (g 0.76 to 0.9) so beams start at the disc and aureole; composite multiplied by (1 - occluder share) so the canopy stays dark between beams. Aerial perspective: sunPower 8 to 24, a tight Mie aureole. ULTRA lens dirt 0.9 to 0.3. Sunset bloom energy mix 0.02.",
      "files": "src/rendering/ultra/light-shafts.ts, src/rendering/studio/aerial-perspective.ts, src/rendering/studio/lens-effects.ts, src/rendering/lens-bloom.ts",
      "value": 7,
      "cost": 2
    },
    {
      "shot": "04 wet braking turn 1",
      "problem": "The rain light is dull and physically inverted. The fully hazed ridge is brighter than the cloud deck directly above it: ridge (156,155,154), sky just above (103-130). The mountains therefore read as a white cardboard cut-out. The ground is also too bright for the sky: sky to wet road is about 5:1, against roughly 12-15:1 for wet asphalt under an overcast dome. As a result the sky never approaches white and the whole frame sits in a narrow grey band. Directional sun shading also persists under a 0.95 nimbostratus deck.",
      "cause": "daylight.ts daylightState computes sun = sunIrradiance*(1 - 0.94*cover^1.45). At the rain preset's cover of 0.95 that still leaves about 0.49 of direct, shadow-casting sun. fill = 0.06 + 0.2*cover adds a hemisphere light on top of the dome PMREM (environment 1), light the visible sky does not emit. The deck the camera sees uses SKY_LIGHT.deckBackground 0.116-0.132 and darker baked cloud bases (sky-light.ts). The fog colour comes from aerialFogColor(..., palette.overcast) times authored rain ratios. These two paths are never reconciled, and the sky dome is excluded from aerial perspective.",
      "fix": "1) Remove the direct beam under a deck: sun *= 1 - smooth(0.6, 0.95, cover), with PCSS shadows fading with it. 2) Remove the extra hemisphere: fill becomes about 0.03 constant. 3) Raise the deck's own radiance (deckBackground and deckAmbient about 2-2.5x) so the dome alone supplies the lost irradiance. 4) Derive the rain fog colour in skyFogPalette from the dome's actual radiance at 1-3 deg elevation for the current cover, cloud panorama included. 5) Apply the same in-scatter to the lowest 3-5 deg of the dome. Target: sky at 0.85-0.95 display after metering, wet road at about 0.15-0.25.",
      "files": "src/rendering/daylight.ts, src/rendering/sky-light.ts, src/rendering/studio/aerial-perspective.ts, src/rendering/studio/sky-clouds.ts",
      "value": 7,
      "cost": 4
    },
    {
      "shot": "10 Neon City night",
      "problem": "Neon City reads as an LED billboard or a voxel city. Window panes are identical and clip to white (right facade (254,254,243); left blocks a uniform cream). The facades between them are pitch black, and the sky is pure black with stars. There is a glare blob where a lamp meets the near facade, and no light spills onto the street, the barriers or the facades from street level.",
      "cause": "venue-kit/materials.ts facadeTextures lights 55 % of panes, each a flat full-pane fill of #ffd79a, #ffe9c4 or #bfe6ff with no interior variation. venue-kit/index.ts sets facade emissiveIntensity 1.6 at night (lamp 8), which lands at or above ACES white at the night exposure. Facades get only the night directional key: no light pools and no lamp light. The night fog and sky (#0e141c, daylight.ts and aerial-perspective night colour) have no urban skyglow.",
      "fix": "Give each pane a log-normal luminance (0.05-1.0, median about 0.25), with 25-35 % lit, 2700-4500 K plus a few cool offices, and an interior gradient or blinds. Lower facade emissiveIntensity from 1.6 to about 0.6. Light facades from street level: chain the light-pool hook onto facades with an upward falloff, or add one analytic lamp row along the kit's roads. For catalogue night city venues, add a warm grey horizon skyglow (about 0.03 linear at the horizon, falling to 0.004 at 30 deg) and multiply stars by about 0.05.",
      "files": "src/rendering/venue-kit/materials.ts, src/rendering/venue-kit/index.ts, src/rendering/daylight.ts, src/rendering/studio/aerial-perspective.ts",
      "value": 7,
      "cost": 3
    },
    {
      "shot": "11 festival town golden hour",
      "problem": "In golden-hour Port Ilse the street is crushed to a near-black blue (road mean (11,12,19)), while the sunlit facades beside it are bright orange. No warm bounce from those facades reaches the street canyon. The headlight cone becomes a hard bright decal on black, the car shows no ground contact, and the 'patched' asphalt tone appears as blotches.",
      "cause": "open-world/festival-renderer.ts lights the town as if it were an open circuit. The only indirect light is the sky-only PMREM (SkyEnvironment captures the dome, not the town) plus a 0.09 hemisphere with a fixed ground colour. There is no AdaptiveExposurePass: toneMappingExposure is fixed at daylight.exposure 1.62, so the shaded canyon is never metered. The town asphalt is materials.asphalt('patched', 0x48484a), a linear albedo of about 0.065 before porous darkening (open-world/roads.ts).",
      "fix": "Add a local diffuse probe in the festival: a 32-64 px cube around the car, one face per frame and refreshed about every 0.5 s, with its SH9 used for diffuse while the sky PMREM keeps specular. ULTRA only, or High as well if within budget. A cheap alternative is a shadowless bounce directional opposite the sun azimuth at about 0.15*sun*facade albedo, tinted by the sun. Reuse the circuit's AdaptiveExposurePass with the per-lighting meter key. Set town asphalt to about 0x5a5b5d (about 0.1 linear) and halve the patch tone contrast.",
      "files": "src/rendering/open-world/festival-renderer.ts, src/rendering/open-world/roads.ts, src/rendering/adaptive-exposure.ts, src/rendering/daylight.ts (SkyEnvironment)",
      "value": 7,
      "cost": 4
    },
    {
      "shot": "06, 10, 04 (also 05, 02)",
      "problem": "At ULTRA no light source glows: the floodlight heads in 06, the street lamps in 10 and the rain lights in 04 have no halo. Bright day and sunset frames, by contrast, carry a uniform low-contrast veil. A real lens does the opposite: tight, bright glare around point sources and almost no wide veil.",
      "cause": "In lens-bloom.ts, energyConserving mode removes the threshold but the prefilter still applies the firefly limiter (limitKnee 24 compressing toward limit 64). Any emitter is therefore capped at 64*mix (0.035) of redistributed energy, and lamp heads at headGain 12 are too dim to produce visible glare in the first place. The pyramid weights (scatter 0.7 over 7 levels, normalization about 3.06) put two-thirds of the redistributed 3.5 % into radii of 8-128 px, which is a frame-wide veil. In rain, wetMix 0.055 strengthens it further (ultra/pipeline.ts).",
      "fix": "In energy mode, raise limitKnee/limit to at least 2000/8000 (half-float safe) and limit only isolated sub-pixel outliers (tap against the minimum of its 3x3). Reshape the PSF so about 70 % of the redistributed energy stays in levels 0-2 (scatter 0.7 to about 0.45) and the wide tail is at most 1 %. Use mix 0.03 by day and 0.045 wet. Author emitters (lamp heads, windows, rain and tail lights) in physical radiance so they glow through the energy-conserving path.",
      "files": "src/rendering/lens-bloom.ts, src/rendering/ultra/pipeline.ts, src/rendering/studio/light-pools.ts",
      "value": 6,
      "cost": 2
    },
    {
      "shot": "04 wet braking turn 1",
      "problem": "When the car brakes in rain, a saturated red fog covers the whole rear of the player car (rear wing, right rear tyre, floor) and smears the car ahead into a red blob (sample (500,500) = (117,42,49)). It looks like a red flare, far more light than a rain LED can scatter into spray.",
      "cause": "The spray-clouds.ts vertex shader adds vec3(0.34,0.004,0.001)*signal*exp(-d^2*0.35)*rear to each puff. rear-signal.ts sets signal to 2.5 when brake > 0.1, otherwise flashing 1.4. The gate rear = smoothstep(-0.08, 0.5, cos) also accepts puffs beside the lamp, and the result is capped only at 2.2 red, about 3-6x the white spray light under overcast (vLight about 0.67*energy). The term does not depend on view direction, so every puff between the camera and the car turns red.",
      "fix": "Make it a bounded, forward-scattered in-scatter. Lower the coefficient from 0.34 to about 0.06. Use falloff exp(-d^2*1.5) (half at about 0.7 m) and gate rear with smoothstep(0.3, 0.8). Multiply by an HG phase toward the camera (g about 0.6) and by puff opacity, and clamp the red increment to at most 0.5x the puff's ambient light. Let the lamp's own bloom carry the glow.",
      "files": "src/rendering/spray-clouds.ts, src/rendering/rear-signal.ts",
      "value": 6,
      "cost": 2
    },
    {
      "shot": "all day shots (02, 03, 07); highlights in 05, 08, 10",
      "problem": "The day frames have a 'game-punchy' look. Verges, kerbs and sky are pushed in saturation, mid-tones get a second contrast curve, and highlights clip with a hard shoulder: 6.2 % of pixels clipped in 05, windows at (254,254,243) in 10, and barrier LED boards flat white at (213,212,222) in 08.",
      "cause": "renderer.ts uses ACESFilmicToneMapping (the ULTRA toneMapper default is 'aces' in options.ts). In display space, broadcast-grade.ts GRADE_PROFILES.day then applies a 0.16 contrast S-curve, saturation 1.06 and vibrance 0.16. Vibrance boosts exactly the muted natural materials: grass, sky, asphalt and foliage. The hue-selective LUT (grade-lut.ts, day sky gain 1.03) comes after that.",
      "fix": "Make 'agx' (or 'neutral') the ULTRA default toneMapper, with an ULTRA-only grade of contrast 0.06-0.08, saturation 1.0 and vibrance 0.04, keeping the hue-selective LUT. Leave low/medium/high on ACES and their current grade, so they keep their look at zero cost.",
      "files": "src/rendering/options.ts, src/rendering/ultra/pipeline.ts, src/rendering/broadcast-grade.ts, src/rendering/studio/grade-lut.ts",
      "value": 5,
      "cost": 2
    }
  ]
}

## critique:geometry

{
  "issues": [
    {
      "shot": "02, 03, 04, 05, 06, 08, 10",
      "problem": "A red/white kerb with a 2-4 m green-painted band beyond it runs the full length of every straight on both sides: the main straight, the rain braking straight, the sunset straight, the night straight, the broadcast view and the Neon City street circuit. On real circuits kerbs only appear at corner entry, apex and exit, and a straight ends in a white line and then grass or asphalt. The unbroken candy stripe reads as a slot-car or toy track set, and its short stripe rhythm makes a 15 m wide track look like a scale model.",
      "cause": "circuit.ts queues the kerb ribbon (offset width..width+1.1 m, step 0.16, stripes) for side -1 and side 1 with no `include` predicate, so it covers 100% of the lap. venue-plan.ts runoffStyleAt returns 0 ('green') whenever cornerAt < 0, so every straight gets painted green bands. simulation/contact.ts kerbHeight/trackHeight add the kerb bump profile across the whole lap, so physics matches the visuals.",
      "fix": "Export cornerAt from venue-plan.ts and add a shared `kerbPresent(track, s, side)`. It is true inside CORNER_WINDOW of a named corner, or where |curvature| > 1/400 m within \u00b140 m. Pass it as `include` to the kerb ribbon in circuit.ts, and gate kerbHeight in contact.ts trackHeight/TrackContactMesh with the same predicate (agree this with the physics owner). On straights, runoffStyleAt should return a new plain style (1-2 m of grey asphalt, then grass) instead of green paint. Keep coloured run-off bands only at corners. This draws fewer triangles on every preset.",
      "files": "src/rendering/circuit.ts (kerb queueRibbon ~l.241), src/rendering/venue-plan.ts (cornerAt, runoffStyleAt, RUNOFF_STYLES), src/rendering/studio/kerb-runoff-finish.ts, src/simulation/contact.ts (kerbHeight, trackHeight)",
      "value": 8,
      "cost": 4
    },
    {
      "shot": "02, 03, 04, 05, 06, 08",
      "problem": "Every forest-belt conifer is the same symmetric Christmas-tree cone: 7-12 sharply separated horizontal tiers, foliage down to the ground, lined along the treeline. Each tree has the identical silhouette, only scaled and rotated, so the belts read as model-railway trees. In 02, 05 and 08 they are the most visible thing behind the circuit.",
      "cause": "studio/belt-trees.ts beltTreeStream builds ONE coniferGeometry (seed 0x51c0; near 12 whorls/16 tips, far 7/10, bottom 0.09, low radius jitter 0.9-1.06). studio/forest-belts.ts instances it with only yaw and (width, height) scale (FOREST_BELTS.conifer 14-28 m, aspect 0.36-0.5). The VERTEX/COLLAPSE hooks contain no per-instance shape variation.",
      "fix": "(a) Add variation in the belt vertex hook at zero draw cost. Hash the instance translation to drive: per-whorl radius jitter (\u00b125%), short or missing branch sectors, a 2-4% crown lean or sweep, a leader kink, and a per-tree 'crown lift' that collapses the lowest 20-45% of whorls onto the trunk (trees in a dense stand self-prune and show bare trunks). Drive this from a whorl index packed into an existing attribute channel. (b) Raise whorls to 18-22 near / 10-12 far, with each tier's droop overlapping the next so the tiers stop reading as separate plates. (c) Tie aspect to height (the tallest trees 0.28-0.36) and add occasional broken or dead tops. ULTRA may also pack 2-3 seeded variants into the stream as extra draw ranges. Low, medium and high keep their current triangle and draw counts.",
      "files": "src/rendering/studio/belt-trees.ts (coniferGeometry, BELT_TREES, VERTEX/COLLAPSE), src/rendering/studio/forest-belts.ts (FOREST_BELTS.conifer, instance transform ~l.290)",
      "value": 8,
      "cost": 5
    },
    {
      "shot": "08 replay broadcast, 08 as seen",
      "problem": "The trackside broadcast replay looks like a tilt-shift miniature. Only a thin band on the pack is sharp. The foreground catch fence and track, and the background trees, stands and mountains, all have the same heavy blur. A real broadcast long lens (2/3-inch B4 camera at f/4-5.6, subject 60-150 m away) keeps almost the whole frame sharp, and blur that does not grow with distance is the classic toy-model cue.",
      "cause": "studio/subject-focus.ts subjectLens returns TELEPHOTO for trackside fov < dofBelow (20 deg). trackside.ts TELEPHOTO sets aperture 0.0006 per metre and maxblur 0.006. dof-pass.ts non-thin-lens circle() = clamp((depth - focus) * aperture) reaches maximum blur 10 m either side of focus, so everything beyond that gets the same blur. ultra/pipeline.ts then skips the physical ReplayLens because this DOF already owns the frame (otherDof).",
      "fix": "Drive the trackside DOF with the thin-lens model: DepthOfFieldPass thinLens:true, lensK from replay-lens.ts thinLensScale, with a broadcast gate (sensorHeight 0.0054, fNumber 4-5.6, maxblur about 0.004). At 100 m focus this gives about 0.2 px of background blur, and the pass already skips pixels under 0.5 px, so it is cheaper on every preset. Close pit-lane long-lens shots still get real separation. A minimal alternative is to drop TELEPHOTO.dofBelow to about 8 deg.",
      "files": "src/rendering/trackside.ts (TELEPHOTO), src/rendering/studio/subject-focus.ts (subjectLens/focusOnSubject), src/rendering/studio/dof-pass.ts, src/rendering/ultra/replay-lens.ts (thinLensScale, sensorHeight), src/rendering/renderer.ts (~l.1464)",
      "value": 7,
      "cost": 2
    },
    {
      "shot": "07 pit service",
      "problem": "The chase camera sits inside the pit crew. The rear-jack operator's helmet and back fill the bottom-centre third of the frame and hide the car. The 15 crew wear identical navy suits and helmets and have identical proportions, so they read as a mannequin army.",
      "cause": "renderer.ts CHASE (height 1.3 m, distance 4.5 m, lookLift -0.25) does not change in the pit box. pit-footwork.ts puts the rear-jack man just behind the rear crash structure, so the lens ends up about 0.8 m behind his helmet. The crew materials have no near-camera fade. pit-crew.ts tints every actor with the same crewTeamColour(car) on the same suit material.",
      "fix": "In renderer.ts, when the followed car is stationary in its box (pit phase >= 1, speed < 2 m/s), ease the chase rig to about 2.6 m height and 7.5 m distance, with the gaze pitched 12-15 deg down and yawed 15-20 deg toward the garage (a three-quarter pit-box view). Add a screen-door dither fade on the crew cloth, head and glove materials for fragments with view depth < 1.2 m. Vary the crew: role-coded sleeve and shoulder panels, stature \u00b14% per actor, visor up or down, and garage staff without helmets. Nothing changes outside the pit box.",
      "files": "src/rendering/renderer.ts (CHASE, chase branch ~l.1173), src/rendering/pit-crew.ts, src/rendering/crew-geometry.ts (crewTeamColour), src/rendering/crew-suit.ts, src/rendering/crew-pose.ts",
      "value": 7,
      "cost": 3
    },
    {
      "shot": "10 Neon City night",
      "problem": "The city is one row of plain extruded boxes. All windows are the same size and 55% of them are lit white-hot in an identical repeating dice pattern. There are no podiums, setbacks, roof plant, parapets or signs, and nothing behind the first row, only a black void. The near building's window bays look 3-4 m tall next to the cars. It reads as a voxel or LED toy skyline.",
      "cause": "venue-kit/structures.ts buildFacades makes one facadeBox per lot (4-17 storeys at 3.5 m) with a flat roof slab and a 14 x 28 m UV tile, and the UV starts 1.5 m below grade, so floors do not line up with the base. venue-kit/materials.ts facadeTextures bakes one 4x8-bay tile with lit = random < 0.55, once per material (3 materials), so the same lit mask repeats every 14 x 28 m on every building. venue-kit/index.ts sets facade emissiveIntensity to 1.6 at night.",
      "fix": "Bake a 16x32-bay lit mask per material with per-window intensity 0.2-1.0, 25-35% of windows lit, 2-3 colour temperatures and some blinds. Give each building a random UV offset so the masks never line up, and align v to the plinth top. Lower night emissive to about 0.5-0.7. Use 2.0-2.4 m mullion bays on towers. Add a wider 2-3 storey podium, a tower setback, a parapet, roof-plant boxes and a few red aircraft-warning lights. Add a second row of taller merged impostor boxes 250-600 m back (one draw) to give the skyline depth.",
      "files": "src/rendering/venue-kit/structures.ts (buildFacades, facadeBox), src/rendering/venue-kit/materials.ts (facadeTextures), src/rendering/venue-kit/index.ts (night emissive)",
      "value": 7,
      "cost": 4
    },
    {
      "shot": "11 festival town golden hour",
      "problem": "Port Ilse reads as a low-poly toy town. The box walls have painted-on windows with no reveal depth, sills, cornices or balconies. Identical 4-6 storey slabs line up to a single vanishing point. The shopfronts are flat beige panels. The street is empty: no trees, parked cars, signs, awnings or bins. The foreground lamp post is a visibly faceted 6-sided tube.",
      "cause": "open-world/buildings.ts Mesher emits one flat quad per wall. The facade shader only darkens a 'reveal' band around a window grid (bay 2.7-3.3 m, floorH 3.2 m), and the flat roof gets a parapet colour but no geometry. open-world/roads.ts townLamps uses CylinderGeometry(0.07, 0.1, 7, 6). Nothing in festival-renderer.ts dresses the streets.",
      "fix": "ULTRA: parallax or interior-mapped window recess (about 0.25 m) with sill and lintel in the facade shader. All presets (cheap merged geometry per 512 m chunk): an extruded string course at each floor, a 0.4 m coping overhang on the parapet, and balconies on 'block' buildings. Vary lot heights by \u00b12 floors and vary roof profiles. Give ground floors awnings and sign boards. Add instanced street dressing along 'town' road edges: street trees, static parked cars (reuse the festival-cars bodies), bollards, bins and signs. Use a 12-sided lamp pole.",
      "files": "src/rendering/open-world/buildings.ts (Mesher, facade shader, flat-roof/parapet), src/rendering/open-world/roads.ts (townLamps), src/rendering/open-world/festival-renderer.ts",
      "value": 7,
      "cost": 6
    },
    {
      "shot": "02, 08",
      "problem": "A 42 m orange-and-teal striped sphere with a coarse grid rises above the treeline just off the main straight. It reads as a beach ball or toy planetarium and becomes the dominant scale reference, which makes the cars, stands and trees look smaller.",
      "cause": "venue-landmark.ts LANDMARK: radius 21 and centreHeight 17 put the top at about 38 m, above the 14-28 m belt trees. landmarkSitePlan places it at s = 0.13 of the lap and 90-140 m lateral from the straight. landmarkScreenMaterial paints saturated ribbons (0.39,0.17,0.075 / 0.075,0.22,0.29) over a 48x18 seam grid, and they are visible in daylight.",
      "fix": "Make it read as architecture. Either cut the shell to a shallow cap over a taller glazed drum (lowerCosine about 0.25-0.35 in the event-hall shell, top <= 24 m) or replace it with a low long-span roof. Use dark anodised cladding (albedo 0.12-0.2, near-zero chroma) with a fine diagrid (about 120x40, seams as normal detail), and show the LED pattern only at night. Move the lateral candidates in landmarkSitePlan to 180-260 m so belt trees hide the lower half. If it stays prominent, add scale cues: an entrance canopy, people, a roof walkway.",
      "files": "src/rendering/venue-landmark.ts (LANDMARK, landmarkSitePlan, landmarkScreenMaterial), src/rendering/event-hall-assets.ts",
      "value": 6,
      "cost": 3
    },
    {
      "shot": "02, 04, 07, 08",
      "problem": "The far landscape is one smooth layer of rounded, sine-wave-shaped green mounds with a single ridgeline that ends at the edge of the terrain plane. In rain (04) the range becomes a flat, pale cut-out silhouette that is brighter than the cloud base, like a painted cardboard backdrop.",
      "cause": "terrain-profile.ts terrainHeight builds the foothills from analytic sin()^2 and sin()^4 terms (24 m and 17 m) plus linear ramps, with a ridged range only between 1.15 and 2.75 km. circuit.ts 'Distant terrain' is PlaneGeometry(5500, 5500), so the world ends at 2.75 km and there is no further layer. studio/aerial-perspective.ts colours.rain (0.31,0.36,0.41) pushes the ridge to a constant colour that does not match the sky dome's horizon.",
      "fix": "Replace the sine foothills with domain-warped fbm/ridged noise (spurs and gullies). Add 2-3 horizon rings: merged low-poly ridge strips at about 6, 12 and 25 km, one draw, hazed by the same aerial-perspective function and fading to the sky's horizon radiance. In overcast and rain, take the in-scatter colour from the sky-light horizon so distant ranges dissolve instead of turning into flat silhouettes. Cheap on every preset.",
      "files": "src/rendering/terrain-profile.ts (terrainHeight), src/rendering/circuit.ts ('Distant terrain' 5500 m plane), src/rendering/studio/aerial-perspective.ts, src/rendering/sky-light.ts",
      "value": 6,
      "cost": 5
    },
    {
      "shot": "02, 03, 06, 08",
      "problem": "The spectator infrastructure is small: stands of 48-80 m with about 8-12 shallow rows. At 238 m past the line (02) the main straight has forest on both sides and no stands. The venue reads as a club circuit, and the track and cars lose an important human-scale reference.",
      "cause": "venue-plan.ts AUREL_VENUE.grandstands has 64 m and 80 m stands on the pit straight and 48 m stands elsewhere. grandstand.ts generic stands use rows = 8 at a 0.49 m rise (about 4 m tall).",
      "fix": "On the main straight, add two 160-220 m stands opposite the pits with 18-24 rows, roof cantilevers and stair towers. Add 90-120 m x 12-16 row stands at T1 and the hairpin. Keep low, medium and high flat in cost: rows above 10 use only the crowd impostor LOD (crowd-impostor.ts) with seats as merged strips, or the extra stands are ULTRA only.",
      "files": "src/rendering/venue-plan.ts (AUREL_VENUE.grandstands), src/rendering/grandstand.ts (rows, seat/spectator layout), src/rendering/crowd.ts, src/rendering/crowd-impostor.ts",
      "value": 6,
      "cost": 6
    },
    {
      "shot": "03, 06, 08",
      "problem": "The crowds read as confetti: solid patches of pure orange, yellow, magenta and red shirts at full saturation. A real F1 crowd is mostly dark and neutral clothing with muted team colours mixed in.",
      "cause": "studio/crowd-flags.ts CROWD_TEAM_COLOURS (0xff8000, 0xffd200, 0xe5007d, 0xc8102e, ...) are picked 50% of the time by crowdColour. COHORT_SHARE 0.75 (used in grandstand.ts) then groups them into solid blocks.",
      "fix": "Cut the team share to 0.2-0.25. Desaturate team colours by about 40% and cap cloth albedo at about 0.55 sRGB. Weight the neutrals toward dark (black, navy, charcoal, denim, khaki, with white tees around 10%). Lower COHORT_SHARE to 0.35. Add cap and hat shapes to the impostor ellipse set. Zero cost.",
      "files": "src/rendering/studio/crowd-flags.ts (CROWD_TEAM_COLOURS, CROWD_NEUTRALS, crowdColour, COHORT_SHARE), src/rendering/grandstand.ts, src/rendering/crowd-impostor.ts",
      "value": 5,
      "cost": 1
    },
    {
      "shot": "01, 03, 04, 05, 06, 07, 10",
      "problem": "The same wordmark (OBSIDIAN, NORDFIN, VOLTEX, VANTA) repeats every 4.6 m along the entire length of the concrete barriers, at the same height, on both sides. There is no plain concrete, no taller board and no gap. The uniform band reads as a toy track border and flattens depth along the straights.",
      "cause": "studio/branding-plan.ts brandingPlan gives every span on both sides a branded panel (plainPanel is never planned). studio/trackside-branding.ts BOARD_METRES is 4.6, and the module applies 'barrier vinyl on every concrete barrier run'.",
      "fix": "In brandingPlan, brand only about 30-40% of the lap, concentrated at TV hotspots (start/finish, braking zones, corner exits). Give the remaining spans plainPanel: weathered grey concrete, or black/white painted sections near corners. Vary span lengths from 20 to 120 m. Add a few 2 m elevated hoardings on posts behind the barrier at the hotspots. Less LED area also makes it cheaper.",
      "files": "src/rendering/studio/branding-plan.ts (brandingPlan, SPAN_METRES, plainPanel), src/rendering/studio/trackside-branding.ts (BOARD_METRES, LED share)",
      "value": 5,
      "cost": 3
    },
    {
      "shot": "01, 02, 03, 05, 07",
      "problem": "The clear sky is evenly sprinkled with small, same-sized, hard-edged cotton-ball puffs with flat bases. In 02 a huge lens-shaped cloud sits close at top-left. The silhouettes read as a cartoon sky.",
      "cause": "studio/sky-clouds.ts makes every cumulus an ellipsoidal dome 0.7-1.15 R high on one flat condensation level (aspect mix(0.42, 1.0) by radius). The fair-weather threshold and cell scales spread many mid-size cells evenly across the dome.",
      "fix": "Widen the shape distribution: height/radius 0.3-1.6 depending on cell size, with small fragments flatter and wispier. Add \u00b160-120 m undulation and erosion to the cloud bases. Cluster coverage so clear patches are larger. Let cirrus and altocumulus carry more of the clear-day texture. These are bake-time changes only, so frame cost is unchanged.",
      "files": "src/rendering/studio/sky-clouds.ts (cloud field, dome shape ~l.366-420, cloudLayer)",
      "value": 4,
      "cost": 5
    }
  ]
}

## implement art fixes

All 15 issues are implemented and committed on `worktree-wf_ef3f8a4a-fe2-5`, not pushed. Thirteen are fully done; issues 9 and 14 are partial (details below). The 11 framings were re-captured with the same script at the final commit `2d695d4`: one run, 0 failures. Lint and build pass. The full test suite has one failure: a simulation test that ran out of time while the machine was heavily loaded; I changed no simulation code.

**Worktree:** `/home/user/Experiment-3/.claude/worktrees/wf_ef3f8a4a-fe2-5`. The integration branch merged as a fast-forward to 9c679ba. `node_modules` is an untracked symlink to the main checkout.

**Commits** (9c679ba..HEAD, oldest first): 36fc7e1, 63ee995, e863d9e, a25d211, 01f5928, ff01f69, bafce04, 4caeb62, 4be09a7, ef27ad1, 8bd166c, 625a07e, d8401f7, 7f5d16f, 6ccfb9b, c3a7937, 52f9436, b31210b, 1a6a954 (updates `RENDERING_PIPELINE.md`), 2d695d4.

**Per-issue outcome**

| # | Issue | Outcome |
|---|---|---|
| 1 | Pit-box yellow lines | Done. One shared lit paint material with car grounding replaces the 12 unlit ones. In 09, the line's darkest 10 % (in the car's shadow) is now about 71/255 against 119 before. The light-pool hook was left off on purpose: the box geometry has no lap coordinates, and the pit asphalt under it has no pools either. |
| 2 | Crowd colours | Done. Team kit 22 % of shirts (desaturated, capped at 0.55), neutrals weighted dark, white tees about 10 %, cohort share 0.35, and caps or hats on the impostors. Flags stay brighter. |
| 3 | Asphalt | Done, at about 0.097 linear albedo and near neutral, slightly below the asked 0.10–0.11 so the road sits under the retuned turf. In 02 the road goes from (140,132,122) to (101,100,100). The exposure key was not re-keyed: no frame clips. |
| 4 | LED boards | Done. Dark glossy face, 12 mm LED matrix, gain 0.8 by day / 1.2 at sunset / 2.0 at night. The boards in 08 are now readable instead of white. |
| 5 | Sunset veils | Done. Light shafts narrowed and weakened (sunset 0.06); near geometry keeps 15 % of the beam rather than 0 %. Sun glow tightened (power 24), ULTRA lens dirt 0.3, sunset bloom mix 0.02. Pixels at 250+ in 05 drop from 7.6 % to 4.3 %, mostly the sun itself. |
| 6 | Kerbs | Done with the suggested colours, a rubber floor of 0.18 on every kerb, dust in the ridges, softened stripe edges, and wear and tyre dirt on the run-off. |
| 7 | Turf and gravel | Done. I used tint [0.94, 1.1, 1.56] instead of the suggested [0.75, 0.88, 1.25]: with the existing soil mix the suggested value rendered slightly darker than the road. Turf now lands around 0.11 luminance, green-to-red ratio about 1.6. Gravel is #8f8470. |
| 8 | Broadcast replay blur | Done. Trackside telephoto uses a broadcast thin lens (2/3-inch sensor, f/4); it costs less than the old blur on every preset. Background sharpness in 08 rises about 34×. |
| 9 | Glare around lights | Partial. Bloom spread tightened (scatter 0.45), mix 0.03 / 0.045 wet, limits 2000/8000. The outlier limiter uses the median of five taps per pixel rather than a full 3×3 minimum per tap, to keep the cost down. Floodlight heads (300×), city lamps (150×) and rain lights (6×) carry physical brightness on ULTRA only; other presets are unchanged. |
| 10 | Red spray fog in rain | Done, as a bounded tint toward the camera. Strongly red pixels in the lower half of 04 drop from 11.7 % to 1.7 %. |
| 11 | Tone mapping and grade | Done. ULTRA defaults to AgX; low/medium/high keep ACES and their grade. I set saturation to 1.05 rather than 1.0 because AgX alone turned the blue sky grey. I also added a 0.03 black point (ULTRA only) because AgX lifted the darkest 5 % of pixels from about 5/255 to about 25/255. |
| 12 | Sky haze and distant ridges | Done. Haze raised to [18, 26, 38], ridges now fade with Beer–Lambert using the same air as the sky, plus rain. Sky tests were updated: the clear zenith is now less deep blue and the sun slightly weaker (expected with hazier air). |
| 13 | Neon City | Done. About a third of windows lit at varied brightness and colour temperature with ceiling gradients and blinds, emissive 0.6, street light on the lower storeys, warm skyglow with stars at 5 %. Bright pixels in the upper frame of 10 drop from 1.19 % to 0.26 %. |
| 14 | Pit-stop camera and crew | Partial. The camera rises to a three-quarter view (2.6 m, 7.5 m, 18°, about 14° down), nearby crew dissolve within 1.2 m, and suits and helmets are tinted by role with small per-person variation. Skipped: stature variation would break the hands-on-tools and feet-on-floor placement; visors and helmet-less garage staff need new head and helmet geometry in the authored assets. |
| 15 | Wet road | Done. Water depth drives a full, smooth sheet; puddles grow with depth; ULTRA screen-space reflections streak on wet road. |

**Constraint on lower presets:** I couldn't measure performance here (software GL, shared CPUs). On low/medium/high the changes are constants plus a few extra shader instructions on kerb, run-off, LED vinyl, facade and pit-crew pixels, and the spray vertex shader got slightly more work per rain lamp. The bloom, light-shaft, reflection-streak and grade-define changes run on ULTRA only.

**After images:** in `/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/after/`, same file names as before:
- 01-cockpit-pit-exit.png, 02-chase-main-straight.png, 03-side-by-side.png
- 04-wet-braking-turn1.png, 05-sunset-into-sun.png, 06-night-traffic.png
- 07-pit-service.png, 08-replay-broadcast.png, 08-replay-broadcast-as-seen.png
- 09-close-photo.png, 10-neon-city-night.png, 11-festival-town-golden-hour.png
- contact-sheet.png, manifest.json, run.log

Method: Mesa backend, 960×540. Before the final run, four attempts died when the shared memory limit killed Chrome's GPU process while other agents' browsers were running. The successful run used the unmodified capture script with `--url` pointing at a prebuilt preview of the final commit. Logs from the failed attempts and an earlier set (1a6a954, before the black point) are in `art/after-logs/`.

**Test results**
- `npm run lint`: passes.
- `npm run build` (type check and Vite build): passes.
- `npm test` at the final commit: 2740 of 2741 pass. The failure is `tests/pit-release.test.ts` › "anticipates the future service-bay sweep…", which hit its own 30 s limit (it took 31 s, and 37 s on a re-run) with the machine's load average at 14. My diff touches nothing under `src/simulation` or `src/core`, and the test passed in my earlier full run. The four failures from that earlier run were test expectations that needed updating for the new behaviour; they are fixed and committed.

## verify art

{
  "perShot": [
    {
      "shot": "01 cockpit, pit exit",
      "better": true,
      "notes": "More photoreal. The asphalt is now neutral grey, the turf is a believable dull green instead of yellow-lime, the pit-box paint sits in the light, and the sky is softer. Two costs: the frame is milkier (median luma 43 to 60, p99 214 to 187) and the brightest cloud stops at 205/255 (was 232), so it no longer reads as a hard sunny day. The halo and carbon lift slightly toward grey plastic."
    },
    {
      "shot": "02 chase, main straight",
      "better": true,
      "notes": "Clear step forward on materials: road (128,121,112) to (90,90,90), less garish kerbs, natural turf, distant ridges now fade with aerial perspective. Not like-for-like: the player is at s=134 m, not 238 m, so the scenery differs. Still very CG: cotton-ball sprite clouds and a huge flat-bottomed 'saucer' cloud near the camera at top left, smooth untextured green mountains, an untextured grey tower, an orange grid dome. Saturation dropped from 0.29 to 0.17 and contrast (std) from 53 to 40, so it looks overcast although the sun is out."
    },
    {
      "shot": "03 side-by-side",
      "better": true,
      "notes": "Modest gain. The grade is more photographic, the sky has haze and the road is believable. The cars still sit lightly on the road (thin contact shadows), the crowd reads as confetti, and the LED boards stay saturated blue. Cloud tops are capped at 205 (was 232) and the meter wants +0.85 EV (its ceiling), so the review frame is underexposed relative to live play."
    },
    {
      "shot": "04 wet braking T1",
      "better": true,
      "notes": "The red spray fog is gone, the biggest single fix in the set, and the car ahead now has a streaked reflection on the wet road. New problems: the rooster-tail spray behind the car ahead has nearly disappeared (only a low dark smear to its left), the player car shows no visible rain light, and the middle-distance road has blocky, mottled cells (the puddle/depth mask looks quantised) instead of a continuous sheet. The far mountains are still flat white cut-outs."
    },
    {
      "shot": "05 sunset into sun",
      "better": true,
      "notes": "The veiling glare and light-shaft wash are gone and the worn racing line now reads. Not like-for-like: s=1341 m against 1434 m, and the sun is at the upper left. With the veil removed, other faults show: the sun disc is drawn over an opaque cloud (no occlusion, no silver lining, almost no glare), back-lit clouds are flat brown discs, two untextured grey berm or slab shapes sit on the right, and the catch-fence posts carry no mesh. Shadows crush a little more than before (pixels at or below 8/255 rose from 0.9% to 3.8%)."
    },
    {
      "shot": "06 night traffic",
      "better": true,
      "notes": "Marginal gain. Floodlight heads now read as bright point sources with tight glare, and the VANTA boards are legible. Still day-for-night: the road and run-off are lit evenly with no pools, falloff or multiple shadows, the hills catch a strong green moonlight rim, and the pit building lost most of its interior glow. p95 dropped from 141 to 112, so the lit areas look dim rather than floodlit."
    },
    {
      "shot": "07 pit service",
      "better": true,
      "notes": "Much better camera: the three-quarter view shows the car, the crew and the jack. Still clearly CG. The crew are identical mannequins (same stature, opaque blue helmets with no visors, role tint barely visible). The box layout is wrong: an advertising wall runs between the garages and the box, the crew kneel on grass, and the car half straddles the grass strip. Real pit lanes run paved from the garage door to the fast lane, with the pit wall on the track side."
    },
    {
      "shot": "08 replay broadcast",
      "better": true,
      "notes": "Strong gain. The fake tilt-shift miniature blur is replaced by a plausible broadcast depth of field, so the pack, boards and gantry are sharp and readable. Main faults now: smooth untextured mountains, a confetti-noise crowd, posts-only fences, and low contrast (std 43 to 29, p99 172 to 147), which reads like a dull broadcast feed."
    },
    {
      "shot": "08 replay broadcast as-seen",
      "better": true,
      "notes": "Same gain as the clean canvas, and the letterbox crop hides the weakest mountain area. The HUD is unchanged."
    },
    {
      "shot": "09 close photo",
      "better": true,
      "notes": "Marginal and mixed. Better: the pit asphalt looks like asphalt (was warm light concrete), the yellow lines are lit and shadowed by the car, and the livery reds are less neon. Worse: the frame is milky and flat (p95 163 to 130, brightest background 211 to 188), the paint has weak specular highlights, and the background haze at about 100 m is heavy for a clear day. The car now sits across the painted box lines (box offset to the right, a line under the front wing), where before it sat inside; check the stop position or studio placement against the box geometry."
    },
    {
      "shot": "10 Neon City night",
      "better": true,
      "notes": "Large gain. Windows vary in brightness and colour temperature and have blinds, facades read as buildings, street lamps and a skyglow cloud deck appear, and the blown-out window walls are gone. Remaining: no coloured neon signage at all, so the venue lost its identity and reads as a generic office district. Windows are flat with no interior depth, the lamps cast no pools on the road, and the asphalt is evenly lit and matte with no specular streaks from the lights."
    },
    {
      "shot": "11 festival town golden hour",
      "better": false,
      "notes": "Essentially unchanged apart from a slightly flatter grade, and now the least photoreal shot by far. The road is dark navy with a repeating dog-bone tile pattern. The facades are blocky and flat, with no window recesses or street dressing. A hard-edged headlight pool shows in daylight: festival-cars.ts lights the headlights whenever night > 0.05, which includes golden hour. The red car reads as a toy, but it belongs to the vehicle-bodies owners."
    },
    {
      "shot": "contact sheet",
      "better": true,
      "notes": "The set is more coherent and physically grounded: neutral asphalt, believable turf, no red fog, no white LED boards, no sunset veil. Two cautions. Globally it is flatter and greyer: luminance std fell 13 to 35% in every shot, and day cloud tops cap at about 205/255. Shot 11 now stands out as the outlier. Shots 02 and 05 were captured about 100 m from their earlier positions, so those comparisons are confounded."
    }
  ],
  "regressions": [
    "ULTRA tone compression. AgX base, the 0.08 S-curve and the 0.03 display black point flatten the day shots. The brightest sunlit cloud tops cap at about 205/255 in 01, 02, 03 and 07 (before 229 to 254), p99 falls by 25 to 40 levels, luminance std falls 13 to 35% in every shot, and 02 saturation falls from 0.29 to 0.17. Sunny scenes read as overcast or milky (src/rendering/broadcast-grade.ts FILMIC_GRADE_PROFILES / FILMIC_BLACK).",
    "The exposure meter was not re-keyed for the darker albedos and AgX. Target EV in the day shots is now +0.30 (02, 07), +0.39 (01) and +0.85 (03, the ceiling), against about 0 before. The review captures at 0 EV no longer match what a player sees after adaptation, and METER_KEY's own comment says the reviews are the reference (src/rendering/exposure-meter.ts).",
    "The clear-sky zenith turned grey-blue: 01 sky mean (72,114,166) became (97,122,149). Summer haze [18,26,38] combined with AgX makes a clear day read as hazy, which removes the direct-sun contrast cue.",
    "04 rain. The fix for the red in-scatter also removed most visible water cues: the rooster-tail spray behind the car ahead is nearly gone and the player car shows no lit rain light (possibly the off phase of the flash; verify). The middle-distance wet road also shows blocky, mottled cells from the water or puddle mask.",
    "09 and 07: the car now straddles the painted pit-box lines. Before it sat inside the box; now a line runs under the front wing and the box is offset. Check the stop position and studio placement against the new shared box-paint geometry.",
    "05: with the veil removed, the sun disc shows drawn on top of an opaque cloud (no occlusion, no silver lining) with almost no glare. The contre-jour car crushes more (pixels at or below 8/255 rose from 0.9% to 3.8%).",
    "10: Neon City has no coloured neon left. Realism is up, but the venue lost its signature look.",
    "Performance constraint risk: the new per-pixel work on kerb, run-off, LED vinyl, facade and pit-crew shaders, and the extra per-rain-lamp spray vertex work, also ship on low, medium and high and were never measured. Gate them behind the ULTRA define or prove them neutral with GPU timer queries."
  ],
  "nextPriorities": [
    "Exposure and tone first, because it limits everything else. Re-key METER_KEY to the new albedos so the review frame equals the adapted live frame. Give ULTRA a filmic curve with a real toe and a later shoulder (an AgX 'punchy'-style look, or Khronos Neutral with a toe) instead of a display-space black-point subtraction. Targets: 18% grey at about 118/255, sunlit asphalt at 90 to 110, sunlit cloud tops and specular highlights at 235 to 255, day p99 at 235 or above.",
    "Sky and clouds: replace the cotton-ball sprite clouds (flat undersides, the near-camera 'saucer' in 02 and 05) with a volumetric or raymarched cloud layer or a calibrated HDR photo sky. It needs correct sun occlusion, silver linings, cloud shadows moving across the ground, and a deeper zenith with haze concentrated at the horizon.",
    "Distant terrain: the mountains are smooth, untextured green blobs (02, 08) and flat white cut-outs (04). Add albedo and normal detail at macro scale, forest, scree and rock masks, and fog-integrated silhouettes. Retire placeholder forms such as the grey berms in 05 and the gridded orange dome.",
    "Vegetation: replace the cone conifers and blob deciduous trees with octahedral impostors and near-field meshes. They need leaf translucency, per-instance hue and size variation, wind, and ground cover where turf meets the trees.",
    "Wet race realism: physically scaled spray plumes behind every car (scaled by speed and water depth, sky-lit white-grey, occluding cars that follow), a visible flashing rain light, and a smooth water-depth mask without blocks. Wet asphalt should darken and carry mirror SSR of cars, boards and lamps. Lens droplets in the chase camera.",
    "Night lighting: floodlights and street lamps need measurable pools with falloff, multiple soft shadows from the light towers, and specular streaks on asphalt. For Neon City, add physically bright coloured signage that bleeds onto wet or dark surfaces, plus window interior mapping for depth.",
    "Festival town (11), now the worst shot: replace the dark-navy dog-bone road with aged asphalt (albedo 0.08 to 0.12, patches, crack seal, polished wheel tracks, worn paint). Turn the headlight pool off while the sun is above the horizon (festival-cars.ts line 92: night > 0.05). Add facade relief (recessed windows, sills, frames, balconies, varied materials), street dressing (signs, poles, parked cars, kerbs) and long golden-hour shadows down the street.",
    "Pit lane and crew: pave the working lane to the garage door and move the advertising wall to the pit wall on the track side. Lit garage interiors with tools and tyre blankets. Crew with stature variation (re-solve hand and foot IK), visors, fireproof-fabric sheen and varied helmets.",
    "Grounding and contact: stronger contact shadows and ambient occlusion under cars and crew (screen-space contact shadows plus GTAO tuned for the undertray), and a tighter near shadow cascade. Cars in 03 and 08 still sit lightly on the road. Replace the confetti-noise crowd with shaded clustered impostors.",
    "Trackside dressing and scale: real alpha-tested catch-fence mesh with mip-correct coverage, textured Armco and tyre walls, marshal posts, debris fences, gantry detail. Also keep low, medium and high cost-neutral: move the new kerb, LED, facade and crew shader work behind ULTRA and add a GPU-timer budget check. Pin capture positions so before and after frames match (02 moved from 238 m to 134 m, 05 from 1434 m to 1341 m)."
  ]
}
