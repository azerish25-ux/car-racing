import * as T from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disposeTextureLoaders,
  loadPbrSet,
  loadShippedTexture,
} from '../src/rendering/assets/texture-loader.ts';
import { thirdPartyAsset, type ShippedFile } from '../src/rendering/assets/third-party.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  vi.stubGlobal('document', {});
  const renderer = {
    capabilities: { isWebGL2: true, getMaxAnisotropy: () => 8 },
  } as unknown as T.WebGLRenderer;
  vi.spyOn(KTX2Loader.prototype, 'detectSupport').mockReturnThis();
  const dispose = vi.spyOn(KTX2Loader.prototype, 'dispose').mockReturnThis();
  const ktx = vi.spyOn(KTX2Loader.prototype, 'loadAsync');
  const webp = vi.spyOn(T.TextureLoader.prototype, 'loadAsync');
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return { renderer, dispose, ktx, webp, warnings };
}

function files(): ShippedFile[] {
  return (['ktx2', 'webp'] as const).map((format) => ({
    path: `assets/lifecycle-fixture/color.${format}`,
    bytes: 0,
    sha256: '',
    role: 'color',
    format,
    colorSpace: 'srgb',
  }));
}

function compressed() {
  return new T.CompressedTexture(
    [{ data: new Uint8Array([1, 2, 3, 255]), width: 1, height: 1 }],
    1,
    1,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('renderer texture decoder lifecycle', () => {
  it('drains every PBR role once and preserves decoded data shared by resident clones', async () => {
    const f = fixture();
    const jobs = Array.from({ length: 3 }, () => deferred<T.CompressedTexture>());
    let role = 0;
    f.ktx.mockImplementation(() => jobs[role++].promise);
    const asset = thirdPartyAsset('sandy-gravel-01');
    expect(asset?.files.filter((file) => file.format === 'ktx2')).toHaveLength(3);
    const first = loadPbrSet(f.renderer, 'sandy-gravel-01');
    const second = loadPbrSet(f.renderer, 'sandy-gravel-01', { repeat: 3 });
    expect(f.ktx).toHaveBeenCalledTimes(3);
    const disposal = disposeTextureLoaders(f.renderer);
    expect(disposeTextureLoaders(f.renderer)).toBe(disposal);
    expect(f.dispose).not.toHaveBeenCalled();

    const sources = jobs.map(() => compressed());
    const releases = sources.map((source) => vi.spyOn(source, 'dispose'));
    jobs[0].resolve(sources[0]);
    jobs[1].resolve(sources[1]);
    await Promise.resolve();
    expect(f.dispose).not.toHaveBeenCalled();
    jobs[2].resolve(sources[2]);
    const [a, b] = await Promise.all([first, second]);
    await disposal;
    expect(f.dispose).toHaveBeenCalledTimes(1);
    expect(a.maps.map).not.toBe(sources[0]);
    expect(a.maps.map).not.toBe(b.maps.map);
    expect(a.maps.map?.source).toBe(sources[0].source);
    expect((b.maps.map as T.CompressedTexture).mipmaps[0].data).toEqual(
      new Uint8Array([1, 2, 3, 255]),
    );
    expect(a.maps.map?.repeat.toArray()).toEqual([1, 1]);
    expect(b.maps.map?.repeat.toArray()).toEqual([3, 3]);
    for (const release of releases) expect(release).not.toHaveBeenCalled();
    expect(await loadShippedTexture(f.renderer, files())).toBeNull();
    expect(f.ktx).toHaveBeenCalledTimes(3);
    await disposeTextureLoaders(f.renderer);
    expect(f.dispose).toHaveBeenCalledTimes(1);
    a.dispose();
    b.dispose();
    for (const source of sources) source.dispose();
  });

  it('lets a failed pending KTX2 role finish its WebP fallback before terminating the pool', async () => {
    const f = fixture(),
      encoded = deferred<T.CompressedTexture>(),
      fallback = deferred<T.Texture>();
    f.ktx.mockReturnValue(encoded.promise);
    f.webp.mockReturnValue(fallback.promise);
    const load = loadShippedTexture(f.renderer, files());
    const disposal = disposeTextureLoaders(f.renderer);
    encoded.reject(new Error('transcode failed'));
    await vi.waitFor(() => expect(f.webp).toHaveBeenCalledTimes(1));
    expect(f.dispose).not.toHaveBeenCalled();
    const source = new T.DataTexture(new Uint8Array([4, 5, 6, 255]), 1, 1);
    fallback.resolve(source);
    const loaded = await load;
    await disposal;
    expect(loaded?.format).toBe('webp');
    expect(loaded?.texture.source).toBe(source.source);
    expect(f.dispose).toHaveBeenCalledTimes(1);
    expect(f.warnings).toHaveBeenCalledTimes(1);
    loaded?.texture.dispose();
    source.dispose();
  });

  it('releases a pool created by an in-flight fallback after renderer disposal began', async () => {
    const f = fixture(),
      preferred = deferred<T.Texture>(),
      fallback = deferred<T.CompressedTexture>();
    f.webp.mockReturnValue(preferred.promise);
    f.ktx.mockReturnValue(fallback.promise);
    const load = loadShippedTexture(f.renderer, files(), 'webp');
    const disposal = disposeTextureLoaders(f.renderer);
    expect(f.ktx).not.toHaveBeenCalled();
    preferred.reject(new Error('WebP unavailable'));
    await vi.waitFor(() => expect(f.ktx).toHaveBeenCalledTimes(1));
    expect(f.dispose).not.toHaveBeenCalled();
    const source = compressed();
    fallback.resolve(source);
    const loaded = await load;
    await disposal;
    expect(loaded?.format).toBe('ktx2');
    expect(f.dispose).toHaveBeenCalledTimes(1);
    loaded?.texture.dispose();
    source.dispose();
  });

  it('settles failed loads and isolates cleanup from a replacement renderer', async () => {
    const f = fixture(),
      failed = deferred<T.CompressedTexture>(),
      failedFallback = deferred<T.Texture>(),
      replacement = deferred<T.CompressedTexture>();
    f.ktx.mockReturnValueOnce(failed.promise).mockReturnValueOnce(replacement.promise);
    f.webp.mockReturnValue(failedFallback.promise);
    const oldLoad = loadShippedTexture(f.renderer, files());
    const disposal = disposeTextureLoaders(f.renderer);
    const nextRenderer = { ...f.renderer } as T.WebGLRenderer;
    const nextLoad = loadShippedTexture(nextRenderer, files());
    failed.reject(new Error('missing KTX2'));
    await vi.waitFor(() => expect(f.webp).toHaveBeenCalledTimes(1));
    failedFallback.reject(new Error('missing WebP'));
    expect(await oldLoad).toBeNull();
    await disposal;
    expect(f.dispose).toHaveBeenCalledTimes(1);
    expect(f.dispose.mock.contexts[0]).toBe(f.ktx.mock.contexts[0]);
    expect(f.dispose.mock.contexts[0]).not.toBe(f.ktx.mock.contexts[1]);

    const source = compressed();
    replacement.resolve(source);
    const loaded = await nextLoad;
    expect(loaded?.texture.source).toBe(source.source);
    await disposeTextureLoaders(nextRenderer);
    expect(f.dispose).toHaveBeenCalledTimes(2);
    expect(f.dispose.mock.contexts[1]).toBe(f.ktx.mock.contexts[1]);
    expect(f.warnings).toHaveBeenCalledTimes(2);
    loaded?.texture.dispose();
    source.dispose();
  });
});
