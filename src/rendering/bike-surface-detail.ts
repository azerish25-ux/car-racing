import * as T from 'three';

export type BikeSurface = 'rubber' | 'leather' | 'seat' | 'brushed' | 'paint';
/** Small deterministic data maps. Values are linear data, not sRGB paint.
 * Tiles are filtered/mipmapped; no per-frame texture creation or stochastic
 * sparkle. The owner's material disposal path owns both textures. */
export function bikeSurfaceMaps(kind: BikeSurface, size = 128) {
  if (!Number.isInteger(size) || size < 16 || size > 512 || size & (size - 1))
    throw new RangeError('Bike surface map size must be a power of two from 16 to 512');
  const height = new Float32Array(size * size);
  const normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const hash = (x: number, y: number) => {
    let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 17, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const period = size / 8;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const grain = hash(x, y),
        at = y * size + x;
      let value = grain * 0.2;
      if (kind === 'paint') {
        // Filtered polyurethane orange peel: two correlated surface scales
        // plus very fine stochastic dispersion. No noisy colour flecks.
        const broad = hash(Math.floor(x / 9), Math.floor(y / 9));
        const fine = hash(Math.floor(x / 3), Math.floor(y / 3));
        value = (broad - 0.5) * 0.095 + (fine - 0.5) * 0.033 + (grain - 0.5) * 0.018;
      } else if (kind === 'leather') {
        const dx = ((x + ((Math.floor(y / period) % 2) * period) / 2) % period) - period / 2;
        const dy = (y % period) - period / 2;
        value -= Math.exp(-(dx * dx + dy * dy) / (period * period * 0.026)) * 0.6;
      } else if (kind === 'seat')
        value += Math.sin((x * Math.PI) / 2) * Math.sin((y * Math.PI) / 2) * 0.06;
      else if (kind === 'brushed') value = hash(0, y) * 0.25 + grain * 0.025;
      else value += 0.04 * Math.sin(((2 * Math.PI * x) / size) * 16);
      height[at] = value;
      const r = Math.round(
        (kind === 'paint'
          ? 0.9 + grain * 0.075
          : kind === 'brushed'
            ? 0.78 + grain * 0.2
            : 0.86 + grain * 0.13) * 255,
      );
      roughness.set([r, r, r, 255], at * 4);
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = y * size + x;
      const h = (u: number, v: number) => height[((v + size) % size) * size + ((u + size) % size)];
      const dx = (h(x - 1, y) - h(x + 1, y)) * 1.2;
      const dy = (h(x, y - 1) - h(x, y + 1)) * 1.2;
      const len = Math.hypot(dx, dy, 1);
      normal.set(
        [
          Math.round(((dx / len) * 0.5 + 0.5) * 255),
          Math.round(((dy / len) * 0.5 + 0.5) * 255),
          Math.round((0.5 / len + 0.5) * 255),
          255,
        ],
        at * 4,
      );
    }
  const texture = (bytes: Uint8Array, label: string) => {
    const t = new T.DataTexture(bytes, size, size, T.RGBAFormat);
    t.name = `MotoGP ${kind} ${label}`;
    t.userData.surfaceDetail = true;
    t.colorSpace = T.NoColorSpace;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    const repeat =
      kind === 'rubber'
        ? [10, 2]
        : kind === 'brushed'
          ? [2, 4]
          : kind === 'paint'
            ? [12, 12]
            : [5, 5];
    t.repeat.set(repeat[0], repeat[1]);
    return t;
  };
  return { normalMap: texture(normal, 'normal'), roughnessMap: texture(roughness, 'roughness') };
}
