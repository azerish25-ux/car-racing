import * as T from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * Depth-texture depth of field (D09 post-lens). Replaces three's BokehPass,
 * which re-rendered the whole scene with a depth override material every
 * photo frame (doubling photo draw calls), with a gather over the scene pass's
 * existing float depth attachment: no scene re-render, one full-screen quad.
 *
 * The lens keeps BokehPass's parameters and response so photo settings carry
 * over: the blur radius in screen units is `clamp((depth - focus) · aperture,
 * ±maxblur)`, with depth the camera-space distance along the optical axis.
 *
 * Gather: 24 taps on a Vogel disc of the centre's circle of confusion. A tap
 * contributes where its own circle covers the distance to the centre (scatter
 * as gather), so a sharp subject never smears into a blurred background, and
 * blurred foreground edges grow soft. Weights favour larger circles slightly
 * so out-of-focus highlights read as discs. Deterministic: a fixed pattern.
 * Linear HDR in, linear HDR out (inserted directly after the scene pass).
 */
export const DOF_TAPS = 24;

export interface DepthOfFieldParameters {
  focus: number;
  aperture: number;
  maxblur: number;
}

/** Options beyond BokehPass's response (ULTRA replay lens). */
export interface DepthOfFieldOptions {
  /** Gather taps (24 is the photo/broadcast default). */
  taps?: number;
  /** Thin-lens circle of confusion: `lensK · (1 - focus / depth)` (uniform `lensK`). */
  thinLens?: boolean;
}

const dofFragment = (taps: number, thinLens: boolean) => /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float focus;
uniform float aperture;
uniform float maxblur;
varying vec2 vUv;
float viewDepth(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
}
${
  thinLens
    ? `uniform float lensK;
// Signed thin-lens circle of confusion, in screen-height units.
float circle(float depth) {
  return clamp(lensK * (1.0 - focus / max(depth, 1e-3)), -maxblur, maxblur);
}`
    : `// Signed circle of confusion, in screen-height units (BokehPass response).
float circle(float depth) {
  return clamp((depth - focus) * aperture, -maxblur, maxblur);
}`
}
void main() {
  vec3 centre = texture2D(tColor, vUv).rgb;
  float c0 = circle(viewDepth(vUv));
  float radius = abs(c0) * resolution.y;
  if (radius < 0.5) {
    gl_FragColor = vec4(centre, 1.0);
    return;
  }
  vec2 pixel = 1.0 / resolution;
  vec3 sum = centre;
  float weight = 1.0;
  for (int i = 0; i < ${taps}; i++) {
    float r = sqrt((float(i) + 0.5) / ${taps}.0) * radius;
    float a = float(i) * 2.39996323;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * pixel;
    float cs = abs(circle(viewDepth(uv))) * resolution.y;
    // A tap counts where its own circle reaches the centre; nearer, blurred
    // taps (foreground) always do.
    float w = clamp(cs - r + 1.0, 0.0, 1.0) * (0.5 + 0.5 * clamp(cs / max(radius, 1.0), 0.0, 1.0));
    sum += texture2D(tColor, uv).rgb * w;
    weight += w;
  }
  gl_FragColor = vec4(sum / weight, 1.0);
}`;

export class DepthOfFieldPass extends Pass {
  /** Named as BokehPass's for the photo controls and diagnostics. */
  readonly materialBokeh: T.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  constructor(
    private readonly camera: T.PerspectiveCamera,
    parameters: DepthOfFieldParameters,
    depth: T.DepthTexture,
    options: DepthOfFieldOptions = {},
  ) {
    super();
    const taps = Math.round(options.taps ?? DOF_TAPS);
    if (!(taps >= 8 && taps <= 96)) throw new Error('Invalid depth-of-field tap count');
    this.materialBokeh = new T.ShaderMaterial({
      name: 'APEX depth of field',
      uniforms: {
        tColor: { value: null },
        tDepth: { value: depth },
        resolution: { value: new T.Vector2(1, 1) },
        cameraNear: { value: camera.near },
        cameraFar: { value: camera.far },
        focus: { value: parameters.focus },
        aperture: { value: parameters.aperture },
        maxblur: { value: parameters.maxblur },
        ...(options.thinLens ? { lensK: { value: 0 } } : {}),
      },
      vertexShader:
        'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: dofFragment(taps, !!options.thinLens),
      depthTest: false,
      depthWrite: false,
      blending: T.NoBlending,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.materialBokeh);
  }
  /** Current focus distance (metres along the optical axis). */
  get focus(): number {
    return this.materialBokeh.uniforms.focus.value;
  }
  override setSize(width: number, height: number) {
    this.materialBokeh.uniforms.resolution.value.set(Math.max(1, width), Math.max(1, height));
  }
  override render(
    renderer: T.WebGLRenderer,
    writeBuffer: T.WebGLRenderTarget,
    readBuffer: T.WebGLRenderTarget,
  ) {
    const u = this.materialBokeh.uniforms;
    u.tColor.value = readBuffer.texture;
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose() {
    this.materialBokeh.dispose();
    this.quad.dispose();
  }
}
