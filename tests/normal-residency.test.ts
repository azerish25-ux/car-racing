import * as T from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeTextureLoaders } from '../src/rendering/assets/texture-loader.ts';
import {
  expandSampledNormal,
  NORMAL_RESIDENCY_MAX_BYTES,
  normalResidencyPlan,
} from '../src/rendering/ground/normal-residency.ts';

function source(width = 1024, height = width) {
  const mipmaps = [];
  for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    mipmaps.push({
      width: w,
      height: h,
      data: new Uint8Array(Math.ceil(w / 4) * Math.ceil(h / 4) * 16),
    });
    if (w === 1 && h === 1) break;
  }
  return new T.CompressedTexture(mipmaps, width, height, T.RGBA_BPTC_Format);
}

describe('sampled-normal residency budget and fidelity contract', () => {
  it('accepts the linear-sRGB metadata produced by KTX2Loader for shipped ground normals', () => {
    const normal = source();
    normal.colorSpace = T.LinearSRGBColorSpace;
    expect(normalResidencyPlan(normal)).toEqual(normalResidencyPlan(source()));
  });

  it('keeps every authored mip, down to 1x1, within the 1K ground budget', () => {
    const texture = source();
    const plan = normalResidencyPlan(texture)!;
    expect(plan).toHaveLength(11);
    expect(plan[0]).toEqual({ level: 0, width: 1024, height: 1024, bytes: 4194304 });
    expect(plan.at(-1)).toEqual({ level: 10, width: 1, height: 1, bytes: 4 });
    expect(plan.reduce((total, mip) => total + mip.bytes, 0)).toBe(5592404);
    expect(plan.reduce((total, mip) => total + mip.bytes, 0)).toBeLessThan(
      NORMAL_RESIDENCY_MAX_BYTES,
    );
  });
  it('preserves rectangular authored chains instead of resizing them', () => {
    const plan = normalResidencyPlan(source(128, 32))!;
    expect(plan.map((m) => [m.width, m.height])).toEqual([
      [128, 32],
      [64, 16],
      [32, 8],
      [16, 4],
      [8, 2],
      [4, 1],
      [2, 1],
      [1, 1],
    ]);
  });
  it('leaves larger future textures compressed instead of silently lowering resolution', () => {
    expect(normalResidencyPlan(source(2048))).toBeNull();
  });
  it('rejects incomplete and inconsistent mip chains rather than generating replacements', () => {
    const incomplete = source(32);
    incomplete.mipmaps.pop();
    expect(normalResidencyPlan(incomplete)).toBeNull();
    const inconsistent = source(32);
    inconsistent.mipmaps[2].width = 7;
    expect(normalResidencyPlan(inconsistent)).toBeNull();
  });
  it('does not apply a linear-normal copy to colour, HDR or another compressed format', () => {
    const colour = source(8);
    colour.colorSpace = T.SRGBColorSpace;
    expect(normalResidencyPlan(colour)).toBeNull();
    const hdr = source(8);
    hdr.type = T.FloatType;
    expect(normalResidencyPlan(hdr)).toBeNull();
    const other = source(8);
    other.format = T.RGBA_S3TC_DXT5_Format;
    expect(normalResidencyPlan(other)).toBeNull();
  });
  it('returns an ordinary normal map unchanged without touching a renderer', async () => {
    const normal = new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    expect(await expandSampledNormal({} as T.WebGLRenderer, normal)).toBe(normal);
  });
});

describe('normal preparation renderer ownership', () => {
  it('restores caller state immediately and drains asynchronous copies before decoder disposal', async () => {
    let finish!: () => void;
    const context = { isContextLost: () => false };
    const target = new T.WebGLRenderTarget(8, 8);
    const viewport = new T.Vector4(1, 2, 3, 4);
    const scissor = new T.Vector4(2, 3, 4, 5);
    const state = { target, face: 0, level: 0, scissorTest: true };
    const read = vi.fn(
      (_target, _x, _y, _w, _h, data: Uint8Array) =>
        new Promise<Uint8Array>((resolve) => {
          finish = () => {
            data.set([23, 46, 197, 255]);
            resolve(data);
          };
        }),
    );
    const gpu = {
      autoClear: true,
      getContext: () => context,
      getRenderTarget: () => state.target,
      getActiveCubeFace: () => state.face,
      getActiveMipmapLevel: () => state.level,
      getViewport: (out: T.Vector4) => out.copy(viewport),
      getScissor: (out: T.Vector4) => out.copy(scissor),
      getScissorTest: () => state.scissorTest,
      setRenderTarget: (value: T.WebGLRenderTarget, face = 0, level = 0) => {
        state.target = value;
        state.face = face;
        state.level = level;
      },
      setViewport: (...args: [T.Vector4] | [number, number, number, number]) =>
        args.length === 1 ? viewport.copy(args[0]) : viewport.set(...args),
      setScissor: (value: T.Vector4) => scissor.copy(value),
      setScissorTest: (value: boolean) => {
        state.scissorTest = value;
      },
      render: vi.fn(),
      readRenderTargetPixelsAsync: read,
    };
    const renderer = gpu as unknown as T.WebGLRenderer;
    const normal = source(1);
    const job = expandSampledNormal(renderer, normal);
    expect(state.target).toBe(target);
    expect(viewport.toArray()).toEqual([1, 2, 3, 4]);
    expect(scissor.toArray()).toEqual([2, 3, 4, 5]);
    expect(state.scissorTest).toBe(true);
    expect(gpu.autoClear).toBe(true);
    let drained = false;
    const disposal = disposeTextureLoaders(renderer).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(await expandSampledNormal(renderer, normal)).toBe(normal);
    expect(read).toHaveBeenCalledTimes(1);
    finish();
    const expanded = await job;
    await disposal;
    expect(drained).toBe(true);
    expect(expanded).not.toBe(normal);
    expect(expanded.image.data).toEqual(new Uint8Array([23, 46, 197, 255]));
    expanded.dispose();
    normal.dispose();
    target.dispose();
  });
});
