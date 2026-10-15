/**
 * Offline look-dev for the vegetation bake: bake one species, write its
 * atlases, and render reference (full-res) | cards | impostor side by side
 * under a simple sun + sky model.
 *   node --experimental-transform-types preview.ts <landscape root> <out dir> <species>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bakeTree, CARD_FLOATS, type TreeRecipe } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/scripts/assets/vegetation/bake.ts';
import { linearToSrgbByte, textureFromRgba8, writePng } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/scripts/assets/vegetation/image.ts';
import { RasterTarget, rasterize, type BakeMesh, type OrthoView, type Vec3 } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/scripts/assets/vegetation/raster.ts';
import { SPECIES } from './species.ts';

const [root, outDir, id] = process.argv.slice(2);
const recipe = SPECIES[id] as TreeRecipe;
mkdirSync(outDir, { recursive: true });
const baked = await bakeTree(root, recipe, 1234, (...a) => console.log(...a));
for (const [name, image] of Object.entries(baked.images))
  writePng(join(outDir, `${id}_${name}.png`), image.width, image.height, image.data);
writeFileSync(join(outDir, `${id}.bin`), baked.geometry);
writeFileSync(join(outDir, `${id}.json`), JSON.stringify(baked.info, null, 2));

// ---------------------------------------------------------------- preview
const L = ((v: Vec3) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l) as Vec3;
})([-0.55, 0.62, 0.55]);
const SUN: Vec3 = [3.2, 2.9, 2.5],
  SKY: Vec3 = [0.55, 0.68, 0.9],
  BG: Vec3 = [0.5, 0.62, 0.8];
const size = 512,
  ss = 2;
const info = baked.info;
const H = info.impostorHeight,
  W = info.impostorHalfWidth;
const extent = Math.max(H, W * 2) * 1.05;
const azimuth = 0.6;
const front: Vec3 = [Math.sin(azimuth), 0, Math.cos(azimuth)];
const view: OrthoView = {
  origin: [0, extent / 2, 0],
  right: [Math.cos(azimuth), 0, -Math.sin(azimuth)],
  up: [0, 1, 0],
  forward: [-front[0], 0, -front[2]],
  width: extent,
  height: extent,
  near: -1e3,
  far: 1e3,
};
function shade(albedo: Vec3, n: Vec3, vis: number, foliage: boolean) {
  const ndl = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
  // Crude direct occlusion: the crown's interior is in its own shadow.
  const direct = ndl * Math.min(1, Math.pow(vis, 1.3) * 1.4);
  const back = foliage ? 0.25 * Math.max(0, -(n[0] * L[0] + n[1] * L[1] + n[2] * L[2])) * vis : 0;
  return albedo.map((a, c) => a * (SUN[c] * (direct + back) + SKY[c] * vis * 0.9)) as Vec3;
}
const panels: Uint8Array[] = [];
function toPanel(colors: Float32Array, cover: Float32Array) {
  const out = new Uint8Array(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const a = cover[p];
    for (let c = 0; c < 3; c++) {
      const v = colors[p * 3 + c] * a + BG[c] * (1 - a);
      // Simple filmic-ish tone curve.
      out[p * 4 + c] = linearToSrgbByte(v / (1 + v * 0.35));
    }
    out[p * 4 + 3] = 255;
  }
  panels.push(out);
}
function resolveShaded(target: RasterTarget, shadeSample: (s: number) => Vec3 | null) {
  const colors = new Float32Array(size * size * 3),
    cover = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let k = 0;
      const acc = [0, 0, 0];
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          const s = (y * ss + j) * target.sw + x * ss + i;
          if (target.depth[s] === Infinity) continue;
          const c = shadeSample(s);
          if (!c) continue;
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
          k++;
        }
      const p = y * size + x;
      cover[p] = k / (ss * ss);
      if (k) for (let c = 0; c < 3; c++) colors[p * 3 + c] = acc[c] / k;
    }
  toPanel(colors, cover);
}
// (a) reference
{
  const target = new RasterTarget(size, size, ss);
  for (const part of baked.plant.parts) rasterize(target, view, part);
  resolveShaded(target, (s) =>
    shade(
      [target.albedo[s * 3], target.albedo[s * 3 + 1], target.albedo[s * 3 + 2]],
      [target.normal[s * 3], target.normal[s * 3 + 1], target.normal[s * 3 + 2]],
      target.visibility[s],
      target.foliage[s] === 1,
    ),
  );
}
// (b) cards + trunk
const cardsColor = textureFromRgba8(baked.images.cards_color, true);
/** Normal atlas RGB with the colour atlas coverage in alpha, and the
 * visibility (normal alpha) as grey with the same coverage. */
function withCoverage(normal: { width: number; height: number; data: Uint8Array }, color: { data: Uint8Array }) {
  const n = new Uint8Array(normal.data),
    v = new Uint8Array(normal.data.length);
  for (let i = 0; i < n.length; i += 4) {
    v[i] = v[i + 1] = v[i + 2] = normal.data[i + 3];
    n[i + 3] = v[i + 3] = color.data[i + 3];
  }
  return {
    normal: textureFromRgba8({ width: normal.width, height: normal.height, data: n }, false),
    visibility: textureFromRgba8({ width: normal.width, height: normal.height, data: v }, false),
  };
}
const cardsNormal = withCoverage(baked.images.cards_normal, baked.images.cards_color);
const facing = Number(process.env.FACING ?? '0.5');
// Turn every card part-way toward the viewer (the runtime does this per view).
const cards = baked.cards.map((card) => {
  const toward: Vec3 = [-view.forward[0], -view.forward[1], -view.forward[2]];
  const back = card.normal[0] * toward[0] + card.normal[1] * toward[1] + card.normal[2] * toward[2] < 0;
  const cn: Vec3 = back ? [-toward[0], -toward[1], -toward[2]] : toward;
  const cr: Vec3 = back ? [-view.right[0], -view.right[1], -view.right[2]] : view.right;
  const norm = (v: Vec3) => {
    const l = Math.hypot(...v) || 1;
    return v.map((x) => x / l) as Vec3;
  };
  const right = norm([0, 1, 2].map((c) => card.right[c] * (1 - facing) + cr[c] * facing) as Vec3);
  const normal = norm([0, 1, 2].map((c) => card.normal[c] * (1 - facing) + cn[c] * facing) as Vec3);
  const up = norm([
    normal[1] * right[2] - normal[2] * right[1],
    normal[2] * right[0] - normal[0] * right[2],
    normal[0] * right[1] - normal[1] * right[0],
  ]);
  return { ...card, right, normal, up };
});
{
  const n = cards.length;
  const positions = new Float32Array(n * 12),
    normals = new Float32Array(n * 12),
    uvs = new Float32Array(n * 8),
    indices = new Uint32Array(n * 6);
  const aw = baked.images.cards_color.width,
    ah = baked.images.cards_color.height;
  cards.forEach((card, i) => {
    const [x, y, w, h] = card.atlas;
    const corners = [
      [-1, -1, x / aw, 1 - (y + h) / ah],
      [1, -1, (x + w) / aw, 1 - (y + h) / ah],
      [1, 1, (x + w) / aw, 1 - y / ah],
      [-1, 1, x / aw, 1 - y / ah],
    ];
    corners.forEach(([u, v, s, t], k) => {
      for (let c = 0; c < 3; c++) {
        positions[(i * 4 + k) * 3 + c] =
          card.centre[c] + card.right[c] * u * card.halfWidth + card.up[c] * v * card.halfHeight;
        normals[(i * 4 + k) * 3 + c] = card.normal[c];
      }
      uvs[(i * 4 + k) * 2] = s;
      uvs[(i * 4 + k) * 2 + 1] = t;
    });
    indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  const mesh: BakeMesh = {
    positions,
    normals,
    uvs,
    indices,
    visibility: new Float32Array(n * 4).fill(1),
    texture: cardsColor,
    tint: [1, 1, 1],
    cutoff: 0.5,
    foliage: true,
  };
  const target = new RasterTarget(size, size, ss);
  for (const part of baked.plant.parts.filter((p) => p.role === 'trunk')) rasterize(target, view, part);
  rasterize(target, view, mesh);
  // Second pass: the same cards with the normal atlas as "albedo".
  const normalTarget = new RasterTarget(size, size, ss);
  normalTarget.depth.set(target.depth.map((d, s) => (target.foliage[s] === 2 ? d : Infinity)));
  rasterize(normalTarget, view, { ...mesh, texture: cardsNormal.normal });
  const visTarget = new RasterTarget(size, size, ss);
  visTarget.depth.set(normalTarget.depth.map((d, s) => (target.foliage[s] === 2 ? target.depth[s] : Infinity)));
  rasterize(visTarget, view, { ...mesh, texture: cardsNormal.visibility });
  resolveShaded(target, (s) => {
    const albedo: Vec3 = [target.albedo[s * 3], target.albedo[s * 3 + 1], target.albedo[s * 3 + 2]];
    if (target.foliage[s] === 2)
      return shade(albedo, [target.normal[s * 3], target.normal[s * 3 + 1], target.normal[s * 3 + 2]], target.visibility[s], false);
    const card = cards[Math.floor(target.id[s] / 2)];
    // Decode tangent normal + visibility (raw, not sRGB).
    const tx = normalTarget.albedo[s * 3] * 2 - 1,
      ty = normalTarget.albedo[s * 3 + 1] * 2 - 1,
      tz = normalTarget.albedo[s * 3 + 2] * 2 - 1;
    // Visibility lives in the normal atlas alpha: sample it again (cheap: re-use tz path).
    let n: Vec3 = [0, 1, 2].map((c) => card.right[c] * tx + card.up[c] * ty + card.normal[c] * tz) as Vec3;
    // Back side of the card faces away from the viewer: mirror the normal.
    if (n[0] * view.forward[0] + n[2] * view.forward[2] > 0 && card.normal[0] * view.forward[0] + card.normal[2] * view.forward[2] > 0)
      n = [0, 1, 2].map((c) => n[c] - 2 * card.normal[c] * tz) as Vec3;
    return shade(albedo, n, visTarget.albedo[s * 3], true);
  });
}
// (c) impostor (view nearest to the azimuth)
{
  const views = info.views;
  const k = Math.round((azimuth / (Math.PI * 2)) * views) % views;
  const col = k % info.impostorColumns,
    row = Math.floor(k / info.impostorColumns);
  const iw = baked.images.impostor_color.width,
    ih = baked.images.impostor_color.height;
  const cw = iw / info.impostorColumns,
    ch = ih / info.impostorRows;
  const u0 = (col * cw) / iw,
    u1 = ((col + 1) * cw) / iw,
    v0 = 1 - ((row + 1) * ch) / ih,
    v1 = 1 - (row * ch) / ih;
  const right = view.right;
  const hw = info.impostorHalfWidth,
    hh = info.impostorHeight;
  const positions = new Float32Array([
    -right[0] * hw, 0, -right[2] * hw,
    right[0] * hw, 0, right[2] * hw,
    right[0] * hw, hh, right[2] * hw,
    -right[0] * hw, hh, -right[2] * hw,
  ]);
  const uvs = new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]);
  const mesh: BakeMesh = {
    positions,
    normals: new Float32Array(12).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)),
    uvs,
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    visibility: new Float32Array(4).fill(1),
    texture: textureFromRgba8(baked.images.impostor_color, true),
    tint: [1, 1, 1],
    cutoff: 0.5,
    foliage: true,
  };
  const target = new RasterTarget(size, size, ss);
  rasterize(target, view, mesh);
  const imp = withCoverage(baked.images.impostor_normal, baked.images.impostor_color);
  const normalTarget = new RasterTarget(size, size, ss);
  rasterize(normalTarget, view, { ...mesh, texture: imp.normal });
  const visTarget = new RasterTarget(size, size, ss);
  rasterize(visTarget, view, { ...mesh, texture: imp.visibility });
  const angle = (k / views) * Math.PI * 2;
  const f: Vec3 = [Math.sin(angle), 0, Math.cos(angle)],
    r: Vec3 = [Math.cos(angle), 0, -Math.sin(angle)];
  resolveShaded(target, (s) => {
    const tx = normalTarget.albedo[s * 3] * 2 - 1,
      ty = normalTarget.albedo[s * 3 + 1] * 2 - 1,
      tz = normalTarget.albedo[s * 3 + 2] * 2 - 1;
    const n: Vec3 = [r[0] * tx + f[0] * tz, ty, r[2] * tx + f[2] * tz];
    return shade([target.albedo[s * 3], target.albedo[s * 3 + 1], target.albedo[s * 3 + 2]], n, visTarget.albedo[s * 3], true);
  });
}
const out = new Uint8Array(size * 3 * size * 4);
for (let y = 0; y < size; y++)
  for (let p = 0; p < 3; p++) out.set(panels[p].subarray(y * size * 4, (y + 1) * size * 4), (y * size * 3 + p * size) * 4);
writePng(join(outDir, `${id}_preview${process.env.TAG ?? ''}.png`), size * 3, size, out);
console.log('preview written', CARD_FLOATS);
