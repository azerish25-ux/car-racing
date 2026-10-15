# Asset provenance

The circuit layout, car lofts, wings, halo, wheel/rim construction, pit buildings, signage, stands, vegetation, interface, textures and audio synthesis are original procedural content authored for this repository. No game files, licensed Formula 1 branding, real team liveries, sponsor assets, real-person likenesses or extracted commercial audio are included. Driver names and the Aurel circuit are fictional design elements.

Three.js and its examples/addons supply the renderer, geometry helpers, sky and post-processing infrastructure. Their dependency license is retained through npm. Vite, TypeScript, ESLint, Vitest and Playwright are development dependencies. Consult each installed package's own LICENSE and the lockfile for dependency provenance; this document does not replace third-party license terms.

No external font files, models, textures, online image downloads or sound recordings are needed to run the built application. System fonts are used. The generated textures and models are local and do not require paid services or API credentials.

## User-provided visual references (2026-09-19)

The F1 25 reference ZIP was inspected as a quality target only. No reference image, commercial-game mesh, livery, UI, recording or extracted texture is bundled or fetched by the app. The replacement body-section geometry, swept wings, APEX UV liveries, procedural foliage atlas and correlated terrain material maps were authored in this repository. See [reference review and validation boundaries](REFERENCE_VISUAL_REVIEW.md) for the archive audit, the excluded unrelated images and the remaining fidelity gap. A visually similar technique is not evidence of ownership of or permission to redistribute third-party source assets.

## Original cockpit detail continuation

`cockpit.ts` authors the mirror housings, rounded apertures, butterfly wheel and printed APEX control panel. `driver-materials.ts` generates two shared 128 × 128 linear normal/roughness maps from deterministic periodic weave functions; no photograph was converted into these textures. Glove reinforcement and seam curves are original geometry. The control lettering uses the browser's system fonts, with no bundled font files. The reference collection supplies qualitative goals, not distributed pixels. No external material library, image-generation output or downloaded PBR asset was added in this continuation.

## Circuit continuation

Profiled barriers, analytically filtered fence wire, eight grandstand layouts, structural components, seat/crowd instances and decorative construction finishes are original procedural work. No F1 25 image, mesh, brand livery, texture, sound or UI element is imported. The supplied pack remains an external qualitative reference, not a runtime dependency. See [circuit validation and limitations](CIRCUIT_REFERENCE_CONTINUATION.md).

## Phase 27H.2 original seated driver

`author-driver.py` and `apx01-driver.blend` are original Blender-authored suit
geometry, vertex-colour panels, UVs and nine named skin joints. Their runtime GLB
contains no imported human scan, real-person likeness, external texture, font or
animation. The suit reuses the repository's deterministic woven-fabric normal
and roughness resources. Gauntlets, thumbs, paddle blanks, fitted six-point
restraints and helmet tethers are original metre-space geometry. See
`PHASE_27H12_IMPLEMENTATION.md` and the hash-pinned driver manifest. Blender is an
authoring tool, not a shipped runtime dependency.

## Phase 27H.3 retained Aurel people

The authored people source and exchange files already present at `ee4fc48` are
preserved byte-for-byte. The normal pit-service and grandstand paths now use
that source's exported geometry, not independent primitive stand-ins. Analytic
bone poses, prop contacts, clothing cohorts and the two-triangle far impostor
are original runtime work. See `PHASE_27H3_IMPLEMENTATION.md` for file ownership,
LOD budgets, tests and the outstanding normal-game visual acceptance. No new
external models, textures, scans, fonts or recordings are included.

## A24 original pit-wall command station

`author-pit-wall.py` retains the original geometry, original packed micro-normal
map, converted built-in text and named placement sockets. Its Blender source and
GLB contain no imported stock art, commercial-game geometry, logo, human scan,
font file or photographic texture. Runtime screen pixels are drawn from the
actual presented session/replay snapshot; no fictional telemetry recording is
included. See [A24 scope and acceptance](A24_PIT_WALL_STATION.md).

## A34 original thermal blankets and controllers

`scripts/author-tyre-blankets.py` authors fitted and opened front/rear covers, folded blankets, controllers and a cable coil from original metre-space geometry. The retained Blender source and GLB use original periodic weave pixels and converted built-in lettering, not downloaded meshes, photographic textures, logos or font files. The fit target is the existing APX spare-wheel envelope, not a dimensional claim about the supplied RB19. Runtime displays remain STANDBY; no synthetic temperature data or tyre-heating physics is introduced. See [A34 production notes](A34_TYRE_BLANKETS.md).

## A21 original pit-building frontage

`author-pit-building-frontage.py` authors the original structural frontage, gallery,
canopy sections, exterior stair-core shells and original packed micro-surface maps.
The retained Blender source and GLB contain no imported scans, photographs, stock
geometry, commercial-game meshes, team logos or external font files. Built-in text
is converted to mesh. Forty-three sockets are placement metadata only. Existing
A22, A24, car, cockpit and driver payloads are unchanged. See [A21 scope, integration
and validation boundaries](A21_HERO_PIT_BUILDING.md).

## Circuit catalogue (WP29–WP30)

The twenty catalogue layouts in `src/simulation/circuit-catalogue/` are
hand-authored data (straights, arcs, elevation and width knots). Six venues are
**approximations of famous real-world circuits from public geometry** — corner
sequence and direction, approximate lengths and radii, the published lap length
(each layout is scaled to it) and, where publicly known, the elevation
character. No map tracing, survey data, third-party geometry file, official
name, logo, livery, signage or branding is included or fetched. Venue, layout
and corner names are neutral and original (e.g. "Parco Reale Autodromo",
"Ardennes Forest Circuit", "Northfield Airfield GP", "Kansai Figure-Eight",
"Riviera Harbour Street Circuit", "Texas Hill Country Circuit"), and
`validate:content` rejects protected real names in catalogue copy. Using any
official circuit, corner or event name would require a licence; until then the
layouts remain approximations under original names. The six unconventional
venues are original designs.

**Catalogue wave 2** adds twenty layouts at seventeen venues under the same
rules. Fifteen venues (seventeen layouts) are approximations of famous
circuits from public geometry, described only by character — Tuscan-hills,
island cliff-top, Dutch "cathedral" and Andalusian motorcycle grand-prix
circuits; a forest ring and a public-road endurance circuit (with its
permanent club circuit); a city-bowl, a mountain, a coastal-hills, an Italian
river-park, a Dutch dunes, a desert night (with its outer loop), a Caspian
boulevard street, a bay night street and a harbour-hill street circuit. They
are hand-authored turtle paths scaled to each published lap length, laid out
from general public knowledge of the corner sequence, direction, straight
lengths and elevation character; no map, survey, satellite image or
third-party geometry was traced, copied or fetched. All venue, layout and
corner names are original ("Poggio Alto Autodromo", "Cape Wrenna Island
Circuit", "Haarveld Circuit", "Montejaral Circuit", "Hochwald Forest Ring",
"Loirette Endurance Circuit", "Serra Verde Autódromo", "Mount Ardlow
Circuit", "Arroyo Oro Raceway", "Autodromo Fiume Verde", "Duinwijk Circuit",
"Ramla Desert Circuit", "Mirvari Boulevard Street Circuit", "Lantern Bay
Street Circuit", "Lotus Hill Harbour Circuit"); the protected-name list in
`content-validation.ts` was extended with the reference circuits, their
corner names and associated series and brands, so none can enter catalogue
copy. Licence status: **unlicensed approximations** — official circuit,
corner, event or series names, logos, liveries and signage would each need a
licence and none is used. The two unconventional venues ("Gantry Point
Container Terminal", "Bright Basin Salt Flat Airbase") are original designs;
their portal cranes, containers and hangar frontage are procedural geometry
built at runtime by the venue kit. Trackside signage text is fictional.

The procedural venue kit (`src/rendering/venue-kit/`) generates all of its
geometry and textures at runtime: rock strata and normals from value noise,
facade windows drawn on canvases, braking-board numerals in system fonts.
It reuses the repository's original asphalt, grass, gravel and concrete
materials, garage bays, grandstands, catch-fence shader and concrete barrier
profile. Trackside sponsor text is fictional. See
[the catalogue scope and limits](CIRCUIT_CATALOGUE.md).
