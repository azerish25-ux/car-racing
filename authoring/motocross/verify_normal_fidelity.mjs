/** Verify the actual shipped soil normals with the shipped Basis transcoder.
 * Run from the repository root on a graphics-capable host:
 *   node --experimental-transform-types authoring/motocross/verify_normal_fidelity.mjs
 * On headless Linux, wrap that command with xvfb-run -a.
 * This is an offline texture component check, NOT a whole-game or FPS test.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { read as readKTX2 } from 'three/addons/libs/ktx-parse.module.js';
import { browserBackend } from '../../scripts/browser-backend.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(
  process.env.MX_NORMAL_PROOF_OUTPUT || join(tmpdir(), 'motobound-normal-proof'),
);
const scratch = mkdtempSync(join(tmpdir(), 'motobound-basis-proof-'));
const require = createRequire(import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assets = ['ground-forest-floor', 'ground-dry-earth', 'ground-wet-earth'];
let browser;
mkdirSync(output, { recursive: true });
try {
  // Load the unchanged UMD distribution as CommonJS without modifying the repository.
  const codecPath = join(scratch, 'basis.cjs');
  writeFileSync(codecPath, readFileSync(join(root, 'public/assets/basis/basis_transcoder.js')));
  const BASIS = require(codecPath);
  const module = await BASIS({
    wasmBinary: readFileSync(join(root, 'public/assets/basis/basis_transcoder.wasm')),
  });
  module.initializeBasis();
  const buildResult = await build({
    root,
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: join(root, 'e2e/fixtures/motocross-normal-residency.ts'),
        name: 'NormalResidencyProof',
        formats: ['iife'],
      },
    },
  });
  const built = Array.isArray(buildResult) ? buildResult[0] : buildResult;
  const chunk = built.output.find((file) => file.type === 'chunk');
  assert.ok(chunk, 'Missing codec component script');
  const backend = browserBackend(process.env.APEX_BROWSER_BACKEND || 'mesa');
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
    headless: backend.headless,
    args: backend.args,
  });
  const reports = [];
  for (const id of assets) {
    const asset = `public/assets/third-party/ground/${id}/${id}_normal.ktx2`;
    const bytes = readFileSync(join(root, asset));
    const dfd = readKTX2(bytes).dataFormatDescriptor[0];
    // These BT709 + linear DFD values are mapped to LinearSRGBColorSpace by
    // the locked KTX2Loader; an unmarked synthetic texture would miss this case.
    assert.equal(dfd.colorPrimaries, 1);
    assert.equal(dfd.transferFunction, 1);
    const file = new module.KTX2File(bytes);
    const mips = [];
    try {
      assert.ok(file.isValid() && file.isUASTC(), 'Expected shipped UASTC texture');
      assert.equal(file.getFaces(), 1);
      assert.ok(file.getLayers() <= 1);
      assert.ok(file.startTranscoding());
      for (let level = 0; level < file.getLevels(); level++) {
        // BC7_M5 (7) is the exact BPTC target selected by the locked KTX2Loader.
        const data = new Uint8Array(file.getImageTranscodedSizeInBytes(level, 0, 0, 7));
        const info = file.getImageLevelInfo(level, 0, 0);
        assert.ok(file.transcodeImage(data, level, 0, 0, 7, 0, -1, -1));
        mips.push({
          width: info.origWidth,
          height: info.origHeight,
          base64: Buffer.from(data).toString('base64'),
        });
      }
    } finally {
      file.close();
      file.delete();
    }
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    try {
      await page.setContent('<!doctype html><title>Shipped normal fidelity component</title>');
      await page.addScriptTag({ content: chunk.code });
      const result = await page.evaluate(
        (input) => window.NormalResidencyProof.inspectNormalResidency(true, input),
        { mips },
      );
      const report = {
        asset,
        sourceSHA256: hash(bytes),
        colorPrimaries: dfd.colorPrimaries,
        transferFunction: dfd.transferFunction,
        offlineCodecOnly: true,
        fullApplicationTest: false,
        errors,
        ...result,
      };
      // Preserve diagnostics before assertions, including on a failing device.
      writeFileSync(join(output, `${id}.json`), JSON.stringify(report, null, 2) + '\n');
      assert.equal(result.supported, true, 'A BPTC-capable test GPU is required; no silent skip');
      assert.deepEqual(errors, []);
      assert.equal(result.isDataTexture, true);
      assert.equal(result.sourceColorSpace, 'srgb-linear');
      assert.equal(result.expandedColorSpace, result.sourceColorSpace);
      assert.equal(result.sourceUnchanged, true);
      assert.equal(result.filteringPreserved, true);
      assert.equal(result.generateMipmaps, false);
      assert.deepEqual(result.initial, result.whilePending);
      assert.deepEqual(result.initial, result.afterPreparation);
      assert.equal(result.mips.length, 11);
      assert.equal(result.replacementMips.length, 11);
      for (const mip of [...result.mips, ...result.replacementMips]) {
        assert.equal(mip.equal, true);
        assert.equal(mip.nonzero, true);
      }
      assert.equal(result.glError, 0);
      assert.equal(result.replacementGlError, 0);
      reports.push(report);
      console.log(`PASS ${id}: every authored mip survives residency and renderer replacement`);
    } finally {
      await page.close();
    }
  }
  writeFileSync(
    join(output, 'summary.json'),
    JSON.stringify({ passed: true, reports }, null, 2) + '\n',
  );
} finally {
  await browser?.close();
  rmSync(scratch, { recursive: true, force: true });
}
