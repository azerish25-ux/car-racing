import * as T from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * Contrast-adaptive sharpening after the temporal resolve (ULTRA `taaSharpen`).
 *
 * The Catmull-Rom history fetch and the per-frame resampling of a moving
 * history soften the resolved image slightly; CAS (Lottes, AMD FidelityFX
 * 2019) restores it in display space without ringing: a negative-lobe cross
 * filter whose weight is reduced where the local 3x3 neighbourhood is already
 * at high contrast or near the ends of the range. It sharpens only frames the
 * TAA actually resolved - held, paused, photo and menu frames run without TAA
 * and therefore without this pass (no extra draw), so they stay identical to
 * the unsharpened renderer. It never compensates for disabled anti-aliasing.
 */
export const TAA_SHARPEN = Object.freeze({
  /** Peak negative lobe at full strength (CAS's sharpest setting, -1/5). The
   * lobe scales linearly with the setting, so 0 is the identity. */
  lobe: 1 / 5,
});
/** Negative-lobe weight of a 0..1 setting. */
export function casPeak(strength: number) {
  return -TAA_SHARPEN.lobe * Math.min(Math.max(Number.isFinite(strength) ? strength : 0, 0), 1);
}

/** CPU reference of the shader (one channel, display-referred 0..1).
 * `n` is the 3x3 neighbourhood, row-major, centre at index 4. */
export function casSharpen(n: readonly number[], sharpness: number) {
  if (n.length !== 9 || !n.every(Number.isFinite)) throw new Error('Invalid CAS neighbourhood');
  const s = Math.min(Math.max(sharpness, 0), 1);
  const [a, b, c, d, e, f, g, h, i] = n;
  const crossMin = Math.min(b, d, e, f, h),
    crossMax = Math.max(b, d, e, f, h);
  const mn = crossMin + Math.min(crossMin, a, c, g, i),
    mx = crossMax + Math.max(crossMax, a, c, g, i);
  const amp = Math.sqrt(Math.min(Math.max(Math.min(mn, 2 - mx) / Math.max(mx, 1e-5), 0), 1));
  const w = amp * casPeak(s);
  return Math.min(Math.max((b * w + d * w + f * w + h * w + e) / (1 + 4 * w), 0), 1);
}

const fragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 texel;
uniform float peak;
varying vec2 vUv;
vec3 tap( vec2 o ) { return clamp( texture2D( tDiffuse, vUv + o * texel ).rgb, 0.0, 1.0 ); }
void main() {
	vec3 a = tap( vec2( -1.0, -1.0 ) ), b = tap( vec2( 0.0, -1.0 ) ), c = tap( vec2( 1.0, -1.0 ) );
	vec3 d = tap( vec2( -1.0, 0.0 ) ), e = tap( vec2( 0.0, 0.0 ) ), f = tap( vec2( 1.0, 0.0 ) );
	vec3 g = tap( vec2( -1.0, 1.0 ) ), h = tap( vec2( 0.0, 1.0 ) ), i = tap( vec2( 1.0, 1.0 ) );
	vec3 crossMin = min( min( min( b, d ), min( e, f ) ), h );
	vec3 crossMax = max( max( max( b, d ), max( e, f ) ), h );
	vec3 mn = crossMin + min( crossMin, min( min( a, c ), min( g, i ) ) );
	vec3 mx = crossMax + max( crossMax, max( max( a, c ), max( g, i ) ) );
	vec3 amp = sqrt( clamp( min( mn, 2.0 - mx ) / max( mx, vec3( 1e-5 ) ), 0.0, 1.0 ) );
	vec3 w = amp * peak;
	gl_FragColor = vec4( clamp( ( ( b + d + f + h ) * w + e ) / ( 1.0 + 4.0 * w ), 0.0, 1.0 ), 1.0 );
}`;

/** The owner decides per frame whether the pass runs (UltraPipeline makes
 * `enabled` follow the temporal resolve of the same frame). */
export class TaaSharpenPass extends Pass {
  private readonly material: T.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  /** Settings strength 0..1 (0 disables). */
  strength = 0;
  frames = 0;
  constructor() {
    super();
    this.enabled = false;
    this.material = new T.ShaderMaterial({
      name: 'APEX contrast-adaptive sharpening',
      uniforms: {
        tDiffuse: { value: null },
        texel: { value: new T.Vector2(1, 1) },
        peak: { value: 0 },
      },
      vertexShader:
        'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: T.NoBlending,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  override setSize(width: number, height: number) {
    this.material.uniforms.texel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }
  override render(
    renderer: T.WebGLRenderer,
    writeBuffer: T.WebGLRenderTarget,
    readBuffer: T.WebGLRenderTarget,
  ) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.peak.value = casPeak(this.strength);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    this.frames++;
  }
  override dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
