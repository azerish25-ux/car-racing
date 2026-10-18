/** Offline execution of the actual FestivalSession, its actual two workers and
 * installed assets. Only the asset transport is supplied from disk, because this
 * review environment does not permit navigation. This is NOT an HTTP/CDN test.
 * No game mesh, material, renderer option, input handling or simulation is mocked. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const out = process.env.R3_OUT ?? 'test-results/solvane-r3';
const mode = process.env.R3_SESSION_QUALITY ?? 'low';
const vehicle = process.env.R3_SESSION_VEHICLE ?? 'eh3';
const baseline = process.env.R3_BASELINE_REF;
const stage = baseline ? 'before' : 'after';
const prefix = `session-${mode}-${stage}`;
const sourcePaths = [
  'src/rendering/open-world/buildings.ts',
  'src/rendering/open-world/festival-renderer.ts',
  'src/session/free-roam.ts',
  'src/ui/festival-hud.ts',
  'src/ui/festival-hud.css',
];
const baselineSources = new Map(
  baseline
    ? sourcePaths.map((path) => [
        resolve(path),
        execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' }),
      ])
    : [],
);
const journey = [];
const publicRoot = resolve('public');
const origin = 'https://solvane-offline.invalid/';
const served = new Map(),
  missing = [],
  errors = [],
  warnings = [],
  views = [];
await mkdir(out, { recursive: true });
const fixture = 'e2e/fixtures/horizon-session.ts';
const query = `quality=${mode}&capture=1&frames=1&vehicle=${vehicle}&discovered=all&lighting=day`;
await build({
  entryPoints: [fixture],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: `${out}/${prefix}-bundle.js`,
  loader: { '.frag': 'text', '.vert': 'text' },
  define: { 'import.meta.env': JSON.stringify({ BASE_URL: origin }) },
  plugins: [
    {
      name: 'offline-vite-inline-workers',
      setup(b) {
        b.onLoad(
          {
            filter: /\/(buildings|festival-renderer|free-roam|festival-hud)\.(ts|css)$/,
            namespace: 'file',
          },
          (args) => {
            const contents = baselineSources.get(args.path);
            return contents === undefined
              ? undefined
              : {
                  contents,
                  loader: extname(args.path) === '.css' ? 'css' : 'ts',
                  resolveDir: dirname(args.path),
                };
          },
        );
        b.onResolve({ filter: /\.worker\.ts\?worker&inline$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.split('?')[0]),
          namespace: 'offline-worker',
        }));
        b.onLoad({ filter: /.*/, namespace: 'offline-worker' }, async (args) => {
          const worker = await build({
            entryPoints: [args.path],
            bundle: true,
            format: 'iife',
            platform: 'browser',
            write: false,
          });
          return {
            contents: `const code=${JSON.stringify(worker.outputFiles[0].text)}; export default class extends Worker { constructor(){const url=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));super(url);setTimeout(()=>URL.revokeObjectURL(url),5000);} }`,
            loader: 'js',
          };
        });
        b.onLoad({ filter: /\/e2e\/fixtures\/horizon-session\.ts$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8'))
            .replace(
              "import '@fontsource-variable/saira';",
              '// Offline capture uses system fallback; no font file is embedded.',
            )
            .replace(
              'new URLSearchParams(location.search)',
              `new URLSearchParams(${JSON.stringify(query)})`,
            ),
          loader: 'ts',
          resolveDir: dirname(args.path),
        }));
      },
    },
  ],
});
const browser = await chromium.launch({
  headless: false,
  executablePath: process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium',
  // Same bounded cold-compilation watchdog as scripts/browser-backend.ts.
  // Keep medium materials and geometry intact; never disable the watchdog.
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=gl',
    '--ignore-gpu-blocklist',
    '--gpu-watchdog-timeout-seconds=120',
  ],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.error('PAGEERROR', e.message);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    errors.push(m.text());
    console.error('CONSOLEERROR', m.text());
  }
  if (m.type() === 'warning') {
    warnings.push(m.text());
    console.warn('WARN', m.text());
  }
});
const base64 = (bytes) => Buffer.from(bytes).toString('base64');
await page.exposeFunction('__solvaneAsset', async (path) => {
  const full = resolve(publicRoot, path);
  if (!full.startsWith(publicRoot + '/') || /\.(woff2?|ttf|otf)$/i.test(path))
    throw Error(`Disallowed offline asset ${path}`);
  try {
    const bytes = await readFile(full);
    served.set(path, {
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    console.log('ASSET', path, bytes.length);
    return {
      base64: base64(bytes),
      type:
        {
          '.json': 'application/json',
          '.bin': 'application/octet-stream',
          '.glb': 'model/gltf-binary',
          '.js': 'application/javascript',
          '.wasm': 'application/wasm',
          '.ktx2': 'image/ktx2',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.jpg': 'image/jpeg',
        }[extname(path)] ?? 'application/octet-stream',
    };
  } catch (e) {
    missing.push({ path, error: String(e) });
    throw e;
  }
});
await page.exposeFunction('__solvaneDigest', (text) =>
  base64(createHash('sha256').update(Buffer.from(text, 'base64')).digest()),
);
let scope;
try {
  await page.setContent(
    '<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;background:#10191e;overflow:hidden}#app{width:100vw;height:100vh;position:relative}canvas#world{width:100%;height:100%;display:block}#loading{position:absolute;left:20px;top:20px;color:white;z-index:50}</style></head><body><main id=app><canvas id=world></canvas><div id=loading>Starting offline review</div></main></body></html>',
  );
  scope = await page.evaluate(
    ({ origin }) => {
      const originalFetch = globalThis.fetch.bind(globalThis);
      const bytes = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const encode = (data) => {
        const a = new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength);
        let s = '';
        for (let i = 0; i < a.length; i += 32768)
          s += String.fromCharCode(...a.subarray(i, i + 32768));
        return btoa(s);
      };
      globalThis.fetch = async (input, options) => {
        const inputUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (/^(blob:|data:)/.test(inputUrl)) return originalFetch(input, options);
        const url = new URL(inputUrl, origin);
        if (url.origin !== new URL(origin).origin)
          throw Error(`Unserved external request ${url.href}`);
        const signal = options?.signal ?? (input instanceof Request ? input.signal : undefined);
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const asset = await window.__solvaneAsset(
          decodeURIComponent(url.pathname.replace(/^\//, '')),
        );
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const body = bytes(asset.base64);
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': asset.type, 'Content-Length': String(body.length) },
        });
      };
      const nativeSubtle = !!crypto.subtle;
      if (!nativeSubtle)
        Object.defineProperty(crypto, 'subtle', {
          value: {
            digest: async (algorithm, data) => {
              if (
                (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase() !==
                'SHA-256'
              )
                throw Error('Unsupported digest in offline review');
              return bytes(await window.__solvaneDigest(encode(data))).buffer;
            },
          },
        });
      return {
        nativeSubtle,
        digestImplementation: nativeSubtle
          ? 'browser WebCrypto'
          : 'Node crypto SHA-256 through fixture bridge',
        secureContext: isSecureContext,
        assetTransport: 'exact disk bytes through fixture bridge, no network',
      };
    },
    { origin },
  );
  await page.addStyleTag({ content: await readFile(`${out}/${prefix}-bundle.css`, 'utf8') });
  await page.addScriptTag({ content: await readFile(`${out}/${prefix}-bundle.js`, 'utf8') });
  await page.waitForFunction(() => window.horizonReview?.state().ready, {}, { timeout: 300000 });
  console.log('SESSION READY');
  const adapter = await page.evaluate(() => {
    const gl = document.querySelector('#world').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
      contextLost: gl?.isContextLost(),
      attributes: gl?.getContextAttributes(),
    };
  });
  scope.adapter = adapter;
  scope.gpuWatchdogSeconds = 120;
  assert.match(adapter.renderer ?? '', /llvmpipe/i);
  assert.doesNotMatch(adapter.renderer ?? '', /swiftshader/i);
  console.log('ADAPTER', JSON.stringify(adapter));
  await page.waitForFunction(
    () => window.horizonReview.state().draws >= 1,
    {},
    { timeout: 300000 },
  );
  await page.evaluate(() => window.horizonReview.rendering(false));
  const state = await page.evaluate(() => window.horizonReview.state());
  const png = await page.evaluate(() => window.horizonReview.image());
  await writeFile(`${out}/${prefix}-harbour.png`, Buffer.from(png.split(',')[1], 'base64'));
  views.push({ name: 'harbour', state });
  console.log(
    'CAPTURED',
    JSON.stringify({ draws: state.draws, render: state.render, street: state.street }),
  );
  assert.ok(
    state.street?.loaded && state.details?.loaded,
    'Both committed Blender kits actually loaded',
  );
  assert.deepEqual(missing, []);
  assert.deepEqual(errors, []);
  if (process.env.R3_INPUT_JOURNEY === '1') {
    const start = await page.evaluate(() => window.horizonReview.state());
    await page.keyboard.down('ArrowUp');
    await new Promise((resolve) => setTimeout(resolve, 3500));
    await page.keyboard.up('ArrowUp');
    await page.waitForFunction(
      (p) => {
        const s = window.horizonReview.state();
        return Math.hypot(s.player.x - p.x, s.player.z - p.z) > 3;
      },
      start.player,
      { timeout: 15000 },
    );
    const driven = await page.evaluate(() => window.horizonReview.state());
    journey.push({
      name: 'real-keyboard-throttle',
      passed: true,
      start: start.player,
      end: driven.player,
      metres: Math.hypot(driven.player.x - start.player.x, driven.player.z - start.player.z),
      mode: driven.status.mode,
      assisted: driven.status.autopilot,
    });
    assert.equal(driven.status.autopilot, false);
    await page.keyboard.press('KeyC');
    await page.waitForFunction(
      (before) => window.horizonReview.state().camera !== before,
      start.camera,
      { timeout: 15000 },
    );
    journey.push({
      name: 'real-keyboard-camera',
      passed: true,
      camera: (await page.evaluate(() => window.horizonReview.state())).camera,
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.horizonReview.state().paused, {}, { timeout: 15000 });
    const paused = await page.evaluate(() => window.horizonReview.state());
    await new Promise((resolve) => setTimeout(resolve, 350));
    const held = await page.evaluate(() => window.horizonReview.state());
    assert.ok(
      Math.hypot(held.player.x - paused.player.x, held.player.z - paused.player.z) < 0.05,
      'Pause holds the actual worker snapshot',
    );
    await page.evaluate(() => window.horizonReview.draw());
    await page.screenshot({ path: `${out}/${prefix}-pause-menu.png`, timeout: 60000 });
    journey.push({ name: 'pause-freezes-worker', passed: true, at: held.player });
    await page.locator('button[data-fest="map"]').click();
    await page.waitForFunction(
      () => !document.getElementById('festMap').hidden,
      {},
      { timeout: 15000 },
    );
    await page.screenshot({ path: `${out}/${prefix}-world-map.png`, timeout: 60000 });
    journey.push({ name: 'real-menu-opens-map', passed: true });
    await page.locator('button[data-fest="mapClose"]').click();
    await page.locator('button[data-fest="photo"]').click();
    await page.waitForFunction(() => window.horizonReview.state().photo, {}, { timeout: 15000 });
    await page.evaluate(() => window.horizonReview.draw());
    await page.screenshot({ path: `${out}/${prefix}-photo-mode.png`, timeout: 60000 });
    journey.push({ name: 'real-menu-photo-mode', passed: true });
    await page.locator('button[data-fest="photoClose"]').click();
    await page.waitForFunction(() => !window.horizonReview.state().photo, {}, { timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => !document.getElementById('festMenu').hidden,
      {},
      { timeout: 15000 },
    );
    await page.locator('button[data-fest="exit"]').click();
    await page.waitForFunction(() => window.horizonReview.state().exited, {}, { timeout: 15000 });
    assert.equal(await page.locator('#festivalHud').count(), 0);
    journey.push({ name: 'real-menu-exit-disposes-hud', passed: true });
    assert.deepEqual(errors, []);
  }
} catch (error) {
  errors.push(String(error));
  console.error(error);
  await page.screenshot({ path: `${out}/${prefix}-failure.png`, timeout: 60000 }).catch(() => {});
  throw error;
} finally {
  await writeFile(
    `${out}/${prefix}-review.json`,
    JSON.stringify(
      {
        scope,
        quality: mode,
        vehicle,
        stage,
        baselineRef: baseline ?? null,
        sourceHashes: Object.fromEntries(
          await Promise.all(
            sourcePaths.map(async (path) => [
              path,
              createHash('sha256')
                .update(baselineSources.get(resolve(path)) ?? (await readFile(path)))
                .digest('hex'),
            ]),
          ),
        ),
        journey,
        inputRenderingPolicy:
          'Normal input polling and worker simulation; GPU frames submitted only for captures, not a frame-rate benchmark.',
        actualSession: true,
        actualWorkers: true,
        softwareGPU: true,
        httpNavigationTest: false,
        productionReleaseApproval: false,
        views,
        served: Object.fromEntries(served),
        missing,
        errors,
        warnings,
        passed: views.length > 0 && !errors.length && !missing.length,
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
}
