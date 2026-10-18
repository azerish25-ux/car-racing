/** Repeatable, identically lit isolated production-building comparisons.
 * R3_STAGE=before resolves only buildings.ts from R3_BASELINE_REF (default HEAD).
 * This does not make a before-capture out of a differently lit after-image. */
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const out = process.env.R3_OUT ?? 'test-results/solvane-r3';
const stage = process.env.R3_STAGE ?? 'after';
if (!['before', 'after'].includes(stage)) throw Error('Unknown R3_STAGE');
const baseline = process.env.R3_BASELINE_REF ?? 'HEAD';
const file = 'src/rendering/open-world/buildings.ts';
const source =
  stage === 'before'
    ? execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' })
    : await readFile(file, 'utf8');
await mkdir(out, { recursive: true });
const bundle = await build({
  entryPoints: ['e2e/fixtures/solvane-facade-review.ts'],
  bundle: true,
  format: 'iife',
  write: false,
  platform: 'browser',
  plugins: [
    {
      name: 'exact-before-building',
      setup(b) {
        b.onLoad({ filter: /\/open-world\/buildings\.ts$/ }, (args) => ({
          contents: source,
          loader: 'ts',
          resolveDir: dirname(resolve(args.path)),
        }));
      },
    },
  ],
});
const browser = await chromium.launch({
  headless: false,
  executablePath: process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium',
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=gl',
    '--ignore-gpu-blocklist',
    '--gpu-watchdog-timeout-seconds=120',
  ],
});
const errors = [],
  views = [];
try {
  for (const finish of ['plaster', 'brick', 'stone']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.error(e.message);
    });
    page.on('console', (m) => {
      if (m.type() === 'error') {
        errors.push(m.text());
        console.error(m.text());
      }
    });
    await page.setContent(
      '<!doctype html><html><head><style>html,body{margin:0}canvas{display:block}</style></head><body><canvas id=world></canvas></body></html>',
    );
    await page.evaluate((value) => {
      window.facadeFinish = value;
    }, finish);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => window.facadeReview?.ready, {}, { timeout: 60000 });
    const adapter = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
    });
    if (!/llvmpipe/i.test(adapter ?? '') || /swiftshader/i.test(adapter ?? ''))
      throw Error(`Unexpected renderer ${adapter}`);
    const shots =
      finish === 'plaster'
        ? [
            ['day', false, false],
            ['recess', false, true],
            ['night', true, false],
          ]
        : [
            [`${finish}-day`, false, false],
            [`${finish}-recess`, false, true],
          ];
    for (const [name, night, close] of shots) {
      const state = await page.evaluate(([n, c]) => window.facadeReview.draw(n, c), [night, close]);
      const png = await page.evaluate(() => window.facadeReview.image());
      await writeFile(`${out}/${stage}-${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
      views.push({ name, state, adapter });
    }
    await page.close();
  }
  if (errors.length) throw Error(JSON.stringify(errors));
} catch (error) {
  errors.push(String(error));
  throw error;
} finally {
  await writeFile(
    `${out}/${stage}-facade.json`,
    JSON.stringify(
      {
        errors,
        views,
        stage,
        baselineRef: stage === 'before' ? baseline : null,
        buildingSourceSha256: createHash('sha256').update(source).digest('hex'),
        componentOnly: true,
        softwareGPU: true,
        sceneLighting:
          'Isolated RoomEnvironment, fixed directional/hemisphere lighting and exposure shared by before and after; not the Festival world lighting.',
        passed: views.length === 7 && !errors.length,
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
}
