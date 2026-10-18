import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { inspectNormalResidency } from './fixtures/motocross-normal-residency.ts';

for (const linearMetadata of [false, true]) {
  const title = linearMetadata
    ? 'linear-sRGB KTX2 normals preserve decoded texels at every mip and across renderer replacement'
    : 'multi-tap ground normals preserve decoded texels at every mip and across renderer replacement';
  test(title, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/motocross-normal-residency.ts'),
          name: 'NormalResidencyProof',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing normal-residency proof build');
    const script = output.output.find((item) => item.type === 'chunk');
    if (!script || script.type !== 'chunk')
      throw new Error('Missing normal-residency proof script');
    // This is an offline codec unit, not a replacement for full application tests.
    await page.setContent('<!doctype html><title>Normal mip fidelity proof</title>');
    await page.addScriptTag({ content: script.code });
    const result = await page.evaluate(
      (linearMetadata) =>
        (
          window as unknown as {
            NormalResidencyProof: { inspectNormalResidency: typeof inspectNormalResidency };
          }
        ).NormalResidencyProof.inspectNormalResidency(linearMetadata),
      linearMetadata,
    );
    test.skip(
      !result.supported,
      'This GPU does not use BC7 textures; normal residency remains unchanged.',
    );
    if (!result.supported) return;
    await info.attach('normal-residency-fidelity.json', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
    expect(result.sourceUnchanged).toBe(true);
    expect(result.sourceColorSpace).toBe(linearMetadata ? 'srgb-linear' : '');
    expect(result.expandedColorSpace).toBe(result.sourceColorSpace);
    expect(result.filteringPreserved).toBe(true);
    expect(result.isDataTexture).toBe(true);
    expect(result.generateMipmaps).toBe(false);
    expect(result.initial.target).toBe(true);
    expect(result.whilePending).toEqual(result.initial);
    expect(result.afterPreparation).toEqual(result.initial);
    expect(result.mips).toHaveLength(8);
    for (const mip of [...result.mips, ...result.replacementMips]) {
      expect(mip.bytes).toBeGreaterThan(0);
      expect(mip.nonzero).toBe(true);
      expect(mip.equal).toBe(true);
    }
    expect(result.glError).toBe(0);
    expect(result.replacementGlError).toBe(0);
  });
}
