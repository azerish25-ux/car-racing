import * as T from 'three';
import { assetUrl, type ShippedFile } from './third-party.ts';

/**
 * Loading of the shipped Ultra HDR skies as GPU-decodable texture pairs.
 *
 * The file is fetched once, split at the manifest's gain-map offset and both
 * JPEGs are decoded by the browser (createImageBitmap, off the main thread,
 * no colour management). The base becomes an sRGB texture (the sampler
 * linearises it), the gain map an R8 texture; both mipmapped, longitude
 * repeating. `photo-sky-shader.ts` reconstructs radiance from the pair.
 * Without a browser image decoder (unit tests in node) loading rejects and
 * callers keep the procedural path.
 */
export interface GainMapTextures {
  base: T.Texture;
  gain: T.Texture;
  gainMax: number;
  width: number;
  height: number;
  /** Encoded bytes fetched (download cost). */
  bytes: number;
  dispose(): void;
}

export function gainMapSupported() {
  return (
    typeof fetch === 'function' &&
    (typeof createImageBitmap === 'function' || typeof Image !== 'undefined')
  );
}

async function decode(bytes: Uint8Array): Promise<ImageBitmap | HTMLImageElement> {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
        imageOrientation: 'none',
      });
    } catch {
      /* fall through to an image element */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function texture(image: ImageBitmap | HTMLImageElement, name: string, srgb: boolean) {
  const t = new T.Texture(image as unknown as HTMLImageElement);
  t.name = name;
  t.flipY = false;
  t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
  if (!srgb) t.format = T.RedFormat;
  t.wrapS = T.RepeatWrapping;
  t.wrapT = T.ClampToEdgeWrapping;
  t.magFilter = T.LinearFilter;
  t.minFilter = T.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = srgb ? 4 : 1;
  t.needsUpdate = true;
  return t;
}

/** Fetch and decode one shipped `.hdr.jpg` (it must carry a gain-map layout). */
export async function loadGainMapTextures(
  file: ShippedFile,
  signal?: AbortSignal,
): Promise<GainMapTextures> {
  const layout = file.gainMap;
  if (!layout) throw new Error(`${file.path} has no gain-map layout`);
  if (!gainMapSupported()) throw new Error('No image decoder in this environment');
  const response = await fetch(assetUrl(file.path), { signal });
  if (!response.ok) throw new Error(`${file.path}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== file.bytes)
    throw new Error(`${file.path}: ${bytes.length} bytes, expected ${file.bytes}`);
  const [baseImage, gainImage] = await Promise.all([
    decode(bytes.subarray(0, layout.offset)),
    decode(bytes.subarray(layout.offset)),
  ]);
  const base = texture(baseImage, `${file.path} base`, true),
    gain = texture(gainImage, `${file.path} gain`, false);
  return {
    base,
    gain,
    gainMax: layout.gainMax,
    width: file.width ?? baseImage.width,
    height: file.height ?? baseImage.height,
    bytes: bytes.length,
    dispose() {
      base.dispose();
      gain.dispose();
      for (const image of [baseImage, gainImage]) if ('close' in image) image.close();
    },
  };
}

/** Linear half-float equirectangular radiance of a texture pair (one draw),
 * for consumers that want an ordinary HDR texture (PMREM, scene.background). */
export function decodeGainMapToHalfFloat(
  renderer: T.WebGLRenderer,
  pair: GainMapTextures,
  scale = 1,
) {
  const target = new T.WebGLRenderTarget(pair.width, pair.height, {
    type: T.HalfFloatType,
    format: T.RGBAFormat,
    colorSpace: T.LinearSRGBColorSpace,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: T.LinearMipmapLinearFilter,
    magFilter: T.LinearFilter,
    wrapS: T.RepeatWrapping,
  });
  target.texture.mapping = T.EquirectangularReflectionMapping;
  const material = new T.RawShaderMaterial({
    glslVersion: T.GLSL3,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      base: { value: pair.base },
      gain: { value: pair.gain },
      gainMax: { value: pair.gainMax },
      scale: { value: scale },
    },
    vertexShader: `precision highp float;
      in vec3 position; in vec2 uv; out vec2 vUv;
      void main() { vUv = vec2(uv.x, 1.0 - uv.y); gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`,
    fragmentShader: `precision highp float;
      uniform sampler2D base; uniform sampler2D gain; uniform float gainMax; uniform float scale;
      in vec2 vUv; out vec4 radiance;
      void main() {
        radiance = vec4(texture(base, vUv).rgb * exp2(texture(gain, vUv).r * gainMax) * scale, 1.0);
      }`,
  });
  const quad = new T.Mesh(new T.PlaneGeometry(1, 1), material);
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(quad, camera);
  } finally {
    renderer.setRenderTarget(previous);
    material.dispose();
    quad.geometry.dispose();
  }
  return target;
}
