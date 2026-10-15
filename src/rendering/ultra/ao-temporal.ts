import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { MOTION_BLUR } from '../studio/velocity.ts';
import { studioGlsl, studioUniforms } from '../studio/studio-frame.ts';

/**
 * Temporal ground-truth AO (ULTRA `aoTemporal`).
 *
 * SceneAmbientPass's GTAO runs at half resolution with a fixed per-pixel
 * slice rotation. Here it takes ULTRA_AO_SLICES slices, its rotation advances
 * every presented frame (an R2 offset of the interleaved-gradient noise), and
 * this stage accumulates the result in a half-resolution history reprojected
 * like the TAA (static world by the previous view-projection, cars rigidly by
 * their previous chassis transform). The history is clamped to the current
 * 3x3 min/max (no ghosting on disocclusion) and blended with less weight when
 * a pixel moves. All three channels (ambient visibility, sun contact, direct
 * share) accumulate. Held, paused and photo frames bypass the history and use
 * the base rotation, so they match the single-frame AO exactly.
 */
export const AO_TEMPORAL = Object.freeze({
  slices: 4,
  feedbackStill: 0.9,
  feedbackMoving: 0.6,
  movingPixels: 4,
  /** Clamp slack around the neighbourhood range. */
  slack: 0.02,
});

/** Noise offset of frame `index` (R2 low-discrepancy sequence, pixels). */
export function aoNoiseOffset(index: number, out = new T.Vector2()) {
  const g = 1.324717957244746;
  const i = Math.max(0, Math.floor(index));
  return out.set(((i / g) % 1) * 64, ((i / (g * g)) % 1) * 64);
}
/** three's perspectiveDepthToViewZ (negative view-space z of a raw depth). */
export function viewZFromDepth(depth: number, near: number, far: number) {
  return (near * far) / ((far - near) * depth - far);
}
/**
 * CPU reference of the static-world reprojection shared by TAA and temporal AO:
 * the uv a pixel's surface occupied in the previous frame, from its current uv
 * and raw depth, the current camera and the previous view-projection matrix.
 * Returns null when the point was behind the previous camera.
 */
export function reprojectUv(
  uv: T.Vector2,
  depth: number,
  camera: T.PerspectiveCamera,
  previousViewProjection: T.Matrix4,
  out = new T.Vector2(),
) {
  const z = viewZFromDepth(depth, camera.near, camera.far);
  const e = camera.projectionMatrix.elements;
  const world = new T.Vector4(
    ((uv.x * 2 - 1) * -z) / e[0],
    ((uv.y * 2 - 1) * -z) / e[5],
    z,
    1,
  ).applyMatrix4(camera.matrixWorld);
  const clip = world.applyMatrix4(previousViewProjection);
  if (clip.w <= 1e-4) return null;
  return out.set((clip.x / clip.w) * 0.5 + 0.5, (clip.y / clip.w) * 0.5 + 0.5);
}
/** CPU reference of the blend: history clamped to [lo, hi] then mixed. */
export function accumulateAo(
  current: number,
  history: number,
  lo: number,
  hi: number,
  movingPixels: number,
) {
  const h = Math.min(Math.max(history, lo - AO_TEMPORAL.slack), hi + AO_TEMPORAL.slack);
  const t = Math.min(Math.max(movingPixels / AO_TEMPORAL.movingPixels, 0), 1);
  const feedback =
    AO_TEMPORAL.feedbackStill + (AO_TEMPORAL.feedbackMoving - AO_TEMPORAL.feedbackStill) * t;
  return current + (h - current) * feedback;
}

const fragmentShader = /* glsl */ `
#include <packing>
${studioGlsl(['studioPrevViewProj', 'studioCarCount', 'studioCarNow', 'studioCarPrev', 'studioCarPose'])}
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform vec2 projectionScale;
uniform mat4 cameraWorld;
uniform vec2 resolution;
uniform float historyValid;
varying vec2 vUv;
vec2 previousUv( vec2 uv, float depth ) {
	float z = perspectiveDepthToViewZ( depth, cameraNear, cameraFar );
	vec3 view = vec3( ( uv * 2.0 - 1.0 ) * - z / projectionScale, z );
	vec3 world = ( cameraWorld * vec4( view, 1.0 ) ).xyz;
	for ( int i = 0; i < STUDIO_MAX_CARS; i ++ ) {
		if ( i >= studioCarCount ) break;
		vec3 footprint = studioCarPoseLocal( studioCarPose[ i ], world );
		if ( abs( footprint.x ) < STUDIO_CAR_HALF_WIDTH + ${MOTION_BLUR.boxMargin.toFixed(2)} &&
			abs( footprint.z ) < STUDIO_CAR_HALF_LENGTH + ${MOTION_BLUR.boxMargin.toFixed(2)} &&
			footprint.y > ${MOTION_BLUR.boxFloor.toFixed(3)} && footprint.y < ${MOTION_BLUR.boxTop.toFixed(2)} ) {
			world = ( studioCarPrev[ i ] * vec4( studioRigidToLocal( studioCarNow[ i ], world ), 1.0 ) ).xyz;
			break;
		}
	}
	vec4 clip = studioPrevViewProj * vec4( world, 1.0 );
	return clip.w > 1e-4 ? clip.xy / clip.w * 0.5 + 0.5 : vec2( -1.0 );
}
void main() {
	vec3 current = texture2D( tCurrent, vUv ).rgb;
	float depth = texture2D( tDepth, vUv ).x;
	if ( historyValid < 0.5 || depth >= 0.99999 ) { gl_FragColor = vec4( current, 1.0 ); return; }
	vec2 texel = 1.0 / resolution;
	vec3 lo = current, hi = current;
	for ( int j = -1; j <= 1; j ++ )
		for ( int i = -1; i <= 1; i ++ ) {
			vec3 c = texture2D( tCurrent, vUv + vec2( float( i ), float( j ) ) * texel ).rgb;
			lo = min( lo, c );
			hi = max( hi, c );
		}
	vec2 previous = previousUv( vUv, depth );
	if ( previous.x < 0.0 || previous.y < 0.0 || previous.x > 1.0 || previous.y > 1.0 ) {
		gl_FragColor = vec4( current, 1.0 );
		return;
	}
	vec3 history = clamp( texture2D( tHistory, previous ).rgb, lo - ${AO_TEMPORAL.slack.toFixed(3)}, hi + ${AO_TEMPORAL.slack.toFixed(3)} );
	float pixels = length( ( previous - vUv ) * resolution );
	float feedback = mix( ${AO_TEMPORAL.feedbackStill.toFixed(3)}, ${AO_TEMPORAL.feedbackMoving.toFixed(3)}, clamp( pixels / ${AO_TEMPORAL.movingPixels.toFixed(1)}, 0.0, 1.0 ) );
	gl_FragColor = vec4( mix( current, history, feedback ), 1.0 );
}`;

export interface ObscuranceStageContext {
  renderer: T.WebGLRenderer;
  camera: T.PerspectiveCamera;
  obscurance: T.Texture;
  depth: T.DepthTexture;
  /** Presented time advanced this frame and the view is live. */
  advancing: boolean;
}

export class TemporalObscurance {
  enabled = false;
  frames = 0;
  resets = 0;
  index = 0;
  private valid = false;
  private readonly history: [T.WebGLRenderTarget, T.WebGLRenderTarget];
  private readonly material: T.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  constructor() {
    const target = () =>
      new T.WebGLRenderTarget(1, 1, {
        type: T.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: T.LinearFilter,
        magFilter: T.LinearFilter,
        generateMipmaps: false,
      });
    this.history = [target(), target()];
    this.history[0].texture.name = this.history[1].texture.name = 'APEX temporal obscurance';
    const u = studioUniforms;
    this.material = new T.ShaderMaterial({
      name: 'APEX temporal obscurance',
      vertexShader:
        'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader,
      uniforms: {
        tCurrent: { value: null },
        tHistory: { value: null },
        tDepth: { value: null },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        projectionScale: { value: new T.Vector2(1, 1) },
        cameraWorld: { value: new T.Matrix4() },
        resolution: { value: new T.Vector2(1, 1) },
        historyValid: { value: 0 },
        studioPrevViewProj: u.studioPrevViewProj,
        studioCarCount: u.studioCarCount,
        studioCarNow: u.studioCarNow,
        studioCarPrev: u.studioCarPrev,
        studioCarPose: u.studioCarPose,
      },
      depthTest: false,
      depthWrite: false,
      blending: T.NoBlending,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  setSize(width: number, height: number) {
    for (const target of this.history) target.setSize(Math.max(1, width), Math.max(1, height));
    this.material.uniforms.resolution.value.set(Math.max(1, width), Math.max(1, height));
    this.reset();
  }
  reset() {
    if (this.valid) this.resets++;
    this.valid = false;
  }
  /** The GTAO noise offset for this frame (0 when the history is bypassed). */
  noiseOffset(advancing: boolean, out: T.Vector2) {
    if (!this.enabled || !advancing) return out.set(0, 0);
    return aoNoiseOffset(this.index + 1, out);
  }
  render(context: ObscuranceStageContext): T.Texture {
    if (!this.enabled || !context.advancing) {
      this.reset();
      return context.obscurance;
    }
    this.index = (this.index + 1) % 1024;
    const { renderer, camera } = context;
    const u = this.material.uniforms;
    const [read, write] = this.history;
    u.tCurrent.value = context.obscurance;
    u.tHistory.value = read.texture;
    u.tDepth.value = context.depth;
    u.historyValid.value = this.valid ? 1 : 0;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    u.projectionScale.value.set(
      camera.projectionMatrix.elements[0],
      camera.projectionMatrix.elements[5],
    );
    u.cameraWorld.value.copy(camera.matrixWorld);
    renderer.setRenderTarget(write);
    this.quad.render(renderer);
    this.history.reverse();
    this.valid = true;
    this.frames++;
    return write.texture;
  }
  diagnostics() {
    return {
      enabled: this.enabled,
      slices: AO_TEMPORAL.slices,
      frames: this.frames,
      resets: this.resets,
      historyValid: this.valid,
      extraDraws: this.valid ? 1 : 0,
    };
  }
  dispose() {
    for (const target of this.history) target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
