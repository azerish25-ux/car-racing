import { build } from 'vite';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const out = resolve(process.argv[2] || '../evidence/before');
mkdirSync(out, { recursive: true });
const bundle = await build({
  configFile: false,
  logLevel: 'error',
  build: {
    write: false,
    lib: {
      entry: resolve('e2e/fixtures/motogp-reference-review.ts'),
      name: 'MotoGPReview',
      formats: ['iife'],
    },
  },
});
const output = Array.isArray(bundle) ? bundle[0] : bundle;
const chunk = output.output.find((v) => v.type === 'chunk');
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: false,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=gl',
    '--ignore-gpu-blocklist',
    '--gpu-watchdog-timeout-seconds=120',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.setContent('<!DOCTYPE html><title>Actual production model isolated inspection</title>');
await page.addScriptTag({ content: chunk.code });
const results = [];
for (const [id, view] of [
  ['gpr1', 'three-quarter'],
  ['gpr1', 'side'],
  ['gpr1', 'front'],
  ['gpr1', 'rear'],
  ['gpr1', 'corner'],
  ['gpr1', 'onboard'],
  ['gpr2', 'three-quarter'],
]) {
  const r = await page.evaluate(
    ([id, view]) => window.MotoGPReview.captureBike(view, 'high', id, false),
    [id, view],
  );
  writeFileSync(resolve(out, `${id}-${view}.png`), Buffer.from(r.image.split(',')[1], 'base64'));
  delete r.image;
  results.push({ id, view, ...r });
  console.log(id, view, r.triangles, r.calls, r.glError);
}
writeFileSync(resolve(out, 'metrics.json'), JSON.stringify({ results, errors }, null, 2));
await browser.close();
if (errors.length) throw Error(JSON.stringify(errors));
