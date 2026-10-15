import type { GraphicsOptions } from '../options.ts';

/** Device features the ULTRA modules depend on. */
export interface UltraCapabilities {
  /** Renderable float colour (R32F Hi-Z, RGBA16F stages). */
  floatColorBuffer: boolean;
  maxTextureSize: number;
  maxSamples: number;
}
export interface CapabilityRenderer {
  extensions: { has(name: string): boolean };
  capabilities: { maxTextureSize: number; maxSamples: number };
}
export function probeCapabilities(renderer: CapabilityRenderer): UltraCapabilities {
  return {
    floatColorBuffer: renderer.extensions.has('EXT_color_buffer_float'),
    maxTextureSize: renderer.capabilities.maxTextureSize,
    maxSamples: renderer.capabilities.maxSamples,
  };
}
/** Effective options on this device: a request beyond what it can allocate
 * falls back to the largest supported value (Low/Medium/High never exceed
 * WebGL2's guaranteed 2048, so they are returned unchanged). */
export function deviceGraphics(
  graphics: GraphicsOptions,
  caps: UltraCapabilities,
): GraphicsOptions {
  let shadowSize = graphics.shadowSize;
  while (shadowSize > 2048 && shadowSize > caps.maxTextureSize)
    shadowSize = (shadowSize / 2) as GraphicsOptions['shadowSize'];
  return shadowSize === graphics.shadowSize ? graphics : { ...graphics, shadowSize };
}
/** Why a module requested in `graphics` cannot run here (empty when it can). */
export function unsupportedModules(graphics: GraphicsOptions, caps: UltraCapabilities) {
  const out: string[] = [];
  if (graphics.ssr && !caps.floatColorBuffer) out.push('ssr: no EXT_color_buffer_float');
  if (graphics.shadowCascades === 3 && graphics.shadowSize === 0)
    out.push('shadowCascades: shadows off');
  if (graphics.taaSharpen > 0 && !graphics.temporalAA) out.push('taaSharpen: temporal AA off');
  if (graphics.aoTemporal && !graphics.ambientOcclusion)
    out.push('aoTemporal: ambient occlusion off');
  return out;
}
