// Matched gameplay baseline: drive the production build through the ordinary
// menu with the AI demonstration, rotate the real cameras and store moving
// frames plus frame-time/draw-call observations for dry, wet and night races.
//
// Usage: npm run build && xvfb-run -a -s '-screen 0 1920x1080x24' \
//   node --experimental-transform-types scripts/gameplay-baseline.ts [outDir] [quality]
//
// Software GL (Mesa llvmpipe or SwiftShader) is a functional renderer only. The
// frame-time figures it records describe that host and are labelled as such;
// they are never evidence of consumer-GPU performance.
import { chromium, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'test-results/gameplay-baseline';
const quality = (process.argv[3] ?? 'high') as 'low' | 'medium' | 'high';
const PORT = Number(process.env.BASELINE_PORT ?? 4179);
const cases = (process.env.BASELINE_CASES ?? 'dry,wet,night').split(',');

interface Case {
  name: string;
  weather: 'clear' | 'rain' | 'changeable';
  lighting: 'day' | 'sunset' | 'night';
}
const CASES: Case[] = [
  { name: 'dry', weather: 'clear', lighting: 'day' },
  { name: 'wet', weather: 'rain', lighting: 'day' },
  { name: 'night', weather: 'clear', lighting: 'night' },
  { name: 'wetnight', weather: 'rain', lighting: 'night' },
];

async function waitFor(check: () => Promise<boolean>, ms: number, what: string) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const diag = (page: Page) => page.evaluate(() => window.apexDiagnostics());

async function frameTimes(page: Page, ms: number) {
  return page.evaluate(async (duration) => {
    const samples: number[] = [];
    let last = performance.now();
    const end = last + duration;
    await new Promise<void>((resolve) => {
      const step = (t: number) => {
        samples.push(t - last);
        last = t;
        if (t < end) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return samples.slice(1);
  }, ms);
}

function percentiles(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] ?? NaN;
  return { n: s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s.at(-1) ?? NaN };
}

async function shot(page: Page, file: string) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 88,
      fromSurface: true,
    });
    await writeFile(file, Buffer.from(data, 'base64'));
  } finally {
    await cdp.detach();
  }
}

async function runCase(page: Page, c: Case) {
  const dir = join(outDir, c.name);
  await mkdir(dir, { recursive: true });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 120000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption(quality);
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.selectOption('#circuit', process.env.BASELINE_CIRCUIT ?? 'aurel');
  await page.selectOption('#mode', 'race');
  await page.selectOption('#opponents', '7');
  await page.selectOption('#laps', '3');
  await page.selectOption('#weather', c.weather);
  if (c.weather === 'rain') await page.selectOption('#compound', 'wet');
  await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
  await page
    .getByRole('button', { name: 'AI DRIVER', exact: true })
    .waitFor({ state: 'visible', timeout: 600000 })
    .catch(async (e) => {
      await shot(page, join(dir, 'failure-grid.jpg'));
      throw e;
    });
  await waitFor(async () => (await diag(page)).workerPause.paused === true, 60000, 'grid');
  await page.getByRole('button', { name: 'AI DRIVER', exact: true }).click();
  await waitFor(async () => (await diag(page)).auto === true, 10000, 'auto');
  if (c.lighting !== 'day') {
    // Software GL can stall for tens of seconds while night/sunset lighting
    // rebuilds its environment; wait for the real dialog instead of failing.
    await page.locator('#modal [data-action="academy"]').click({ timeout: 120000 });
    await page
      .locator(`#modal [data-action="lighting:${c.lighting}"]`)
      .click({ timeout: 120000 });
    await page.locator('#modal [data-action="modalClose"]').click({ timeout: 180000 });
  }
  await page.locator('#modal [data-action="resume"]').click();
  await waitFor(async () => (await diag(page)).state === 'driving', 30000, 'driving');
  const report: Record<string, unknown>[] = [];
  const cameras = ['chase', 'cockpit', 'pod', 'trackside'];
  const simTime = async () => ((await diag(page)).frame?.[0] as number | undefined) ?? 0;
  // Grid and launch frames, then rotate cameras while the race runs.
  await shot(page, join(dir, '00-grid-chase.jpg'));
  const rounds = Number(process.env.BASELINE_ROUNDS ?? 2);
  for (let round = 0; round < rounds; round++) {
    for (const cam of cameras) {
      await waitFor(
        async () => (await diag(page)).renderer?.presentedCamera === cam,
        15000,
        `camera ${cam}`,
      ).catch(async () => {
        await page.keyboard.press('c');
        await waitFor(
          async () => (await diag(page)).renderer?.presentedCamera === cam,
          15000,
          `camera ${cam}`,
        );
      });
      const t = await simTime();
      const ft = await frameTimes(page, 4000);
      const d = await diag(page);
      await shot(page, join(dir, `r${round}-${cam}-t${t.toFixed(0)}.jpg`));
      const census =
        process.env.BASELINE_CENSUS === '1'
          ? await page.evaluate(() => window.apexDiagnostics(true).visual?.census ?? null)
          : null;
      report.push({
        camera: cam,
        simTime: t,
        frameMs: percentiles(ft),
        renderer: d.renderer,
        census,
      });
      await page.keyboard.press('c');
    }
  }
  return report;
}

// Spawn vite itself, not npx: killing an npx wrapper left the preview server
// running after the capture.
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', `${PORT}`],
  { stdio: 'ignore' },
);
try {
  await new Promise((r) => setTimeout(r, 2500));
  const backend = process.env.APEX_BROWSER_BACKEND ?? 'mesa';
  const browser = await chromium.launch({
    headless: backend !== 'mesa',
    executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
    args:
      backend === 'mesa'
        ? ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
        : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const gl = await (async () => {
    await page.goto(`http://127.0.0.1:${PORT}/`);
    return page.evaluate(() => {
      const c = document.createElement('canvas').getContext('webgl2');
      const ext = c?.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(c!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
  })();
  const results: Record<string, unknown> = {
    note: 'Software-rendered functional capture. Frame times describe this host only, not consumer GPUs.',
    renderer: gl,
    quality,
    viewport: '1600x900',
  };
  for (const c of CASES.filter((x) => cases.includes(x.name))) {
    results[c.name] = await runCase(page, c);
    await writeFile(join(outDir, `${c.name}.json`), JSON.stringify(results[c.name], null, 2));
    console.log(`captured ${c.name}`);
  }
  results.errors = errors;
  await writeFile(join(outDir, 'baseline.json'), JSON.stringify(results, null, 2));
  await browser.close();
  console.log(JSON.stringify({ errors }, null, 1));
} finally {
  server.kill();
}
