# Solvane — 100-reference Blender continuation

Runtime checkpoint: `2cacf1d1709ac0e58328a06d1ffcb0790b46d033`. This continues the [original individual ledger](HORIZON_REFERENCE_IMPLEMENTATION.md); it does not relabel that earlier pass or its test results.

All 100 supplied images were rechecked against the archive manifest and original ledger: IDs 001–100 exactly once, 100 distinct SHA-256 values, correct byte lengths, filenames and attributed source URLs. In this resumed review each numbered image was visually revisited on labelled contact sheets; the original ledger retains the earlier individual observations.

**39 references inform additional changes in this continuation; 55 retain the previous implementation; 6 are promotional/hardware context only.** Shared change codes mean a single implementation was informed by multiple references, not 39 independent new features. “Retained” is not a new completion claim, and no row asserts commercial-image equivalence.

The native file's `reference_ids` are broad authoring tags, not proof of a literal object match. This narrower observation-based table is the claimed attribution. Reference 059 is retained as a sunlit sedan/material reference; this continuation does not infer a new garage or frontage requirement from it.

The supplied archive labels its images official FH6 media, not 100 independently verified PS5 gameplay captures. No source screenshot, licensed logo, proprietary model or third-party font is embedded in the new native library.

## Inspectable changes

| Code | Implementation | Scope and boundary |
| --- | --- | --- |
| **AERO** | [EH-3 rear aero](../../src/rendering/open-world/solvane-details.ts) | Original Blender main plane, separate visual air-brake flap, shaped endplates and supports; an original assembly, not the pictured licensed car. |
| **FRONT** | [Shop frontage](../../src/rendering/open-world/solvane-details.ts) | Blender jambs, lintels, recessed joinery, transoms and small fixtures, with near/far geometry on existing Solvane walls. No depicted building or brand is copied. |
| **BALCONY** | [Balcony modules](../../authoring/solvane/build_detail_kit.py) | Projecting sill, corbels, forged rails and physically mounted finials. No traversable interiors are added. |
| **LIGHT** | [Street illumination](../../src/rendering/open-world/street-light-pools.ts) | Four/six/eight bounded warm light pools for Medium/High/Ultra; Low retains emissive fixtures. Unshadowed pools, not ray-traced global illumination. |
| **GATE** | [Cloth checkpoints](../../src/rendering/open-world/horizon-guidance.ts) | Original near/far cloth checkpoint flags stay outside the driving corridor and retain event colour after a quality change. No new drag-tree/stadium mode. |
| **BRAKE** | [Predictive route cues](../../src/rendering/open-world/braking-envelope.ts) | Backward braking-speed envelope anticipates bends and tightens with wetness. It is advisory, not a vehicle-specific optimum inferred from a still. |
| **CAMERA** | [Camera wall clearance](../../src/rendering/open-world/camera-clearance.ts) | Chase boom checks existing oriented structure footprints and vertical bounds, including its damped final position. |
| **SKILL** | [Clean-driving skills](../../src/simulation/open-world/skill-chain.ts) | Front-to-back non-contact traffic passes and sustained left/right drift transitions produce bounded bonuses. Original gameplay rules, not a recovered commercial score algorithm. |
| **BOAT** | [Coastal launches](../../authoring/solvane/build_detail_kit.py) | Three scenery launches receive curved hulls, cabin, rigging, rails, fenders, cargo and near/far geometry. Existing locations retained; no boat-driving mode. |

## Image-by-image continuation

| Image | Revisited visible cue | This continuation |
| --- | --- | --- |
| 001 | Three time-attack cars have broad sculpted fenders and separately layered splitters, canards and wing endplates. | AERO |
| 002 | The pink car has dark hollow intake depth, splitter endplates and visible wheel-arch fasteners. | Retained |
| 003 | The carbon car separates a raised bonnet vent and scoop from the bonnet; surface sheen varies under winter lighting. | Retained |
| 004 | Round projector openings sit in a shaped front fascia, with polished rim lips contrasting with black wheel centres. | Retained |
| 005 | The rear view exposes diffuser channels, wing support hardware and deep wheel barrels. | AERO |
| 006 | The miniature truck exposes multi-element headlamps, bucket seats, harnesses and roll structure through the windscreen. | Retained |
| 007 | Twin round taillight units show concentric red rings above a deep carbon diffuser and large wing supports. | AERO |
| 008 | A white coupe has several fender/bonnet louvres and stepped carbon canards, with bright highlights on its painted curves. | Retained |
| 009 | The front bumper shows separate intake ducts, radiator fins, a tow strap and hood pins. | Retained |
| 010 | The red prototype has a rounded canopy, separate fender crowns and a low central nose. | Retained |
| 011 | White LED guides and bright projectors are separate from black lamp housings; grilles have visible surrounding lips. | Retained |
| 012 | The classic convertible has wire wheels, thin chrome trim, circular taillights and dark exhaust bores. | Retained |
| 013 | The hypercar rear is layered: red body bridge, black mesh, central exhaust and tall diffuser dividers. | AERO |
| 014 | Clear-coated red panels reflect long colored city lights; black grilles reveal real depth and a large yellow caliper. | Retained |
| 015 | The rear lights are narrow segmented red blades and the rear aero has visible thickness. | AERO |
| 016 | The sedan and hypercar have distinctly different bonnet, roof and track proportions. | Retained |
| 017 | The lineup spans classic, prototype, hypercar and sedan silhouettes; all show soft paint highlights rather than flat color. | Retained |
| 018 | The rear coupe has an uninterrupted red light guide above horizontal cooling slats and four open exhaust tips. | Retained |
| 019 | The car has a black roof, a swept lamp signature, physical bonnet vent openings and long sculpted shoulder highlights. | Retained |
| 020 | The low coupe and tall SUV demonstrate distinct clearance and bumper structures; both have layered lamps and intake mesh. | Retained |
| 021 | The SUV front has individual rectangular LED elements, horizontal grille bars and a ribbed lower skid plate. | Retained |
| 022 | The SUV rear shows broad black lower cladding, small reverse-light bands, a rear wiper and dirt on lower surfaces. | Retained |
| 023 | The close side-glass view reveals a steering wheel and gauges through reflective glazing with rubber window seals. | Retained |
| 024 | The coupe rear shows bolted overfenders, metal wing braces and black hollow exhaust outlets. | AERO |
| 025 | The parked lineup uses diverse rooflines, proportions, wheels and paint colors with readable interior volume. | Retained |
| 026 | Temple approach: layered green broadleaf crowns, rough gravel foreground, low warm plaster walls with dark tiled caps, shaded planting strip. | Retained |
| 027 | Same temple approach in autumn with orange/red foliage, low warm sunlight and deep cast shadows. | Retained |
| 028 | Rural night gathering: warm airborne lanterns above white tensile tents, pond reflection and cool forest silhouettes. | LIGHT |
| 029 | Golden-hour panorama: multiple forest ridges receding in mist, conifer silhouettes, red flowering shrubs in foreground. | Retained |
| 030 | Dense commercial street: repeated glazing, floor bands, vertical shop signage, varied rooftops, footpaths and bollards. | FRONT, BALCONY, LIGHT, CAMERA |
| 031 | Promotional title card over lakeside roofs, cherry branches and snowy volcanic horizon. | Context only |
| 032 | SUV on irregular meadow with tall grasses, wildflowers and mixed trees, with distant city/harbour vista. | Retained |
| 033 | Action scene beside stone castle walls and flowering trees; gravel road, varied offroad cars, airborne dust. | Retained |
| 034 | Low sunset beauty shot with rim-lit yellow race car, roadside houses, small festival pennants and foliage. | GATE |
| 035 | Low rear car view emphasizing monumental snowy mountain, unambiguous edge lines and wire roadside barrier. | Retained |
| 036 | Golden reed-covered hills, narrow dirt trail, distant snow peak and layered blue forest ridges. | Retained |
| 037 | Red coupe passing elevated infrastructure: shadowed undercroft, barrier layers and clear white lane marking. | Retained |
| 038 | Close commercial alley: textured walls, awnings, small signs, utility boxes, vending machine, overhead wires, sunlit haze. | FRONT, BALCONY, CAMERA |
| 039 | Urban park: red timber railing, clear blue pond, shrubs, varied trees and articulated distant towers. | Retained |
| 040 | Rear three-quarter drift car with countersteer, tyre smoke, wide rear wing and a clearly framed event-entry banner. | GATE, BRAKE, SKILL |
| 041 | A 39 mph cornering drift displays a top-centre skill multiplier and a separate current drift-zone score and personal best; painted run-off and tyre stacks define the course edge. | SKILL |
| 042 | A 49 mph downhill drift links toward an S-bend; skill-chain 3.1 multiplier, zone 2.0 multiplier, live score and course pennants are simultaneously readable. | GATE, BRAKE, SKILL |
| 043 | Night-time forest switchback has illuminated guardrails, two visible cars and several receding mountain layers. | LIGHT, BRAKE |
| 044 | Two road coupes negotiate a narrow marked hairpin; front car remains on the drivable lane, lit tail lamps separate it from the dusk background. | BRAKE, SKILL |
| 045 | Modern red hatch and yellow sports coupe fill a very close side-by-side shot; dark trim, vents, glass and driver silhouettes are distinct materials. | SKILL |
| 046 | Large oval stadium surrounds many small paddock structures with lake, forest and distant snow peak framing the site. | Retained |
| 047 | The stadium interior contains a tight loop, hairpins, contrasting painted run-off, tent islands and spectator areas. | Retained |
| 048 | Two cars pass between red smoke flares at the road edge; the active driving corridor is still clear. | GATE |
| 049 | Several visibly different drift cars countersteer in front of festival structures and spectators; the lead coupe has clear front tyre steering angle. | SKILL |
| 050 | Repeated switchbacks wind through pink flowering trees; two cars leave a continuous smoke path around the nearest hairpin. | BRAKE, SKILL |
| 051 | A high-clearance racing truck, SUV and buggy traverse flower fields with dirt trails; open terrain extends beyond a narrow road. | Retained |
| 052 | Several rally vehicles descend a wooded dirt trail through warm light and airborne dust. | Retained |
| 053 | A yellow coupe follows other cars through dense city signage with illuminated tail lights and road markings. | LIGHT, SKILL |
| 054 | The foreground is a branded Xbox controller and headset with limited-edition sales copy; a wet festival roadway is only background. | Context only |
| 055 | A labelled summer map shows a dense southern city grid, a coastal road network, dirt spurs, airfield, lake and mountainous switchbacks. | Retained |
| 056 | An ordinary red hatch travels a rural road with low buildings, orange trees, guardrail and overhead services. | FRONT, CAMERA |
| 057 | A very low silver prototype has sculpted channels and precise luminous headlight contours under warm backlight. | Retained |
| 058 | The same silver prototype is parked in a dim industrial shed with flowing red rear-light contours and visibly different metal, rubber and glass response. | Retained |
| 059 | Sunlit white road sedan: reflective painted body and windows contrast dark trim, with roadside vegetation and structures behind it. | Retained |
| 060 | Raised SUV with large deeply treaded tyres is parked in snow among heavily coated conifers and rocks. | Retained |
| 061 | A small purple hatch is parked by a harbour at dusk, with modest wheel size, clear cabin volume and soft violet reflections. | Retained |
| 062 | A graphic lists vehicles in four seasonal reward columns, dates and all-season rewards; no live gameplay or menu controls are shown. | Context only |
| 063 | A red road pickup stands at a construction site with loading equipment and pale gravel; the environment establishes industrial place character. | Retained |
| 064 | Winter village panorama: dark cleared roads contrast snowfields; layered conifers, settlement roofs and pale atmospheric depth. | Retained |
| 065 | PC hardware/feature requirements infographic with minimum/recommended/extreme columns, GPU/CPU/RAM/storage rows. | Context only |
| 066 | Wet night street close-up: bright headlights, coloured shop lights, rain beads and damp reflective asphalt. | LIGHT, BRAKE |
| 067 | Night expressway: warm road lighting, layered overpasses, reflective barriers and multiple cars. | LIGHT, BRAKE |
| 068 | Close rear glass/engine cover showing high-contrast neon reflection and visible mechanical hardware. | Retained |
| 069 | Night commercial street with varied vertical signs, stone-like paving, low rear car composition and glowing lamps. | LIGHT |
| 070 | Snow canyon road: dark wet asphalt, orange centreline, high ploughed snow walls, crisp mountain ridges. | BRAKE |
| 071 | Dense night traffic below rail bridge with green lighting, road stripes and droplets on bodywork. | LIGHT |
| 072 | Large night festival venue: tents, crowd stands, fairground landmark, illuminated course and fireworks. | Retained |
| 073 | Offroad buggies on snow with strong surface relief, exposed suspension, spectator rail and mountain backdrop. | Retained |
| 074 | Top-down view separates carbon-fibre wing weave, painted body panels, glass demister lines and a red tow hook. | AERO |
| 075 | Tuned coupe is parked under stacked highway flyovers at sunset while surrounding cars show motion blur; parking markings provide scale. | Retained |
| 076 | A row of modified cars sits beside tents, speaker arrays, flags and a crowd; foreground rain droplets and reflective finish are visible. | GATE |
| 077 | Six marked staging lanes, start-light towers, central finish gantry and packed spectator edges sit along a long airfield strip. | GATE |
| 078 | Several different coupes launch beside green start trees; wheel blur and clear lane separators communicate acceleration. | Retained |
| 079 | Classic muscle coupe visibly lifts both front wheels at an acceleration strip, with guardrail and spectator background. | Retained |
| 080 | Cars occupy marked bays outside a branded convenience store with vending machines and an organised spectator boundary. | FRONT, CAMERA |
| 081 | Same convenience-store scene is lit by its storefront and headlamps at dusk; people and buildings are otherwise in shadow. | FRONT, LIGHT, CAMERA |
| 082 | Low front view shows a mixed lineup of compact, supercar and modern hatchback body sizes outside the store. | FRONT, CAMERA |
| 083 | Nearly identical lineup is shown at night with illuminated shop canopy, headlamps and pools of light on asphalt. | FRONT, LIGHT, CAMERA |
| 084 | Sales panel advertises early access, expansions and a bonus car with icons; it is not a playable menu. | Context only |
| 085 | Large racing, spec racing, head-to-head, drift, elimination and hide-and-seek tiles each state the objective; player level/XP spans the header. | SKILL |
| 086 | High-performance cars drive between illuminated commercial façades; each car casts headlamp pools while signage reflects on paint. | LIGHT |
| 087 | Fishing boat on shore with curved hull, cabin, mast/rigging, fenders and small beach equipment against forest. | BOAT |
| 088 | A brush-edged poster combines a silver prototype, blossom petals, mountain landscape and Welcome to Japan lettering. | Context only |
| 089 | Two modern road cars show nested LED signatures, separate radiator cores and visible drivers. | Retained |
| 090 | The hypercar front has raised fender lobes, triangular vent volume and layered mesh ahead of a radiator core. | Retained |
| 091 | The blue hatchback combines low black grille, angular segmented headlights, mirror indicators and bright cabin seats. | Retained |
| 092 | The orange classic has large round glass lamps with chrome rims and fine bonnet louvres. | Retained |
| 093 | The blue roadster has upright metallic grille blades, rounded intake rims and separate LED edges. | Retained |
| 094 | The time-attack coupe has raised louvres, exposed side exhaust pipes and numerous aero support rods. | AERO |
| 095 | The older touring car uses amber corner lamps, headlamp reflector sections and a visible large intercooler. | Retained |
| 096 | The white sedan has deep black grille openings, clear headlight covers and thin panel seams. | Retained |
| 097 | The purple hypercar has curved fender shoulders and large side intakes that read as holes with deep sidewalls. | Retained |
| 098 | The blue classic side profile shows wheel lip bolts, visible roll cage, side exhausts and thin metallic window trims. | Retained |
| 099 | The rear three-quarter shows a deep perforated vent, open exhaust tips, large brake discs and glossy carbon side insert. | AERO |
| 100 | The drift car has exposed wheel steering angle, circular reflectors, chrome bumper and flared arches. | SKILL |

## Acceptance is separate from attribution

See [the continuation validation report](SOLVANE_CONTINUATION_VALIDATION.md) for source identities, native round-trip checks, rendered evidence, actual driving checks and open limits. Linking an image to code is not a frame-rate test, a full-scene fidelity approval, or proof that all modes depicted by the reference game exist.
