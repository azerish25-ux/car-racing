# FH6 reference pass R4 — season particles, snow corridor and fairground (lead)

Festival only, visual only (no colliders). Modules: `open-world/season-particles.ts`,
`open-world/snow-walls.ts`, `open-world/festival-attractions.ts`; contracts in
`tests/festival-r4-extras.test.ts`.

| Ref | Measured observation | What was implemented (file / symbol) | Remaining gap |
| --- | --- | --- | --- |
| 015 | Petals drifting in the air under blossoms, ~2–3 cm, pale pink, slow flutter. | `SeasonParticles`: spring petals in a 68 × 22 × 68 m camera-wrapped volume, 0.6–1.0 m/s fall, per-flake spin and sway, one instanced draw (1,400 MEDIUM / 2,600 HIGH / 3,600 ULTRA, none on LOW). | Uniform density everywhere in spring, not concentrated under cherry crowns. |
| 027 | Autumn temple lane, leaves in the air and on the gravel. | Autumn maple/broadleaf leaves 4–7 cm, scarlet/orange/yellow, 1.0–1.6 m/s with tumbling. | Leaves do not settle or pile on the ground (agent D's ground litter covers that). |
| 064 | Winter village, light snowfall over the valley. | Winter snowflakes 0.8–1.6 cm, 0.7–1.2 m/s, gentle sway. | No heavy-snow weather state; flakes are unlit sprites lit by a sun/sky estimate. |
| 070 | Snow corridor: ploughed walls several metres tall either side of a mountain road, horizontal strata, blue-white. | `SnowWalls`: winter-only plough walls 2.5–7 m tall on mountain/country roads above 260 m where the slope is cut above the shoulder (7.7 km, 20 k triangles, one draw), canvas strata texture as albedo and bump. | Walls stand on the uphill side only; no wall on the open downhill side (no collider there). |
| 072 | Night festival: Ferris wheel with colour LEDs, fireworks bursts above the site. | `FestivalAttractions`: 46 m wheel on a 26.5 m axle beside the Kestrel hub (45 m from roads, 30 m from buildings), 36 level gondolas, 144 rim LEDs cycling colours at night; 10-shell GPU fireworks (140 sparks each) at 150–260 m, night only. | Fireworks cast no light on the ground; no smoke trails. |
| 079 | Ferris wheel by the drag strip by day, white steel A-frame. | Same wheel, turning one revolution per 9 min. | Gondolas are simple cylinders. |
