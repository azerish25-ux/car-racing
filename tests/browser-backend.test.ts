import { describe, expect, it } from 'vitest';
import { browserBackend, requireBrowserBackend } from '../scripts/browser-backend.ts';

describe('explicit software graphics backend selection', () => {
  it('retains the existing SwiftShader launch by default and does not share mutable arguments', () => {
    const first = browserBackend(undefined);
    expect(first).toEqual({
      name: 'swiftshader',
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    first.args.length = 0;
    expect(browserBackend('swiftshader').args).toHaveLength(3);
  });
  it('selects Mesa only explicitly and only on Linux', () => {
    expect(browserBackend('mesa', 'linux')).toEqual({
      name: 'mesa',
      headless: false,
      args: [
        '--use-gl=angle',
        '--use-angle=gl',
        '--ignore-gpu-blocklist',
        '--gpu-watchdog-timeout-seconds=120',
      ],
    });
    for (const platform of ['win32', 'darwin'] as const)
      expect(() => browserBackend('mesa', platform)).toThrow('requires Linux');
    for (const name of ['', 'auto', 'Mesa', '--disable-gpu'])
      expect(() => browserBackend(name)).toThrow('Unknown APEX_BROWSER_BACKEND');
  });
  it('keeps a finite watchdog only for explicit Mesa and never changes sandbox isolation', () => {
    const mesa = browserBackend('mesa', 'linux').args;
    expect(mesa).toContain('--gpu-watchdog-timeout-seconds=120');
    for (const backend of [mesa, browserBackend('swiftshader').args]) {
      expect(backend).not.toContain('--disable-gpu-watchdog');
      expect(backend).not.toContain('--disable-gpu-sandbox');
      expect(backend).not.toContain('--no-sandbox');
    }
    expect(browserBackend('swiftshader').args.some((arg) => arg.includes('watchdog'))).toBe(false);
  });
  it('requires the observed requested adapter and rejects silent driver fallback', () => {
    expect(() =>
      requireBrowserBackend('mesa', 'ANGLE (Mesa, llvmpipe (LLVM 20.1.2, 256 bits), OpenGL 4.5)'),
    ).not.toThrow();
    expect(() =>
      requireBrowserBackend('swiftshader', 'ANGLE (Google, SwiftShader Device)'),
    ).not.toThrow();
    for (const value of [null, undefined, '', 'softpipe', 'NVIDIA GeForce', 'SwiftShader'])
      expect(() => requireBrowserBackend('mesa', value)).toThrow('Expected mesa');
    expect(() => requireBrowserBackend('mesa', 'llvmpipe SwiftShader')).toThrow('Expected mesa');
    expect(() => requireBrowserBackend('swiftshader', 'llvmpipe')).toThrow('Expected swiftshader');
  });
});
