import { build } from 'vite';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const out = resolve(process.argv[2] || '../evidence/venue-before');
mkdirSync(out, { recursive: true });
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
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  for (const fixture of ['motogp-environment-review', 'people-lab']) {
    const bundle = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: { entry: resolve(`e2e/fixtures/${fixture}.ts`), name: 'Review', formats: ['iife'] },
      },
    });
    const output = Array.isArray(bundle) ? bundle[0] : bundle;
    const chunk = output.output.find((v) => v.type === 'chunk');
    await page.setContent('<!doctype html><title>Actual production component inspection</title>');
    await page.addScriptTag({ content: chunk.code });
    if (fixture === 'motogp-environment-review') {
      const assets = {};
      for (const layer of ['asphalt', 'concrete', 'lawn', 'meadow'])
        for (const role of ['color', 'normal', 'orm']) {
          const path = `assets/third-party/ground/ground-${layer}/ground-${layer}_${role}.webp`;
          assets[path] =
            `data:image/webp;base64,${readFileSync(resolve('public', path)).toString('base64')}`;
        }
      const r = await page.evaluate((a) => window.Review.captureCircuitSurfaces(a), assets);
      for (const c of r.captures) {
        writeFileSync(resolve(out, `${c.name}.png`), Buffer.from(c.image.split(',')[1], 'base64'));
        delete c.image;
      }
      writeFileSync(resolve(out, 'surfaces.json'), JSON.stringify(r, null, 2));
      console.log(
        'surfaces',
        r.glError,
        r.captures.map((c) => [c.name, c.calls, c.hash]),
      );
    } else {
      const r = await page.evaluate(() =>
        window.Review.crowdLab(
          [
            { name: 'crowd-wide', eye: [-5, 3.7, 6], target: [2.9, 1.4, 0], fov: 43 },
            { name: 'crowd-close', eye: [-1.1, 1.6, 1.8], target: [1.8, 1.12, 0], fov: 43 },
          ],
          { time: 3, reaction: 0.25 },
        ),
      );
      for (const [name, image] of Object.entries(r.images))
        writeFileSync(resolve(out, `${name}.png`), Buffer.from(image.split(',')[1], 'base64'));
      writeFileSync(resolve(out, 'crowd.json'), JSON.stringify(r.info, null, 2));
      console.log('crowd', r.info);
    }
  }
  writeFileSync(resolve(out, 'errors.json'), JSON.stringify(errors));
  if (errors.length) throw Error(JSON.stringify(errors));
} finally {
  await browser.close();
}
