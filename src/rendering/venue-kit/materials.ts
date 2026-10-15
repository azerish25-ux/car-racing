import * as T from 'three';
import { Random } from '../../core/math.ts';
import { valueNoise } from '../terrain-profile.ts';
import { canvasTexture } from '../geometry.ts';
import { surfaceMaterial } from '../surface-detail.ts';
import { installVenueFinish } from '../venue-materials.ts';
import { installCarGrounding } from '../studio/car-grounding.ts';
import { installLightPools } from '../studio/light-pools.ts';
import { installGravelFinish } from '../studio/grass-gravel-finish.ts';
import type { VenueThemeStyle } from './theme.ts';

/** Procedural stratified rock: albedo and a derived tangent-space normal map
 * (512 px, 6 m tile), no photographs. Shared by cuttings, cliffs and boulders. */
function rockTextures(tint: number) {
  const size = 256,
    heights = new Float32Array(size * size),
    base = new T.Color(tint);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      // Periodic sampling keeps the tile seamless.
      const n =
        0.55 * valueNoise(Math.cos(u * 6.283) * 2 + 7, Math.sin(u * 6.283) * 2 + v * 9) +
        0.3 * valueNoise(u * 23 + 3, v * 31 + 1) +
        0.15 * valueNoise(u * 61, v * 67);
      const strata = 0.5 + 0.5 * Math.sin(v * 6.283 * 7 + n * 5);
      heights[y * size + x] = 0.65 * n + 0.35 * strata;
    }
  const albedo = canvasTexture(size, size, (c) => {
    const image = c.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const h = heights[i],
        k = 0.62 + 0.55 * h;
      image.data[i * 4] = Math.min(255, base.r * 255 * k);
      image.data[i * 4 + 1] = Math.min(255, base.g * 255 * k);
      image.data[i * 4 + 2] = Math.min(255, base.b * 255 * k);
      image.data[i * 4 + 3] = 255;
    }
    c.putImageData(image, 0, 0);
  });
  const normal = canvasTexture(size, size, (c) => {
    const image = c.createImageData(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const at = (xx: number, yy: number) =>
          heights[((yy + size) % size) * size + ((xx + size) % size)];
        const nx = (at(x - 1, y) - at(x + 1, y)) * 3,
          ny = (at(x, y - 1) - at(x, y + 1)) * 3,
          inverse = 1 / Math.hypot(nx, ny, 1),
          i = (y * size + x) * 4;
        image.data[i] = (nx * inverse * 0.5 + 0.5) * 255;
        image.data[i + 1] = (ny * inverse * 0.5 + 0.5) * 255;
        image.data[i + 2] = (inverse * 0.5 + 0.5) * 255;
        image.data[i + 3] = 255;
      }
    c.putImageData(image, 0, 0);
  });
  normal.colorSpace = T.NoColorSpace;
  for (const t of [albedo, normal]) t.wrapS = t.wrapT = T.RepeatWrapping;
  return { albedo, normal };
}

/** Facade texture: one 4 x 8 storey tile of mullioned windows; the emissive
 * twin lights a deterministic subset of rooms at night. */
function facadeTextures(seed: number, warm: boolean) {
  const random = new Random(seed),
    w = 256,
    h = 512,
    cols = 4,
    rows = 8,
    lit: boolean[] = [];
  for (let i = 0; i < cols * rows; i++) lit.push(random.next() < 0.55);
  const draw = (emissive: boolean) =>
    canvasTexture(w, h, (c) => {
      c.fillStyle = emissive ? '#000000' : '#5d6266';
      c.fillRect(0, 0, w, h);
      for (let r = 0; r < rows; r++)
        for (let col = 0; col < cols; col++) {
          const x = col * (w / cols) + 7,
            y = r * (h / rows) + 9,
            ww = w / cols - 14,
            hh = h / rows - 20;
          if (emissive) {
            if (!lit[r * cols + col]) continue;
            const tone = warm ? (random.next() < 0.5 ? '#ffd79a' : '#ffe9c4') : '#bfe6ff';
            c.fillStyle = tone;
          } else c.fillStyle = '#26323a';
          c.fillRect(x, y, ww, hh);
          if (!emissive) {
            c.fillStyle = '#8b939a';
            c.fillRect(x + ww / 2 - 1, y, 2, hh);
          }
        }
    });
  const map = draw(false),
    emissiveMap = draw(true);
  for (const t of [map, emissiveMap]) t.wrapS = t.wrapT = T.RepeatWrapping;
  return { map, emissiveMap };
}

export function venueKitMaterials(style: VenueThemeStyle) {
  const groundKind =
    style.ground === 'sand' ? 'gravel' : style.ground === 'grass' ? 'grass' : 'concrete';
  const ground = surfaceMaterial(groundKind, groundKind === 'concrete' ? 'concrete' : undefined);
  ground.color.set(style.groundTint).multiplyScalar(style.ground === 'grass' ? 1.6 : 1.25);
  if (groundKind === 'gravel') installGravelFinish(ground);
  const gravel = surfaceMaterial('gravel');
  installGravelFinish(gravel);
  if (style.ground === 'sand') gravel.color.set(0xd9b08a);
  const runoff = surfaceMaterial('asphalt', 'concrete');
  runoff.color.multiplyScalar(0.92);
  const rockMaps = rockTextures(style.rockTint);
  const rock = new T.MeshStandardMaterial({
    map: rockMaps.albedo,
    normalMap: rockMaps.normal,
    normalScale: new T.Vector2(1.4, 1.4),
    roughness: 0.93,
  });
  rock.name = 'Venue kit stratified rock';
  rockMaps.albedo.repeat.set(1 / 6, 1 / 6);
  rockMaps.normal.repeat.set(1 / 6, 1 / 6);
  const concrete = new T.MeshStandardMaterial({ color: 0xa7a69e, roughness: 0.9 });
  installVenueFinish(concrete, 'stone');
  const steel = new T.MeshStandardMaterial({ color: 0xb4babd, metalness: 0.82, roughness: 0.34 });
  installVenueFinish(steel, 'metal');
  const darkSteel = new T.MeshStandardMaterial({
    color: 0x3d4447,
    metalness: 0.7,
    roughness: 0.45,
  });
  const tyre = new T.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.88 });
  const tyreBand = new T.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.7 });
  const saferFoam = new T.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.55 });
  const facades = [0, 1, 2].map((i) => {
    const maps = facadeTextures(91 + i * 17, i !== 1);
    const material = new T.MeshStandardMaterial({
      color: [0xc8c4bb, 0x9fb2c0, 0xb7a58f][i],
      map: maps.map,
      emissiveMap: maps.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 0.55,
      metalness: 0.15,
    });
    material.name = `Venue kit facade ${i + 1}`;
    return material;
  });
  const neon = [0xff2fa6, 0x22e4ff, 0xffd23a, 0x7c5cff].map(
    (c) =>
      new T.MeshStandardMaterial({
        color: 0x111111,
        emissive: c,
        emissiveIntensity: 0.4,
        roughness: 0.4,
      }),
  );
  const lamp = new T.MeshStandardMaterial({
    color: 0x2a2a2a,
    emissive: 0xfff3dc,
    emissiveIntensity: 0.05,
    roughness: 0.3,
  });
  const water = new T.MeshStandardMaterial({ color: 0x4a4f50, roughness: 0.95 });
  for (const m of [ground, gravel, runoff]) {
    installCarGrounding(m);
    installLightPools(m);
  }
  return {
    ground,
    gravel,
    runoff,
    rock,
    concrete,
    steel,
    darkSteel,
    tyre,
    tyreBand,
    saferFoam,
    facades,
    neon,
    lamp,
    quay: water,
  };
}
export type VenueKitMaterials = ReturnType<typeof venueKitMaterials>;
