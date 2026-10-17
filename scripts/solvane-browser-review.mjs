/** Actual Festival renderer evidence. Fixed-camera inspections are identified
 * separately from the unchanged real-input journey. No model/physics overrides. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { browserBackend, requireBrowserBackend } from "./browser-backend.ts";
const base = process.env.HORIZON_REVIEW_URL ?? "http://127.0.0.1:5173";
const output = resolve(
  process.env.HORIZON_REVIEW_OUTPUT ?? "test-results/solvane-review",
);
const candidate = process.env.SOLVANE_CANDIDATE === "1";
const selectedView = process.env.SOLVANE_REVIEW_VIEW;
const viewIds = [
  "day-drive",
  "day-shopfront",
  "night-rain-street",
  "coastal-launch",
  "low-drive",
];
if (selectedView && !viewIds.includes(selectedView))
  throw new Error("Unknown SOLVANE_REVIEW_VIEW: " + selectedView);
const sourceIdentityPath = process.env.HORIZON_REVIEW_IDENTITY;
const reviewSourceIdentity = sourceIdentityPath
  ? JSON.parse(await readFile(sourceIdentityPath, "utf8"))
  : null;
const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.HORIZON_REVIEW_EXECUTABLE || undefined,
  headless: backend.headless,
  args: ["--no-sandbox", ...backend.args],
});
const report = {
  candidate,
  requestedView: selectedView ?? "all",
  backend: backend.name,
  viewport: [1280, 720],
  // The applied candidate is a working tree, not the workflow's triggering commit.
  baseCommit: process.env.GITHUB_SHA ?? null,
  sourceIdentity: reviewSourceIdentity,
  browserVersion: browser.version(),
  notHardwarePerformance: true,
  inspections: [],
  errors: [],
  failedAssets: [],
};
try {
  for (const test of [
    { id: "day-drive", lighting: "day", weather: "clear", quality: "medium" },
    {
      id: "day-shopfront",
      lighting: "day",
      weather: "clear",
      quality: "medium",
      position: [574, 6.9, -2600],
      target: [574, 5.5, -2608.4],
    },
    {
      id: "night-rain-street",
      lighting: "night",
      weather: "rain",
      quality: "medium",
      position: [552, 7.0, -2602],
      target: [583, 5.0, -2602],
    },
    {
      id: "coastal-launch",
      lighting: "sunset",
      weather: "clear",
      quality: "medium",
      position: [749, 5.8, -2787],
      target: [739, 1.5, -2800],
    },
    { id: "low-drive", lighting: "day", weather: "clear", quality: "low" },
  ].filter((test) => !selectedView || test.id === selectedView)) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    page.setDefaultTimeout(240000);
    page.on("pageerror", (error) =>
      report.errors.push({ id: test.id, message: error.message }),
    );
    page.on("console", (message) => {
      if (message.type() === "error")
        report.errors.push({ id: test.id, message: message.text() });
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        report.failedAssets.push({
          id: test.id,
          status: response.status(),
          url: response.url(),
        });
    });
    await page.goto(
      `${base}/e2e/fixtures/horizon-session.html?quality=${test.quality}&vehicle=eh3&lighting=${test.lighting}&weather=${test.weather}&capture=1&frames=1`,
      { waitUntil: "domcontentloaded" },
    );
    await page.locator("#loading").waitFor({ state: "hidden" });
    await page.waitForFunction(() => window.horizonReview?.state().draws >= 1);
    const renderer = await page.evaluate(() => {
      const gl = document.querySelector("#world").getContext("webgl2"),
        e = gl.getExtension("WEBGL_debug_renderer_info");
      return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    });
    requireBrowserBackend(backend.name, renderer);
    if (candidate) {
      const data = await page.evaluate(() => window.horizonReview.state());
      assert.equal(
        data.details?.loaded,
        true,
        "authored kit must actually load",
      );
      assert.equal(data.details.boats, 3);
      assert(data.details.frontage > 400);
      assert.equal(data.aero, true, "the EH-3 must use its authored wing");
    }
    if (test.position) {
      await page.evaluate(
        ({ position, target }) =>
          window.horizonReview.inspect(position, target),
        test,
      );
      // Hide UI solely in labelled fixed-camera inspections; drive captures keep
      // the normal HUD. This cannot change the canvas image or renderer options.
      await page.addStyleTag({
        content:
          "#app > :not(canvas):not(#loading) { visibility: hidden !important; }",
      });
    }
    const count = test.lighting === "night" ? 9 : 2;
    for (let frame = 0; frame < count; frame++) {
      await page.waitForTimeout(85);
      await page.evaluate(() => window.horizonReview.draw());
      await page.evaluate(() => window.horizonReview.image());
    }
    const state = await page.evaluate(() => window.horizonReview.state());
    if (candidate && test.lighting === "night")
      assert(
        state.lampSockets.length > 0,
        "town fixtures must illuminate at night",
      );
    await page.screenshot({
      path: resolve(output, `${test.id}.png`),
      timeout: 120000,
    });
    report.inspections.push({
      ...test,
      kind: test.position
        ? "paused fixed-camera scene inspection"
        : "unmodified gameplay chase and HUD",
      renderer,
      state,
    });
    console.log(
      "PASS",
      test.id,
      JSON.stringify({
        renderer,
        details: state.details,
        streetLightSockets: state.lampSockets,
        drawCalls: state.render?.drawCalls,
        triangles: state.render?.triangles,
      }),
    );
    await writeFile(
      resolve(output, "visual-review.json"),
      JSON.stringify(report, null, 2),
    );
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedAssets, []);
} catch (error) {
  report.failure = String(error.stack ?? error);
  throw error;
} finally {
  await writeFile(
    resolve(output, "visual-review.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
