# FH6 reference pass r4: hero rear / chase view (agentQ)

Scope: the chase-camera view of the player's festival road car, the most-seen
frame. Everything is behind `model.festival` (festival form) or lives in
festival modules. Circuit bodies keep their locked fingerprints
(`tests/festival-vehicle-form.test.ts` passes unchanged). Measurements are read
from the 1920 x 1080 references and scaled by the 330 mm plate. They are
approximate.

| Ref | Measured observation                                                                                                                                                            | What was implemented (file / symbol)                                                                                                                                                                                                                                                                                                  | Remaining gap                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 013 | Rear 3/4: the black lower ~40 % of the rear face (diffuser, 5-7 tall carbon fins ~0.15 m deep); a ducktail lip over thin lamps; haunch ~0.1 m outboard of the cabin             | Taller supercar fins (up to 0.15 m, 0.2 m long; `addDiffuserStrakes`); undercut ducktail 7.5 cm (`FestivalBodyModel` `duck`, `back` keys); haunch +6 cm (`STYLE_FORMS.supercar.haunch`)                                                                                                                                               | Separate floating wing over the ducktail not modelled; tips stay round                       |
| 018 | Ducktail overhanging a full-width bar with hooked ends; big black louvred corner panels; plate on a body-colour bumper above a quad-tip diffuser; strong plan taper of the tail | Rear slot removed on festival supercars/GTs (`festivalFasciaOpenings` rear); bumper rises to 0.8 of the lamp height (`festivalRearBumper`); louvred corner panels over the outer 42 % (`addTailCornerPanels`); plate high on the bumper (`platePlacement`); tail face 0.72 of the half width, 0.15 m sweep (`tailWidth`, `tailCurve`) | Hook is still a flat band; corner panels are rectangular, not the reference's tapered blades |
| 024 | Time-attack tail with a tall wing on swan necks; round twin lamps                                                                                                               | No change (round lamps and wings kept)                                                                                                                                                                                                                                                                                                | Not addressed                                                                                |
| 035 | Straight rear: rear face H/W ~0.58; light bar ~12 mm deep with hooks; plate centred on the bumper; corner louvres                                                               | 3D light pipe 12 mm proud with lit top/bottom faces (`addWrapTailLamps`, `ledge`); corner louvres; plate on the bumper                                                                                                                                                                                                                | Bar is 14 mm tall; the reference's has a thin upper and a thicker lower element              |
| 044 | Coupe rear at dusk: lamps glowing as continuous shapes, not points                                                                                                              | Night/brake glow is one bar-shaped halo along the light bar plus two end glows (`lampHaloSites` `stretch`, super-Gaussian in `lampHaloMaterial`)                                                                                                                                                                                      | Glow does not follow the hook shape                                                          |
| 053 | Rounded 90s coupe tail: tail face wraps round in plan, smoked band with lamps at its ends, lit plate                                                                            | Saloon/GT tails rounder (`tailCurve` 0.1-0.13, saloon `tailWidth` 0.82)                                                                                                                                                                                                                                                               | No smoked end lamps per car (sheet lamps decide)                                             |
| 059 | Saloon rear 3/4: rounded boot corners, round lamps                                                                                                                              | Saloon haunch +2.5 cm, rounder tail plan                                                                                                                                                                                                                                                                                              | No round-lamp saloon in the festival road set                                                |
| 069 | Ring tail lamps glowing red at night; carbon diffuser                                                                                                                           | Round lamps keep agent G's ring units; night halos unchanged for round lamps                                                                                                                                                                                                                                                          | No ring-lamp 3D internals                                                                    |
| 070 | Several cars from behind in a convoy: plates and lamps read at 20-40 m                                                                                                          | Meet cars now carry front/rear plates (mid LOD) and lamp lenses that light at night (`MeetCars` `lamp`/`plate` classes, `setNight`)                                                                                                                                                                                                   | One plate text per meet model                                                                |
| 015 | Supercar rear 3/4: deep diffuser under a high tail, wide haunches                                                                                                               | Fins, haunch, taper (as 013)                                                                                                                                                                                                                                                                                                          | Same as 013                                                                                  |
| 007 | Time-attack R32 tail: round quad lamps, big wing, diffuser                                                                                                                      | Not changed (round lamps)                                                                                                                                                                                                                                                                                                             | Not addressed                                                                                |

## Changes

- `festival-form.ts`: supercar `tailWidth` 0.82 to 0.72, `tailWrap` 0.42 to
  0.5, `tailCurve` 0.09 to 0.15, `haunch` 0.035 to 0.06; GT 0.84 to 0.76,
  0.4 to 0.46, 0.08 to 0.13, 0.02 to 0.045; roadster and saloon rounder tails
  with more haunch. The ducktail kick is 7.5 cm (was 5 cm) with an undercut
  lip.
- `festival-detail.ts`: no full-width rear slot on festival supercars and
  GTs; the bumper rises to 0.8 of the lamp height; the strip lamp is a 3D
  light pipe.
- `festival-hardware.ts`: taller, longer supercar fins; wider corner panels.
- `festival-car-finish.ts`: plate high on the bumper for supercars and GTs;
  bar-shaped light-bar glow.
- `meet-cars.ts`, `traffic-cars.ts`: meet plates and night lamps.

## Cost

Studio near LOD, same camera (triangles / draws incl. ground and sky):
eh3 78.0k / 61 before, 73.3k / 61 after (removing the rear slot's tunnel
saves more than the new parts add). sc7 72.2k / 60, lx12 75.1k / 62, rs5
74.5k / 61 after. Meet cars: +1 draw per model and LOD (lamps), +1 per model
on the mid LOD (plates).

## Not done

- No rotational wheel blur on the festival's procedural wheels
  (`studio/wheel-blur.ts` is bound to the supplied player model's meshes).
- Ride height and track are unchanged.
- The rear corners of rs5/rh3/rm8 only get the plan and haunch change.

## Evidence

In-game Medium chase at spawn, before (integration head) and after:
`/tmp/claude-0/-home-user-Experiment-3/6225d78a-1b23-58c0-86f8-76bad1718c62/scratchpad/agentQ/before-after-chase.jpg`
(top: day, bottom: night; left before, right after). Studio before/after:
`.../scratchpad/agentQ/before-sheet.jpg`, `.../scratchpad/agentQ/s1-sheet.jpg`.
