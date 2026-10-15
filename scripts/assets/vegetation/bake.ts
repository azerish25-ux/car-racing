/**
 * Vegetation bake: turns one full-resolution landscape plant into a real-time
 * asset (plant space: metres, +Y up, trunk base at the origin).
 *
 *   trunk     the bark meshes (trunk and main limbs), simplified with
 *             meshoptimizer to a triangle budget, with per-vertex sky
 *             visibility; one bark colour + normal map (from the source's
 *             displacement map).
 *   cards     a billboard cloud: the crown (leaves, needles, twigs, fine
 *             branches) is split into k-means clusters, each drawn
 *             orthographically onto its own fitted card in a colour+coverage
 *             atlas and a tangent-space normal + sky-visibility atlas.
 *   impostor  the whole plant drawn from `views` azimuths around the trunk
 *             axis into a colour+coverage and a normal + visibility atlas.
 *   grass     (meadow patches) side views of the patch as clump cards.
 *
 * Sky visibility is volumetric ambient occlusion through the crown's leaf
 * area density (canopy.ts). Shading normals blend each leaf's normal with the
 * crown's ellipsoidal normal so cards and impostors shade as one volume.
 * Everything is deterministic for a given source and recipe. Node only.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import {
  CanopyVolume,
  clusterCrown,
  crownTriangles,
  fitCards,
  packCards,
  random,
  type Card,
  type CardOptions,
} from './canopy.ts';
import { linearToSrgbByte, loadHeight, loadTexture, type Texture } from './image.ts';
import { loadPlant, type Plant, type PlantRecipeSpec } from './plant.ts';
import {
  RasterTarget,
  rasterize,
  resolve,
  type BakeMesh,
  type OrthoView,
  type Vec3,
} from './raster.ts';

export interface TreeRecipe extends PlantRecipeSpec {
  type: 'vegetation';
  form: 'tree' | 'shrub' | 'grass';
  /** Number of crown cards (clusters). */
  cards: number;
  cardOrientation: CardOptions['orientation'];
  outwardBias: number;
  /** Card atlas size [w, h] (px). */
  cardAtlas: [number, number];
  /** Impostor views around the axis and the cell size [w, h] (px). */
  views: number;
  impostorCell: [number, number];
  /** Trunk triangle budget after simplification. */
  trunkTriangles: number;
  /** Shipped bark texture size [w, h] (px). */
  barkSize: [number, number];
  /** Share of the crown's ellipsoid normal in the shading normals. */
  crownNormal: number;
  /** Supersampling per axis. */
  supersample: number;
}

export interface Image8 {
  width: number;
  height: number;
  /** RGBA rows top to bottom. */
  data: Uint8Array;
  colorSpace: 'srgb' | 'linear';
}

export interface BakedVegetation {
  info: VegetationInfo;
  images: Record<string, Image8>;
  geometry: Uint8Array;
}

export interface VegetationInfo {
  form: 'tree' | 'shrub' | 'grass';
  /** Plant height and crown radius (m). */
  height: number;
  radius: number;
  bounds: number[];
  /** Crown centre height (m) for the crown normal. */
  crownCentreY: number;
  trunkTriangles: number;
  cards: number;
  /** Card atlas texel density (px/m). */
  cardDensity: number;
  views: number;
  /** Impostor quad: half width and height (m), base at y = 0. */
  impostorHalfWidth: number;
  impostorHeight: number;
  impostorColumns: number;
  impostorRows: number;
  /** Mean albedo of the crown (linear), for distant tints. */
  crownAlbedo: Vec3;
  sourceTriangles: number;
}

const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

function crownEllipsoid(plant: Plant) {
  // Crown from the lowest crown triangle to the top.
  let low = Infinity;
  for (const p of plant.parts) {
    if (p.role !== 'crown') continue;
    for (let v = 1; v < p.positions.length; v += 3) low = Math.min(low, p.positions[v]);
  }
  if (!Number.isFinite(low)) low = 0;
  const centreY = (low + plant.height) / 2;
  const radiusY = Math.max(0.5, (plant.height - low) / 2);
  return { centreY, radiusY, radiusXZ: Math.max(0.3, plant.radius) };
}

function blendCrownNormal(
  n: Vec3,
  p: Vec3,
  ellipsoid: ReturnType<typeof crownEllipsoid>,
  share: number,
): Vec3 {
  const c = normalize([
    p[0] / ellipsoid.radiusXZ ** 2,
    (p[1] - ellipsoid.centreY) / ellipsoid.radiusY ** 2,
    p[2] / ellipsoid.radiusXZ ** 2,
  ]);
  return normalize([
    n[0] * (1 - share) + c[0] * share,
    n[1] * (1 - share) + c[1] * share,
    n[2] * (1 - share) + c[2] * share,
  ]);
}

/** Linear albedo + coverage and frame-space normal + visibility -> 8-bit images. */
function encodeTile(
  out: { color: Uint8Array; normal: Uint8Array; width: number },
  x0: number,
  y0: number,
  w: number,
  h: number,
  albedo: Float32Array,
  normal: Float32Array,
  frame: { right: Vec3; up: Vec3; front: Vec3 },
) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x,
        o = ((y0 + y) * out.width + x0 + x) * 4;
      out.color[o] = linearToSrgbByte(albedo[p * 4]);
      out.color[o + 1] = linearToSrgbByte(albedo[p * 4 + 1]);
      out.color[o + 2] = linearToSrgbByte(albedo[p * 4 + 2]);
      out.color[o + 3] = Math.round(Math.min(1, albedo[p * 4 + 3]) * 255);
      const n: Vec3 = [normal[p * 4], normal[p * 4 + 1], normal[p * 4 + 2]];
      const tx = n[0] * frame.right[0] + n[1] * frame.right[1] + n[2] * frame.right[2],
        ty = n[0] * frame.up[0] + n[1] * frame.up[1] + n[2] * frame.up[2],
        tz = Math.max(0, n[0] * frame.front[0] + n[1] * frame.front[1] + n[2] * frame.front[2]);
      const l = Math.hypot(tx, ty, tz) || 1;
      out.normal[o] = Math.round((tx / l) * 127.5 + 127.5);
      out.normal[o + 1] = Math.round((ty / l) * 127.5 + 127.5);
      out.normal[o + 2] = Math.round((tz / l) * 127.5 + 127.5);
      out.normal[o + 3] = Math.round(Math.min(1, Math.max(0, normal[p * 4 + 3])) * 255);
    }
}

/** Replace resolved normals by the crown-blended normals (pixel positions
 * from the view and depth). */
function shadeNormals(
  resolved: ReturnType<typeof resolve>,
  view: OrthoView,
  ellipsoid: ReturnType<typeof crownEllipsoid>,
  share: number,
) {
  const { width, height, normal, depth } = resolved;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!Number.isFinite(depth[p])) continue;
      const u = ((x + 0.5) / width - 0.5) * view.width,
        v = (0.5 - (y + 0.5) / height) * view.height,
        d = depth[p];
      const pos: Vec3 = [0, 1, 2].map(
        (c) => view.origin[c] + view.right[c] * u + view.up[c] * v + view.forward[c] * d,
      ) as Vec3;
      const n = blendCrownNormal(
        [normal[p * 4], normal[p * 4 + 1], normal[p * 4 + 2]],
        pos,
        ellipsoid,
        share,
      );
      normal[p * 4] = n[0];
      normal[p * 4 + 1] = n[1];
      normal[p * 4 + 2] = n[2];
    }
}

/** Simplify the trunk parts into one indexed mesh (positions, normals, uvs,
 * visibility). UV islands stay intact; the budget is a target, not a cap. */
async function simplifyTrunk(plant: Plant, budget: number) {
  await MeshoptSimplifier.ready;
  const trunk = plant.parts.filter((p) => p.role === 'trunk');
  let vertices = 0,
    indices = 0;
  for (const p of trunk) {
    vertices += p.positions.length / 3;
    indices += p.indices.length;
  }
  const positions = new Float32Array(vertices * 3),
    attributes = new Float32Array(vertices * 6),
    index = new Uint32Array(indices);
  let v = 0,
    i = 0;
  for (const p of trunk) {
    positions.set(p.positions, v * 3);
    for (let k = 0; k < p.positions.length / 3; k++) {
      attributes.set([p.normals[k * 3], p.normals[k * 3 + 1], p.normals[k * 3 + 2]], (v + k) * 6);
      attributes[(v + k) * 6 + 3] = p.uvs[k * 2];
      attributes[(v + k) * 6 + 4] = p.uvs[k * 2 + 1];
      attributes[(v + k) * 6 + 5] = p.visibility[k];
    }
    for (let k = 0; k < p.indices.length; k++) index[i + k] = p.indices[k] + v;
    v += p.positions.length / 3;
    i += p.indices.length;
  }
  if (!indices) return null;
  const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
    index,
    positions,
    3,
    attributes,
    6,
    [0.4, 0.4, 0.4, 0.02, 0.02, 0.1],
    null,
    Math.min(index.length, budget * 3),
    // Up to 2 % of the plant height: fine limbs fold into the crown cards.
    Math.max(0.05, plant.height * 0.02),
    ['ErrorAbsolute', 'Prune'],
  );
  // Compact to the used vertices.
  const remap = new Int32Array(vertices).fill(-1);
  let used = 0;
  for (const k of simplified) if (remap[k] < 0) remap[k] = used++;
  const out = {
    position: new Float32Array(used * 3),
    normal: new Float32Array(used * 3),
    uv: new Float32Array(used * 2),
    visibility: new Float32Array(used),
    index: new Uint32Array(simplified.length),
  };
  for (let k = 0; k < vertices; k++) {
    const r = remap[k];
    if (r < 0) continue;
    out.position.set(positions.subarray(k * 3, k * 3 + 3), r * 3);
    out.normal.set(attributes.subarray(k * 6, k * 6 + 3), r * 3);
    out.uv.set(attributes.subarray(k * 6 + 3, k * 6 + 5), r * 2);
    out.visibility[r] = attributes[k * 6 + 5];
  }
  for (let k = 0; k < simplified.length; k++) out.index[k] = remap[simplified[k]];
  return out;
}

/** The dominant bark part's colour and a normal map from its displacement. */
function bakeBark(root: string, plant: Plant, size: [number, number]) {
  const trunk = plant.parts
    .filter((p) => p.role === 'trunk' && p.part.color)
    .sort((a, b) => b.area - a.area)[0];
  if (!trunk) return null;
  const join = (rel: string) => `${root}/${rel}`;
  const colorTexture = loadTexture(join(trunk.part.color!), null, Math.max(...size) * 2);
  const [w, h] = size;
  const color = new Uint8Array(w * h * 4);
  // Box-resample the top level to the shipped size.
  const level = colorTexture.levels[0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x / w) * level.width),
        sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / w) * level.width)),
        sy0 = Math.floor((y / h) * level.height),
        sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) / h) * level.height));
      const acc = [0, 0, 0];
      let k = 0;
      for (let yy = sy0; yy < sy1; yy++)
        for (let xx = sx0; xx < sx1; xx++) {
          const i = (yy * level.width + xx) * 4;
          acc[0] += level.rgba[i];
          acc[1] += level.rgba[i + 1];
          acc[2] += level.rgba[i + 2];
          k++;
        }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) color[o + c] = linearToSrgbByte(acc[c] / k);
      color[o + 3] = 255;
    }
  // Normal map: Sobel of the displacement (or of the colour's luminance).
  const height = loadHeight(join(trunk.part.bump ?? trunk.part.color!), Math.max(w, h));
  const normal = new Uint8Array(w * h * 4);
  const H = (x: number, y: number) => {
    const sx = Math.min(
        height.width - 1,
        Math.max(0, Math.floor(((((x % w) + w) % w) / w) * height.width)),
      ),
      sy = Math.min(
        height.height - 1,
        Math.max(0, Math.floor(((((y % h) + h) % h) / h) * height.height)),
      );
    return height.data[sy * height.width + sx];
  };
  const strength = 3.2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx =
        H(x + 1, y - 1) +
        2 * H(x + 1, y) +
        H(x + 1, y + 1) -
        H(x - 1, y - 1) -
        2 * H(x - 1, y) -
        H(x - 1, y + 1);
      const dy =
        H(x - 1, y + 1) +
        2 * H(x, y + 1) +
        H(x + 1, y + 1) -
        H(x - 1, y - 1) -
        2 * H(x, y - 1) -
        H(x + 1, y - 1);
      // Image rows go down; OpenGL normal maps have +Y up.
      const n = normalize([-dx * strength, dy * strength, 1]);
      const o = (y * w + x) * 4;
      normal[o] = Math.round(n[0] * 127.5 + 127.5);
      normal[o + 1] = Math.round(n[1] * 127.5 + 127.5);
      normal[o + 2] = Math.round(n[2] * 127.5 + 127.5);
      normal[o + 3] = 255;
    }
  return {
    color: { width: w, height: h, data: color, colorSpace: 'srgb' as const },
    normal: { width: w, height: h, data: normal, colorSpace: 'linear' as const },
  };
}

/** Card records: 20 floats each (centre, right, up, normal, half extents,
 * atlas UV rectangle, flex, phase). */
export const CARD_FLOATS = 20;

/** The geometry container: 'VEG1', JSON length, JSON, 4-byte aligned blobs. */
function container(json: Record<string, unknown>, blobs: Record<string, ArrayBufferView>) {
  const layout: Record<string, { offset: number; length: number; type: string }> = {};
  let offset = 0;
  const views: Uint8Array[] = [];
  for (const [name, view] of Object.entries(blobs)) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    layout[name] = { offset, length: bytes.length, type: view.constructor.name };
    views.push(bytes);
    offset += Math.ceil(bytes.length / 4) * 4;
  }
  let header = new TextEncoder().encode(JSON.stringify({ ...json, layout }));
  const padded = Math.ceil(header.length / 4) * 4;
  if (padded !== header.length) {
    const h = new Uint8Array(padded).fill(0x20);
    h.set(header);
    header = h;
  }
  const out = new Uint8Array(8 + header.length + offset);
  out.set([0x56, 0x45, 0x47, 0x31]);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  let at = 8 + header.length;
  for (const bytes of views) {
    out.set(bytes, at);
    at += Math.ceil(bytes.length / 4) * 4;
  }
  return out;
}

export async function bakeTree(
  root: string,
  recipe: TreeRecipe,
  seed: number,
  log: (...parts: unknown[]) => void,
): Promise<BakedVegetation & { plant: Plant; cards: Card[] }> {
  const t0 = Date.now();
  const plant = loadPlant(root, recipe);
  const sourceTriangles = plant.parts.reduce((s, p) => s + p.indices.length / 3, 0);
  log(
    `${recipe.object}: ${plant.parts.length} parts, ${sourceTriangles} triangles, ${plant.height.toFixed(2)} m tall, crown radius ${plant.radius.toFixed(2)} m (${Date.now() - t0} ms)`,
  );
  const ellipsoid = crownEllipsoid(plant);
  // Volumetric sky visibility.
  const volume = new CanopyVolume(plant.bounds, Math.max(0.08, plant.height / 48));
  volume.deposit(plant.parts);
  volume.solve();
  volume.apply(plant.parts);
  log(`  canopy volume ${volume.n.join('x')} solved (${Date.now() - t0} ms)`);

  // Crown clusters and cards.
  const crown = crownTriangles(plant.parts);
  const { labels } = clusterCrown(crown, recipe.cards, seed);
  const cards = fitCards(plant.parts, crown, labels, recipe.cards, {
    orientation: recipe.cardOrientation,
    outwardBias: recipe.outwardBias,
    crownCentreY: ellipsoid.centreY,
  });
  const [aw, ah] = recipe.cardAtlas;
  const density = packCards(cards, aw, ah);
  log(`  ${cards.length} cards at ${density.toFixed(1)} px/m (${Date.now() - t0} ms)`);
  const cardColor = new Uint8Array(aw * ah * 4),
    cardNormal = new Uint8Array(aw * ah * 4);
  // Unused atlas space: mid grey, flat normal, open sky.
  for (let p = 0; p < aw * ah; p++) {
    cardColor.set([60, 70, 45, 0], p * 4);
    cardNormal.set([128, 128, 255, 255], p * 4);
  }
  // Members by part, so each card rasterises part by part.
  let albedoSum: Vec3 = [0, 0, 0],
    albedoWeight = 0;
  for (const card of cards) {
    const [x, y, w, h] = card.atlas;
    const target = new RasterTarget(w, h, recipe.supersample);
    const view: OrthoView = {
      origin: card.centre,
      right: card.right,
      up: card.up,
      forward: [-card.normal[0], -card.normal[1], -card.normal[2]],
      width: (w / density) * 1,
      height: (h / density) * 1,
      near: -1e3,
      far: 1e3,
    };
    // Exact rectangle in metres for this pixel footprint.
    view.width = card.halfWidth * 2;
    view.height = card.halfHeight * 2;
    const byPart = new Map<number, number[]>();
    for (const m of card.members) {
      const part = crown.part[m];
      let list = byPart.get(part);
      if (!list) byPart.set(part, (list = []));
      list.push(crown.triangle[m]);
    }
    for (const [part, triangles] of byPart) rasterize(target, view, plant.parts[part], triangles);
    const resolved = resolve(target, 4);
    shadeNormals(resolved, view, ellipsoid, recipe.crownNormal);
    for (let p = 0; p < w * h; p++) {
      const a = resolved.albedo[p * 4 + 3];
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) albedoSum[c] += resolved.albedo[p * 4 + c] * a;
      albedoWeight += a;
    }
    encodeTile(
      { color: cardColor, normal: cardNormal, width: aw },
      x,
      y,
      w,
      h,
      resolved.albedo,
      resolved.normal,
      { right: card.right, up: card.up, front: card.normal },
    );
  }
  albedoSum = albedoSum.map((v) => v / Math.max(1e-6, albedoWeight)) as Vec3;
  log(`  card atlas drawn (${Date.now() - t0} ms)`);

  // Impostor views around the axis (azimuth k * 360 / views, horizontal).
  const [cw, ch] = recipe.impostorCell;
  const columns = Math.ceil(Math.sqrt(recipe.views * (ch / cw))),
    rows = Math.ceil(recipe.views / columns);
  const iw = cw * columns,
    ih = ch * rows;
  const impColor = new Uint8Array(iw * ih * 4),
    impNormal = new Uint8Array(iw * ih * 4);
  for (let p = 0; p < iw * ih; p++) {
    impColor.set([60, 70, 45, 0], p * 4);
    impNormal.set([128, 128, 255, 255], p * 4);
  }
  // Square-ish frame: the widest horizontal extent in any direction.
  let halfWidth = 0;
  for (const p of plant.parts)
    for (let v = 0; v < p.positions.length; v += 3)
      halfWidth = Math.max(halfWidth, Math.hypot(p.positions[v], p.positions[v + 2]));
  halfWidth *= 1.02;
  const impostorHeight = plant.height * 1.02;
  for (let k = 0; k < recipe.views; k++) {
    const angle = (k / recipe.views) * Math.PI * 2;
    // The viewer stands at azimuth `angle` (x = sin, z = cos) looking at the axis.
    const front: Vec3 = [Math.sin(angle), 0, Math.cos(angle)];
    const right: Vec3 = [Math.cos(angle), 0, -Math.sin(angle)];
    const view: OrthoView = {
      origin: [0, impostorHeight / 2, 0],
      right,
      up: [0, 1, 0],
      forward: [-front[0], -front[1], -front[2]],
      width: halfWidth * 2,
      height: impostorHeight,
      near: -1e3,
      far: 1e3,
    };
    const target = new RasterTarget(cw, ch, recipe.supersample);
    for (const part of plant.parts) rasterize(target, view, part);
    const resolved = resolve(target, 6);
    shadeNormals(resolved, view, ellipsoid, recipe.crownNormal);
    encodeTile(
      { color: impColor, normal: impNormal, width: iw },
      (k % columns) * cw,
      Math.floor(k / columns) * ch,
      cw,
      ch,
      resolved.albedo,
      resolved.normal,
      { right, up: [0, 1, 0], front },
    );
  }
  log(`  ${recipe.views} impostor views ${iw}x${ih} (${Date.now() - t0} ms)`);

  const trunk = await simplifyTrunk(plant, recipe.trunkTriangles);
  const bark = bakeBark(root, plant, recipe.barkSize);
  log(`  trunk ${trunk ? trunk.index.length / 3 : 0} triangles (${Date.now() - t0} ms)`);

  // Card records.
  const rnd = random(seed + 1);
  const records = new Float32Array(cards.length * CARD_FLOATS);
  cards.forEach((card, i) => {
    const [x, y, w, h] = card.atlas;
    const r = Math.hypot(card.centre[0], card.centre[2]);
    const flex =
      Math.min(1, r / Math.max(0.3, plant.radius)) * 0.7 +
      Math.min(1, card.centre[1] / plant.height) * 0.3;
    records.set(
      [
        ...card.centre,
        ...card.right,
        ...card.up,
        ...card.normal,
        card.halfWidth,
        card.halfHeight,
        x / aw,
        1 - (y + h) / ah,
        (x + w) / aw,
        1 - y / ah,
        flex,
        rnd() * Math.PI * 2,
      ],
      i * CARD_FLOATS,
    );
  });
  const info: VegetationInfo = {
    form: recipe.form,
    height: +plant.height.toFixed(4),
    radius: +plant.radius.toFixed(4),
    bounds: plant.bounds.map((v) => +v.toFixed(4)),
    crownCentreY: +ellipsoid.centreY.toFixed(4),
    trunkTriangles: trunk ? trunk.index.length / 3 : 0,
    cards: cards.length,
    cardDensity: +density.toFixed(3),
    views: recipe.views,
    impostorHalfWidth: +halfWidth.toFixed(4),
    impostorHeight: +impostorHeight.toFixed(4),
    impostorColumns: columns,
    impostorRows: rows,
    crownAlbedo: albedoSum.map((v) => +v.toFixed(5)) as Vec3,
    sourceTriangles,
  };
  const blobs: Record<string, ArrayBufferView> = { cards: records };
  if (trunk) {
    blobs.trunkPosition = trunk.position;
    blobs.trunkNormal = trunk.normal;
    blobs.trunkUv = trunk.uv;
    blobs.trunkVisibility = trunk.visibility;
    blobs.trunkIndex = trunk.index.length / 3 < 21000 ? Uint16Array.from(trunk.index) : trunk.index;
  }
  const geometry = container({ version: 1, ...info }, blobs);
  const images: Record<string, Image8> = {
    cards_color: { width: aw, height: ah, data: cardColor, colorSpace: 'srgb' },
    cards_normal: { width: aw, height: ah, data: cardNormal, colorSpace: 'linear' },
    impostor_color: { width: iw, height: ih, data: impColor, colorSpace: 'srgb' },
    impostor_normal: { width: iw, height: ih, data: impNormal, colorSpace: 'linear' },
  };
  if (bark) {
    images.bark_color = bark.color;
    images.bark_normal = bark.normal;
  }
  log(`  done (${Date.now() - t0} ms)`);
  return { info, images, geometry, plant, cards };
}

export type { BakeMesh, Texture };

export interface GrassRecipe {
  type: 'vegetation';
  form: 'grass';
  /** Meadow patch objects (pbrt names) and their up axis. */
  patches: { object: string; up: 'y' | 'z'; exclude?: string[]; tints?: Record<string, Vec3> }[];
  /** Side views per patch (azimuths) and the slab depth (m) each view keeps. */
  views: number;
  slab: number;
  /** Tile size (px) and the metres it covers [w, h]. */
  tile: [number, number];
  tileMetres: [number, number];
  crownNormal: number;
  supersample: number;
}

/**
 * Grass clump cards: each tile is a thin vertical slab of a meadow patch seen
 * from the side (colour + coverage, tangent normal + visibility), so crossed
 * clump cards show real blades, seed heads and weeds.
 */
export async function bakeGrass(
  root: string,
  recipe: GrassRecipe,
  log: (...parts: unknown[]) => void,
): Promise<BakedVegetation> {
  const [tw, th] = recipe.tile;
  const tiles = recipe.patches.length * recipe.views;
  const columns = Math.max(1, Math.round(Math.sqrt((tiles * th) / tw))),
    rows = Math.ceil(tiles / columns);
  const aw = tw * columns,
    ah = th * rows;
  const color = new Uint8Array(aw * ah * 4),
    normal = new Uint8Array(aw * ah * 4);
  for (let p = 0; p < aw * ah; p++) {
    color.set([70, 80, 45, 0], p * 4);
    normal.set([128, 128, 255, 255], p * 4);
  }
  let tile = 0;
  let maxHeight = 0;
  const albedo: Vec3 = [0, 0, 0];
  let albedoWeight = 0;
  for (const patch of recipe.patches) {
    const plant = loadPlant(
      root,
      { object: patch.object, up: patch.up, trunk: [], exclude: patch.exclude, tints: patch.tints },
      512,
    );
    maxHeight = Math.max(maxHeight, plant.height);
    const volume = new CanopyVolume(plant.bounds, Math.max(0.03, plant.height / 24));
    volume.deposit(plant.parts);
    volume.solve(32, 0.5);
    volume.apply(plant.parts);
    const ellipsoid = {
      centreY: 0,
      radiusY: Math.max(0.2, plant.height),
      radiusXZ: Math.max(0.3, plant.radius * 2),
    };
    for (let k = 0; k < recipe.views; k++) {
      const angle = (k / recipe.views) * Math.PI;
      const front: Vec3 = [Math.sin(angle), 0, Math.cos(angle)];
      const right: Vec3 = [Math.cos(angle), 0, -Math.sin(angle)];
      // Alternate slabs a little in front of and behind the centre.
      const offset = ((k % 2) - 0.5) * recipe.slab * 0.6;
      const view: OrthoView = {
        origin: [front[0] * offset, recipe.tileMetres[1] / 2, front[2] * offset],
        right,
        up: [0, 1, 0],
        forward: [-front[0], 0, -front[2]],
        width: recipe.tileMetres[0],
        height: recipe.tileMetres[1],
        near: -recipe.slab / 2,
        far: recipe.slab / 2,
      };
      const target = new RasterTarget(tw, th, recipe.supersample);
      for (const part of plant.parts) rasterize(target, view, part);
      const resolved = resolve(target, 6);
      shadeNormals(resolved, view, ellipsoid, recipe.crownNormal);
      for (let p = 0; p < tw * th; p++) {
        const a = resolved.albedo[p * 4 + 3];
        for (let c = 0; c < 3; c++) albedo[c] += resolved.albedo[p * 4 + c] * a;
        albedoWeight += a;
      }
      encodeTile(
        { color, normal, width: aw },
        (tile % columns) * tw,
        Math.floor(tile / columns) * th,
        tw,
        th,
        resolved.albedo,
        resolved.normal,
        { right, up: [0, 1, 0], front },
      );
      tile++;
    }
    log(
      `${patch.object}: ${plant.parts.length} parts, ${plant.height.toFixed(2)} m, ${recipe.views} slabs`,
    );
  }
  const [mw, mh] = recipe.tileMetres;
  const info: VegetationInfo = {
    form: 'grass',
    height: +maxHeight.toFixed(4),
    radius: mw / 2,
    bounds: [-mw / 2, 0, -mw / 2, mw / 2, mh, mw / 2],
    crownCentreY: 0,
    trunkTriangles: 0,
    cards: tiles,
    cardDensity: +(tw / mw).toFixed(3),
    views: recipe.views,
    impostorHalfWidth: mw / 2,
    impostorHeight: mh,
    impostorColumns: columns,
    impostorRows: rows,
    crownAlbedo: albedo.map((v) => +(v / Math.max(1e-6, albedoWeight)).toFixed(5)) as Vec3,
    sourceTriangles: 0,
  };
  const geometry = container(
    { version: 1, ...info },
    { tiles: new Float32Array([tiles, columns, rows]) },
  );
  return {
    info,
    geometry,
    images: {
      grass_color: { width: aw, height: ah, data: color, colorSpace: 'srgb' },
      grass_normal: { width: aw, height: ah, data: normal, colorSpace: 'linear' },
    },
  };
}
