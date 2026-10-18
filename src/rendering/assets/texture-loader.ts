import * as T from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { assetUrl, thirdPartyAsset, type ShippedFile } from './third-party.ts';
import { disposeNormalResidency } from '../ground/normal-residency.ts';

/**
 * PBR texture sets from the third-party manifest.
 *
 *   const set = await loadPbrSet(renderer, 'sandy-gravel-01', { repeat: 4, anisotropy: 8 });
 *   new T.MeshStandardMaterial({ ...set.maps });   // map, normalMap, roughnessMap, metalnessMap, aoMap
 *   set.dispose();                                  // when the material goes
 *
 * KTX2 (Basis ETC1S colour / ORM, UASTC normals, mipmapped; the transcoder is
 * served from `assets/basis/`) is used when the renderer can transcode it,
 * else the WebP fallback; a role whose files all fail is left null (the
 * caller's untextured parameters remain). Decoded sources are cached per
 * renderer and shared; every call returns its own Texture objects so repeat
 * and anisotropy are per material. ORM packs ambient occlusion (R),
 * roughness (G) and metalness (B), the layout three's aoMap, roughnessMap
 * and metalnessMap read. Normal maps are OpenGL convention (+Y). In node
 * (unit tests) loading rejects.
 */
export interface PbrMaps {
  map: T.Texture | null;
  normalMap: T.Texture | null;
  roughnessMap: T.Texture | null;
  metalnessMap: T.Texture | null;
  aoMap: T.Texture | null;
}
export interface PbrSet {
  id: string;
  /** Metres one texture repeat covers on the ground it was captured from. */
  metres: number;
  maps: PbrMaps;
  /** Formats actually used per role. */
  formats: Record<string, 'ktx2' | 'webp'>;
  dispose(): void;
}
export interface PbrOptions {
  /** Repeats across the UV unit square (number or [u, v]). */
  repeat?: number | [number, number];
  anisotropy?: number;
  /** Skip KTX2 (diagnostics, A/B). */
  prefer?: 'ktx2' | 'webp';
}

const ktx2Loaders = new WeakMap<T.WebGLRenderer, KTX2Loader>();
function ktx2(renderer: T.WebGLRenderer) {
  let loader = ktx2Loaders.get(renderer);
  if (!loader) {
    loader = new KTX2Loader().setTranscoderPath(assetUrl('assets/basis/')).detectSupport(renderer);
    ktx2Loaders.set(renderer, loader);
  }
  return loader;
}
const loaderDisposals = new WeakMap<T.WebGLRenderer, Promise<void>>();
/** Close a renderer's cache to new requests, then release its transcoder pool
 * after every current role (including format fallbacks) settles. Terminating
 * Three's workers earlier drops their pending resolvers and can strand the
 * shared ground store. Source images stay owned by any resident texture clones. */
export function disposeTextureLoaders(renderer: T.WebGLRenderer) {
  let disposal = loaderDisposals.get(renderer);
  if (!disposal) {
    disposal = Promise.allSettled([
      ...(sources.get(renderer)?.values() ?? []),
      disposeNormalResidency(renderer),
    ]).then(() => {
      // A fallback may have created the KTX2 pool while the roles drained.
      ktx2Loaders.get(renderer)?.dispose();
      ktx2Loaders.delete(renderer);
      sources.delete(renderer);
    });
    loaderDisposals.set(renderer, disposal);
  }
  return disposal;
}

const sources = new WeakMap<
  T.WebGLRenderer,
  Map<string, Promise<{ texture: T.Texture; format: 'ktx2' | 'webp' } | null>>
>();

async function loadFile(renderer: T.WebGLRenderer, file: ShippedFile): Promise<T.Texture> {
  if (file.format === 'ktx2') return ktx2(renderer).loadAsync(assetUrl(file.path));
  const texture = await new T.TextureLoader().loadAsync(assetUrl(file.path));
  texture.colorSpace = file.colorSpace === 'srgb' ? T.SRGBColorSpace : T.NoColorSpace;
  return texture;
}

function loadRole(renderer: T.WebGLRenderer, files: ShippedFile[], prefer: 'ktx2' | 'webp') {
  if (loaderDisposals.has(renderer)) return Promise.resolve(null);
  let cache = sources.get(renderer);
  if (!cache) sources.set(renderer, (cache = new Map()));
  const key = `${files[0].path}:${prefer}`;
  let pending = cache.get(key);
  if (!pending) {
    const ordered = [...files].sort((a, b) =>
      a.format === prefer ? -1 : b.format === prefer ? 1 : 0,
    );
    pending = (async () => {
      for (const file of ordered) {
        try {
          const texture = await loadFile(renderer, file);
          texture.name = file.path;
          texture.wrapS = texture.wrapT = T.RepeatWrapping;
          texture.needsUpdate = true;
          return { texture, format: file.format as 'ktx2' | 'webp' };
        } catch (error) {
          console.warn(
            `Texture ${file.path} unavailable${file === ordered.at(-1) ? '' : ', trying the fallback'}:`,
            error,
          );
        }
      }
      return null;
    })();
    cache.set(key, pending);
  }
  return pending;
}

export async function loadPbrSet(
  renderer: T.WebGLRenderer,
  id: string,
  options: PbrOptions = {},
): Promise<PbrSet> {
  const asset = thirdPartyAsset(id);
  if (!asset || asset.kind !== 'texture') throw new Error(`Unknown texture set ${id}`);
  if (typeof document === 'undefined') throw new Error('Texture sets load in a browser only');
  const supportsKtx2 = renderer.capabilities.isWebGL2;
  const prefer = options.prefer ?? (supportsKtx2 ? 'ktx2' : 'webp');
  const repeat =
    typeof options.repeat === 'number'
      ? [options.repeat, options.repeat]
      : (options.repeat ?? [1, 1]);
  const anisotropy = Math.min(options.anisotropy ?? 8, renderer.capabilities.getMaxAnisotropy());
  const roles = ['color', 'normal', 'orm'] as const;
  const loaded = await Promise.all(
    roles.map((role) => {
      const files = asset.files.filter(
        (f) => f.role === role && (f.format === 'ktx2' || f.format === 'webp'),
      );
      return files.length ? loadRole(renderer, files, prefer) : Promise.resolve(null);
    }),
  );
  const owned: T.Texture[] = [];
  const formats: Record<string, 'ktx2' | 'webp'> = {};
  const instance = (index: number) => {
    const source = loaded[index];
    if (!source) return null;
    const texture = source.texture.clone();
    texture.repeat.set(repeat[0], repeat[1]);
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
    owned.push(texture);
    formats[roles[index]] = source.format;
    return texture;
  };
  const map = instance(0),
    normalMap = instance(1),
    orm = instance(2);
  return {
    id,
    metres: asset.texture?.metres ?? 1,
    maps: { map, normalMap, roughnessMap: orm, metalnessMap: orm, aoMap: orm },
    formats,
    dispose() {
      for (const texture of owned) texture.dispose();
      owned.length = 0;
    },
  };
}

/**
 * One shipped texture role (KTX2 preferred on WebGL2, else its WebP
 * fallback), decoded once per renderer and shared; the caller receives its
 * own clone (wrap, repeat and filtering are per use). Rejects in node.
 */
export async function loadShippedTexture(
  renderer: T.WebGLRenderer,
  files: ShippedFile[],
  prefer?: 'ktx2' | 'webp',
): Promise<{ texture: T.Texture; format: 'ktx2' | 'webp' } | null> {
  if (typeof document === 'undefined') throw new Error('Textures load in a browser only');
  const usable = files.filter((f) => f.format === 'ktx2' || f.format === 'webp');
  if (!usable.length) return null;
  const source = await loadRole(
    renderer,
    usable,
    prefer ?? (renderer.capabilities.isWebGL2 ? 'ktx2' : 'webp'),
  );
  if (!source) return null;
  const texture = source.texture.clone();
  texture.needsUpdate = true;
  return { texture, format: source.format };
}
