import type * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/**
 * Screen-space reflection mask (ULTRA `ssr`).
 *
 * The forward renderer has no G-buffer. Opted-in opaque materials (car paint,
 * the circuit road, the shared material library) write their glossy layer's
 * roughness into the scene target's otherwise constant alpha, during the main
 * scene draw only: `apexSsrEncode` is 1 inside SceneAmbientPass's scene render
 * when the SSR stage is active and 0 everywhere else (mirrors, probe, wet plane,
 * shadow and every other preset), where the output is bit-identical to an
 * unpatched material (`mix(a, code, 0.0) == a`).
 *
 * Encoding: alpha = BAND_LOW + BAND_SPAN · r for roughness r in [0, 1), inside a
 * band that excludes the values other materials write (1 for opaque, 0 for
 * some custom shaders). A multisampled edge against an ordinary opaque pixel
 * resolves to the upper half of the band (rough), which the trace ignores.
 *
 * The glossy layer is the clear coat when one is present (paint lacquer, the
 * road's water film), weighted by its strength; otherwise the base lobe.
 */
export const SSR_MASK = Object.freeze({
  bandLow: 0.25,
  bandSpan: 0.5,
  /** Roughness above which the trace does not run (it fades out below this). */
  maxRoughness: 0.62,
});
export const SSR_MASK_HOOK = 'ultra-ssr-mask-v1';

/** Shared by identity across every patched program. */
export const ssrMaskUniforms = Object.freeze({
  apexSsrEncode: { value: 0 } as T.IUniform<number>,
});

/** CPU reference of the shader encode (alpha written for roughness `r`). */
export function encodeSsrRoughness(roughness: number) {
  const r = Number.isFinite(roughness) ? Math.min(Math.max(roughness, 0), 0.999) : 0.999;
  return SSR_MASK.bandLow + SSR_MASK.bandSpan * r;
}
/** CPU reference of the trace's decode: roughness, or null when not masked. */
export function decodeSsrRoughness(alpha: number) {
  if (!Number.isFinite(alpha)) return null;
  const r = (alpha - SSR_MASK.bandLow) / SSR_MASK.bandSpan;
  return r >= 0 && r < 1 ? r : null;
}
/** Effective SSR roughness of a coat of `strength` over a base lobe. */
export function ssrLayerRoughness(base: number, coat: number, coatRoughness: number) {
  const s = Math.min(Math.max(coat, 0), 1);
  // A weak coat contributes little mirror energy: treat it as rough so the
  // trace fades it, rather than inventing a second strength channel.
  return s > 0 ? 1 - s + s * coatRoughness : base;
}

export const SSR_DECODE_GLSL = /* glsl */ `
float apexSsrDecode( float alpha ) {
	float r = ( alpha - ${SSR_MASK.bandLow.toFixed(3)} ) / ${SSR_MASK.bandSpan.toFixed(3)};
	return ( r >= 0.0 && r < 1.0 ) ? r : 2.0;
}`;

const DECLARATIONS = /* glsl */ `
uniform float apexSsrEncode;`;

const ENCODE = /* glsl */ `
#if defined( OPAQUE ) && ! defined( PREMULTIPLIED_ALPHA )
{
	float apexSsrRough = material.roughness;
	#ifdef USE_CLEARCOAT
	{
		float apexCoat = clamp( material.clearcoat, 0.0, 1.0 );
		if ( apexCoat > 0.0 ) apexSsrRough = 1.0 - apexCoat + apexCoat * material.clearcoatRoughness;
	}
	#endif
	float apexSsrCode = ${SSR_MASK.bandLow.toFixed(3)} + ${SSR_MASK.bandSpan.toFixed(3)} * clamp( apexSsrRough, 0.0, 0.999 );
	gl_FragColor.a = mix( gl_FragColor.a, apexSsrCode, apexSsrEncode );
}
#endif`;

/** Opt `material` into the SSR mask. Only lit physical/standard materials have a
 * `material` struct; others are left alone. Idempotent. */
export function installSsrMask(material: T.Material) {
  const typed = material as T.Material & { isMeshStandardMaterial?: boolean };
  if (!typed.isMeshStandardMaterial) return false;
  return chainShaderHook(material, SSR_MASK_HOOK, (shader) => {
    // A material whose earlier hooks replaced these anchors keeps its own
    // output: a missing mask only means no reflection, never a failed program.
    const fragment = shader.fragmentShader;
    if (
      fragment.split('#include <opaque_fragment>').length !== 2 ||
      fragment.split('#include <common>').length !== 2
    )
      return;
    shader.uniforms.apexSsrEncode = ssrMaskUniforms.apexSsrEncode;
    injectDeclarations(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'opaque_fragment', ENCODE, 'fragment');
  });
}
