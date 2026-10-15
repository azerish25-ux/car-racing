/**
 * Deterministic ULTRA rendering capture.
 *
 *   node --experimental-transform-types scripts/ultra-capture.ts [--out dir] [--size 960x540]
 *
 * Bundles e2e/fixtures/ultra-pipeline.ts, renders the same fixed set through
 * the High and ULTRA presets (dry and in rain, live and replay) on the
 * selected software or hardware browser backend, and writes PNG captures plus
 * a JSON report (per-pass draws, fetch estimates, GPU timestamps where the
 * browser exposes them, cascade texel sizes). It fails on any console error
 * (shader compile/link errors included), GL error, non-identical held frame or
 * an inactive module that ULTRA requested and the device supports.
 * Set CHROMIUM_PATH to a Chromium binary; APEX_BROWSER_BACKEND as for Playwright.
 * Software rendering is functional evidence, not a GPU performance claim.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { browserBackend } from './browser-backend.ts';
import type * as Fixture from '../e2e/fixtures/ultra-pipeline.ts';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const out = resolve(option('out', 'test-results/ultra-capture'));
const [width, height] = option('size', '960x540').split('x').map(Number);
if (!(width > 0 && height > 0)) throw new Error('Invalid --size');

export async function bundleUltraFixture() {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/ultra-pipeline.ts'),
        name: 'UltraFixture',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing ULTRA fixture output');
  const chunk = result.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing ULTRA fixture chunk');
  return chunk.code;
}

const cases: { name: string; options: Fixture.UltraCaptureOptions }[] = [
  {
    name: 'high-dry',
    options: { preset: 'high', width, height, frames: 24, rain: 0, replay: false },
  },
  {
    name: 'ultra-dry',
    options: { preset: 'ultra', width, height, frames: 24, rain: 0, replay: false },
  },
  {
    name: 'ultra-rain',
    options: { preset: 'ultra', width, height, frames: 24, rain: 12, replay: false },
  },
  {
    name: 'ultra-replay',
    options: { preset: 'ultra', width, height, frames: 16, rain: 0, replay: true },
  },
];

async function main() {
  const code = await bundleUltraFixture();
  const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);
  const browser = await chromium.launch({
    headless: backend.headless,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: backend.args,
  });
  await mkdir(out, { recursive: true });
  const report: Record<string, unknown> = {};
  const failures: string[] = [];
  try {
    for (const c of cases) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.setContent(
        '<!doctype html><title>ULTRA capture</title><body style="margin:0"></body>',
      );
      await page.addScriptTag({ content: code });
      const result = await page.evaluate(
        (options) =>
          (window as unknown as { UltraFixture: typeof Fixture }).UltraFixture.capture(options),
        c.options,
      );
      await page.close();
      const { image, ...data } = result;
      await writeFile(join(out, `${c.name}.png`), Buffer.from(image.split(',')[1], 'base64'));
      report[c.name] = { ...data, consoleErrors: errors };
      if (errors.length)
        failures.push(`${c.name}: console errors: ${errors.slice(0, 3).join(' | ')}`);
      if (data.glErrors.length) failures.push(`${c.name}: GL errors ${data.glErrors.join(',')}`);
      if (!data.heldFramesIdentical) failures.push(`${c.name}: held frames differ`);
      if (!(data.meanLuminance > 0.02 && data.meanLuminance < 0.98))
        failures.push(`${c.name}: implausible mean luminance ${data.meanLuminance}`);
      const d = data.diagnostics;
      if (c.options.preset === 'ultra') {
        if (d.capabilities.floatColorBuffer && !d.ssr.frames)
          failures.push(`${c.name}: SSR never ran`);
        if (!d.aoTemporal.frames) failures.push(`${c.name}: temporal AO never ran`);
        if (!d.taaSharpen.frames) failures.push(`${c.name}: sharpening never ran`);
        if (!d.shadowCascades.mid.updates) failures.push(`${c.name}: mid cascade never rendered`);
        if (c.options.replay && !d.replayDof.frames)
          failures.push(`${c.name}: replay lens never ran`);
      } else if (
        d.ssr.frames ||
        d.aoTemporal.frames ||
        d.taaSharpen.frames ||
        d.shadowCascades.mid.updates
      )
        failures.push(`${c.name}: an ULTRA module ran on a non-ULTRA preset`);
      console.log(
        `${c.name}: ${data.renderer} · draws ${data.drawCalls} · programs ${data.programs} · ` +
          `luminance ${data.meanLuminance.toFixed(3)} · cascades ${d.shadowCascades.count} · ` +
          `held identical ${data.heldFramesIdentical}`,
      );
    }
  } finally {
    await browser.close();
  }
  if (args.includes('--textures')) {
    const browser2 = await chromium.launch({
      headless: backend.headless,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: backend.args,
    });
    try {
      const page = await browser2.newPage();
      await page.setContent('<!doctype html><title>ULTRA textures</title>');
      await page.addScriptTag({ content: code });
      const { sheets, diagnostics } = await page.evaluate(() =>
        (window as unknown as { UltraFixture: typeof Fixture }).UltraFixture.proceduralSheets(),
      );
      await mkdir(join(out, 'textures'), { recursive: true });
      for (const [name, url] of Object.entries(sheets))
        await writeFile(
          join(out, 'textures', `${name}.png`),
          Buffer.from(url.split(',')[1], 'base64'),
        );
      report.textures = diagnostics;
    } finally {
      await browser2.close();
    }
  }
  await writeFile(join(out, 'ultra-capture.json'), JSON.stringify(report, null, 2));
  console.log(`Wrote ${out}`);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
}
await main();
