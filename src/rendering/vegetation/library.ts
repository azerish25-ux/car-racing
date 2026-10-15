import * as T from 'three';
import { loadShippedTexture } from '../assets/texture-loader.ts';
import { assetUrl, thirdPartyAsset, type ShippedAsset } from '../assets/third-party.ts';
import type { QualityPreset } from '../options.ts';
import {
  CARD_FLOATS,
  parseVegetation,
  type VegetationGeometry,
  type VegetationInfo,
} from './format.ts';
import {
  barkMaterial,
  cardDepthMaterials,
  cardMaterial,
  grassMaterial,
  impostorMaterial,
} from './materials.ts';
import type { SpeciesId } from './species.ts';

/**
 * Loaded photographic vegetation: geometry and materials of every species a
 * venue shows (baked from the CC BY 4.0 landscape plants, see
 * docs/ASSET_PROVENANCE.md). Loaded before the venue is built; when it is
 * unavailable (LOW preset, node tests, a failed download or decoder) the
 * procedural planting stays.
 */
export interface VegetationSpecies {
  id: SpeciesId;
  info: VegetationInfo;
  /** Leaf cards (one quad per crown card, expanded in the vertex shader). */
  cards: T.BufferGeometry | null;
  trunk: T.BufferGeometry | null;
  /** Unit impostor quad (x -1..1, y 0..1). */
  impostor: T.BufferGeometry;
  cardMaterial: T.MeshStandardMaterial | null;
  cardDepth: T.MeshDepthMaterial | null;
  cardDistance: T.MeshDistanceMaterial | null;
  barkMaterial: T.MeshStandardMaterial | null;
  barkDepth: T.MeshDepthMaterial | null;
  barkDistance: T.MeshDistanceMaterial | null;
  impostorMaterial: T.MeshStandardMaterial | null;
  impostorDepth: T.MeshDepthMaterial | null;
  /** Grass: clump cross geometry and its material. */
  grass: {
    geometry: T.BufferGeometry;
    material: T.MeshStandardMaterial;
    depth: T.MeshDepthMaterial;
    tiles: number;
  } | null;
  /** Every texture this species owns (disposed with it). */
  textures: T.Texture[];
}

/** Presets that draw the photographic vegetation. LOW and MEDIUM keep the
 * procedural planting (its draw, memory and shadow budgets are the ones the
 * MEDIUM scenery budgets and browser surveys are measured against). */
export function photoVegetationEnabled(preset: QualityPreset) {
  return preset === 'high' || preset === 'ultra';
}

function cardGeometry(geometry: VegetationGeometry) {
  const n = geometry.cards.length / CARD_FLOATS;
  if (!n) return null;
  const position = new Float32Array(n * 12),
    normal = new Float32Array(n * 12),
    tangent = new Float32Array(n * 16),
    uv = new Float32Array(n * 8),
    corner = new Float32Array(n * 8),
    size = new Float32Array(n * 8),
    right = new Float32Array(n * 12),
    wind = new Float32Array(n * 8),
    index = new Uint32Array(n * 6);
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (let c = 0; c < n; c++) {
    const r = geometry.cards.subarray(c * CARD_FLOATS, (c + 1) * CARD_FLOATS);
    // centre 0-2, right 3-5, up 6-8, normal 9-11, half 12-13, uv 14-17, flex 18, phase 19
    for (let k = 0; k < 4; k++) {
      const v = c * 4 + k;
      position.set(r.subarray(0, 3), v * 3);
      normal.set(r.subarray(9, 12), v * 3);
      right.set(r.subarray(3, 6), v * 3);
      tangent.set([r[3], r[4], r[5], 1], v * 4);
      corner.set(corners[k], v * 2);
      size.set([r[12], r[13]], v * 2);
      uv.set([corners[k][0] < 0 ? r[14] : r[16], corners[k][1] < 0 ? r[15] : r[17]], v * 2);
      wind.set([r[18], r[19]], v * 2);
    }
    index.set([c * 4, c * 4 + 1, c * 4 + 2, c * 4, c * 4 + 2, c * 4 + 3], c * 6);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(position, 3));
  g.setAttribute('normal', new T.BufferAttribute(normal, 3));
  g.setAttribute('tangent', new T.BufferAttribute(tangent, 4));
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  g.setAttribute('cardCorner', new T.BufferAttribute(corner, 2));
  g.setAttribute('cardSize', new T.BufferAttribute(size, 2));
  g.setAttribute('cardRight', new T.BufferAttribute(right, 3));
  g.setAttribute('cardWind', new T.BufferAttribute(wind, 2));
  g.setIndex(new T.BufferAttribute(index, 1));
  bounds(g, geometry.info);
  return g;
}

/** Culling bounds of the whole plant (cards expand in the shader). */
function bounds(g: T.BufferGeometry, info: VegetationInfo) {
  const b = info.bounds;
  const r = Math.max(info.impostorHalfWidth, Math.abs(b[0]), Math.abs(b[2]), b[3], b[5]) * 1.1;
  g.boundingBox = new T.Box3(new T.Vector3(-r, -0.5, -r), new T.Vector3(r, info.height * 1.08, r));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new T.Sphere());
}

function trunkGeometry(geometry: VegetationGeometry) {
  const t = geometry.trunk;
  if (!t || !t.index.length) return null;
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(t.position, 3));
  g.setAttribute('normal', new T.BufferAttribute(t.normal, 3));
  g.setAttribute('uv', new T.BufferAttribute(t.uv, 2));
  g.setAttribute('barkVisibility', new T.BufferAttribute(t.visibility, 1));
  g.setIndex(new T.BufferAttribute(t.index, 1));
  bounds(g, geometry.info);
  return g;
}

function impostorGeometry(info: VegetationInfo) {
  const g = new T.BufferGeometry();
  g.setAttribute(
    'position',
    new T.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3),
  );
  g.setAttribute(
    'normal',
    new T.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  g.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  bounds(g, info);
  return g;
}

/** Three crossed quads (60 degrees apart), base on the ground, unit size. */
function grassGeometry() {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    index: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3 + 0.2;
    const dx = Math.cos(a) * 0.5,
      dz = Math.sin(a) * 0.5;
    const nx = -Math.sin(a),
      nz = Math.cos(a);
    const base = positions.length / 3;
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      positions.push((u * 2 - 1) * dx, v, (u * 2 - 1) * dz);
      normals.push(nx, 0, nz);
      uvs.push(u, v);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.boundingBox = new T.Box3(new T.Vector3(-0.6, 0, -0.6), new T.Vector3(0.6, 1.2, 0.6));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new T.Sphere());
  return g;
}

async function texture(
  renderer: T.WebGLRenderer,
  asset: ShippedAsset,
  role: string,
  options: { srgb: boolean; repeat?: boolean; anisotropy?: number },
) {
  const files = asset.files.filter((f) => f.role === role);
  if (!files.length) return null;
  const loaded = await loadShippedTexture(renderer, files);
  if (!loaded) throw new Error(`${asset.id}: ${role} unavailable`);
  const t = loaded.texture;
  t.colorSpace = options.srgb ? T.SRGBColorSpace : T.NoColorSpace;
  t.wrapS = t.wrapT = options.repeat ? T.RepeatWrapping : T.ClampToEdgeWrapping;
  t.anisotropy = Math.min(options.anisotropy ?? 4, renderer.capabilities.getMaxAnisotropy());
  t.minFilter = T.LinearMipmapLinearFilter;
  t.magFilter = T.LinearFilter;
  t.name = `${asset.id}:${role}`;
  t.needsUpdate = true;
  return t;
}

async function loadSpecies(renderer: T.WebGLRenderer, id: SpeciesId): Promise<VegetationSpecies> {
  const asset = thirdPartyAsset(id);
  if (!asset || asset.kind !== 'vegetation') throw new Error(`Unknown vegetation ${id}`);
  const file = asset.files.find((f) => f.role === 'geometry');
  if (!file) throw new Error(`${id}: no geometry`);
  const response = await fetch(assetUrl(file.path));
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== file.bytes) throw new Error(`${id}: size mismatch`);
  const geometry = parseVegetation(bytes);
  const info = geometry.info;
  const name = asset.title;
  if (info.form === 'grass') {
    const [color, normal] = await Promise.all([
      texture(renderer, asset, 'grass_color', { srgb: true }),
      texture(renderer, asset, 'grass_normal', { srgb: false }),
    ]);
    if (!color || !normal) throw new Error(`${id}: grass atlases missing`);
    const tiles = geometry.tiles ? geometry.tiles[0] : info.cards;
    const { material, depth } = grassMaterial(
      { color, normal },
      { columns: info.impostorColumns, rows: info.impostorRows },
    );
    return {
      id,
      info,
      cards: null,
      trunk: null,
      impostor: impostorGeometry(info),
      cardMaterial: null,
      cardDepth: null,
      cardDistance: null,
      barkMaterial: null,
      barkDepth: null,
      barkDistance: null,
      impostorMaterial: null,
      impostorDepth: null,
      grass: { geometry: grassGeometry(), material, depth, tiles },
      textures: [color, normal],
    };
  }
  const [cardsColor, cardsNormal, impColor, impNormal, barkColor, barkNormal] = await Promise.all([
    texture(renderer, asset, 'cards_color', { srgb: true, anisotropy: 4 }),
    texture(renderer, asset, 'cards_normal', { srgb: false }),
    texture(renderer, asset, 'impostor_color', { srgb: true }),
    texture(renderer, asset, 'impostor_normal', { srgb: false }),
    texture(renderer, asset, 'bark_color', { srgb: true, repeat: true, anisotropy: 8 }),
    texture(renderer, asset, 'bark_normal', { srgb: false, repeat: true }),
  ]);
  if (!cardsColor || !cardsNormal || !impColor || !impNormal)
    throw new Error(`${id}: atlases missing`);
  const cards = cardGeometry(geometry);
  const trunk = trunkGeometry(geometry);
  const card = cardMaterial(
    { color: cardsColor, normal: cardsNormal },
    info.height,
    `${name} leaf cards`,
  );
  const cardShadow = cardDepthMaterials({ color: cardsColor, normal: cardsNormal }, info.height);
  const bark = barkMaterial({ color: barkColor, normal: barkNormal }, info.height, `${name} bark`);
  const impostor = impostorMaterial(
    { color: impColor, normal: impNormal },
    {
      views: info.views,
      columns: info.impostorColumns,
      rows: info.impostorRows,
      halfWidth: info.impostorHalfWidth,
      height: info.impostorHeight,
    },
    info.height,
    `${name} impostor`,
  );
  return {
    id,
    info,
    cards,
    trunk,
    impostor: impostorGeometry(info),
    cardMaterial: card,
    cardDepth: cardShadow.depth,
    cardDistance: cardShadow.distance,
    barkMaterial: bark.material,
    barkDepth: bark.depth,
    barkDistance: bark.distance,
    impostorMaterial: impostor.material,
    impostorDepth: impostor.depth,
    grass: null,
    textures: [cardsColor, cardsNormal, impColor, impNormal, barkColor, barkNormal].filter(
      (t): t is T.Texture => !!t,
    ),
  };
}

export class VegetationLibrary {
  private constructor(
    readonly species: ReadonlyMap<SpeciesId, VegetationSpecies>,
    readonly failed: readonly string[],
  ) {}
  /** Load `ids` (failures are dropped and listed; trees need at least one). */
  static async load(renderer: T.WebGLRenderer, ids: readonly SpeciesId[]) {
    const settled = await Promise.allSettled(ids.map((id) => loadSpecies(renderer, id)));
    const species = new Map<SpeciesId, VegetationSpecies>();
    const failed: string[] = [];
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') species.set(ids[i], result.value);
      else {
        failed.push(ids[i]);
        console.warn(`Vegetation ${ids[i]} unavailable:`, result.reason);
      }
    });
    return new VegetationLibrary(species, failed);
  }
  get(id: SpeciesId) {
    return this.species.get(id) ?? null;
  }
  get available(): ReadonlySet<string> {
    return new Set(this.species.keys());
  }
  get trees() {
    return [...this.species.values()].filter((s) => s.info.form === 'tree');
  }
  dispose() {
    for (const s of this.species.values()) {
      for (const g of [s.cards, s.trunk, s.impostor, s.grass?.geometry]) g?.dispose();
      for (const m of [
        s.cardMaterial,
        s.cardDepth,
        s.cardDistance,
        s.barkMaterial,
        s.barkDepth,
        s.barkDistance,
        s.impostorMaterial,
        s.impostorDepth,
        s.grass?.material,
        s.grass?.depth,
      ])
        m?.dispose();
      for (const t of s.textures) t.dispose();
    }
  }
}
