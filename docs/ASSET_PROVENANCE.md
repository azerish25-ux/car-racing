# Asset provenance

The circuit layouts, car and bike lofts, wings, halo, wheel/rim construction, pit buildings, signage, stands, vegetation, interface, most textures and the audio synthesis are original content authored for this repository (procedural code or the Blender authoring scripts below). No game files, licensed Formula 1 branding, real team liveries, sponsor assets, real-person likenesses or extracted commercial audio are included. Driver names and the Aurel circuit are fictional design elements.

**Since 2026-10-15 the application also ships licensed third-party content** — photographed skies (HDRIs) and scanned material textures, all under CC0 1.0 so far — because procedural generation alone could not reach a photographic look (decision D14 in [DECISIONS_AND_RISKS.md](production/DECISIONS_AND_RISKS.md)). The rules, the register and the list are in [Third-party assets](#third-party-assets) below. Everything else in this document remains original work.

Three.js and its examples/addons supply the renderer, geometry helpers, sky and post-processing infrastructure. Their dependency license is retained through npm. Vite, TypeScript, ESLint, Vitest and Playwright are development dependencies. Consult each installed package's own LICENSE and the lockfile for dependency provenance; this document does not replace third-party license terms.

No external font files, online image downloads or paid services are needed to run the built application: every third-party file ships inside the build under `public/assets/` (no runtime CDN). System fonts are used.

## Third-party assets

**Policy.** Only CC0-1.0, CC-BY-4.0, CC-BY-2.0 and MIT content may ship (`src/rendering/assets/licences.ts`). Every shipped third-party file is recorded with its source, licence, author, attribution, size and SHA-256; CC-BY content is credited visibly in the game (**Paddock → CREDITS & LICENCES**, which lists every manifest entry) and in `public/assets/third-party/CREDITS.txt`; MIT content ships its notice. Content showing brands, logos, shop signage or branded vehicles is excluded, and asset names, credits and file names are checked against a brand list and the protected real-world names (`forbiddenNameIn`).

**Register and build.** `assets/third-party/sources.json` is the source register: id, kind, title, author, SPDX licence, attribution text, licence evidence, pinned source URL(s) (a commit-pinned GitHub path or an immutable object path) with SHA-256 and size, and the processing recipe. `scripts/assets/build-third-party.ts` fetches each source into the gitignored `.cache/third-party/` (verifying size and hash), converts it and writes the shipped files under `public/assets/third-party/<kind>/<id>/`, the credits text and the manifest `src/rendering/assets/third-party-manifest.json` (id, files with role/format/size/SHA-256, licence, attribution, source URL, and per-sky measurements). The tools it runs (hdrify 1.3.0 for the Ultra HDR container, jpeg-js, ImageMagick/libjpeg, KTX-Software 4.4.2 `toktx`) are build-time tools outside the application's dependencies; their versions are recorded in the manifest. `tests/third-party-assets.test.ts` fails if any file under `public/assets/third-party` is missing from the manifest or differs in size or hash, if a licence is outside the allowed set, if a CC-BY/MIT entry lacks attribution, if a brand word appears, or if the total exceeds the 150 MB budget; `npm run validate:content` re-checks the register and sizes.

**Shipped today (11.0 MB of the 150 MB budget).**

| Id | Kind | Author | Licence | Source (pinned) | Use |
|---|---|---|---|---|---|
| kiara-5-noon | HDRI | Greg Zaal (Poly Haven) | CC0-1.0 | Poly Haven `kiara_5_noon` 4k, via the Google Kubric public mirror `storage.googleapis.com/kubric-public/assets/HDRI_haven/kiara_5_noon.tar.gz` | clear day, arid, alpine and coastal venues |
| goegap | HDRI | Greg Zaal | CC0-1.0 | same mirror, `goegap` | clear day, desert venues |
| quarry-02 | HDRI | Sergej Majboroda | CC0-1.0 | `quarry_02` | fair-weather cumulus over a chalk quarry (arid and desert venues) |
| rural-landscape | HDRI | Sergej Majboroda | CC0-1.0 | `rural_landscape` | broken cumulus over flat country (clear and cloudy days at green, city and flat venues; cloudy at alpine and coastal ones) |
| waterbuck-trail | HDRI | Greg Zaal | CC0-1.0 | `waterbuck_trail` | overcast over low hills (green, coastal, arid) |
| mud-road | HDRI | Sergey Rudavin | CC0-1.0 | `mud_road` | overcast, flat/city/desert venues |
| kloppenheim-01 | HDRI | Greg Zaal | CC0-1.0 | `kloppenheim_01` | rain cloud and mist |
| winter-lake-01 | HDRI | Sergej Majboroda | CC0-1.0 | `winter_lake_01` | bright winter overcast over snow (alpine, highland) |
| table-mountain-1 | HDRI | Greg Zaal | CC0-1.0 | `table_mountain_1` | golden hour with broken cloud |
| kiara-8-sunset | HDRI | Greg Zaal | CC0-1.0 | `kiara_8_sunset` | clear sunset (arid, desert) |
| syferfontein-0d-clear | HDRI | Greg Zaal | CC0-1.0 | `syferfontein_0d_clear` | dawn-clear horizon (flat venues' golden hour) |
| kloppenheim-02 | HDRI | Greg Zaal | CC0-1.0 | `kloppenheim_02` | moonlit night |
| kloppenheim-04 | HDRI | Greg Zaal | CC0-1.0 | `kloppenheim_04` | night under low cloud lit by distant towns (city venues) |
| sandy-gravel-01 | PBR texture | cgbookcase | CC0-1.0 | `google/filament@58fcec6e…/third_party/textures/Sandy_gravel_01/` | gravel traps and run-off (KTX2 + WebP; not yet applied to a material) |

Licence evidence: Poly Haven publishes every asset under CC0 1.0, and both the mirror's index (`HDRI_haven.json`) and each archive's `data.json` state `"license": "CC0 1.0"`; cgbookcase publishes its textures under CC0 1.0 and the files are redistributed unchanged in the commit-pinned filament repository. Each sky ships as a 4096 × 2048 and a 2048 × 1024 Ultra HDR JPEG (sRGB base plus a half-size scalar gain map, radiance normalised to a unit dome mean, sun cores clipped at 64× that mean, everything below the horizon or the sky's skyline replaced by blurred sky before encoding, so the photographer's ground is not shipped); the texture set as 1024 px KTX2 (Basis ETC1S colour/ORM, UASTC normal) and WebP fallbacks, its DirectX normal map converted to OpenGL. No HDRI with signage, vehicles or brand marks in view was chosen; the city-at-night sky shows only distant, unreadable lights. Skies were also chosen for a clean horizon: a photo is drawn at infinity, so a hillside, tree or building near the photographer would tower over the circuit (early picks with a roadside hill, nearby trees, a snowy hillside and seaside ruins were replaced for that reason). Below the horizon (below a raised per-sky skyline where needed) the shader replaces the photographer's surroundings with haze, so only distant ridges, tree lines and rocks of a photo remain visible: `rural-landscape` hides its nearby utility poles, trees, farm buildings and a distant parked car (no readable marking) under a 7.5° skyline, `winter-lake-01` its housing estate under 5.5°.

**Runtime library shipped beside the assets.** `public/assets/basis/basis_transcoder.{js,wasm}` is copied byte-for-byte from the `three` npm package (`examples/jsm/libs/basis`) so `KTX2Loader` can transcode KTX2 textures; it is the Basis Universal transcoder by Binomial LLC, licensed Apache-2.0 (a code dependency like three.js itself, not art content). A test checks the copy matches the installed package.

**Still original/procedural.** Cars, bikes, riders, crews, buildings, vegetation, terrain, road surfaces, kerbs, barriers, crowds and every other material are still the repository's own procedural or Blender-authored work; the third-party skies replace only the visible sky dome and its image-based lighting on HIGH/ULTRA (2k on MEDIUM; LOW keeps the physical sky).

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
third-party geometry was traced, copied or fetched. Venue, layout and corner
names are intended to be original ("Poggio Alto Autodromo", "Cape Wrenna Island
Circuit", "Haarveld Circuit", "Montejaral Circuit", "Hochwald Forest Ring",
"Loirette Endurance Circuit", "Serra Verde Autódromo", "Mount Ardlow
Circuit", "Arroyo Oro Raceway", "Autodromo Fiume Verde", "Duinwijk Circuit",
"Ramla Desert Circuit", "Mirvari Boulevard Street Circuit", "Lantern Bay
Street Circuit", "Lotus Hill Harbour Circuit"); the protected-name list in
`content-validation.ts` was extended with the reference circuits, their
corner names and associated series and brands. **Correction (wave-2
review):** the first wave-2 build still carried seven real corner or section
names that the list did not yet contain — five infield corners of the
reference endurance venue's permanent club circuit on Loirette Club
("Chapelle", "Garage Vert", "Musée", "Garage Bleu" and "Raccord", short for
"Raccordement"), a jump section of the reference forest ring on Hochwald
("Sprunghügel") and a chicane of the reference river-park circuit on Fiume
Verde ("Variante Bassa"); one translated name ("Pescador") on Lotus Hill was
also too close to its reference. All were renamed to original names
(Prieuré, Pigeonnier, Orangerie, Lavoir, Retour; Lerchenkuppe; Variante dei
Pioppi; Maré), the protected list now contains them and further corner
names of every wave-2 reference circuit, and validation now also checks the
player-visible trackside signage text (it previously checked only names,
descriptions and corners). Licence status: **unlicensed approximations** — official circuit,
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
