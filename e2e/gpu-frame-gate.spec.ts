import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { GpuFrameGate } from '../src/rendering/gpu-frame-gate.ts';

/** Real WebGL fences with no further draw to kick the driver after submission.
 * This specifically guards held replay/settings, independently of scene assets.
 * No server navigation or software-renderer substitute is needed in this test.
 */
for (const scheduling of ['timer', 'animation-frame'] as const) {
  test(`GPU frame completion stays asynchronous with ${scheduling} polling`, async ({
    page,
  }, info) => {
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('src/rendering/gpu-frame-gate.ts'),
          name: 'FrameGate',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing frame gate build');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing frame gate code');
    await page.setContent(
      '<!doctype html><button id="input">CHECK INPUT</button><canvas width="640" height="400"></canvas>',
    );
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(async (schedule) => {
      const canvas = document.querySelector('canvas')!;
      const gl = canvas.getContext('webgl2');
      if (!gl) throw new Error('WebGL2 unavailable');
      const adapter = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = adapter
        ? String(gl.getParameter(adapter.UNMASKED_RENDERER_WEBGL))
        : 'unknown';
      // Calling the synchronous fallback is a regression, not a permitted shortcut.
      gl.finish = () => {
        throw new Error('Blocking GPU drain is forbidden');
      };
      const Constructor = (
        window as unknown as { FrameGate: { GpuFrameGate: typeof GpuFrameGate } }
      ).FrameGate.GpuFrameGate;
      const gate = new Constructor(gl);
      const yieldTask = () =>
        new Promise<void>((resolve) =>
          schedule === 'timer' ? setTimeout(resolve, 0) : requestAnimationFrame(() => resolve()),
        );
      let callbacks = 0;
      const start = performance.now();
      try {
        for (let frame = 0; frame < 12; frame++) {
          if (!gate.ready()) throw new Error('Previous frame was not complete');
          gl.clearColor(frame / 12, 0.4, 0.6, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gate.submittedFrame();
          // Even with no further rendering, completion must be observed across tasks.
          while (!gate.ready()) {
            if (performance.now() - start > 15000)
              throw new Error('Fence never completed across browser tasks');
            callbacks++;
            await yieldTask();
          }
        }
        return {
          renderer,
          scheduling: schedule,
          callbacks,
          elapsedMs: performance.now() - start,
          gate: gate.diagnostics(),
          glError: gl.getError(),
        };
      } finally {
        gate.dispose();
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    }, scheduling);
    expect(report.glError).toBe(0);
    expect(report.gate.submitted).toBe(12);
    expect(report.gate.completed).toBe(12);
    expect(report.gate.failure).toBeNull();
    expect(report.callbacks).toBeGreaterThan(0);
    await page.locator('#input').evaluate((button) =>
      button.addEventListener('click', () => {
        button.setAttribute('data-clicked', 'true');
      }),
    );
    await page.getByRole('button', { name: 'CHECK INPUT' }).click({ timeout: 15000 });
    await expect(page.locator('#input')).toHaveAttribute('data-clicked', 'true');
    await info.attach('gpu-frame-completion.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
  });
}
