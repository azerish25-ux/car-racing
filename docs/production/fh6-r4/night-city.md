# FH6 reference pass R4: night city glow

Worker: agentR. Festival only. Colours are sRGB hex of 13 x 13 patches of the
1920 x 1080 references (linear in brackets, Y = linear luminance); game
captures are 1280 x 720, Medium, software GL.

Modules:

- `src/rendering/open-world/night-glow.ts` (new): `NightGlow`, `NIGHT_GLOW`.
  Every lit face of the signage is baked into one top-down half-float map
  over the city (1874 x 638 at 1 m, 9.6 MB, baked in ~0.2 s at load): rgb =
  the light a white wall reflects (sources summed with a 2.4 m core and a
  smooth cut at their reach, saturation x1.5, soft-saturated), alpha = the
  light-weighted top of the sources (the wash fades 0.45/m above it). The
  facade material and the street layers (town/asphalt/major, paint, glyphs,
  anti-skid; paving) add `albedo x wash` at night (asphalt x0.75 plus a
  glossy share 0.30 dry / 0.60 wet, because dark asphalt reads through its
  sheen; paving x0.5 plus 0.06 / 0.35), sampled 0.9 m out along the
  surface normal. The wash top is weighted by the square of each face's
  contribution, so the dominant nearby face sets how high it reaches. No draw calls; one texture fetch per fragment (skipped by day).
  Real lights: 2 / 3 / 4 coloured point lights (Medium / High / Ultra, none
  on Low or by day; 16 cd per unit of source power, 16 m range) follow the
  strongest faces within 42 m of the camera, fading before they move; the
  count is fixed per tier and lighting state (no recompiles).
- `src/rendering/open-world/festival-signage.ts`: `GlowSource`,
  `FestivalSignage.glows` (projecting signs, tenant columns, flat boards in
  their tenant colour, LED screens, wall banners, vending machines,
  lanterns, stand signs, store and konbini fronts); `night-glow.ts` adds a
  warm strip along every lit city ground floor. Denser fronts: projecting
  signs one per ~2.2 m of block frontage (4-7, was 3-6), flat lit boards on
  three blocks in four (was two in three), 2-4 per block (was 2-3).
- `src/rendering/open-world/facade-richness.ts`: city rooms lit at night 54 %
  punched / 64 % ribbon+curtain (was 42 / 55 %); shop interiors x1.7 at night.
  `buildings.ts`: generic city shopfront panes 2.4-4.2 (was 1.6-3.0).
- Bloom: `LensBloomPass.threshold` / `knee` (shared, opt-in; default
  `LENS_BLOOM`, circuits never set them); the festival lowers the threshold
  by 1.0 x night (3.6 -> 2.6 at night, 2.8 at dusk) and the knee by 0.3,
  so neon tubes (scene ~6.7) and screens halo while backlit boxes (~2.4)
  add only ~14 % of their light to the bloom and keep their lettering.

## Ledger

| Ref | Measured observation                                                                                                                                                                                                                                                                 | What was implemented (file / symbol)                                                                                                                                                                                                                                                                                                                                                         | Remaining gap                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 069 | Neon canyon race: signs stacked on every storey both sides, large lit boards at the top; facade between signs #877464 (0.24/0.18/0.13) near boards, #2f1e22 (Y 0.017) in the gaps; road pink-grey #3a2b32-#503035 (Y 0.03-0.04, R/B 1.3-2.2); car flanks take pink/white sign light. | `NightGlow` wash on facades/road/pavement in the sign colours; denser projecting signs and boards; sign point lights tint the cars; bloom threshold at night. Spawn street, night: road #0b0a09 (Y 0.003) -> #443c34 (Y 0.048) ahead of the car, right lane #171b22 (Y 0.011); left wall #674c33 -> #75563b (0.18/0.10/0.04); right wall #202630 (Y 0.019, blue-black) -> #615248 (Y 0.092). | Our canyon is still sparser (blocks of 6-9 storeys with signs on the lower 3-5); no big rooftop LED walls facing down the street; our grade is neutral, not 069's magenta. |
| 014 | Night shopping street: warm floor light from shops on the paving #f3b455 (0.90/0.46/0.09) in the pools, #836046 between; walls lit by signs #897363 (0.25/0.17/0.13), shade side #3f322c; neon in paint.                                                                             | Shop-front strip in the wash + existing town-life pools; brighter shop interiors; walls take the sign colour.                                                                                                                                                                                                                                                                                | Paving pools are less saturated amber than 014's sodium-like light.                                                                                                        |
| 066 | Wet neon: road #364459 (Y 0.057) with white-blown streaks (0.95); paint mirrors the signs (#cfbcd3).                                                                                                                                                                                 | Wet sheen share 0.45 of the wash on the street; SSR on wet asphalt (Medium wet, High+) already reflects the signs; lower bloom threshold for the halos.                                                                                                                                                                                                                                      | No rain-drop-on-paint streaks; streaks come only from SSR.                                                                                                                 |
| 068 | Close-up: glass and paint mirror neon (#f59480 0.92/0.30/0.22 red wall, #802829).                                                                                                                                                                                                    | Facades near signs now carry the sign colour, so the Medium car probe and High SSR reflect coloured walls, not black.                                                                                                                                                                                                                                                                        | No DOF/bokeh in game.                                                                                                                                                      |
| 086 | Night city: walls lit grey #595353 (Y 0.08-0.09) above lit shopfronts; big orange and white boards light the pavement; road under headlights 0.6, otherwise #383c43.                                                                                                                 | Wash brings walls between signs to Y 0.07-0.11 (spawn night/dusk, warm or pink-violet); boards and screens are sources (16-20 m reach).                                                                                                                                                                                                                                                      | No street trees in the canyon; no large ground-floor board fronts.                                                                                                         |
| 067 | Sodium expressway: road #b06c44 (0.44/0.15/0.06, Y 0.2) under orange lamps.                                                                                                                                                                                                          | Not addressed (expressway lamps are street-light pools, not signage).                                                                                                                                                                                                                                                                                                                        | Sodium lamp tint on highways.                                                                                                                                              |
| 071 | Blue-hour overpass: walls #3a5671 (Y 0.09), road #526fa0 sky-lit, lit windows.                                                                                                                                                                                                       | More lit rooms at night/dusk; wash at 0.8 at dusk.                                                                                                                                                                                                                                                                                                                                           | Our dusk road is darker and the scene has no rail bridge.                                                                                                                  |
| 053 | Dusk city drift: road #3e3231 (Y 0.036), lit signs in haze, street trees.                                                                                                                                                                                                            | Dusk wash (0.8) and lit signs; bloom threshold 2.8 at dusk.                                                                                                                                                                                                                                                                                                                                  | No street trees; no haze glow around distant signs.                                                                                                                        |

## Evidence

Captures (1280 x 720, Medium, software GL, chase view at the spawn unless
noted). Before = integration head (`scratchpad/int2/spawn-night.png`); after =
`scratchpad/agentR/c3/` (`spawn-night`, `spawn-night-rain`, `spawn-dusk`,
`canyon-night`); first iteration `scratchpad/agentR/c1`, `c2`. Sheets:
`scratchpad/agentR/sheet-night-city.jpg` (069 / 014 / 086 vs night / dusk /
rain) and `sheet-before-after.jpg`.

| View                                                   | Draws / triangles (after)                       | Visual change                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Spawn, night                                           | 592 / 3,440,402 (c2 iteration: 579 / 3,374,002) | Walls between signs warm/pink-lit instead of blue-black; road sheen under the signs; denser sign stack down the street.     |
| Spawn, night rain                                      | 604 / 3,473,868                                 | Wet road mirrors the neon (SSR) over a coloured sheen; pavement takes pink/amber light.                                     |
| Spawn, dusk                                            | 599 / 3,758,886                                 | Violet dome over a sign-lit street; walls pink-violet (#5f4551).                                                            |
| Inspection (556, 3.2, -2618) -> (566, 9, -2540), night | 637 / 2,600,768                                 | Camera landed in a lot behind a shop, not down the canyon (no capture left to re-aim); shows the lit store faces and walls. |

Cost: the wash adds no meshes or draw calls (one RGBA16F texture, one fetch
per facade/street fragment, a uniform branch by day). The denser signage
adds 214 projecting signs and 155 boards in the existing merged chunks:
signage 118,722 -> 127,288 triangles world-wide (+8.6 k), same 41 chunk
draws. Medium adds 2 point lights (High 3, Ultra 4) at night. Draw counts
between the before and after spawn frames are not comparable (the car
settled at a different spot under load: 2-4 m and a different heading in
the night/rain runs); none of the added work creates a draw.

Tests: `tests/festival-night-glow.test.ts` (bake colour/falloff/top, hook
chaining, light budget per tier); festival / open-world / solvane /
traffic suites 45 files, 333 tests pass; `tsc --noEmit` and eslint clean.

## Not done / next

- The wash has no direction: a wall facing away from a sign takes its light
  if the sign is within reach (blocks are deeper than most reaches, so it is
  rare); two extra taps (field gradient) would give an N.L term.
- Cars receive only the 2-4 real sign lights (Medium probe captures the lit
  walls; vehicle files are worker Q's and were not touched).
- Upper storeys of tall towers stay dark above their signs; a rooftop LED
  wall per central block and light boxes on poles were not added.
- The map is 9.6 MB of half floats; RGBA8 with a scale would halve it.
- Rain: the pale paving reads bright under the wet sheen (Y 0.2-0.45 near
  shop fronts); the paving wet share (0.35) could drop.
- The canyon inspection view needs re-aiming down Harbour Front.
