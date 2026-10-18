import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** Japanese-format registration plates for festival road cars and ambient
 * traffic (references 005, 013, 018, 058, 059, 074): a 330 x 165 mm plate,
 * place name and three-digit class on the top row, one hiragana and a
 * four-place serial ("12-34", "・・・7") below. Private cars carry a white
 * plate with green characters, kei cars a yellow plate with black ones. All
 * place names are invented; no real registration office appears. One shared
 * canvas atlas holds every plate, so a car's plates are one draw. */
export const PLATE = Object.freeze({ width: 0.33, height: 0.165, depth: 0.007 });
const PLACES = ['汐浜', '灰谷', '鷹野原', '茨森', '白砂', '朝凪', '霧ヶ崎', '北汐'];
const CLASSES = ['300', '330', '500', '531', '301', '338', '580', '303'];
const KEI_CLASSES = ['580', '581', '480', '50'];
const KANA = 'さすせそたちつてとなにぬねのはひふほまみむめもやゆよらりるろ';
/** Atlas grid (columns x rows of 256 x 128 px slots). */
const COLUMNS = 4,
  ROWS = 8,
  SLOT_W = 256,
  SLOT_H = 128;
/** White private plates, yellow kei plates and one plain white slot. */
export const PLATE_SLOTS = Object.freeze({ white: 24, kei: 7, plain: 31 });
const FONT = '"Noto Sans JP","Hiragino Sans","Yu Gothic","IPAGothic",sans-serif';

function hash(n: number) {
  let x = Math.imul(n ^ 0x5bd1e995, 0x27d4eb2d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x165667b1);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
}
/** The text of plate `slot` (deterministic). */
export function plateText(slot: number) {
  const kei = slot >= PLATE_SLOTS.white && slot < PLATE_SLOTS.white + PLATE_SLOTS.kei;
  const place = PLACES[Math.floor(hash(slot * 3 + 1) * PLACES.length)];
  const classes = kei ? KEI_CLASSES : CLASSES;
  const cls = classes[Math.floor(hash(slot * 3 + 2) * classes.length)];
  const kana = KANA[Math.floor(hash(slot * 7 + 5) * KANA.length)];
  // Most serials have four places; a few short ones show the dot padding.
  const short = hash(slot * 17 + 9) < 0.2;
  const serial = short
    ? 1 + Math.floor(hash(slot * 11 + 3) * 998)
    : 1000 + Math.floor(hash(slot * 11 + 3) * 8999);
  const digits = String(serial);
  // Under four digits the empty places are dots: "・・12", "・・・7".
  const body =
    digits.length === 4
      ? `${digits.slice(0, 2)}-${digits.slice(2)}`
      : `${'・'.repeat(4 - digits.length)}${digits}`;
  return { kei, place, cls, kana, serial: body };
}
function drawPlate(ctx: CanvasRenderingContext2D, slot: number, x0: number, y0: number) {
  const { kei, place, cls, kana, serial } = plateText(slot);
  const ink = kei ? '#141414' : '#0f5a36';
  ctx.save();
  ctx.translate(x0, y0);
  // Pressed aluminium: bright face, a raised rim and a slightly darker edge.
  ctx.fillStyle = kei ? '#5c4a12' : '#3d4440';
  ctx.fillRect(0, 0, SLOT_W, SLOT_H);
  ctx.fillStyle = kei ? '#efc92e' : '#f3f4ef';
  ctx.beginPath();
  ctx.roundRect(3, 3, SLOT_W - 6, SLOT_H - 6, 9);
  ctx.fill();
  ctx.strokeStyle = kei ? 'rgba(80,60,0,0.55)' : 'rgba(15,90,54,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(7, 7, SLOT_W - 14, SLOT_H - 14, 7);
  ctx.stroke();
  // Bolt caps on the top row (the rear plate's left one is the seal).
  for (const bx of [34, SLOT_W - 34]) {
    ctx.fillStyle = '#b9bdbf';
    ctx.beginPath();
    ctx.arc(bx, 22, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7d8285';
    ctx.beginPath();
    ctx.arc(bx, 22, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = `bold 27px ${FONT}`;
  ctx.fillText(`${place} ${cls}`, SLOT_W / 2, 27);
  ctx.font = `bold 30px ${FONT}`;
  ctx.fillText(kana, 30, 86);
  // Condensed serial digits, as on the real plate typeface.
  ctx.save();
  ctx.translate(148, 84);
  ctx.scale(0.78, 1);
  ctx.font = `bold 72px ${FONT}`;
  ctx.fillText(serial, 0, 0);
  ctx.restore();
  ctx.restore();
}

let atlas: T.Texture | null = null;
/** The shared plate atlas (null without a document). */
export function plateAtlas() {
  if (atlas || typeof document === 'undefined') return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = COLUMNS * SLOT_W;
  canvas.height = ROWS * SLOT_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let slot = 0; slot < PLATE_SLOTS.plain; slot++)
    drawPlate(ctx, slot, (slot % COLUMNS) * SLOT_W, Math.floor(slot / COLUMNS) * SLOT_H);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.name = 'Festival registration plate atlas';
  atlas = texture;
  return texture;
}
/** UV rectangle [u0, v0, u1, v1] of atlas slot `slot`. */
export function plateUv(slot: number) {
  const s = Math.max(0, Math.min(PLATE_SLOTS.plain, Math.floor(slot)));
  const c = s % COLUMNS,
    r = Math.floor(s / COLUMNS);
  return [c / COLUMNS, 1 - (r + 1) / ROWS, (c + 1) / COLUMNS, 1 - r / ROWS] as const;
}
/** A private (white) or kei (yellow) slot for a seed. */
export function plateSlot(seed: number, kei = false) {
  const h = Math.floor(hash(seed * 13 + 7) * 1e6);
  return kei ? PLATE_SLOTS.white + (h % PLATE_SLOTS.kei) : h % PLATE_SLOTS.white;
}

let material: T.MeshStandardMaterial | null = null;
const plateLamp = { value: 0 };
/** Shared plate finish: the atlas, a satin retroreflective face and the rear
 * plate lamp (emissive, only where the vertex `plateLit` is 1). */
export function plateMaterial() {
  if (material) return material;
  const map = plateAtlas();
  material = new T.MeshStandardMaterial({
    name: 'Festival registration plates',
    color: 0xffffff,
    map,
    emissive: 0xfff2dc,
    emissiveMap: map,
    emissiveIntensity: 1,
    roughness: 0.42,
    metalness: 0.15,
  });
  chainShaderHook(material, 'festival-plate-lamp-v1', (shader) => {
    shader.uniforms.festivalPlateLamp = plateLamp;
    injectDeclarations(
      shader,
      'common',
      'attribute float plateLit; varying float vPlateLit;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vPlateLit = plateLit;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      'uniform float festivalPlateLamp; varying float vPlateLit;',
      'fragment',
    );
    injectAfter(
      shader,
      'emissivemap_fragment',
      'totalEmissiveRadiance *= vPlateLit * festivalPlateLamp;',
      'fragment',
    );
  });
  return material;
}
/** Rear plate lamp level (0 by day). */
export function setPlateLamp(level: number) {
  plateLamp.value = Math.max(0, level);
}
/** One plate as a thin slab facing +Z (rotate for a rear plate): the face
 * maps the slot, the edges map the slot's dark rim. `lit` marks the rear
 * plate's face for the plate lamp. */
export function plateGeometry(slot: number, lit: boolean) {
  const g = new T.BoxGeometry(PLATE.width, PLATE.height, PLATE.depth);
  const [u0, v0, u1, v1] = plateUv(slot);
  const uv = g.getAttribute('uv') as T.BufferAttribute;
  const rimU = u0 + 1 / (COLUMNS * SLOT_W),
    rimV = v0 + 1 / (ROWS * SLOT_H);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, rimU, rimV);
  // BoxGeometry faces: +x, -x, +y, -y, +z (16..19), -z.
  const face = [
    [u0, v1],
    [u1, v1],
    [u0, v0],
    [u1, v0],
  ];
  for (let k = 0; k < 4; k++) uv.setXY(16 + k, face[k][0], face[k][1]);
  const lamp = new Float32Array(uv.count);
  if (lit) for (let k = 16; k < 20; k++) lamp[k] = 1;
  g.setAttribute('plateLit', new T.BufferAttribute(lamp, 1));
  return g;
}
/** Release the shared atlas and material (session exit). */
export function disposePlates() {
  material?.dispose();
  material = null;
  atlas?.dispose();
  atlas = null;
}
