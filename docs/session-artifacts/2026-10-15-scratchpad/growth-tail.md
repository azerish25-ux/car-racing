* **GP-R2 Prototype (`gpr2` v1, gp-bike).** A second prototype-class bike: inline-four
  "screamer" (about 216 kW at 16 500 rpm), 157 kg plus rider, a box wing low on a ducted fairing
  with more downforce (front share 70 %) and drag than GP-R1, seamless six-speed. Intended skill:
  expert. Strengths: front-end grip on the brakes and turn-in. Weaknesses: less low-rpm torque
  than the V4, top-end drag. Bands: 0–100 2.4–3.4 s, top 330–360 km/h, 100–0 30–42 m, 1.15–1.55 g.
  Sound: `i4-bike`. Body: full fairing, box wing, under-belly exhaust, lower screen. Events:
  `aurel-gp-prototype-pair`.
* **SS-600 Supersport (`ss600` v1, supersport).** 600 cc four, about 95 kW at 14 500 rpm, 175 kg,
  road-legal racing tyres (μ 1.55), quickshifter. Intended skill: novice–intermediate. Strengths:
  agility, corner speed. Weaknesses: needs revs, low top speed. Bands: 0–100 2.9–4.0 s, top
  250–280 km/h, 100–0 36–48 m, 1.05–1.4 g. Sound: `i4-bike`. Body: full fairing, twin slit lamps,
  short low can, taller screen. Events: `vellamar-supersport-sprint`.
* **NR-900 Naked Roadster (`nr900` v1, road-bike, open world only).** 890 cc triple, about 88 kW,
  182 kg, upright position (no tuck to speak of), road tyres (μ 1.3), lean limited by the pegs.
  Intended skill: novice. Strengths: torque, wheelie-limited launches, easy to place. Weaknesses:
  drag above 200 km/h, modest lean. Bands: 0–100 2.9–4.2 s, top 210–240 km/h, 100–0 36–50 m,
  0.9–1.2 g. Sound: `i3-bike`. Body: no fairing, round lamp, upright bar, trellis frame, stubby
  tail. Events: none (practice, qualifying and time trial only).
* **CR-750 Classic Racer (`cr750` v1, classic-bike).** A 1970s-style 750 cc two-stroke triple,
  about 75 kW in a narrow band, 160 kg, narrow treaded racing tyres (μ 1.25, crown 65 mm), lean
  limited to 0.9 rad, a single front disc and a rear drum (brake-limited, not stoppie-limited),
  twin shocks. Intended skill: intermediate–expert. Strengths: light, a top-end rush. Weaknesses:
  weak brakes, narrow power band, little lean. Bands: 0–100 3.2–4.6 s, top 230–265 km/h, 100–0
  40–56 m, 0.85–1.15 g. Sound: `two-stroke-bike`. Body: round-nosed fairing, double cradle, spoked
  wheels, three expansion chambers, hump seat, twin shocks. Events:
  `aurel-classic-motorcycle-sprint`.

Exteriors: every new car has its own body sheet; the generators gained a 1970s wedge and a 1980s
flat-bottom era for single-seaters (tall airbox and pylon wing; long pods and big low wing), kart
bodywork variants (compact nose, short pods, air cooling, enclosed bumper), a tube-frame buggy with
exposed long-travel arms, open-cockpit prototypes, laced wire wheels and five furniture extras (fan
shroud, dive planes, rally lamp pod, bonnet scoop, fender louvres). Road bikes have body sheets
(`src/rendering/bike-sheet.ts`: fairing, wings, lamps, exhaust, tail, bars, frame, wheels,
shocks); GP-R1 and SBK-1000 keep the original design. Silhouettes are measured, not asserted:
`tests/vehicle-bodies.test.ts` requires every pair of four-wheel bodies to differ by more than
0.075 m RMS in side and plan outline (closest pair TC-1/RR-4 at 0.080; TC-1/TC-2 of the first
catalogue is 0.088) and `tests/bike-bodies.test.ts` every pair of road bikes by more than 0.02 m
(closest GP-R1/SBK-1000 at 0.032). Ten new sound families (V6 NA and turbo, turbo five, straight-six
turbo, boxer-four turbo, flat-12, twin-turbo V12, fuel cell, bike triple, two-stroke triple);
every registered machine names its family explicitly (`explicitSoundFamily`).

Known limits (catalogue growth): all the limits listed for the first catalogue apply (no authored
assets, damage geometry or handling sign-off; Formula cockpit socket; per-car setup on the shared
screen). Further: the XF-2 fan is a constant suction with a seal fade — no fan power draw from the
main engine and no fan voice; FX-26 deploys its 350 kW to any speed (no deployment taper), so its
peak top speed is reached while the store lasts; electric and fuel-cell machines (RX-E, XE-1,
XH-3) draw energy from the fuel-mass proxy, and XH-3's stack is a static power map; historic tyres
differ from modern ones only by family grip and loose-surface share; BG-2 and RP-6 are travel-limited
like DX-8; DK-100 carries a nominal reverse ratio the validator requires (a direct-drive kart has
none) and brakes on the rear axle through a fixed bias outside the setup screen; the lateral-g
ramp of the laboratory ends at 72 % steering input, so FX-26, XE-1 and XF-2 report lower bounds;
several cars sit within 1.6–3 % of a band floor (braking: RR-4, RM-8, LX-12, GS-6M, RS-5, GT-6R,
SP-71; lateral: GT-6R, SP-71, XT-1); FE-4 tops out at 208 km/h, 2 km/h under its brief's 210–230 km/h (inside its
200–235 band), GT-6R at 291 km/h against its brief's 280–290; in four-car AI practice RS-5 and RM-8
still touch occasionally on Vellamar, and loose-surface machines can still beach in a gravel trap
as DX-8 and GS-4 already did; bike art shares one rider and rider pose, CR-750's twin shocks are
static; the naked roadster has no festival region to ride in yet.
