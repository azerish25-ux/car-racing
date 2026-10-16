# MOTOBOUND — MotoGP 100-reference graphics revision R1

## What was actually changed

This revision reviews all 100 supplied numbered images independently and applies their relevant visual principles to the existing Three.js motorcycle renderer. It does **not** certify MotoGP 26 / PS5 visual parity, all 100 scenes implemented, perfect geometry, or release-ready performance. Several images are repeated moments, editorial captions, career scenes, training/dirt bikes or environment references, rather than 100 separate GP features.

**B — Bodywork:** an original Blender-authored GP-R1 cowl, recessed intake, layered swept wings, tank, lower fairing, contoured tail and rear fins. Five material batches; high and decimated medium meshes. GP-R2 retains its own box-wing design and receives bounded profile smoothing rather than being replaced with the GP-R1 shell. Existing vehicle dimensions and wheel/suspension ownership are retained.

**M — Finishes and identity:** filtered metre-scale carbon shading, deterministic rubber/leather/seat/brushed-metal normal and roughness maps, restrained paint metalness, original MOTOBOUND flank graphics and numbered plates. No reference photo is pasted onto the model; no real team livery, logos or human likenesses are reproduced.

**W — Mechanical detail:** high-detail vented brake rotors, rounded spokes/controls, carbon rear hugger attached to the swingarm rather than the removable wheel, fork fittings, hoses and cockpit hardware. Existing wheel rotation, suspension and pit-service articulation remain authoritative.

**R — Rider:** smoothly sampled torso contours, garment panels, zipper/seams, leather microstructure, shaped glove palms/fingers, rounded boots, armour/sliders, conformal helmet visor gasket, helmet fittings and a shaped spoiler. Existing analytic IK, hang-off, tuck, braking and separated-rider animation are retained; this is not a new scanned human or a new motion-capture system.

**C — Cockpit:** a readable, original display with gear, km/h, RPM and shift lamps from the actual interpolated simulation snapshot. Correct reverse/neutral/forward indexing; quantised redraws and a dynamic-texture tag preserve paused/replayed and lower-quality operation. Includes an actual display enclosure rather than a blank box.

**D — Dampness:** explicitly tags bike and rider materials for the existing recorded-weather shader, including distinct rubber/leather response. Does not replace the existing road-water or spray simulation. Off-track dampness is the existing rain/mean-track-water approximation, not newly simulated water retention.

**L — Rendering cost:** rigid details batch by material and shadow state within articulation boundaries; hands, wheels, fork, suspension, rider bones and the live display remain separate. Bounded shell LODs and resource disposal are tested. More mesh detail is not a claim of higher frame rate.

## Image-by-image accounting

Source: the user-supplied `MotoGP26_PS5_100_Reference_Images(1).zip`, corresponding to the repository's `reference/MotoGP26/MotoGP26_PS5_100_Reference_Images.zip`. The working review also records the filename and SHA-256 of every image. The row identifies **which implemented components use that reference**, not a claim that the complete pictured scene or every observation has been recreated.

`Retained/context` means reviewed but no corresponding new track, camera, UI, career or off-road feature is claimed in R1. Pose, world lighting, scenery and environmental details mentioned alongside applied components also remain subject to those limits.

| Reference | Individual observation | Applied R1 components / scope |
|---|---|---|
| REF 001 | Front pack: narrow nose intake, thin wing planes, windscreen, forks and strong directional grounding. | B, M, W |
| REF 002 | Corner close-up: inside knee, low torso, rounded slick tire and glossy paint against matte suit. | M, R, W |
| REF 003 | Side-by-side exit: rider shoulder seams, wheel hardware and rubber trajectory marks. | R, W |
| REF 004 | High three-quarter apex: unbroken screen/cowl silhouette and worn red/white curb detail. | B |
| REF 005 | Dirt training bike: extended suspension and upright stance; retain road-bike proportions in GP mode. | Retained/context |
| REF 006 | Pit straight: compact tuck, raised tail, glass pit facade and separated bike silhouettes. | B, R |
| REF 007 | Indoor training: roof occlusion, terracotta surface and repeating barrier depth. | Retained/context |
| REF 008 | Telephoto racing: sharp mid-distance subject with defocused foreground, appropriate for replays only. | Retained/context |
| REF 009 | Indoor mini bikes: columns, cast shadows and exposed mechanical finishes. | Retained/context |
| REF 010 | Rain pack: cool diffuse sky, darker asphalt, subdued paint and localized wet sheen. | D |
| REF 011 | Rider identity menu: legible restrained overlay and perforated leather; no likeness copying. | R |
| REF 012 | Garage setup: clear settings hierarchy over detailed side-on bike and workshop shadows. | M |
| REF 013 | Split-screen HUD: compact timing tower, peripheral instruments, unobstructed driving sightline. | Retained/context |
| REF 014 | Start grid chase: grid paint, start gantry, grounded tires and clear rear silhouette. | Retained/context |
| REF 015 | Deep lean at ribbed curb: knee position, shoulder offset and tire crown contact. | R, W |
| REF 016 | Stationary grid: boot-down rider stance and readable entrant colors. | M, R |
| REF 017 | Wet cockpit: legible dash, fork tops, cables and a clear forward sightline. | C, D |
| REF 018 | Wet side profile: fairing/tank/seat transitions, tail clearance and matte mechanical cavities. | B, M |
| REF 019 | Dry lean front view: layered winglets, tucked head and long directional shadow. | B, R |
| REF 020 | Front battle: rounded tire contact and controlled paint highlights without white clipping. | M, W |
| REF 021 | Small-class pair: slim front silhouettes, fork spacing and restrained white surfaces. | B, M |
| REF 022 | Nose close-up: deep inlet opening, layered aero and glove/lever contact. | B, C, R |
| REF 023 | Indoor mini bike: structured roof shadows and patchy, directional floor response. | Retained/context |
| REF 024 | Dirt corner: radiator/exhaust exposure, fabric barriers and different suspension silhouette. | Retained/context |
| REF 025 | Mini-bike curb: chipped/ribbed curb paint, contrasting tire and broad white material. | M |
| REF 026 | Dirt pack: spokes, chain, swingarm, extended foot and localized dust; not a GP dust effect. | Retained/context |
| REF 027 | Extreme lean: low inside elbow without clipping fairing; clear tire crown contact. | R, W |
| REF 028 | Road sport bike: clear bubble screen and curved red shell; GP bike must not gain road headlights. | B, M |
| REF 029 | Road-bike pack: narrow screen highlight and opaque visor contrast. | B, M, R |
| REF 030 | High-angle GP corner: off-center torso and overlapping rubber lines at the racing trajectory. | R |
| REF 031 | Top-down lean: width of racing-line rubber and red/white curb wear. | Retained/context |
| REF 032 | Low front three-quarter: inlet cavity depth and coherent screen/fairing reflection flow. | B, M |
| REF 033 | Medium replay view: matte broad runoff colors and believable contact shadows. | Retained/context |
| REF 034 | Rain under bridge: diffuse cool exposure, readable bike under structural shadow. | D |
| REF 035 | Rain rider close-up: elbow protection, suit seams and subdued wheel/paint response. | D, R |
| REF 036 | Rain apex: broken puddle coverage, spray plume and non-uniform asphalt roughness. | D |
| REF 037 | Wet side lean: restrained red paint and correctly scaled grandstand structure. | D, M |
| REF 038 | Wet overhead: compact aero hump, narrow tail and meaningful tire clearance. | B, D, R |
| REF 039 | Sunlit medium shot: low-contrast asphalt aggregate and localized tire grounding. | W |
| REF 040 | Dirt at golden hour: warm key/cool fill separation rather than orange global tint. | Retained/context |
| REF 041 | Dirt overhead: ruts, fork spacing and foot-out pose; keep these out of GP handling. | Retained/context |
| REF 042 | Training close-up: physically thick tire, dark wheel recesses and textured riding suit. | R, W |
| REF 043 | Indoor shaded corner: visible material differences without crushed black surfaces. | Retained/context |
| REF 044 | Mountain training circuit: distance haze, crisp foreground curb and muted far forest. | Retained/context |
| REF 045 | Mountain mini-bike apex: worn ribbed curb and distinct suit panels. | R |
| REF 046 | Orange sport bike: non-metallic painted shell with clearcoat over dark inner structure. | M |
| REF 047 | Sport-bike low corner: broad fairing curvature and curb scale, not extra GP headlights. | B |
| REF 048 | Wide side-pan trailer: consistent silhouette during camera pan; blur belongs to replay, not blanket live blur. | Retained/context |
| REF 049 | Extreme nose close-up: wing cavities, rounded leading edge and fastener scale. | B |
| REF 050 | On-bike carbon close-up: fine twill, occluded cavity and scale-sensitive texture filtering. | C, M |
| REF 051 | Pre-start hand gesture: hand independence from handlebar when stationary; gesture not inferred physics. | Retained/context |
| REF 052 | Grid front: both boots planted and pelvis/seat relationship at rest. | R |
| REF 053 | Passing field: wheel/readability across distances, avoiding abrupt silhouette changes. | L |
| REF 054 | Front cockpit-facing rider: opaque visor, glove armor and fine suit contrast. | C, R |
| REF 055 | Long straight chase: rear tire/tail proportions and compact high-speed tuck. | B, R |
| REF 056 | PS5 bodywork detail crop: layered aero, fasteners, fork finishes and knee-out shape. | B, M, R |
| REF 057 | Glove detail: separate fingers, knuckle protection, seams and actual grip contact. | C, R |
| REF 058 | Side-pan repeated moment: preserve wheel rotation and replay continuity. | L |
| REF 059 | Side lean close-up: open wheel/seat negative space and visible chain/swingarm. | B, W |
| REF 060 | PS5 fairing detail crop: paint/carbon separation, tire contact and paired bikes. | B, M, W |
| REF 061 | Night rear: rounded rear slick, muffler outlets, boots and controlled low-light silhouette. | B |
| REF 062 | Dusk pit straight: warm facade edge light, cool sky and structured shadow separation. | Retained/context |
| REF 063 | Long-lens trackside: bike stays readable across sun/shadow boundaries. | Retained/context |
| REF 064 | Night front pack: local floodlights and cool specular highlights, no excessive bloom. | Retained/context |
| REF 065 | Cockpit detail: triple clamp, cables, thin screen rim and perforated sleeves. | C, R |
| REF 066 | Trailer typography over riding: editorial hierarchy only; title is not a gameplay feature. | Retained/context |
| REF 067 | Overhead training: lean/tuck silhouette and tire shadow placement. | R, W |
| REF 068 | Indoor riding: localized floor reflection and roof shadow structure. | Retained/context |
| REF 069 | Press room: fabric folds and off-bike staging, outside MotoGP riding graphics scope. | Retained/context |
| REF 070 | Rain/trailer caption: blue-grey distance treatment and dark wet bike separation. | D |
| REF 071 | Rear underside: twin perforated exhaust ends, chain and wide rounded slick. | B, W |
| REF 072 | Night paired lean: cool highlights with preserved black tire contact. | M |
| REF 073 | Tank/gloves macro: recessed vents, sculpted edges, glove contact and fine perforation. | B, R |
| REF 074 | Helmet-offset cockpit: readable fork tops and dashboard with a useful horizon. | C |
| REF 075 | On-bike carbon repeat: stable fine weave and mechanical cavity contrast in motion. | C, M |
| REF 076 | Cockpit left: small control buttons, clamp fasteners, glove wrap and clear road view. | C, R |
| REF 077 | Onboard passing: stable forward view, plausible screen height and dash contrast. | C |
| REF 078 | Pit prep: differentiated glove/suit/visor finishes; no copying real crew faces. | M, R |
| REF 079 | Wide pan near-repeat: stable track texel scale and continuous bike framing. | Retained/context |
| REF 080 | Wide pan near-repeat: same material scale and LOD behavior at shifted position. | L |
| REF 081 | Helmet macro: recessed liner and visor/frame layering; no replication of likeness. | R |
| REF 082 | Distant field: coherent bike LODs, track edges, haze and pack readability. | L |
| REF 083 | Training caption: rear-view tire grounding; no new game mode inferred from title. | W |
| REF 084 | Career desk: paper, furniture and casual character staging outside GP riding scope. | Retained/context |
| REF 085 | Sunlit lean: restrained asphalt grain, tire shoulder highlights and crisp contact shadow. | W |
| REF 086 | Night side close-up: controlled white clearcoat highlights over saturated paint. | M |
| REF 087 | Rear onboard: split tail fins, hollow titanium exhaust outlet and tire shoulder profile. | B, W |
| REF 088 | Cockpit repeat: dash/shift lights remain below useful road sightline. | C |
| REF 089 | Chase straight: aerotail silhouette, neutral shading and rear tire width. | B |
| REF 090 | Chase field: distant silhouettes, track paint scale and consistent visual density. | L |
| REF 091 | Dirt side: spoke wheel, exhaust, boots and fork finish; retain distinct GP wheel design. | Retained/context |
| REF 092 | Mini-bike front pack: compact silhouette and foreground/background depth separation. | Retained/context |
| REF 093 | PS5 dirt detail crop: fork/rider/suspension materials; no dirt geometry transplanted to GP. | Retained/context |
| REF 094 | Distant field near-repeat: readable changing detail and restrained background haze. | L |
| REF 095 | Repeated cockpit macro: windscreen edge, triple-clamp metal and leather microstructure. | C, R |
| REF 096 | PS5 wet detail crop: wet tire, controlled paint response and rain exposure. | D, M |
| REF 097 | Career hub title: stairs/facade scene and overlay hierarchy; no career rebuild claimed. | Retained/context |
| REF 098 | Deep elbow-down apex: knee/elbow relationship, continuous fairing and worn curb. | B, R |
| REF 099 | Repeated side pan: coherent silhouettes and tire phase across replay positions. | L |
| REF 100 | Dirt side repeat: component finish/scale observations only; not GP suspension behavior. | Retained/context |

## Reproduce and inspect

Use Blender 5.2.2 LTS, or its official `bpy==5.2.2` Python 3.13 module:

```sh
blender -b --python tools/motogp/build_gp_bodywork.py -- --out /tmp/motobound-gp
# Equivalent inside a Python 3.13 environment with bpy==5.2.2:
python tools/motogp/build_gp_bodywork.py -- --out /tmp/motobound-gp
cp /tmp/motobound-gp/gp-bodywork.mesh.json src/rendering/assets/gp-bodywork.mesh.json
npm ci
npm run check
npx playwright test e2e/41-motogp-reference.spec.ts
```

The runtime consumes the baked indexed mesh synchronously; Blender is not a game dependency. The editable `.blend` and `.glb` are authoring outputs, not hidden substitutes for the running game. Changes to authoring must regenerate the mesh and pass the same assertions before delivery.

`tests/motogp-reference.test.ts` checks finite geometry, normals/UVs/indices, bounded interpolation, real unit/gear conversions, dynamic texture identity, deterministic maps, weather-hook composition, rigid batching and all three bike LOD poses through suspension/steering/wheel-service states. Existing bike and pit-service tests remain unchanged.

`e2e/41-motogp-reference.spec.ts` uses the production BikeModel on real WebGL2: GP-R1 high/mid/far, GP-R2 high, wet response and dry restoration. It retains PNGs and observed draw/triangle/weather metrics, checks GPU and console errors, and checks deterministic dry restoration. It is a model fixture, not a frame-rate or complete-game acceptance benchmark.

`e2e/fixtures/motogp-race-review.ts` additionally captures the actual simulation and full RacingRenderer in clear/rain conditions, with two GP bikes and unchanged snapshot checks. Offline reviews can feed identical local asset bytes using the fixture's URL resolver; that resolver is never installed by the game.

## Acceptance boundaries and remaining art work

All 100 images have been reviewed; not every pictured feature is newly implemented. Track geometry, grandstands, paddock interiors, menu layouts, career cinematics, custom weather lighting rigs and off-road scenes are not rebuilt by this revision. Existing production systems are retained. A source-code assertion or reference count is not visual-quality certification.

The rider remains procedural, body proportions and all close-up camera/lean combinations still need a human art review, and this is not photogrammetry. Full-field desktop/mobile hardware frame-time, VRAM, thermal behaviour, long-session stability and all hosted CI release gates remain separate acceptance requirements. Software-rendered fixtures cannot certify physical GPU performance.
