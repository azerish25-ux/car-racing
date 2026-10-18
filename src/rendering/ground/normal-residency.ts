import * as T from 'three';

/** Multi-tap ground normals pay for the same BC7 block decode many times on
 * some texture units. Expand that decoded signal once, not the source image
 * into a different codec. This applies to the format and sampling workload,
 * not a browser name, GPU vendor, test flag or quality downgrade.
 *
 * The shipped 1K normal costs 5,592,404 resident bytes including all 11 mips.
 * At most ten named ground layers exist. Larger future assets keep their
 * compressed representation rather than silently exhausting the budget. */
export const NORMAL_RESIDENCY_MAX_BYTES = 8 * 1024 * 1024;
export interface NormalMipPlan {
  level: number;
  width: number;
  height: number;
  bytes: number;
}

/** Only complete unsigned 8-bit, linear BC7 normal chains are eligible. */
export function normalResidencyPlan(texture: T.Texture): NormalMipPlan[] | null {
  const source = texture as T.CompressedTexture;
  if (
    !source.isCompressedTexture ||
    source.format !== T.RGBA_BPTC_Format ||
    source.type !== T.UnsignedByteType ||
    (source.colorSpace !== T.NoColorSpace && source.colorSpace !== T.LinearSRGBColorSpace) ||
    source.flipY ||
    source.premultiplyAlpha
  )
    return null;
  let width = source.image.width,
    height = source.image.height;
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0)) return null;
  const count = 1 + Math.floor(Math.log2(Math.max(width, height)));
  if (source.mipmaps.length !== count) return null;
  let bytes = 0;
  const plan: NormalMipPlan[] = [];
  for (let level = 0; level < count; level++) {
    const mip = source.mipmaps[level];
    if (
      mip.width !== width ||
      mip.height !== height ||
      mip.data.byteLength !== Math.ceil(width / 4) * Math.ceil(height / 4) * 16
    )
      return null;
    bytes += width * height * 4;
    if (bytes > NORMAL_RESIDENCY_MAX_BYTES) return null;
    plan.push({ level, width, height, bytes: width * height * 4 });
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
  return plan;
}

/** Materialize the GPU's exact decoded normal texels at EVERY authored mip.
 * No normal regeneration, resizing, re-mipping, colour conversion, filtering,
 * asynchronous asset fetch or shader sampling change occurs here. Readback
 * uses pixel-pack buffers and fences, never gl.finish or synchronous readPixels.
 * CPU-backed mip arrays survive renderer replacement/context loss, unlike a
 * cached render-target texture. The caller owns the returned texture when it
 * differs from the input; the input itself is never mutated or disposed. */
const preparations = new WeakMap<T.WebGLRenderer, Set<Promise<T.Texture>>>();
const disposals = new WeakMap<T.WebGLRenderer, Promise<void>>();

/** Close to new GPU work synchronously, then drain existing pixel-pack reads
 * before the owning renderer releases its context. Late asset downloads keep
 * their CPU-backed compressed normal and cannot restart a disposed renderer. */
export function disposeNormalResidency(renderer: T.WebGLRenderer): Promise<void> {
  let pending = disposals.get(renderer);
  if (!pending) {
    pending = Promise.allSettled([...(preparations.get(renderer) ?? [])]).then(() => {
      preparations.delete(renderer);
    });
    disposals.set(renderer, pending);
  }
  return pending;
}

export function expandSampledNormal(
  renderer: T.WebGLRenderer,
  source: T.Texture,
): Promise<T.Texture> {
  const plan = normalResidencyPlan(source);
  if (!plan || disposals.has(renderer)) return Promise.resolve(source);
  let active = preparations.get(renderer);
  if (!active) preparations.set(renderer, (active = new Set()));
  const job = expandMipChain(renderer, source, plan).finally(() => active.delete(job));
  active.add(job);
  return job;
}

async function expandMipChain(renderer: T.WebGLRenderer, source: T.Texture, plan: NormalMipPlan[]) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    'position',
    new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  const material = new T.RawShaderMaterial({
    glslVersion: T.GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
    toneMapped: false,
    uniforms: { normalSource: { value: source }, sourceMip: { value: 0 } },
    vertexShader: `precision highp float;
      in vec3 position;
      void main() { gl_Position = vec4(position, 1.0); }`,
    fragmentShader: `precision highp float;
      precision highp int;
      uniform sampler2D normalSource;
      uniform int sourceMip;
      out vec4 decoded;
      void main() {
        decoded = texelFetch(normalSource, ivec2(gl_FragCoord.xy), sourceMip);
      }`,
  });
  const scene = new T.Scene(),
    camera = new T.Camera(),
    triangle = new T.Mesh(geometry, material);
  triangle.frustumCulled = false;
  scene.add(triangle);
  const mipmaps: { data: Uint8Array; width: number; height: number }[] = [];
  try {
    for (const mip of plan) {
      if (renderer.getContext().isContextLost()) throw new Error('Normal preparation lost context');
      const target = new T.WebGLRenderTarget(mip.width, mip.height, {
        format: T.RGBAFormat,
        type: T.UnsignedByteType,
        colorSpace: T.NoColorSpace,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      const data = new Uint8Array(mip.bytes);
      try {
        // Restore ALL externally visible target state before the first await.
        // Several different layers may finish decoding during the same task.
        const previous = renderer.getRenderTarget(),
          face = renderer.getActiveCubeFace(),
          level = renderer.getActiveMipmapLevel(),
          viewport = renderer.getViewport(new T.Vector4()),
          scissor = renderer.getScissor(new T.Vector4()),
          scissorTest = renderer.getScissorTest(),
          autoClear = renderer.autoClear;
        let pending: ReturnType<T.WebGLRenderer['readRenderTargetPixelsAsync']>;
        try {
          renderer.autoClear = false;
          renderer.setRenderTarget(target);
          renderer.setViewport(0, 0, mip.width, mip.height);
          renderer.setScissorTest(false);
          material.uniforms.sourceMip.value = mip.level;
          renderer.render(scene, camera);
          pending = renderer.readRenderTargetPixelsAsync(target, 0, 0, mip.width, mip.height, data);
        } finally {
          renderer.setRenderTarget(previous, face, level);
          renderer.setViewport(viewport);
          renderer.setScissor(scissor);
          renderer.setScissorTest(scissorTest);
          renderer.autoClear = autoClear;
        }
        if ((await pending) !== data) throw new Error('Normal preparation returned no pixel data');
        if (renderer.getContext().isContextLost())
          throw new Error('Normal preparation lost context');
        mipmaps.push({ data, width: mip.width, height: mip.height });
      } finally {
        target.dispose();
      }
    }
    const first = mipmaps[0];
    const texture = new T.DataTexture(first.data, first.width, first.height);
    texture.mipmaps = mipmaps;
    texture.generateMipmaps = false;
    texture.colorSpace = source.colorSpace;
    texture.channel = source.channel;
    texture.mapping = source.mapping;
    texture.wrapS = source.wrapS;
    texture.wrapT = source.wrapT;
    texture.minFilter = source.minFilter;
    texture.magFilter = source.magFilter;
    texture.anisotropy = source.anisotropy;
    texture.repeat.copy(source.repeat);
    texture.offset.copy(source.offset);
    texture.center.copy(source.center);
    texture.rotation = source.rotation;
    texture.matrix.copy(source.matrix);
    texture.matrixAutoUpdate = source.matrixAutoUpdate;
    texture.name = source.name;
    texture.userData = {
      ...source.userData,
      normalResidency: 'decoded-rgba8',
      residentBytes: plan.reduce((n, m) => n + m.bytes, 0),
    };
    texture.needsUpdate = true;
    return texture;
  } finally {
    geometry.dispose();
    material.dispose();
  }
}
