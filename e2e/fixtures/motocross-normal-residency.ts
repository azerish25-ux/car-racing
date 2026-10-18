import * as T from 'three';
import { disposeTextureLoaders } from '../../src/rendering/assets/texture-loader.ts';
import { expandSampledNormal } from '../../src/rendering/ground/normal-residency.ts';

/** Offline codec-component proof. Optional already-transcoded source mips are
 * supplied by the authoring verifier. No application navigation, scene
 * simplification or image-baseline substitution is involved. */
export interface NormalSourceMips {
  mips: { width: number; height: number; base64: string }[];
}

export async function inspectNormalResidency(linearMetadata = false, supplied?: NormalSourceMips) {
  const renderer = new T.WebGLRenderer({ antialias: false });
  if (!renderer.extensions.has('EXT_texture_compression_bptc')) {
    renderer.dispose();
    renderer.forceContextLoss();
    return { supported: false as const };
  }
  const mips: { width: number; height: number; data: Uint8Array }[] = [];
  for (let width = 128, height = 64, level = 0; ; level++) {
    const data = new Uint8Array(Math.ceil(width / 4) * Math.ceil(height / 4) * 16);
    for (let block = 0; block < data.length; block += 16) {
      // Mode 6 is valid BC7; each mip has independently varied endpoints and
      // indices. A generated mip pyramid cannot pass this authored-mip test.
      data[block] = 0x40;
      for (let i = 1; i < 16; i++) data[block + i] = (block * 127 + i * 43 + level * 19) % 256;
    }
    mips.push({ width, height, data });
    if (width === 1 && height === 1) break;
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  }
  if (supplied) {
    mips.length = 0;
    for (const mip of supplied.mips) {
      mips.push({
        width: mip.width,
        height: mip.height,
        data: Uint8Array.from(atob(mip.base64), (character) => character.charCodeAt(0)),
      });
    }
  }
  const source = new T.CompressedTexture(mips, mips[0].width, mips[0].height, T.RGBA_BPTC_Format);
  // KTX2Loader identifies linear RGB primaries as LinearSRGBColorSpace.
  // Both valid linear labels must take the identical residency path.
  source.colorSpace = linearMetadata ? T.LinearSRGBColorSpace : T.NoColorSpace;
  source.wrapS = source.wrapT = T.RepeatWrapping;
  source.minFilter = T.LinearMipmapLinearFilter;
  source.magFilter = T.LinearFilter;
  source.anisotropy = renderer.capabilities.getMaxAnisotropy();
  source.repeat.set(2, 3);
  source.offset.set(0.13, 0.28);
  source.rotation = 0.2;
  source.updateMatrix();
  source.needsUpdate = true;
  const originalVersion = source.version;
  const originalMips = mips.map((mip) => mip.data.slice());
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
    uniforms: { source: { value: source as T.Texture }, mip: { value: 0 } },
    vertexShader: `precision highp float; in vec3 position;
      void main() { gl_Position=vec4(position,1.0); }`,
    fragmentShader: `precision highp float; precision highp int;
      uniform sampler2D source; uniform int mip; out vec4 colour;
      void main() { colour=texelFetch(source,ivec2(gl_FragCoord.xy),mip); }`,
  });
  const scene = new T.Scene(),
    camera = new T.Camera();
  const triangle = new T.Mesh(geometry, material);
  triangle.frustumCulled = false;
  scene.add(triangle);
  const capture = async (gpu: T.WebGLRenderer, texture: T.Texture) => {
    const pixels: Uint8Array[] = [];
    material.uniforms.source.value = texture;
    for (const [level, mip] of mips.entries()) {
      const target = new T.WebGLRenderTarget(mip.width, mip.height, {
        depthBuffer: false,
        stencilBuffer: false,
        colorSpace: T.NoColorSpace,
      });
      try {
        gpu.setRenderTarget(target);
        gpu.setViewport(0, 0, mip.width, mip.height);
        gpu.setScissorTest(false);
        material.uniforms.mip.value = level;
        gpu.render(scene, camera);
        const data = new Uint8Array(mip.width * mip.height * 4);
        await gpu.readRenderTargetPixelsAsync(target, 0, 0, mip.width, mip.height, data);
        pixels.push(data);
      } finally {
        gpu.setRenderTarget(null);
        target.dispose();
      }
    }
    return pixels;
  };
  let expanded: T.Texture | undefined;
  let replacement: T.WebGLRenderer | undefined;
  const heldTarget = new T.WebGLRenderTarget(16, 16);
  try {
    const before = await capture(renderer, source);
    renderer.setRenderTarget(heldTarget);
    renderer.setViewport(1, 2, 9, 10);
    renderer.setScissor(3, 2, 7, 8);
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    const state = () => ({
      target: renderer.getRenderTarget() === heldTarget,
      viewport: renderer.getViewport(new T.Vector4()).toArray(),
      scissor: renderer.getScissor(new T.Vector4()).toArray(),
      scissorTest: renderer.getScissorTest(),
      autoClear: renderer.autoClear,
    });
    const initial = state();
    const preparation = expandSampledNormal(renderer, source);
    const whilePending = state();
    expanded = await preparation;
    const afterPreparation = state();
    const after = await capture(renderer, expanded);
    const compare = (a: Uint8Array[], b: Uint8Array[]) =>
      a.map((mip, level) => ({
        level,
        bytes: mip.length,
        equal: mip.every((value, i) => value === b[level][i]),
        nonzero: mip.some((value) => value !== 0),
      }));
    const sourceUnchanged =
      source.version === originalVersion &&
      mips.every((mip, level) => mip.data.every((value, i) => value === originalMips[level][i]));
    const filteringPreserved =
      source.minFilter === expanded.minFilter &&
      source.magFilter === expanded.magFilter &&
      source.anisotropy === expanded.anisotropy &&
      source.wrapS === expanded.wrapS &&
      source.wrapT === expanded.wrapT &&
      source.matrix.equals(expanded.matrix) &&
      source.repeat.equals(expanded.repeat) &&
      source.offset.equals(expanded.offset);
    const glError = renderer.getContext().getError();
    renderer.setRenderTarget(null);
    heldTarget.dispose();
    await disposeTextureLoaders(renderer);
    renderer.dispose();
    renderer.forceContextLoss();
    replacement = new T.WebGLRenderer({ antialias: false });
    const reuploaded = await capture(replacement, expanded);
    return {
      supported: true as const,
      sourceUnchanged,
      filteringPreserved,
      sourceColorSpace: source.colorSpace,
      expandedColorSpace: expanded.colorSpace,
      isDataTexture: expanded instanceof T.DataTexture,
      generateMipmaps: expanded.generateMipmaps,
      residency: expanded.userData,
      initial,
      whilePending,
      afterPreparation,
      mips: compare(before, after),
      replacementMips: compare(before, reuploaded),
      glError,
      replacementGlError: replacement.getContext().getError(),
    };
  } finally {
    renderer.setRenderTarget(null);
    heldTarget.dispose();
    source.dispose();
    expanded?.dispose();
    geometry.dispose();
    material.dispose();
    await disposeTextureLoaders(renderer);
    renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
    replacement?.dispose();
    replacement?.forceContextLoss();
  }
}
