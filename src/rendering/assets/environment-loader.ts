import * as T from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { UltraHDRLoader } from 'three/addons/loaders/UltraHDRLoader.js';
import { decodeGainMapToHalfFloat, loadGainMapTextures } from './gain-map.ts';
import { assetUrl, thirdPartyAsset, type HdriInfo, type ShippedFile } from './third-party.ts';

/**
 * A shipped HDRI as ordinary three.js lighting, for scenes that do not draw
 * the sky dome (showrooms, studios, garages):
 *
 *   const env = await loadEnvironment(renderer, 'quarry-02', { variant: '2k' });
 *   scene.background = env.background;           // equirectangular, linear HDR
 *   scene.environment = env.environment;         // PMREM
 *   scene.backgroundRotation.y = scene.environmentRotation.y = env.rotationFor(sunDirection);
 *   env.dispose();
 *
 * Radiance is in the shipped normalised units (unit dome mean) times
 * `options.scale`. The shipped files decode on the GPU (gain map, exact);
 * a `.hdr.jpg` without a manifest layout falls back to three's UltraHDRLoader
 * and a Radiance `.hdr` to HDRLoader. Results are cached per renderer and
 * reference counted; the circuit and festival renderers use `PhotoSky`
 * instead, which draws the same files on their sky dome.
 */
export interface LoadedEnvironment {
  id: string;
  info: HdriInfo | null;
  background: T.Texture;
  environment: T.Texture;
  /** backgroundRotation / environmentRotation (y, radians) that puts the
   * photo's sun at the scene sun's azimuth. */
  rotationFor(sun: { x: number; z: number }): number;
  dispose(): void;
}
export interface EnvironmentOptions {
  variant?: '4k' | '2k';
  scale?: number;
}

interface Cached {
  promise: Promise<{ background: T.Texture; environment: T.Texture; release(): void }>;
  users: number;
}
const cache = new WeakMap<T.WebGLRenderer, Map<string, Cached>>();

async function decodeFile(renderer: T.WebGLRenderer, file: ShippedFile, scale: number) {
  if (file.format === 'ultrahdr' && file.gainMap) {
    const pair = await loadGainMapTextures(file);
    const canRender =
      renderer.extensions.has('EXT_color_buffer_float') ||
      renderer.extensions.has('EXT_color_buffer_half_float');
    if (canRender) {
      const target = decodeGainMapToHalfFloat(renderer, pair, scale);
      pair.dispose();
      return { texture: target.texture, release: () => target.dispose() };
    }
    pair.dispose();
  }
  const loader = file.path.endsWith('.hdr') ? new HDRLoader() : new UltraHDRLoader();
  loader.setDataType(T.HalfFloatType);
  const texture = await loader.loadAsync(assetUrl(file.path));
  texture.mapping = T.EquirectangularReflectionMapping;
  return { texture, release: () => texture.dispose() };
}

export async function loadEnvironment(
  renderer: T.WebGLRenderer,
  id: string,
  options: EnvironmentOptions = {},
): Promise<LoadedEnvironment> {
  const asset = thirdPartyAsset(id);
  if (!asset || asset.kind !== 'hdri') throw new Error(`Unknown HDRI ${id}`);
  if (typeof document === 'undefined') throw new Error('Environments load in a browser only');
  const variant = options.variant ?? '2k',
    scale = options.scale ?? 1;
  const file = asset.files.find((f) => f.role === variant) ?? asset.files[0];
  let perRenderer = cache.get(renderer);
  if (!perRenderer) cache.set(renderer, (perRenderer = new Map()));
  const key = `${id}:${file.role}:${scale}`;
  let entry = perRenderer.get(key);
  if (!entry) {
    const promise = (async () => {
      const decoded = await decodeFile(renderer, file, scale);
      decoded.texture.mapping = T.EquirectangularReflectionMapping;
      decoded.texture.name = `${id} ${file.role}`;
      const generator = new T.PMREMGenerator(renderer);
      try {
        const pmrem = generator.fromEquirectangular(decoded.texture);
        return {
          background: decoded.texture,
          environment: pmrem.texture,
          release() {
            decoded.release();
            pmrem.dispose();
          },
        };
      } finally {
        generator.dispose();
      }
    })();
    entry = { promise, users: 0 };
    perRenderer.set(key, entry);
    promise.catch(() => perRenderer!.delete(key));
  }
  entry.users++;
  const loaded = await entry.promise;
  const held = entry;
  let released = false;
  return {
    id,
    info: asset.hdri ?? null,
    background: loaded.background,
    environment: loaded.environment,
    rotationFor(sun) {
      const photo = ((asset.hdri?.sunAzimuth ?? 0) * Math.PI) / 180;
      // three's environmentRotation turns the lookup direction; the photo's
      // sun azimuth moves to the scene sun's.
      return photo - Math.atan2(sun.z, sun.x);
    },
    dispose() {
      if (released) return;
      released = true;
      if (--held.users <= 0) {
        perRenderer!.delete(key);
        loaded.release();
      }
    },
  };
}
