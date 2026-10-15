# Rendering pipeline: presets, passes, costs and fallbacks

Masterplan §17 (art direction, §17.3 priorities, §17.5 material library, §17.6 temporal
stability), WP27–WP28. Three.js 0.180 on WebGL2 only; no new dependencies. The ULTRA modules are
**integrated** in the sense of `STATUS_REGISTER.md` (reachable in a session, covered by automated
tests); the shared material library is a **prototype** until a vehicle or venue kit is built from it.
Nothing here is performance accepted — no named reference-hardware capture exists yet.

## 1. Presets

`Settings → Garage → RENDER QUALITY`. Presets fill the individual controls; every control can then
be overridden and persists (`src/storage/data.ts`, settings v6). The default remains **Medium**;
**ULTRA is opt-in only** — no migration, default or CI job selects it.

| | Low | Medium | High | **ULTRA** |
|---|---|---|---|---|
| Detail tier (LOD, scenery, mirrors) | low | medium | high | high (`detailTier('ultra')`) |
| Resolution scale / MSAA | 0.75 / off (FXAA) | 1 / 2× | 1 / 4× | 1 / 4× + TAA |
| Temporal AA (jittered history) | opt-in | opt-in | opt-in | **on**, with CAS sharpening 0.35 |
| Ambient occlusion | off | GTAO 2 slices | GTAO 3 slices | **GTAO 4 slices + temporal accumulation** |
| Reflections | sky PMREM | sky PMREM | local probe + planar wet road | local probe + **hierarchical SSR** (replaces the planar wet pass) |
| Sun shadows | off | near 2048 + far | near 2048 + far | **near 4096 + mid 2048 + far** (PCSS everywhere) |
| Bloom | off | highlight (threshold) | highlight | **energy-conserving** |
| Lens | grade + vignette | + effects | + effects | + **restrained chromatic aberration**, **sun shafts** |
| Depth of field | photo, showroom, telephoto | same | same | + **thin-lens replay lens** |
| Tone mapping | ACES | ACES | ACES | **AgX** with a restrained filmic grade (ACES / Khronos Neutral selectable on any preset) |
| Vegetation (§8b) | procedural crowns | procedural crowns | photographic, near trees ≤ 56 m, grass ≤ 40 m | photographic, ≤ 72 m, grass ≤ 55 m |

A save written before ULTRA existed validates to exactly its old preset values with every new
module off (`tests/ultra-options.test.ts`, "settings migration"). An ULTRA save opened by an older
build falls back to Medium.

## 2. Frame graph

Passes in submission order. **Bold** entries are ULTRA modules (`src/rendering/ultra/`), inserted by
`UltraPipeline` into the retained chain; `renderer.ts` only constructs the pipeline, calls
`configure()` from `setQuality`, `prepareFrame()` before the composer and `afterFrame()` after it.

1. Environment: sky PMREM recapture on cloud-bin, lighting or LIVE-sun-key change (`SkyEnvironment`,
   time-of-day refresh), local reflection probe (one cube face per frame), mirrors, planar wet road
   (off while SSR runs).
2. Shadow maps (inside the first scene render): near car-following map (light-space snapped,
   PCSS for the 0.53° sun), **mid cascade** (every second presented frame), far whole-circuit map
   (baked once per lighting).
3. Scene pass (`SceneAmbientPass`): one multisampled HDR draw (TAA-jittered when active; the
   **SSR roughness mask** is written into alpha by opted-in materials during this draw only) →
   **SSR stage** (Hi-Z build, half-resolution trace, full-resolution resolve) → TAA resolve →
   GTAO (**4 slices, rotating noise**) → **temporal AO** → composite with contact shadows and
   per-object motion blur (camera + rigid cars from the velocity field).
4. Photo / showroom / telephoto depth of field (retained) and **replay lens** (thin lens, 48-tap bokeh).
5. Adaptive exposure meter → **sun shafts** (linear HDR) → lens bloom (**energy-conserving** mode)
   → output transform (**ACES | AgX | Neutral**) → **CAS sharpening** → FXAA (only without MSAA) →
   broadcast grade (vignette, **restrained fringe**, LUT).

## 3. Modules

**Temporal AA + sharpening.** The retained TAA (Halton(2,3) ×8 jitter, camera and rigid per-car
reprojection, 3×3 YCoCg variance clipping, Catmull-Rom history) complements 4× MSAA at ULTRA:
MSAA resolves geometric edges, TAA the shading and specular aliasing MSAA cannot. Contrast-adaptive
sharpening (`taa-sharpen.ts`, after the output transform) restores the softening of history
resampling; its lobe scales with the setting (0 = identity) and it runs only on frames the TAA
resolved, so held, paused and photo frames are byte-identical to the unsharpened image.

**Ground-truth AO.** ULTRA raises GTAO to 4 slices, offsets its per-pixel rotation every presented
frame by an R2 sequence and accumulates a half-resolution history (`ao-temporal.ts`) reprojected like
the TAA and clamped to the current 3×3 range. Held frames bypass the history and use rotation 0.

**Screen-space reflections** (`ssr.ts`, `ssr-mask.ts`). No G-buffer exists, so opted-in opaque
materials (road water film, car paint lacquer, the material library's glossy finishes) write their
glossy layer's roughness into the HDR target's alpha band [0.25, 0.75) while `apexSsrEncode` is 1 —
only inside the main scene draw of an ULTRA frame; everywhere else `mix(a, code, 0) == a`. A
6-level conservative closest-depth pyramid of the raw (screen-affine) depth drives a Hi-Z traversal
(≤ 56 iterations) of a GGX-importance-sampled ray about the depth-reconstructed normal, perturbed by
procedural rain ripples on upward water films. The resolve reuses the four nearest rays with depth
weights (on wet upward surfaces each ray gathers four jittered taps along the direction to its hit,
so rain lights and the horizon streak as on a real wet road), limits fireflies, and replaces the
environment probe's share (the local probe cubemap
while it owns the road and the followed car, else the sky PMREM):
`out = scene + F_schlick-roughness · confidence · (ssr − probe)`, fading to the probe at screen edges,
for rays toward the camera, at the iteration limit and with roughness. TAA accumulates the stochastic
rays.

**Bloom.** The retained pyramid (13-tap downsample, tent upsample, firefly limiter) gains an
energy-conserving mode: no threshold, and the frame becomes `(1 − m)·scene + m·blur(scene)` with
`m = 0.03` by day and at night, 0.02 at the golden hour and 0.045 in wet air
(`physicalBloomMix`) by a constant-alpha blend — a fixed share of every pixel's energy is
redistributed (veiling glare) and total radiance is preserved. The point-spread function is a
real lens's: level-to-level carry 0.45 (0.7 in threshold mode), so about 90 % of the redistributed
share stays within ~8 px and the coarsest level carries under 0.5 % (tight glare around sources,
almost no frame-wide veil). The energy mode has its own prefilter program: it limits only isolated
sub-pixel outliers (taps above 16× the median of the centre and inner diagonal taps), with
half-float-safe ceilings 2000/8000, so emitters authored in physical radiance glow: floodlight
heads (300× white), venue-kit lamps (150×) and rain lights (6×) when the energy bloom is on, their
threshold-mode gains elsewhere. Low/Medium/High keep the threshold prefilter unchanged.

**Tone mapping and lens.** ACES stays calibrated for Low/Medium/High with the broadcast grade.
ULTRA defaults to AgX (it matches ACES at mid grey, so the exposure keys hold; soft highlight
roll-off without ACES's hue skews) and, over any filmic transform (AgX or Neutral), the grade uses
`FILMIC_GRADE_PROFILES`: S-curve 0.07–0.08, saturation 1.03–1.05 (offsetting AgX's own
desaturation), vibrance 0.04, with tints, vignette and the hue-selective LUT kept. Chromatic
aberration adds 0.0012 grade fringe (≈ 2 px of red/blue separation in a 1080p corner, none at the
centre) on live and replay views only, never over a photo look or menu. ULTRA's lens dirt is 0.3
(0.9 elsewhere).

**Depth of field.** Retained: photo lens, D29 showroom. The D30 broadcast telephoto (trackside
lens under 20°, every preset) is a broadcast camera's thin lens: a 2/3-inch B4 gate (5.4 mm) at
f/4, maxblur 0.4 % (`BROADCAST_LENS`), so a 60–150 m pack keeps the frame sharp instead of reading
as a tilt-shift miniature; the pass skips pixels under half a pixel of blur. ULTRA adds the
replay lens (`replay-lens.ts`): a thin lens on a Super 35 gate at f/2.8,
`c(d) = f²/(N(s − f)h) · (1 − s/d)`, focused on the followed car, capped at 0.65 % of the screen
height so a held shot never reads as a miniature, for recorded chase and broadcast views only.

**Shadows** (`cascades.ts`). Near map 4096 at ULTRA (2048 where `maxTextureSize` < 4096). The mid
cascade is a third shadowed directional light whose texel is the geometric mean of the near and far
texels (`balancedMidExtent`; ≈ 9 cm over ±92 m on Aurel), leading the camera, snapped to its texel
grid in light space and filtered with the same PCSS. Its shader code is a guarded patch of the
far-shadow chunks that exists only in programs with three shadowed directional lights; removing the
guarded blocks restores the original chunk exactly (`tests/ultra-pipeline.test.ts`). The practical
split scheme (`cascadeSplits`, λ = 0.8) is provided for view-fitted cascades and documented
splits.

**Image-based lighting.** Retained: the sky PMREM is recaptured on lighting/LIVE-sun changes and
blended between cloud bins without recapture; local scene probes refresh one face per frame. Since
D14 the dome it captures is a **photographed sky** on HIGH/ULTRA/MEDIUM (§8), so the environment
light, reflections and the visible background are the same photograph.

**Sun shafts** (`light-shafts.ts`). Screen-space volumetric scattering in linear HDR before bloom:
a quarter-resolution mask of open sky weighted by a Henyey-Greenstein lobe (g = 0.9: beams start at
the disc and its aureole), two 24-tap radial gathers (decay 0.94, 576 effective samples) and an
additive composite scaled by lighting (0.04 by day, 0.06 at sunset) and haze (broken cloud, rain);
near geometry (under 150 m, open again by 1.5 km) keeps only 15 % of the beam, so a backlit canopy
stays dark between beams. Off at night, in studio backdrops, in menus and when the sun is behind
the camera.

**Atmosphere.** The sky is baked with summer aerosols (`SKY_LIGHT.haze` day 18/26/38, AOD ≈
0.09–0.18). The local atmosphere's aerial perspective is Beer–Lambert per channel with the same air
(`aerialExtinction`: Rayleigh plus Mie at the presented haze level, plus rain) and the 1200 m
aerosol scale height, so ridges keep their contrast and fade into the dome's own horizon. Night
city venues add a warm urban skyglow (stars at 5 %).

**Material library** (`src/rendering/materials/`). See §6.

## 4. Costs (1920 × 1080, render scale 1; upper bounds)

Draws are full-screen quads unless stated. Fetch counts are static estimates reported per frame as
`renderer.ultra.passes[name].fetchesM`; only masked/blurred pixels do the full work.

| Module | Extra draws / frame | Texture fetches (M) | Memory (MB) |
|---|---:|---:|---:|
| SSR (Hi-Z 6, trace 1, resolve 1) | 8 | ≤ 6 + 33 + 46 | 23.5 |
| Temporal AO (+1 GTAO slice) | 1 | 5.7 + 6.2 | 4.1 |
| CAS sharpening | 1 (TAA frames) | 18.7 | 0 |
| Sun shafts | 4 (sun in view) | 9.3 | 2.1 |
| Replay lens (48 taps) | 1 (replay) | ≤ 203 (blurred pixels only) | 0 |
| Chromatic aberration | 0 | +4.1 | 0 |
| Energy-conserving bloom, tone mapper | 0 | 0 | 0 |
| Mid cascade 2048 | shadow casters in ±R, every 2nd frame | — | 32 |
| Near 4096 (vs 2048), far 4096 (vs 2048) | 0 (fill only) | — | +96, +96 |
| Material library maps | 0 at runtime; one bake per recipe | — | 1 per recipe output used |

The draw ledger's fixed phases are unchanged (ULTRA quads count in `composer`, the mid cascade in
`shadow`), so the pinned cockpit baselines remain comparable. ULTRA is never part of those budgets.

## 5. Diagnostics and evidence

- `apexDiagnostics().renderer.ultra`: preset/tier, capabilities, unsupported modules with reasons,
  per-pass draws/triangles/frames/fetch estimates and GPU milliseconds (EXT_disjoint_timer_query
  timestamps where `QUERY_COUNTER_BITS > 0`; `null` otherwise — RAF time is never substituted),
  SSR pyramid sizes, AO history state, cascade extents and texel sizes, replay focus and blur.
- Frame GPU time remains `gpuMilliseconds` (GpuTimer). A/B a module with the performance capture
  (Pause → Performance capture) with the module toggled; `npm run test:performance` compares reports.
- `node --experimental-transform-types scripts/ultra-capture.ts [--size WxH] [--textures]`:
  deterministic captures of a fixed set (wet asphalt with puddles, flaked paint, carbon, rubber,
  brushed metal, glass, concrete, leaves; near + mid + far shadows) through High and ULTRA, dry, in
  rain and in replay; PNGs, a JSON report and optionally every baked procedural map. Fails on console
  (shader) errors, GL errors, non-identical held frames or an inactive module the device supports.
- Tests: `tests/ultra-options.test.ts` (presets, migration, capability fallbacks, controls),
  `tests/ultra-math.test.ts` (jitter/ray/noise sequences, reprojection, CAS, cascade splits and
  texel balance, Hi-Z traversal vs a linear march, SSR encoding, Fresnel/GGX, thin lens, HG phase),
  `tests/ultra-pipeline.test.ts` (per-preset gating, pass order, stage hooks, mid-cascade patch,
  bloom/grade/DOF variants, pass ledger), `tests/material-library.test.ts`;
  `e2e/58-ultra-pipeline.spec.ts` (the controlled GPU set in every browser run; a saved ULTRA
  preference in a live session with `APEX_ULTRA_LIVE=1`, opt-in because a software-rendered ULTRA
  session takes 10–20 minutes and would change the CI shard workload).

## 6. Shared material library (for car bodies, bikes and venue kits)

```ts
import { materials } from '../rendering/materials/index.ts';
materials.carPaint({ color: 0xc81e1e, flake: 0.6, pearl: 0.2 }); // base + flake normal + clear coat
materials.carbon({ finish: 'lacquered' | 'satin' });              // retained band-limited twill
materials.rubber({ wear: 0.3 });                                  // ~3 % albedo, micro-relief, no lettering
materials.metal({ kind: 'brushed' | 'bare' | 'polished' | 'cast', metal: 'aluminium' });
materials.glass({ tint: 0xa9bccc, transmission: 0.88 });          // Fresnel alpha, premultiplied
materials.asphalt({ variant: 'fresh' | 'worn' | 'patched' });     // weather-coupled, puddles, ripples
materials.wetRoad({ wetness: 1 });                                // always-wet surface
materials.concrete({ variant: 'smooth' | 'rough', horizontal: 0 });
materials.vegetation({ translucency: 0.4, alphaMap });            // shadowed thin-leaf transmission
materials.boxProjectUv(geometry, metresPerUnit);                  // metre UVs for unwrapped geometry
```

Conventions: linear albedo, perceptual GGX roughness, detail maps tile per metre of UV
(`flakeTile`, `tile`). Detail maps (flake normals, brushing, micro-relief, three asphalt and two
concrete aggregates; normal, ORM and tone outputs) are drawn on the GPU once from periodic recipes,
read back into mipmapped repeating textures and shared by source; before the bake (or without a GPU)
they hold identity texels, so a material renders as its untextured parameters, never broken. Wet
surfaces follow `surfaceWeather` (written each frame from the presented rain and track water).
Glossy opaque finishes join the ULTRA SSR mask; nothing else changes on other presets.
Factories return ordinary three.js materials — callers own and dispose them.

## 7. Fallbacks

| Module | Needs | Without it |
|---|---|---|
| TAA, CAS | live, advancing frame | unjittered frame, no sharpening (held frames identical) |
| SSR | `EXT_color_buffer_float` (R32F), opted-in material | probe + planar wet reflection (planar stays enabled) |
| Temporal AO | AO on, advancing frame | single-frame GTAO |
| Mid cascade | shadows on, far map baked (it must be directional shadow 2) | near + far |
| 4096 near map | `maxTextureSize` ≥ 4096 | 2048 |
| Sun shafts | sun in front of the camera, day/sunset | off |
| Replay lens | recorded chase/broadcast view, no other depth of field | sharp |
| GPU pass timing | timestamp queries | `gpuMs: null`; frame GPU time only |
| Material maps | RGBA8 render-target readback | identity (flat) maps |
| Photographic vegetation | HIGH or ULTRA, KTX2 transcoder or WebP decode, a loaded species of the venue | the procedural planting (whole venue; LOW and MEDIUM always) |

## 8. Photographed skies and third-party assets (D14)

The visible sky and its image-based light are photographs (13 CC0 Poly Haven HDRIs, list and
licences in `docs/ASSET_PROVENANCE.md`), not the procedural dome, on every preset except LOW.

**Files.** Each sky ships as `public/assets/third-party/hdri/<id>/<id>_{4k,2k}.hdr.jpg`: an
Ultra HDR JPEG whose sRGB base is full size and whose gain map is a half-size scalar
(log2 over [0, log2 65], gamma 1, zero offsets) — `hdr = base · 2^(gain · gainMax)` exactly, the
base computed against the gain the decoder reads back (built and verified by
`scripts/assets/hdri.ts`; reconstruction 0.015–0.045 stops RMS, JPEG noise). Radiance is normalised so
the cosine-weighted dome mean is 1 and sun cores are clipped at 64×; pixels below the skyline (the
photographer's ground) are replaced by the blurred sky above it before encoding, since the shader
never shows them. The build measures, and the
manifest stores, the brightest region's azimuth/elevation and colour, direct/diffuse ratio, dome
mean, horizon colours toward/away from the sun, zenith and ground means.

**Selection** (`src/rendering/assets/sky-catalogue.ts`). A venue's landscape picks a palette
(`THEME_PALETTE` for every catalogue/off-road theme; Aurel green, Vellamar coast, festival coast);
each lighting has a ramp of skies over simulated cloud cover — day: clear (≤ 0.20) → fair-weather
cumulus (0.45) → overcast (0.72) → rain cloud and mist (≥ 0.92); golden hour: clear/broken
evening → overcast → rain; night: moonlit (≤ 0.4) → low cloud lit by distant towns (≥ 0.7; cities
always, at 4× the physical night dome so a city's sky glow reads above the floodlit-venue black).
Green, city and flat venues open under broken cumulus with the sun out of shot: no clear-sky photo
with a high sun and a clean horizon exists in the reachable set for them. The visible dome and every
PMREM bin crossfade the two neighbouring skies per pixel, so a weather transition is continuous; the
weather presets land on clear (0.12) and rain (0.95). Skies were chosen for a clean horizon (a photo
is drawn at infinity: a nearby hill or tree would tower over the circuit); see
`docs/ASSET_PROVENANCE.md`.

**Alignment and radiometry** (`src/rendering/assets/photo-sky.ts`). Each photo is rotated about +y
so its measured sun (moon or glow at night) stands under the scene's key light (`skyRotation`);
skies with a visible sun were chosen within 8° of the key's elevation (52° day, 10° golden hour —
tested), so shadows, shafts and the photographed sun agree. The photo is scaled to the
cosine-weighted mean radiance of the physical sky it replaces (`skyCosineRadiance`), which keeps
the sun, fill, exposure and IBL calibration of §1–§7; only the sky's content and colour change. The
aerial-perspective haze takes the photo's horizon colours (`fogPalette` → `aerialFogColor` and the
sun-side glow), so distant terrain dissolves into the photographed horizon. Cube captures (PMREM bins,
local probes) clip the photo at 16× the dome mean — the directional light carries the sun — and
replace the lower hemisphere with the calibrated ground (`SKY_GROUND_GLSL`). The visible dome never
shows the photographer's ground: below the recipe's `skyline` it fades over 1° into the sky just
above it, blurred across azimuth (a 64-texel-wide mip), so wherever the venue's terrain ends inside the
haze the horizon continues as haze, as the physical sky does. The skyline is 0° (horizon) for most
skies; 7.5° for the broken-cumulus sky (it also hides nearby poles, trees and farm buildings) and 5.5°
for the winter sky (a distant housing estate).

**Shader** (`photo-sky-shader.ts`, in the dome of `daylight.ts`). Two texture pairs (base sRGB
RGBA8 with mips and 4× anisotropy, gain R8), equirectangular lookup with seam-free `textureGrad`,
crossfade weight, capture clamp; `photoAmount` 1 skips the procedural sky entirely (no sky-view,
cloud or star fetches). Cost: 2 (4 while crossfading) texture fetches per sky pixel, 4 (8) below the
horizon. The diffuse IBL keeps the physical sky's blue/red balance (`irradianceSaturation`: clear
photographs run B/R 3–4.5 against the model's calibrated 2.4, which tinted sunlit asphalt blue);
the visible sky keeps the photograph's colour. The festival renderer, whose materials lack that
patch, gets the same balance in its PMREM captures (`photoCaptureSaturation`).

**Loading and memory.** Files load on demand (`fetch`, split at the manifest's gain-map offset,
`createImageBitmap` without colour management, off the main thread). Sessions wait for the skies of
their starting cover behind the loading screen (circuit `prepare`, festival boot; menu: the clear
sky during renderer creation); a later weather or lighting change loads in the background and the
dome keeps its loaded neighbour (or the procedural sky) until then, followed by one PMREM recapture.
At most four decoded skies stay resident. 4k: 0.3–1.4 MB download, ≈45 MB GPU (base 32 MB + mips,
gain 2 MB); 2k: 0.1–0.4 MB / ≈11 MB. All 13 skies at both sizes are 10.6 MB. LOW, a missing decoder (node tests), or a failed load keep the
physical sky (`console.warn`, no error dialog). `apexDiagnostics().renderer.photoSky` reports
palette, variant, shown pair and residents.

| Preset | Sky |
|---|---|
| Low | procedural physical sky (unchanged) |
| Medium | photographed, 2k |
| High / ULTRA | photographed, 4k |

**Asset APIs for other features** (`src/rendering/assets/`):

```ts
import { loadPbrSet } from '../rendering/assets/texture-loader.ts';
const set = await loadPbrSet(renderer.renderer, 'sandy-gravel-01', { repeat: 8, anisotropy: 8 });
const gravel = new T.MeshStandardMaterial({ ...set.maps });   // map, normalMap, roughnessMap, metalnessMap, aoMap (ORM)
set.metres;                                                   // physical size of one repeat
set.dispose();

import { loadEnvironment } from '../rendering/assets/environment-loader.ts';
const env = await loadEnvironment(renderer, 'quarry-02', { variant: '2k' });   // studio / showroom scenes
scene.background = env.background; scene.environment = env.environment;
scene.backgroundRotation.y = scene.environmentRotation.y = env.rotationFor(sunDirection);

import { thirdPartyAsset, creditLines } from '../rendering/assets/third-party.ts';
```

`loadPbrSet` prefers KTX2 (transcoder at `assets/basis/`, copied from three by the build) and
falls back to WebP per map; textures are cached per renderer and cloned per call. `loadEnvironment`
decodes the gain map on the GPU into a half-float equirect + PMREM (three's `UltraHDRLoader` /
`HDRLoader` for files without a manifest layout) and is reference counted. All loaders reject in
node, so unit tests and LOW keep the procedural paths. To add an asset: add a register entry
(pinned URL, SHA-256, size, licence, author, attribution, licence evidence, recipe), run
`node --experimental-transform-types scripts/assets/build-third-party.ts --tools <node_modules with
hdrify> [--toktx <path>]`, commit the register, the manifest and `public/assets/third-party/`.

## 8b. Photographic vegetation (D15)

Trees, shrubs and the grass band are baked from the CC BY 4.0 *Landscape* plants (Laubwerk; list,
licence and the stated modification in `docs/ASSET_PROVENANCE.md`) on HIGH and ULTRA. LOW, MEDIUM
(whose scenery draw/shadow budgets and browser surveys are measured on the procedural planting),
node tests and any failed load keep the procedural crowns (`landscape.ts`, `studio/forest-belts.ts`,
`open-world/vegetation.ts`) and the A51–A54 Aurel trees.

**Bake** (`scripts/assets/vegetation/`, run by `build-third-party.ts` for `"type": "vegetation"`
register entries). The pbrt scene object is read with its PLY meshes and PNG textures (`pbrt.ts`,
`ply.ts`, `plant.ts`: centimetres → metres, +Y up, trunk base at the origin). A leaf-area-density
volume of the whole plant gives every vertex its **sky visibility** — the cosine-weighted
transmittance `exp(−0.5·LAD·s)` over 48 upper-hemisphere rays (`canopy.ts`), i.e. ambient occlusion
through the crown. The **trunk and main limbs** are simplified with meshoptimizer
(`simplifyWithAttributes`, error ≤ 2 % of the plant height) to 1 200–9 000 triangles and keep their
visibility per vertex; one bark colour map and a normal map from the source displacement ship per
plant. The **crown** (leaves, needles, twigs, fine branches; 0.25–4 M source triangles) is split
into 80–480 area-weighted k-means clusters; each gets a card through its centroid (deciduous: the
cluster's thinnest axis turned 60 % outward; conifers: vertical, facing away from the trunk), sized
to hold every leaf it owns, and the cluster is rasterised orthographically onto it (`raster.ts`,
3×3 supersampled, mip-filtered alpha-tested textures) into a 2048² colour + coverage atlas and a
tangent-space normal + visibility atlas (shipped at 1024²). Shading normals are 45 % the crown's
ellipsoid normal, so cards and impostors light as one volume. The **impostor** is the whole plant
from eight azimuths (512² cells; 384 × 768 for firs). **Grass**: thin vertical slabs (0.45 m) of
two meadow patches from four azimuths, 512 × 256 tiles. KTX2 (ETC1S colour, UASTC + zstd normals,
mipmapped, rows bottom-first so atlas UVs match the WebP fallback) plus half-size WebP. Geometry is a
`.veg` container (`src/rendering/vegetation/format.ts`). Eight plants: 24.75 MB (KTX2 18.92 MB,
WebP fallbacks 4.68 MB, geometry 1.16 MB; a tree 3.56–4.11 MB, the shrub 1.11 MB, the grass 0.51 MB).

**Runtime** (`src/rendering/vegetation/`). `loadVenueVegetation` loads only the species the venue's
palette uses (`species.ts`; the same palette that picks its sky) before construction; the planting
step builds `PhotoPlanting` from the existing plans (`vegetationPlan`, `grovePlan`,
`forestBeltPlan`, `aurelVegetationPlan`, the venue-kit scatter shrubs, festival tile trees): the
planting zone's character (cypress, olive, upright, spreading…) or the crown aspect picks a role,
the palette and a position hash a species, the planned height a clamped uniform scale (0.55–1.75; the baked firs are young 8–9 m trees and
may grow to 2.6× for the belts' 14–28 m conifers)
and a tint; in venues planted with conifer rows (the forest theme) about two in three belt trees
are firs instead of 40 %. `PhotoForest` instances per 140–500 m chunk and species: impostors
always; cards + trunk only in chunks within the near distance, and there only for the plants within
it (+2.5 m), re-selected on the CPU whenever the eye has moved 2 m — the shader would collapse the
others, but at full vertex cost (hundreds of thousands of trunk triangles per chunk on software
GL). Materials (`materials.ts`, MeshStandardMaterial + chained hooks, also on the depth/distance
programs):

| | |
|---|---|
| Cards | turned 50 % toward the main-camera eye (`vegEye`, the same in colour and shadow passes); flutter by distance from the trunk, sway ∝ height² with the presented wind (`studioWind`) |
| LOD | per plant: cards/trunk fade out and impostors fade in over 6 m before the near distance with complementary screen-space dithers (no double draw, no hole); beyond it the near geometry collapses in the vertex shader |
| Impostor | quad about the trunk axis facing the camera; the two nearest views blended (colour, coverage, normal, visibility); light-facing in shadow passes (far map) |
| Coverage | alpha-to-coverage edges; alpha × (1 + 0.08 per mip, ≤ 0.24) against minification thinning |
| Light | baked visibility × indirect (and 45 % of direct) light; leaf transmission (back-lit diffuse 0.55, forward scatter 0.6, `pow 5`) added per shadowed light in a wrapped `RE_Direct` |
| Grass | three crossed cards per clump (tile, size, turn, tint per instance), normals 55 % toward the sky, half the baked meadow occlusion, sunk 7 % of their height (hides the patch's soil line), tips bend with the wind, clumps shrink into the ground at the grass distance |
| Contact | a soft dark disc (42 %) under each crown on the terrain slope, within 240 m, never a shadow caster |

| Preset | Near trees (cards + trunk) | Impostors | Grass band |
|---|---|---|---|
| Low, Medium | procedural crowns | — | — |
| High | ≤ 56 m | beyond | ≤ 40 m |
| ULTRA | ≤ 72 m | beyond | ≤ 55 m |

Grass (`grass.ts`): clumps every 0.75 m along the lap (up to eight per side and row, thinning
outward), from the barrier foot (only on grass run-off) to 16 m beyond it, never within the
barrier line of the nearest section (hairpins), stands, service areas or venue structures; venues
whose ground is not grass have none. Late-summer tiles (bare soil at the foot) are 85 % of clumps
at arid and desert venues, 30 % at flat ones and 6 % elsewhere. Near trees cast into
the moving sun map; impostors and belts reach the far map only (light-facing impostors).
`apexDiagnostics().renderer.photoVegetation` reports plants, chunks, near chunks, near plants drawn
with cards, species, failures and grass clumps.

## 9. Known limits

- SSR normals are reconstructed from depth (no MRT G-buffer): tessellated curvature can show as
  faceted reflections on low-polygon bodies; normal-mapped detail is not reflected. Single bounce;
  off-screen and camera-facing rays fall back to the probe. The probe term the resolve replaces is
  the followed car's local probe (box-filtered mips) while it owns the road and paint, otherwise the
  sky PMREM at its specular scale; rivals' paint uses its own environment, so its replacement is
  approximate.
- The roughness mask shares the HDR alpha with transparent blending; spray and glass over a glossy
  surface raise alpha and suppress SSR there (by design, not a physical result).
- TAA and temporal AO reproject cars rigidly; wheels, particles and skinned crew have no
  per-vertex velocity and rely on neighbourhood clamping.
- The mid cascade refreshes every second presented frame (one frame of lag on distant moving
  shadows); PCSS penumbrae are capped at 6 texels in every map.
- Sun shafts are screen-space: no shafts once the sun is well outside the frame, and no ray-marched
  in-scattering in shadowed air (the aerial-perspective haze remains the retained model).
- Photographed skies are static: the sun's azimuth follows the scene key by rotation, but its
  elevation is the photo's (within 8° for sunlit skies); a LIVE sky keeps the photo of the nearest
  lighting rather than the real time of day, and night is a fixed moonlit or town-lit sky. Clouds
  in the photo do not move or cast the (procedural) cloud shadows on the circuit. The photo's
  ground below the horizon is at infinity — wherever the venue's terrain ends inside the haze the
  photographed foreground can show through. 4k over 360° is about 11 px per degree, softer than
  the screen at 50–60° FOV.
- Photographic vegetation is a billboard cloud: within ~10 m a card shows as a flat, slightly
  swimming cluster of leaves; seen from below the crown, impostor views (horizontal only) read as
  the side of the tree. Held frames (no TAA) show the LOD crossfade stipple on the few trees inside
  the 6 m band. Species are temperate (linden, horse chestnut, birch, rowan, two firs, one
  flowering shrub, meadow grass): Mediterranean, desert and tropical venues show the nearest
  temperate stand-ins. Grass is a band along the lap, not a ground cover of the whole venue; the
  festival has no grass band. Wind sways whole trees and flutters cards, not individual leaves.
- Software rendering (CI SwiftShader/Mesa) proves function only. ULTRA frame cost, memory headroom
  and image quality need captures on named reference hardware (`HARDWARE_DEVICE_PLAYTEST_PROTOCOLS.md`)
  before any row moves beyond *integrated*.
