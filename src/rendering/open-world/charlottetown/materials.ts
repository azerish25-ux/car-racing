import * as T from 'three';
export type CityMaterial =
  | 'brick'
  | 'siding'
  | 'stone'
  | 'roof'
  | 'trim'
  | 'metal'
  | 'glass'
  | 'litGlass'
  | 'wood'
  | 'paving'
  | 'grass'
  | 'asphalt'
  | 'paint'
  | 'sign';
/** Seeded, generated texels. No photograph, remote image, or vendor texture. */
function noise(x: number, y: number) {
  let h = Math.imul(x ^ 0x45d9f3b, 0x27d4eb2d) ^ Math.imul(y + 0x165667b1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function surface(kind: 'brick' | 'siding' | 'stone' | 'roof' | 'paving') {
  const size = 512,
    bytes = new Uint8Array(size * size * 4),
    height = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const grain = noise(x, y),
        u = x / size,
        v = y / size;
      let base = 220,
        relief = 170;
      if (kind === 'brick') {
        const row = Math.floor(v * 24),
          column = Math.floor(u * 8 + (row % 2) * 0.5);
        const fx = (u * 8 + (row % 2) * 0.5) % 1,
          fy = (v * 24) % 1;
        const joint = fx < 0.035 || fx > 0.965 || fy < 0.075 || fy > 0.925;
        base = joint ? 138 + grain * 12 : 190 + noise(column, row) * 45 + grain * 18;
        relief = joint ? 35 : 170 + grain * 30;
      } else if (kind === 'siding') {
        const fy = (v * 16) % 1;
        base = fy < 0.065 ? 130 : 205 + fy * 33 + grain * 8;
        relief = fy < 0.065 ? 20 : 230 - fy * 120;
      } else if (kind === 'roof') {
        const row = Math.floor(v * 18),
          fx = (u * 12 + (row % 2) * 0.5) % 1,
          fy = (v * 18) % 1;
        const joint = fx < 0.023 || fy < 0.05;
        base = joint
          ? 80
          : 160 + noise(Math.floor(u * 12 + (row % 2) * 0.5), row) * 45 + grain * 32;
        relief = joint ? 40 : 140 + grain * 55;
      } else {
        const n = kind === 'stone' ? 7 : 2,
          fx = (u * n) % 1,
          fy = (v * n) % 1;
        const joint = fx < 0.007 || fy < 0.007;
        base = joint ? 132 : 210 + grain * 22 + noise(Math.floor(u * 31), Math.floor(v * 31)) * 12;
        relief = joint ? 60 : 150 + grain * 20;
      }
      const i = (y * size + x) * 4;
      bytes[i] = bytes[i + 1] = bytes[i + 2] = base;
      bytes[i + 3] = 255;
      height[i] = height[i + 1] = height[i + 2] = relief;
      height[i + 3] = 255;
    }
  const make = (data: Uint8Array, color: boolean) => {
    const t = new T.DataTexture(data, size, size, T.RGBAFormat);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(bytes, true), bumpMap: make(height, false) };
}
export const CITY_SIGNS = [
  'MALONEY DRIVE',
  'QUEEN STREET',
  'KENT STREET',
  'WEYMOUTH STREET',
  'HOLLAND COLLEGE',
  'PRINCE OF WALES CAMPUS',
  'CHARLOTTETOWN',
  'CAMPUS ROUTE',
  'UNIVERSITY AVENUE',
  'FITZROY STREET',
  'EUSTON STREET',
  'GRAFTON STREET',
  '1.706 KM',
  'START / FINISH',
  'NO PARKING',
  'PEI',
] as const;
function signTexture() {
  if (typeof document === 'undefined') {
    const t = new T.DataTexture(new Uint8Array([32, 60, 50, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const g = c.getContext('2d');
  if (!g) throw new Error('Street sign atlas requires Canvas2D');
  for (let i = 0; i < CITY_SIGNS.length; i++) {
    const x = (i % 4) * 512,
      y = Math.floor(i / 4) * 256;
    g.fillStyle = i === 4 || i === 5 ? '#8c3030' : '#203e35';
    g.fillRect(x, y, 512, 256);
    g.strokeStyle = '#e0dec9';
    g.lineWidth = 3;
    g.strokeRect(x + 14, y + 24, 484, 208);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f4f1df';
    let font = 40;
    do {
      g.font = `600 ${font--}px sans-serif`;
    } while (g.measureText(CITY_SIGNS[i]).width > 450 && font > 14);
    g.fillText(CITY_SIGNS[i], x + 256, y + 132);
  }
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function windowTexture() {
  const size = 256,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size,
        i = (y * size + x) * 4;
      const curtain = u < 0.12 || u > 0.87,
        fold = 0.8 + 0.2 * Math.sin(u * 180);
      const depth = 0.32 + 0.24 * v + 0.13 * noise(Math.floor(x / 32), Math.floor(y / 100));
      const blind = v > 0.75 && Math.sin(v * 230) > 0.4;
      const value = curtain ? 0.64 * fold : blind ? depth * 0.65 : depth;
      data[i] = value * 210;
      data[i + 1] = value * 218;
      data[i + 2] = value * 220;
      data[i + 3] = 255;
    }
  const texture = new T.DataTexture(data, size, size);
  texture.colorSpace = T.SRGBColorSpace;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
export class CityMaterials {
  readonly materials: Record<CityMaterial, T.MeshStandardMaterial>;
  private readonly textures: T.Texture[] = [];
  constructor() {
    const patterned = (
      kind: 'brick' | 'siding' | 'stone' | 'roof' | 'paving',
      roughness: number,
    ) => {
      const maps = surface(kind);
      this.textures.push(maps.map, maps.bumpMap);
      const m = new T.MeshStandardMaterial({
        vertexColors: true,
        roughness,
        bumpScale: kind === 'brick' ? 0.018 : 0.008,
        ...maps,
      });
      m.name = `Charlottetown / generated ${kind}`;
      return m;
    };
    const plain = (roughness: number, metalness = 0) =>
      new T.MeshStandardMaterial({ vertexColors: true, roughness, metalness });
    const windowMap = windowTexture();
    this.textures.push(windowMap);
    const glass = new T.MeshPhysicalMaterial({
      map: windowMap,
      vertexColors: true,
      roughness: 0.16,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      envMapIntensity: 0.7,
    });
    const lit = glass.clone();
    lit.emissive.setHex(0xffbe75);
    lit.emissiveIntensity = 0;
    const signs = signTexture();
    this.textures.push(signs);
    this.materials = {
      brick: patterned('brick', 0.84),
      siding: patterned('siding', 0.72),
      stone: patterned('stone', 0.87),
      roof: patterned('roof', 0.94),
      trim: plain(0.62),
      metal: plain(0.46, 0.68),
      glass,
      litGlass: lit,
      wood: plain(0.75),
      paving: patterned('paving', 0.92),
      grass: plain(0.98),
      asphalt: plain(0.93),
      paint: plain(0.7),
      sign: new T.MeshStandardMaterial({ map: signs, roughness: 0.5, metalness: 0.12 }),
    };
    for (const key of ['paving', 'grass', 'asphalt', 'paint'] as const) {
      const m = this.materials[key];
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = key === 'paint' ? -8 : -2;
    }
  }
  update(night: number, wet: number) {
    this.materials.litGlass.emissiveIntensity = night * 0.9;
    this.materials.metal.roughness = 0.46 - wet * 0.12;
    this.materials.paving.roughness = 0.92 - wet * 0.44;
    this.materials.asphalt.roughness = 0.93 - wet * 0.63;
  }
  dispose() {
    for (const m of Object.values(this.materials)) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
