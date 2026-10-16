# Asset provenance

The circuit layouts, car and bike lofts, wings, halo, wheel/rim construction, pit buildings, signage, stands, vegetation, interface, most textures and the audio synthesis are original content authored for this repository (procedural code or the Blender authoring scripts below). No game files, licensed Formula 1 branding, real team liveries, sponsor assets, real-person likenesses or extracted commercial audio are included. Driver names and the Aurel circuit are fictional design elements.

**Since 2026-10-15 the application also ships licensed third-party content** — photographed skies (HDRIs), scanned ground textures under CC0 1.0 and CC BY 4.0, and photographic trees, a shrub and meadow grass baked from CC BY 4.0 plant models — because procedural generation alone could not reach a photographic look (decisions D14, D14.1 and D15 in [DECISIONS_AND_RISKS.md](production/DECISIONS_AND_RISKS.md)). The rules, register and asset list are in [Third-party assets](#third-party-assets) below. Procedural vegetation remains the LOW/MEDIUM path and fallback; scanned ground is enabled on MEDIUM and above.

Three.js and its examples/addons supply the renderer, geometry helpers, sky and post-processing infrastructure. Their dependency license is retained through npm. Vite, TypeScript, ESLint, Vitest and Playwright are development dependencies. Consult each installed package's own LICENSE and the lockfile for dependency provenance; this document does not replace third-party license terms.

No external font files, online image downloads or paid services are needed to run the built application: every third-party file ships inside the build under `public/assets/` (no runtime CDN). System fonts are used.

## Third-party assets

**Policy.** Only CC0-1.0, CC-BY-4.0, CC-BY-2.0 and MIT content may ship (`src/rendering/assets/licences.ts`). Every shipped third-party file is recorded with its source, licence, author, attribution, size and SHA-256; CC-BY content is credited visibly in the game (**Paddock → CREDITS & LICENCES**, which lists every manifest entry) and in `public/assets/third-party/CREDITS.txt`; MIT content ships its notice. Content showing brands, logos, shop signage or branded vehicles is excluded, and asset names, credits and file names are checked against a brand list and the protected real-world names (`forbiddenNameIn`).

**Register and build.** `assets/third-party/sources.json` (plus department fragments in `assets/third-party/sources/*.json`, appended in file-name order; the ground sets live in `sources/ground.json`) is the source register: id, kind, title, author, SPDX licence, attribution text, licence evidence, pinned source URL(s) (a commit-pinned GitHub path or an immutable object path) with SHA-256 and size, and the processing recipe. `scripts/assets/build-third-party.ts` fetches each source into the gitignored `.cache/third-party/` (verifying size and hash), converts it and writes the shipped files under `public/assets/third-party/<kind>/<id>/` (or `<area>/<id>/` for a department's namespace, e.g. `ground/ground-lawn/`), the credits text and the manifest `src/rendering/assets/third-party-manifest.json` (id, files with role/format/size/SHA-256, licence, attribution, source URL, and per-sky measurements). The tools it runs (hdrify 1.3.0 for the Ultra HDR container, jpeg-js, ImageMagick/libjpeg, KTX-Software 4.4.2 `toktx`) are build-time tools outside the application's dependencies; their versions are recorded in the manifest. `tests/third-party-assets.test.ts` fails if any file under `public/assets/third-party` is missing from the manifest or differs in size or hash, if a licence is outside the allowed set, if a CC-BY/MIT entry lacks attribution, if a brand word appears, or if the total exceeds the 150 MB budget; `npm run validate:content` re-checks the register and sizes.

**Shipped today (52.90 MiB of the 150 MiB budget, including ground and vegetation).**

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
| sandy-gravel-01 | PBR texture | cgbookcase | CC0-1.0 | `google/filament@58fcec6e…/third_party/textures/Sandy_gravel_01/` | gravel traps, sand and gravel soil, festival sand |
| ground-lawn | PBR texture | ambientCG ("Grass 001") | CC0-1.0 | `pmndrs/market-assets@c9cfa023…/files/materials/grass/Grass001_1K_*` | mown verges, aprons, skirts, near terrain |
| ground-meadow | PBR texture | Poly Haven ("Aerial Grass Rock") | CC0-1.0 | npm `aframe-enviropacks@0.10.0` tarball (SHA-256 pinned), `package/asset/aerial_grass_rock_2k_jpg/` | rough grass, far terrain, verge patches, off-road turf, festival meadows |
| ground-forest-floor | PBR texture | Poly Haven ("Forest Ground 03") | CC0-1.0 | same tarball, `forrest_ground_03_2k_jpg/` | off-road loam, festival soil |
| ground-dry-earth | PBR texture | Poly Haven ("Sandstone Cracks") | CC0-1.0 | same tarball, `sandstone_cracks_2k_jpg/` | off-road hardpack |
| ground-asphalt | PBR texture | Poly Haven asphalt_02, as shipped with the glTF sample model "Traffic Cone" by hinndia | CC-BY-4.0 (credited as such; the texture itself is Poly Haven CC0) | `KhronosGroup/glTF-Sample-Assets@edc7c9e6…/Models/TrafficCone/glTF/asphalt_02_{diff,rough}_1k.jpg` | racing surface, pit lane, run-off, festival roads (re-synthesised without the photo's cracks; normal derived from the aggregate) |
| ground-wet-earth | PBR texture | Amazon Lumberyard (Bistro, "Pavement Ground Wet") | CC-BY-4.0 | `mmp/pbrt-v4-scenes@30cf4a03…/bistro/textures/Pavement_Ground_Wet_*` | off-road mud and ruts |
| ground-concrete | PBR texture | Amazon Lumberyard (Bistro, "Concrete Plaster") | CC-BY-4.0 | same repository, `MASTER_Concrete_Plaster_*` | kerb substrate, concrete paving, start-gate pad, stadium concrete |
| ground-rock | PBR texture | ambientCG ("Rock 020") | CC0-1.0 | `pmndrs/market-assets@c9cfa023…/files/materials/rock/Rock020_1K_*` | steep terrain, cuttings, venue-kit rock |
| ground-snow | PBR texture | ambientCG ("Snow 004") | CC0-1.0 | npm `aframe-enviropacks@0.10.0`, `Snow004_2K-JPG/` | festival snow |
| tree-linden | vegetation | Jan-Walter Schliep, Burak Kahraman and Timm Dapper (Laubwerk) | CC-BY-4.0 | `mmp/pbrt-v4-scenes@30cf4a03…/landscape/` object `xref_Tilia_tomentosa_02medium.c4d Instance` (PLY meshes, PNG textures, `geometry/geometry.pbrt`) | silver linden: broadleaf near planting, groves, city and coastal trees |
| tree-chestnut | vegetation | same | CC-BY-4.0 | same scene, `xref_Aesculus_02adult.c4d Instance` | horse chestnut: spreading crowns, forest belts |
| tree-birch | vegetation | same | CC-BY-4.0 | same scene, `xref_Betula_pendula_03mediumb.c4d` | silver birch: upright crowns, alpine broadleaf |
| tree-rowan | vegetation | same | CC-BY-4.0 | same scene, `mountain_ash` | rowan: small trees, orchards, olive-grove zones |
| tree-fir | vegetation | same | CC-BY-4.0 | same scene, `Abies_concolor_02medium` | white fir: conifers, cypress rows, conifer belts |
| tree-fir-b | vegetation | same | CC-BY-4.0 | same scene, `Abies_concolor_01medium` | second fir form for conifer variety |
| shrub-flowering | vegetation | same | CC-BY-4.0 | same scene, `xref_WPR.c4d` | flowering shrubs beyond the barriers and in the venue-kit scatter |
| grass-meadow | vegetation | same | CC-BY-4.0 | same scene, `meadow_v3` and `meadow_v3dry` | meadow grass clumps along the circuit edge |

Licence evidence: Poly Haven publishes every asset under CC0 1.0, and both the mirror's index (`HDRI_haven.json`) and each archive's `data.json` state `"license": "CC0 1.0"`; cgbookcase publishes its textures under CC0 1.0 and the files are redistributed unchanged in the commit-pinned filament repository. ambientCG publishes every asset under CC0 1.0 (docs.ambientcg.com/license); its sets are redistributed unchanged in `pmndrs/market-assets` and the `aframe-enviropacks` npm package, whose README states its Texture Haven (now Poly Haven) and CC0 Textures (now ambientCG) content is CC0. The Traffic Cone model's `LICENSE.md` names CC-BY-4.0 and CC0-1.0 for its files without saying which applies to the texture, so `ground-asphalt` is credited under the stricter CC BY 4.0 terms. The Bistro scene (Amazon Lumberyard, distributed by NVIDIA ORCA) is CC BY 4.0, legal code in the pinned `bistro/LICENSE.txt`; only two of its ground textures ship (no geometry, no signage, no vehicle). Ground sets ship at 1024 px (KTX2 + WebP); two Poly Haven normal maps lean about 6° and are recentred by the build, DirectX normal maps (ambientCG, Bistro, cgbookcase — detected by comparing the curl of both Y conventions) are flipped to OpenGL, and the build records each set's linear mean colour and roughness. Texture authors are credited as published: the Poly Haven texture pages are not reachable from the build host, so the individual photographers of those three textures are not named (CC0 needs no attribution; the credit names Poly Haven). Each sky ships as a 4096 × 2048 and a 2048 × 1024 Ultra HDR JPEG (sRGB base plus a half-size scalar gain map, radiance normalised to a unit dome mean, sun cores clipped at 64× that mean, everything below the horizon or the sky's skyline replaced by blurred sky before encoding, so the photographer's ground is not shipped); the texture set as 1024 px KTX2 (Basis ETC1S colour/ORM, UASTC normal) and WebP fallbacks, its DirectX normal map converted to OpenGL. No HDRI with signage, vehicles or brand marks in view was chosen; the city-at-night sky shows only distant, unreadable lights. Skies were also chosen for a clean horizon: a photo is drawn at infinity, so a hillside, tree or building near the photographer would tower over the circuit (early picks with a roadside hill, nearby trees, a snowy hillside and seaside ruins were replaced for that reason). Below the horizon (below a raised per-sky skyline where needed) the shader replaces the photographer's surroundings with haze, so only distant ridges, tree lines and rocks of a photo remain visible: `rural-landscape` hides its nearby utility poles, trees, farm buildings and a distant parked car (no readable marking) under a 7.5° skyline, `winter-lake-01` its housing estate under 5.5°.

**Photographic vegetation (CC BY 4.0).** The eight vegetation entries come from the *Landscape* scene of `mmp/pbrt-v4-scenes` (the cover scene of *Physically Based Rendering*, 3rd edition), whose README (commit `30cf4a0`) states: "Many thanks to Jan-Walter Schliep, Burak Kahraman, and Timm Dapper from Laubwerk for this amazing scene, which is licensed under a CC-BY license" with a link to CC BY 4.0. Every PLY mesh, PNG texture and the scene description each plant uses is listed in the register with its commit-pinned `raw.githubusercontent.com` URL, size and SHA-256 (8–42 files per plant). The source models are film-resolution (0.27–4.2 million triangles per tree, one quad per leaf) and are **not shipped**: `scripts/assets/vegetation/` bakes each into a real-time asset — the trunk and main limbs simplified with meshoptimizer to a triangle budget, the crown (leaves, needles, twigs, fine branches) split into 80–480 k-means clusters, each drawn orthographically onto its own card of a colour + coverage atlas and a tangent-normal + sky-visibility atlas (a billboard cloud), eight impostor views of the whole plant, a bark colour map and a normal map derived from the source displacement map, and for the grass side slabs of two meadow patches as clump tiles. These are adaptations (CC BY 4.0 §1(a)); the attribution, shown in the in-game credits and in `CREDITS.txt`, names the authors, the licence and states the modification. Not used: the scene's 20 m spruce (its lower trunk is missing from the scene) and the two flat weed rosettes of the meadow patches (their texture sheet holds a bark swatch). No plant model shows a brand, sign or marking.

**Runtime library shipped beside the assets.** `public/assets/basis/basis_transcoder.{js,wasm}` is copied byte-for-byte from the `three` npm package (`examples/jsm/libs/basis`) so `KTX2Loader` can transcode KTX2 textures; it is the Basis Universal transcoder by Binomial LLC, licensed Apache-2.0 (a code dependency like three.js itself, not art content). A test checks the copy matches the installed package.

**Still original/procedural.** Cars, bikes, riders, crews, buildings, terrain geometry, barriers, crowds and the remaining procedural materials are the repository's own procedural or Blender-authored work. The third-party skies replace the visible sky dome and its image-based lighting on HIGH/ULTRA (2k on MEDIUM; LOW keeps the physical sky). The scanned ground sets supply the photographic structure (colour variation, relief, roughness) of the asphalt, kerb substrate, verges, gravel traps, terrain, off-road soil and festival terrain on MEDIUM and above; the calibrated albedos, painted kerb and run-off designs, racing line, rubber, repairs, water, ruts and every other layer on those surfaces remain original shader work, and LOW keeps the fully procedural surfaces. Kerb paint wear, tyre-rubber, painted lines and the off-road ruts are authored in shaders, not photographed. Vegetation is photographic on HIGH and ULTRA (trees, shrubs and the meadow grass band at every circuit, catalogue, off-road and festival venue); the *placement* of every plant (planting plans, groves, belts, festival tile placement, the colliders the physics reads) is still the repository's own, as are the contact-occlusion discs under the crowns and the shaders. LOW, MEDIUM, a failed download or a missing KTX2/WebP decoder keep the original procedural crowns and the A51–A54 Blender-authored Aurel trees, which remain in the repository unchanged.

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
