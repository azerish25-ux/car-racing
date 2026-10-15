import * as T from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * Sun shafts (ULTRA `lightShafts`): volumetric light scattering as a
 * post-process (Mitchell, GPU Gems 3 ch. 13) in linear HDR, before bloom.
 *
 *  1. Occlusion mask (quarter resolution): sky pixels (no depth) keep their
 *     own radiance - the sun disc, its aureole, sunset colour - weighted by a
 *     Henyey-Greenstein forward-scattering lobe around the sun; geometry is
 *     black, so trees, stands, gantries and cars cut the beams.
 *  2. Two radial gathers toward the sun's screen position (24 taps each,
 *     exponential decay; the second at the square of the first step), i.e.
 *     576 effective samples, with a fixed per-pixel dither (deterministic).
 *  3. Additive composite scaled by the scattering strength of the lighting and
 *     air (haze from cloud and rain, much stronger low sun at sunset). Off at
 *     night, in studio backdrops, and when the sun is behind the camera; it
 *     fades as the sun leaves the frame. Near occluders (a canopy, a stand)
 *     keep their dark core between the beams: the in-scatter in front of
 *     them is a short path of air, so the composite keeps `occluded` of the
 *     beam on geometry nearer than `clearDistance` m (full beyond it).
 *
 * Photoreal pass (sunset into the sun read milky): a narrow mask (g 0.9, the
 * beams start at the disc and its aureole, about 8 degrees), a shorter gather
 * (decay 0.94) and a third of the sunset strength.
 */
export const LIGHT_SHAFTS = Object.freeze({
  taps: 24,
  /** Fraction of the distance to the sun covered by the first gather. */
  density: 0.9,
  decay: 0.94,
  /** HG asymmetry of the mask lobe (Mie forward scattering). */
  g: 0.9,
  /** Radiance ceiling of masked sky (linear HDR). */
  limit: 40,
  strength: Object.freeze({ day: 0.04, sunset: 0.06 }),
  /** Share of the beam composited over near geometry, and the view distance
   * (m) where geometry counts as open air again. */
  occluded: 0.15,
  clearDistance: Object.freeze([150, 1500] as const),
  /** Sun screen distance (uv) beyond which shafts are fully faded. */
  fadeOutside: 0.6,
});

/** Henyey-Greenstein phase (normalised over the sphere). */
export function henyeyGreenstein(cosTheta: number, g: number = LIGHT_SHAFTS.g) {
  const c = Math.min(Math.max(cosTheta, -1), 1);
  const denominator = (1 + g * g - 2 * g * c) ** 1.5;
  return (1 - g * g) / (4 * Math.PI * denominator);
}
/** Scattering strength for a lighting mode, cloud cover and rain (0..1). */
export function shaftStrength(
  mode: 'day' | 'sunset' | 'night' | 'studio',
  cloud: number,
  rain: number,
) {
  if (mode === 'night' || mode === 'studio') return 0;
  const c = Number.isFinite(cloud) ? Math.min(Math.max(cloud, 0), 1) : 0;
  const r = Number.isFinite(rain) ? Math.min(Math.max(rain, 0), 1) : 0;
  // Broken cloud and moist air scatter more; overcast hides the sun entirely.
  const haze = (1 + 1.5 * c * (1 - c) + 0.6 * r) * (1 - Math.max(0, c - 0.7) / 0.3);
  return LIGHT_SHAFTS.strength[mode] * Math.max(0, haze);
}
const clipScratch = new T.Vector4();
/** Screen position (uv) of a world direction, and whether it is in front (z). */
export function sunScreenPosition(
  camera: T.PerspectiveCamera,
  direction: T.Vector3,
  out = new T.Vector3(),
) {
  const clip = clipScratch
    .set(direction.x, direction.y, direction.z, 0)
    .normalize()
    .applyMatrix4(camera.matrixWorldInverse)
    .applyMatrix4(camera.projectionMatrix);
  if (clip.w <= 1e-5) return out.set(0.5, 0.5, 0);
  return out.set((clip.x / clip.w) * 0.5 + 0.5, (clip.y / clip.w) * 0.5 + 0.5, 1);
}

const vertexShader =
  'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const maskShader = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 sourceTexel;
uniform mat4 projectionInverse;
uniform vec3 sunView;
uniform float g;
varying vec2 vUv;
void main() {
	float sky = 0.0;
	vec3 radiance = vec3( 0.0 );
	for ( int j = 0; j < 2; j ++ )
		for ( int i = 0; i < 2; i ++ ) {
			vec2 uv = vUv + ( vec2( float( i ), float( j ) ) - 0.5 ) * 2.0 * sourceTexel;
			float open = step( 0.99999, texture2D( tDepth, uv ).x );
			sky += open;
			radiance += open * texture2D( tColor, uv ).rgb;
		}
	radiance *= 0.25;
	float l = dot( radiance, vec3( 0.2126, 0.7152, 0.0722 ) );
	if ( !( l < 65000.0 ) ) radiance = vec3( 0.0 );
	radiance *= ${LIGHT_SHAFTS.limit.toFixed(1)} / max( l, ${LIGHT_SHAFTS.limit.toFixed(1)} );
	vec4 view = projectionInverse * vec4( vUv * 2.0 - 1.0, 1.0, 1.0 );
	float c = dot( normalize( view.xyz / view.w ), sunView );
	float phase = ( 1.0 - g * g ) / pow( 1.0 + g * g - 2.0 * g * c, 1.5 );
	gl_FragColor = vec4( radiance * phase * ( 1.0 - g ) * ( 1.0 - g ) * 0.25, 1.0 );
}`;
const gatherShader = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 sun;
uniform float stepScale;
uniform vec2 resolution;
varying vec2 vUv;
void main() {
	vec2 delta = ( sun - vUv ) * stepScale / float( ${LIGHT_SHAFTS.taps} );
	float dither = fract( 52.9829189 * fract( dot( floor( vUv * resolution ), vec2( 0.06711056, 0.00583715 ) ) ) );
	vec2 uv = vUv + delta * dither;
	vec3 sum = vec3( 0.0 );
	float weight = 1.0, total = 0.0;
	for ( int i = 0; i < ${LIGHT_SHAFTS.taps}; i ++ ) {
		sum += texture2D( tSource, uv ).rgb * weight;
		total += weight;
		weight *= ${LIGHT_SHAFTS.decay.toFixed(4)};
		uv += delta;
	}
	gl_FragColor = vec4( sum / total, 1.0 );
}`;
const compositeShader = /* glsl */ `
#include <packing>
uniform sampler2D tSource;
uniform sampler2D tDepth;
uniform vec2 sourceTexel;
uniform float strength;
uniform float cameraNear;
uniform float cameraFar;
varying vec2 vUv;
float openAir( vec2 uv ) {
	float depth = texture2D( tDepth, uv ).x;
	if ( depth >= 0.99999 ) return 1.0;
	float distance = - perspectiveDepthToViewZ( depth, cameraNear, cameraFar );
	return smoothstep( ${LIGHT_SHAFTS.clearDistance[0].toFixed(1)}, ${LIGHT_SHAFTS.clearDistance[1].toFixed(1)}, distance );
}
void main() {
	// Occluder share over a 4-tap footprint, so beam edges stay soft.
	float open = 0.25 * ( openAir( vUv + vec2( -1.5, -1.5 ) * sourceTexel ) + openAir( vUv + vec2( 1.5, -1.5 ) * sourceTexel )
		+ openAir( vUv + vec2( -1.5, 1.5 ) * sourceTexel ) + openAir( vUv + vec2( 1.5, 1.5 ) * sourceTexel ) );
	float keep = mix( ${LIGHT_SHAFTS.occluded.toFixed(3)}, 1.0, open );
	gl_FragColor = vec4( texture2D( tSource, vUv ).rgb * strength * keep, 1.0 );
}`;

function shader(
  name: string,
  fragmentShader: string,
  uniforms: Record<string, T.IUniform>,
  additive = false,
) {
  return new T.ShaderMaterial({
    name,
    vertexShader,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: additive ? T.CustomBlending : T.NoBlending,
    blendEquation: T.AddEquation,
    blendSrc: T.OneFactor,
    blendDst: T.OneFactor,
    transparent: additive,
    toneMapped: false,
  });
}

export class LightShaftsPass extends Pass {
  /** Settings switch; the pass is enabled per frame only when it adds light. */
  wanted = false;
  frames = 0;
  strength = 0;
  private readonly targets: [T.WebGLRenderTarget, T.WebGLRenderTarget];
  private readonly mask: T.ShaderMaterial;
  private readonly gather: T.ShaderMaterial;
  private readonly composite: T.ShaderMaterial;
  private readonly quad = new FullScreenQuad();
  private readonly sun = new T.Vector3();
  private readonly sunView = new T.Vector3();
  constructor(
    private readonly camera: T.PerspectiveCamera,
    private readonly depth: () => T.Texture | null,
  ) {
    super();
    this.needsSwap = false;
    this.enabled = false;
    const target = () =>
      new T.WebGLRenderTarget(1, 1, {
        type: T.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: T.LinearFilter,
        magFilter: T.LinearFilter,
        generateMipmaps: false,
      });
    this.targets = [target(), target()];
    this.targets[0].texture.name = this.targets[1].texture.name = 'APEX sun shafts';
    this.mask = shader('APEX sun shaft mask', maskShader, {
      tColor: { value: null },
      tDepth: { value: null },
      sourceTexel: { value: new T.Vector2() },
      projectionInverse: { value: new T.Matrix4() },
      sunView: { value: new T.Vector3(0, 0, -1) },
      g: { value: LIGHT_SHAFTS.g },
    });
    this.gather = shader('APEX sun shaft gather', gatherShader, {
      tSource: { value: null },
      sun: { value: new T.Vector2(0.5, 0.5) },
      stepScale: { value: LIGHT_SHAFTS.density },
      resolution: { value: new T.Vector2(1, 1) },
    });
    this.composite = shader(
      'APEX sun shaft composite',
      compositeShader,
      {
        tSource: { value: null },
        tDepth: { value: null },
        sourceTexel: { value: new T.Vector2() },
        strength: { value: 0 },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
      },
      true,
    );
  }
  /** Per frame, before the composer: decide whether this frame has shafts. */
  prepare(sunDirection: T.Vector3, strength: number) {
    this.enabled = false;
    if (!this.wanted || !(strength > 0)) return false;
    sunScreenPosition(this.camera, sunDirection, this.sun);
    if (this.sun.z <= 0) return false;
    const outside = Math.max(0, Math.abs(this.sun.x - 0.5) - 0.5, Math.abs(this.sun.y - 0.5) - 0.5);
    const fade = 1 - Math.min(1, outside / LIGHT_SHAFTS.fadeOutside);
    this.strength = strength * fade * fade;
    if (this.strength <= 1e-4) return false;
    this.sunView.copy(sunDirection).normalize().transformDirection(this.camera.matrixWorldInverse);
    this.enabled = true;
    return true;
  }
  override setSize(width: number, height: number) {
    const w = Math.max(1, Math.round(width / 4)),
      h = Math.max(1, Math.round(height / 4));
    for (const t of this.targets) t.setSize(w, h);
    this.mask.uniforms.sourceTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    this.composite.uniforms.sourceTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    this.gather.uniforms.resolution.value.set(w, h);
  }
  override render(
    renderer: T.WebGLRenderer,
    _write: T.WebGLRenderTarget,
    readBuffer: T.WebGLRenderTarget,
  ) {
    const depth = this.depth();
    if (!depth) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const draw = (m: T.ShaderMaterial, target: T.WebGLRenderTarget | null) => {
      this.quad.material = m;
      renderer.setRenderTarget(target);
      this.quad.render(renderer);
    };
    const [a, b] = this.targets;
    const mu = this.mask.uniforms;
    mu.tColor.value = readBuffer.texture;
    mu.tDepth.value = depth;
    mu.projectionInverse.value.copy(this.camera.projectionMatrixInverse);
    mu.sunView.value.copy(this.sunView);
    draw(this.mask, a);
    const gu = this.gather.uniforms;
    gu.sun.value.set(this.sun.x, this.sun.y);
    gu.tSource.value = a.texture;
    gu.stepScale.value = LIGHT_SHAFTS.density;
    draw(this.gather, b);
    gu.tSource.value = b.texture;
    gu.stepScale.value = LIGHT_SHAFTS.density / LIGHT_SHAFTS.taps;
    draw(this.gather, a);
    const cu = this.composite.uniforms;
    cu.tSource.value = a.texture;
    cu.tDepth.value = depth;
    cu.cameraNear.value = this.camera.near;
    cu.cameraFar.value = this.camera.far;
    cu.strength.value = this.strength;
    draw(this.composite, this.renderToScreen ? null : readBuffer);
    renderer.autoClear = autoClear;
    this.frames++;
  }
  diagnostics() {
    return {
      wanted: this.wanted,
      active: this.enabled,
      strength: this.strength,
      sunScreen: [this.sun.x, this.sun.y],
      frames: this.frames,
      resolution: [this.targets[0].width, this.targets[0].height],
      extraDraws: this.enabled ? 4 : 0,
    };
  }
  override dispose() {
    for (const t of this.targets) t.dispose();
    this.mask.dispose();
    this.gather.dispose();
    this.composite.dispose();
    this.quad.dispose();
  }
}
