# FH6 reference pass — vegetation, seasons and ground cover (agent D)

Scope: Japanese flora and the four seasons of the festival region (Solvane).
Colours are medians (p20..p80) sampled from the 1920x1080 references with
`scratchpad/agentD/tools/sample.py` (sRGB as published, i.e. after the game's
grade; used as targets for the rendered result, not as raw albedo). Linear
albedo targets in code are noted where they differ.

Code (all presentation only; placement, trunk colliders, roads and physics are
unchanged):

- `src/rendering/open-world/flora-roles.ts` — planting roles (`FLORA_ROLE`:
  broadleaf, cherry, maple, cedar, pine, shrub, azalea, bamboo), smooth planting
  zones (`floraZone`, GLSL twin `FLORA_ZONE_GLSL`), role per placed tree
  (`floraRole`), role carried in the instance tint (`encodeRole`/`decodeRole`).
- `src/rendering/open-world/vegetation.ts` — `tileRoles` (road/town sampled from
  the tile shade data), role buckets and proportions (`ROLE_FORM`: the width
  ratio also picks the painted crown silhouette — sugi the conifer tile, maples
  the round lobes, cherries the widest), new `pineGeometry`/`pineTrunkGeometry`
  (black pine pads), photographic species per role (`ROLE_SPECIES`).
- `src/rendering/open-world/season-flora.ts` — season shading hooks chained on
  the festival's own material instances: `installSeasonFoliage`,
  `installSeasonBark`, `installSeasonGrass`, `installSeasonRoad(s)`,
  `installSeasonLibrary`, `installSeasonMeadow`.
- `src/rendering/open-world/terrain-material.ts` — seasonal grass, autumn leaf
  litter and susuki tint, spring petal drifts, winter snow cover of all but steep
  ground, rice-paddy / flower-strip plots on the lowland farms, dusty verge only
  at the shoulder (embankments stay grassed).
- `src/rendering/open-world/tile-data.ts` — the bare-soil verge band narrowed
  from 16 m to ~8.5 m from the centre line.
- `src/rendering/open-world/flora.ts` — `FestivalFlora`: streamed instanced
  susuki clumps and textured susuki field patches, wildflower tufts and bamboo
  groves (`planFloraChunk`, 144 m chunks, 1 chunk planned per frame).
- `src/rendering/open-world/festival-renderer.ts` — construct/update/dispose the
  flora, install the road/meadow/library season hooks (6 lines).

| Ref | Measured observation | What was implemented (file / symbol) | Remaining gap |
| --- | --- | --- | --- |
| 003 | Winter time-attack: hillside of dense conifers dusted with snow, median #768494 (p20 #5d6973, p80 #9fa9b7); snow banks on the verge #cacbd4 (p80); dark wet tarmac; bare deciduous trees grey-brown behind the barrier. | Winter: `owLeafSnow` (snow on upward crown normals, conifers hold 100 %, deciduous 75 %), cedar bronzing `owLeafSeason` (winter), verge snow banks and edge dusting with 18 % darker tarmac `installSeasonRoad`. | Snow is a colour layer on the crowns (no extra snow geometry or sagging branches); tarmac does not get wet reflections from the season (weather owns that). |
| 007 | Autumn roadside: Japanese maples scarlet-orange #bb5f3b (p20 #994c2a, p80 #d68867), yellow/olive broadleaf #715013 (#563e07..#8e6420), black pines among them; fallen red leaves along the kerb and verge. | `FLORA_ROLE.MAPLE` in maple zones (`floraZone(…, MAPLE_SEED)`, 50-70 % of broadleaf, 12 % elsewhere) recoloured scarlet→orange (linear 0.50,0.035,0.02 … 0.52,0.12,0.012); generic broadleaf per-tree yellow/orange/russet/olive; leaf litter on road edges `installSeasonRoad` (autumn). | Leaves are recoloured foliage-atlas cards, not maple-leaf geometry; no falling-leaf particles. |
| 010 | Winter paddock: melting snow patches on asphalt, wet dark tarmac, snow in the corners #c8c0eb lit. | Winter road dusting in noise patches toward the edges, darker tarmac (`installSeasonRoad`, asphalt). | No puddles/slush specular from the season alone. |
| 015 | Cherry avenue: Somei-yoshino crowns #a26f8f (p20 #6b4558, p80 #d6a9c8; graded magenta), dark trunks #705254 (#4e3637..#aa8387), the whole road carpeted with petals #9b6996, densest at the edges; trees overhang the road. | `FLORA_ROLE.CHERRY` for 88 % of roadside trees in cherry zones (`floraRole`, roadside from the tile road-carve within 9 m); wide low crowns `ROLE_FORM` [0.62 h, w 1.22 h]; blossom colour `owLeafSeason` (linear 0.58,0.35,0.43 … 0.72,0.58,0.63); darker purplish bark `installSeasonBark`; petal litter on asphalt and verges `owLitter` in `installSeasonRoad` (cherry zones, edge-weighted). | Petal coverage on the carriageway is lighter than 015's full carpet; no airborne petals. |
| 016 | Summer lakeside: deep green broadleaf #212c17 (#121b09..#3f4d34), meadow #636935 with orange lilies, snow-capped volcano. | Summer keeps the atlas greens (×0.94 R/B), azalea/flower tufts flowering red-orange in summer, wildflower tufts `flowerGeometry`. | Lily-specific flowers not modelled. |
| 019 | Garden: bamboo and fern leaves #2d3419 (#18190c..#4f5a2f), clipped shrubs, cobbles. | Bamboo leaf sprays (`bambooGeometry`, linear 0.06,0.12,0.035). | Garden-scale stone/shrub dressing is not part of this pass. |
| 021 | Spring hillside: cherry trees pink #956c6f (#4f3d45..#c99e9f) around a castle; fresh green/yellow meadow; Fuji. | Cherry roles in towns/parks (70 % in zone), spring grass `springG` (terrain) and fresh blades `installSeasonGrass`. | — |
| 022 | Alpine: grass patches #474c27 (#343719..#606540) between rock and snow fields. | Unchanged terrain rock/snow layers; summer grass. | Alpine snow patches in summer stay altitude-driven (unchanged). |
| 026 | Summer temple: Japanese black pines with flat layered pads #393f27 (#202414..#616a4c) on leaning trunks; clipped hedges. | `pineGeometry` (6 flat domed pads) + `pineTrunkGeometry` (kinked leaning trunk and limbs), `FLORA_ROLE.PINE` in towns (45 %), coast (<45 m, 50 %) and low hills. | Pads are smooth domes, not needle tufts; no cloud-pruning variation per tree. |
| 027 | Autumn temple: maple crowns red/pink backlit #c78463 (#825332..#f9d5be), orange #a6591b (#6d3e0c..#df7d29), pines stay green. | Maple/broadleaf autumn palettes; pines/cedars keep green (`owLeafSeason`, roles 3/4). | Backlit translucency is the existing vegetation transmission only. |
| 028 | Autumn night: rice paddies (green rice with a flooded plot reflecting), autumn trees yellow-brown. | Paddy plots on the flat lowland farms (`terrain-material.ts`: 34 x 61 m plots, 0.5 m grass bunds, flooded with roughness 0.06 in spring, rice green in summer, gold/stubble in autumn). | Water plots do not use the water shader (no ripples or true reflections beyond the environment map). |
| 029 | Summer sea of clouds: red-orange azaleas #af2704 (#9f1e00..#c4320d) on dark foliage #281a08, cedars silhouetted. | `FLORA_ROLE.AZALEA` (22-52 % of shrubs) flowering magenta/pink/white in spring, red-orange in summer (`owLeafSeason`, role 6). | Flowers are recoloured leaf speckles on the shrub crown, not separate blossoms. |
| 032 | Late-summer meadow: grass #3c3610 (#232303..#615225) with pampas plumes #77592b (#513f15..#9e7443) catching the low sun, conifers and broadleaf behind. | `FestivalFlora` susuki clumps (`susukiGeometry`: 9 arching blades + 5 plume stalks, 1.5-2.4 m) on verges (≤10 m from the road, 22 % of 3.2 m cells) and textured field patches (`susukiFieldGeometry`, 8 cards; blades in the green channel, plumes in the red) inside susuki zones; plumes open from late summer (75 %). | Plume cards are coarse at very close range; no flattening where cars drive through. |
| 033 | Castle: weeping cherries #7b6061 (#46363c..#c7a29e) lining a gravel track with petals on the ground; black pines; green shrubs. | Cherry roles + petal litter on dirt tracks/verges; terrain petal drifts under cherry zones in spring. | Weeping (shidare) crown shape not distinguished. |
| 036 | Susuki hills: golden fields #c5a57d (#776548..#e5c69a) covering whole slopes; dark forest #363c35. | Field patches nearly touching (up to 85 % of cells) inside the zones, gold plumes linear 0.56,0.42,0.24 … 0.72,0.62,0.46; terrain autumn tint toward linear 0.44,0.36,0.22 in the same zones so the field reads gold beyond the 130 m (MEDIUM) draw distance — measured rendered terrain #b59d71 vs reference #c5a57d. | Patches are cards: from above they thin out; the far field is only a terrain tint. |
| 039 | City park: pale cherries #ada39f (#746767..#ebe0da), lush green deciduous trees, clipped round shrubs, petals on the pond. | Cherry roles in towns (shade.w > 0.05 → 70 % in zone). | No petals on water; park layout unchanged. |
| 041 | Autumn drift venue: forested hill with orange/yellow broadleaf (#2a2117 shaded), cedars. | Broadleaf autumn palette, cedar plantations (`CEDAR_SEED` zones). | — |
| 042 | Autumn: dry grass slopes #bba248 (#a58e3b..#ccb15c) yellow straw, orange woods. | Terrain `autumnG` straw (linear 0.30,0.225,0.095 … 0.20,0.12,0.055) and blades `installSeasonGrass` autumn. | — |
| 050 | Touge from above: cherries #d2b6be (#b89ea1..#f0d4dd) clustered along the hairpins among green broadleaf and conifers; petals drift on verges and road edges; paddies patchwork top right. | Roadside cherries in zones; petals concentrated at edges (`edge` term) and in drifts (`drift` noise); paddy plots. | — |
| 051 | Flower farm: striped fields of red #a1383c, yellow, purple and white flowers. | 14 % of the farm plots are flower strips (7.5 m bands: red, yellow, purple, white, pink) in spring and summer (`terrain-material.ts`). | Flowers are a terrain colour, not 3-D stems (tufts only in meadows). |
| 052 | Autumn forest: tall pines/cedars with bare lower trunks, red/orange maple understorey, ferns; leaf litter #3a2711 (#2a1c08..#5b3b1c). | Sugi drawn with the painted conifer crown (1.15 × height, width 0.5) among maples/broadleaf in autumn colours; forest-floor litter (linear 0.15,0.065,0.028) in autumn (`autumnG` × forest); leaf litter on dirt tracks. | No fern layer; sugi keep foliage low (the shared crown shaping), unlike the bare lower trunks of 052/093. |
| 057 | Sun shafts through a roadside forest at dawn. | Lighting is another worker's area; foliage receives the existing shafts. | — |
| 060 | Snow-laden conifers ("snow monsters") #cec4cb (#aeaabb..#ded4d6), deep snow. | Conifer snow cover on upward normals (`owLeafSnow`, hold 1.0); winter terrain snow. | No juhyo snow-mass geometry; conifers stay recognisably green below the snow. |
| 064 | Winter village: snow ground #aeb6c2 (#5c616e..#e0e6f2), dark conifers with snow #474b4d, bare grey-brown deciduous crowns, snow-covered fields with furrows. | Terrain winter snow on ground with normal.y > ~0.72 (`owSnowCover`); bare deciduous crowns (`owLeafKeep`: twigs + 20 % dry leaves, colour linear 0.075,0.064,0.055); conifer snow. | Roof snow belongs to the buildings worker. |
| 070 | Snow corridor: 8-12 m snow walls #a1a4b1 (#838492..#b9bcc7) with layered strata. | Not implemented (would need new road-side geometry; road owner). | Snow walls missing. |
| 073 | Snow race: snow ground #cac6d4 (#a4a7c0..#d9d1dc), frosted trees. | Winter terrain snow + conifer/broadleaf snow tint. | — |
| 090 | Autumn road to Fuji: mixed red/orange/yellow roadside trees #8e5e3e (#61422e..#bb8962), tall straight pines/cedars, leaves on the shoulder. | Broadleaf/maple autumn palettes, cedars, leaf litter on asphalt edges. | — |
| 093 | Cedar avenue: tall straight trunks bare to ~55-60 % of the height #5f4b41 (#312a26..#997d62), narrow dark crowns #43482c (#282b1a..#71794c). | `FLORA_ROLE.CEDAR` (all placed conifers not chosen as pines, plus sugi plantation zones `CEDAR_SEED` > 0.6 above 60 m) drawn with the painted conifer crown cards at 1.15 × height; red-brown bark tint (`installSeasonBark` ×1.02, 0.80, 0.70); slight winter bronzing. A first pass with solid ragged cones (`cedarGeometry`) was dropped after the captures: the flat cones read as toy spruces next to the textured crowns. | Crowns are spruce-like spires with foliage to the ground; no bare lower trunks; colour is the shared atlas green, a little brighter than 093. |
| 096 | City cherries: dense blossom #d0a2b7 (#ae8493..#efc5d8) over a road with a pink petal haze. | Cherry blossom + road petals. | — |
| 099 | Bamboo grove: culms #1f2611 (#151c08..#3c4d32) 10-14 m, a few cm thick at 0.3-0.6 m spacing; feathery leaf canopy #354732 (#273524..#597352). | `bambooGeometry` (16 culms 9-13 m, r 0.035-0.05 m within 2.2 m, node rings every 0.45 m in the shader, 64 drooping leaf sprays 2.1-3.4 m) in groves at forest edges (`BAMBOO_SEED` zone > 0.74, 30 % of 3.2 m cells, ≥7 m from the road), casting shadows, drawn to 300 m (MEDIUM). | Canopy still thinner than 099's; culms are triangular prisms (fine at driving distance); no ground litter. |
