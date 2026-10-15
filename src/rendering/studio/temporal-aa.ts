import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { studioGlsl, studioUniforms } from './studio-frame.ts';
import { MOTION_BLUR } from './velocity.ts';

/**
 * Temporal anti-aliasing for High (post-motion, D05; opt-in `temporalAA`).
 *
 * The scene draw is jittered by a Halton(2,3) sequence of 8 sub-pixel offsets;
 * one resolve quad blends the current frame into a reprojected history. The
 * history is fetched where the surface was last frame: static world through
 * render-core's `studioPrevViewProj`, cars rigidly through `studioCarPrev`
 * (the same footprint boxes as the motion blur). It is clipped to the current
 * 3x3 neighbourhood's YCoCg variance box (no ghosting on disocclusion, colour
 * or lighting change) and blended in a luminance-weighted space so HDR
 * highlights cannot smear. The motion blur and AO composite read the result.
 *
 * Determinism: the jitter index advances only on frames whose presented time
 * advances (`studioFrameDt > 0`). Held, paused and photo frames, menus, cuts,
 * seeks and resizes render unjittered without history, so held frames stay
 * byte-identical and nothing accumulates across a cut.
 */
export const TEMPORAL_AA = Object.freeze({
  /** Halton(2,3) jitter period. */
  samples: 8,
  /** History weight at rest and at `movingPixels` of motion per frame or more:
   * resampling a moving history softens it, so moving pixels trust it less. */
  feedbackStill: 0.92,
  feedbackMoving: 0.7,
  movingPixels: 3,
  /** Variance clip width in standard deviations. */
  gamma: 1.1,
});

/** Radical inverse of `index` (≥ 1) in `base`. */
export function halton(index: number, base: number) {
  let result = 0,
    fraction = 1 / base,
    i = Math.floor(index);
  while (i > 0) {
    result += (i % base) * fraction;
    i = Math.floor(i / base);
    fraction /= base;
  }
  return result;
}

/** Sub-pixel jitter (pixels, each in [-0.5, 0.5)) for frame `index`. */
export function jitterOffset(index: number, out = new T.Vector2()) {
  const i =
    (((Math.floor(index) % TEMPORAL_AA.samples) + TEMPORAL_AA.samples) % TEMPORAL_AA.samples) + 1;
  return out.set(halton(i, 2) - 0.5, halton(i, 3) - 0.5);
}

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragment = /* glsl */ `
  #include <packing>
  ${studioGlsl(['studioPrevViewProj', 'studioCarCount', 'studioCarNow', 'studioCarPrev', 'studioCarPose'])}
  uniform sampler2D tColor;
  uniform sampler2D tHistory;
  uniform sampler2D tDepth;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform vec2 projectionScale;
  uniform vec2 jitterUv;
  uniform mat4 cameraWorld;
  uniform vec2 resolution;
  uniform float historyValid;
  uniform float feedbackStill;
  uniform float feedbackMoving;
  uniform float gamma;
  varying vec2 vUv;
  vec3 toYCoCg(vec3 c) {
    return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25)));
  }
  vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
  // Luminance-weighted (Karis) space: bright speculars cannot dominate the blend.
  vec3 compress(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
  vec3 expand(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }
  // Clamped to the HalfFloat range: compress(Inf) is NaN, which would reach the history.
  vec3 finiteColor(vec3 c) { return clamp(c, vec3(0.0), vec3(65000.0)); }
  vec3 sampleCurrent(vec2 uv) { return toYCoCg(compress(finiteColor(texture2D(tColor, uv).rgb))); }
  // Five-tap Catmull-Rom history fetch (sharper than bilinear, no ringing past the clip).
  vec3 sampleHistory(vec2 uv) {
    vec2 position = uv * resolution;
    vec2 center = floor(position - 0.5) + 0.5;
    vec2 f = position - center, f2 = f * f, f3 = f2 * f;
    vec2 w0 = -0.5 * f3 + f2 - 0.5 * f, w1 = 1.5 * f3 - 2.5 * f2 + 1.0;
    vec2 w2 = -1.5 * f3 + 2.0 * f2 + 0.5 * f, w3 = 0.5 * f3 - 0.5 * f2;
    vec2 w12 = w1 + w2;
    vec2 texel = 1.0 / resolution;
    vec2 t0 = (center - 1.0) * texel, t3 = (center + 2.0) * texel;
    vec2 t12 = (center + w2 / w12) * texel;
    vec3 sum = texture2D(tHistory, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y)
      + texture2D(tHistory, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y)
      + texture2D(tHistory, t12).rgb * (w12.x * w12.y)
      + texture2D(tHistory, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y)
      + texture2D(tHistory, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
    float weight = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
    return toYCoCg(compress(finiteColor(sum / weight)));
  }
  vec2 previousUv(vec2 uv, float depth) {
    float z = perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
    // The jittered pixel at uv shows the unjittered surface at uv + jitterUv.
    vec3 view = vec3(((uv + jitterUv) * 2.0 - 1.0) * -z / projectionScale, z);
    vec3 world = (cameraWorld * vec4(view, 1.0)).xyz;
    for (int i = 0; i < STUDIO_MAX_CARS; i++) {
      if (i >= studioCarCount) break;
      vec3 footprint = studioCarPoseLocal(studioCarPose[i], world);
      if (abs(footprint.x) < STUDIO_CAR_HALF_WIDTH + ${MOTION_BLUR.boxMargin.toFixed(2)} &&
          abs(footprint.z) < STUDIO_CAR_HALF_LENGTH + ${MOTION_BLUR.boxMargin.toFixed(2)} &&
          footprint.y > ${MOTION_BLUR.boxFloor.toFixed(3)} && footprint.y < ${MOTION_BLUR.boxTop.toFixed(2)}) {
        world = (studioCarPrev[i] * vec4(studioRigidToLocal(studioCarNow[i], world), 1.0)).xyz;
        break;
      }
    }
    vec4 clip = studioPrevViewProj * vec4(world, 1.0);
    // History pixels are unjittered: the surface moved by (now + jitter) - before,
    // so the history of pixel uv lies at before - jitter.
    return clip.w > 1e-4 ? clip.xy / clip.w * 0.5 + 0.5 - jitterUv : vec2(-1.0);
  }
  void main() {
    vec2 texel = 1.0 / resolution;
    vec3 current = sampleCurrent(vUv);
    if (historyValid < 0.5) { gl_FragColor = vec4(expand(fromYCoCg(current)), 1.0); return; }
    // Neighbourhood moments (3x3) in YCoCg.
    vec3 m1 = current, m2 = current * current;
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        if (i == 0 && j == 0) continue;
        vec3 c = sampleCurrent(vUv + vec2(float(i), float(j)) * texel);
        m1 += c;
        m2 += c * c;
      }
    m1 /= 9.0;
    vec3 sigma = sqrt(max(m2 / 9.0 - m1 * m1, vec3(0.0))) * gamma;
    vec2 previous = previousUv(vUv, texture2D(tDepth, vUv).x);
    if (previous.x < 0.0 || previous.y < 0.0 || previous.x > 1.0 || previous.y > 1.0) {
      gl_FragColor = vec4(expand(fromYCoCg(current)), 1.0);
      return;
    }
    vec3 history = sampleHistory(previous);
    // Clip the history toward the neighbourhood mean onto the variance box.
    vec3 offset = history - m1;
    vec3 units = abs(offset / max(sigma, vec3(1e-5)));
    float scale = max(units.x, max(units.y, units.z));
    if (scale > 1.0) history = m1 + offset / scale;
    float pixels = length((previous - vUv) * resolution);
    float feedback = mix(feedbackStill, feedbackMoving, clamp(pixels / ${TEMPORAL_AA.movingPixels.toFixed(1)}, 0.0, 1.0));
    gl_FragColor = vec4(expand(fromYCoCg(mix(current, history, feedback))), 1.0);
  }
`;

export class TemporalAA {
  /** The settings key; the pass also needs a live, advancing frame. */
  enabled = false;
  frames = 0;
  resets = 0;
  private readonly history: [T.WebGLRenderTarget, T.WebGLRenderTarget];
  private readonly material: T.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly offset = new T.Vector2();
  private index = 0;
  private valid = false;
  private active = false;
  private jittered = false;
  private readonly unjittered = new T.Matrix4();
  private readonly unjitteredInverse = new T.Matrix4();
  private width = 1;
  private height = 1;
  private disposed = false;
  constructor() {
    const target = () =>
      new T.WebGLRenderTarget(1, 1, {
        type: T.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: T.LinearFilter,
        magFilter: T.LinearFilter,
      });
    this.history = [target(), target()];
    this.history[0].texture.name = this.history[1].texture.name = 'APEX temporal history';
    const u = studioUniforms;
    this.material = new T.ShaderMaterial({
      name: 'APEX temporal resolve',
      vertexShader: vertex,
      fragmentShader: fragment,
      depthTest: false,
      depthWrite: false,
      blending: T.NoBlending,
      toneMapped: false,
      uniforms: {
        tColor: { value: null },
        tHistory: { value: null },
        tDepth: { value: null },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        projectionScale: { value: new T.Vector2(1, 1) },
        jitterUv: { value: new T.Vector2() },
        cameraWorld: { value: new T.Matrix4() },
        resolution: { value: new T.Vector2(1, 1) },
        historyValid: { value: 0 },
        feedbackStill: { value: TEMPORAL_AA.feedbackStill },
        feedbackMoving: { value: TEMPORAL_AA.feedbackMoving },
        gamma: { value: TEMPORAL_AA.gamma },
        // Bound by identity: render-core's StudioFrame writes them each frame.
        studioPrevViewProj: u.studioPrevViewProj,
        studioCarCount: u.studioCarCount,
        studioCarNow: u.studioCarNow,
        studioCarPrev: u.studioCarPrev,
        studioCarPose: u.studioCarPose,
      },
    });
    this.quad = new FullScreenQuad(this.material);
  }
  setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    for (const target of this.history) target.setSize(this.width, this.height);
    this.material.uniforms.resolution.value.set(this.width, this.height);
    this.reset();
  }
  /** Jitter index of the current (or last) resolved frame. */
  get jitterIndex() {
    return this.index;
  }
  /** This frame is jittered and resolved (read after the scene pass began it). */
  get resolving() {
    return this.active;
  }
  /** Cut, seek, resize or settings change: the next frame starts a new history. */
  reset() {
    this.valid = false;
    this.resets++;
  }
  /**
   * Before the scene draw. `live` is false for menu, photo and paused replay;
   * `frameDt` is StudioFrame's presented step (0 when held or cut).
   * Returns whether this frame is jittered and resolved.
   */
  begin(camera: T.PerspectiveCamera, live: boolean, frameDt = studioUniforms.studioFrameDt.value) {
    const advancing = frameDt > 0;
    this.active = !this.disposed && this.enabled && live && advancing;
    if (!this.active) {
      // Held frames render exactly as without TAA; the next advancing frame restarts.
      if (this.valid) this.reset();
      return false;
    }
    this.index = (this.index + 1) % TEMPORAL_AA.samples;
    jitterOffset(this.index, this.offset);
    this.unjittered.copy(camera.projectionMatrix);
    this.unjitteredInverse.copy(camera.projectionMatrixInverse);
    const p = camera.projectionMatrix.elements;
    p[8] += (2 * this.offset.x) / this.width;
    p[9] += (2 * this.offset.y) / this.height;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.jittered = true;
    return true;
  }
  /** After the scene draw: restore the unjittered projection. */
  end(camera: T.PerspectiveCamera) {
    if (!this.jittered) return;
    camera.projectionMatrix.copy(this.unjittered);
    camera.projectionMatrixInverse.copy(this.unjitteredInverse);
    this.jittered = false;
  }
  /** Resolve the jittered scene colour into the history; returns the image the
   * composite reads, or `color` itself when inactive. One full-screen quad. */
  resolve(
    renderer: T.WebGLRenderer,
    camera: T.PerspectiveCamera,
    color: T.Texture,
    depth: T.Texture,
  ): T.Texture {
    if (!this.active) return color;
    const u = this.material.uniforms;
    const [read, write] = this.history;
    u.tColor.value = color;
    u.tDepth.value = depth;
    u.tHistory.value = read.texture;
    u.historyValid.value = this.valid ? 1 : 0;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    u.projectionScale.value.set(
      camera.projectionMatrix.elements[0],
      camera.projectionMatrix.elements[5],
    );
    // Adding 2j/size to projection[8], [9] moves every point by -j pixels.
    u.jitterUv.value.set(this.offset.x / this.width, this.offset.y / this.height);
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
      active: this.active,
      frames: this.frames,
      resets: this.resets,
      index: this.index,
      jitter: this.offset.toArray(),
      extraDraws: this.active ? 1 : 0,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    for (const target of this.history) target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
