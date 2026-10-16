export type BrowserBackend = 'swiftshader' | 'mesa';

/** Select only known test backends. This never changes application graphics,
 * simulation timing, test dimensions, timeouts, workers or retries. */
export function browserBackend(request: string | undefined, platform = process.platform) {
  const name = request ?? 'swiftshader';
  if (name !== 'swiftshader' && name !== 'mesa')
    throw new Error(`Unknown APEX_BROWSER_BACKEND: ${name}`);
  if (name === 'mesa' && platform !== 'linux')
    throw new Error('The Mesa CI backend requires Linux and an X display');
  return {
    name: name as BrowserBackend,
    headless: name !== 'mesa',
    args:
      name === 'mesa'
        ? [
            '--use-gl=angle',
            '--use-angle=gl',
            '--ignore-gpu-blocklist',
            // llvmpipe compiles and executes on the CPU. Keep a bounded graphics
            // process watchdog for cold photographed-material compilation; do
            // not disable it, reduce scene quality, or extend test deadlines.
            '--gpu-watchdog-timeout-seconds=120',
          ]
        : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  };
}

/** Reject an unavailable requested backend, including automatic SwiftShader
 * fallback. A successful identity check is NOT physical-hardware acceptance. */
export function requireBrowserBackend(name: BrowserBackend, renderer: unknown) {
  const valid =
    typeof renderer === 'string' &&
    (name === 'mesa'
      ? /llvmpipe/i.test(renderer) && !/swiftshader/i.test(renderer)
      : /swiftshader/i.test(renderer));
  if (!valid) throw new Error(`Expected ${name} software renderer, observed ${String(renderer)}`);
}
