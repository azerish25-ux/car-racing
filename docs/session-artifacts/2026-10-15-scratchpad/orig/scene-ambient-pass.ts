import * as T from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { MotionBlur } from './motion-blur.ts';
import { MOTION_BLUR, MOTION_VELOCITY_GLSL, createMotionUniforms } from './studio/velocity.ts';
import { TemporalAA } from './studio/temporal-aa.ts';

/** Scalable ambient obscurance tuning. World-space radius in metres; the screen
 * radius is clamped so a cockpit surface 30 cm from the eye cannot black out.
 * Obscurance also fades out in the near field (nearStart..nearEnd metres from
 * the eye). The composite multiplies the lit colour, direct sunlight included,
 * and close to the eye the clamped kernel spans a large solid angle, so gloves,
 * wheel and chassis tens of centimetres apart read as deep crevices: the
 * cockpit interior went near-black. Sun shadows and the environment light
 * still shade it. */
export interface AmbientOcclusionSettings {
  radius: number;
  intensity: number;
  bias: number;
  maxPixels: number;
  fadeStart: number;
  fadeEnd: number;
  nearStart: number;
  nearEnd: number;
}
export const AMBIENT_OCCLUSION: Readonly<AmbientOcclusionSettings> = Object.freeze({
  radius: 0.9,
  intensity: 1.15,
  bias: 0.012,
  maxPixels: 72,
  fadeStart: 90,
  fadeEnd: 220,
  nearStart: 0.9,
  nearEnd: 2.2,
});

/** Contact-shadow key light response (see `syncCamera`). */
export const CONTACT_SUN = Object.freeze({
  ratioPerIntensity: 2.5,
  minIntensity: 0.6,
  fullIntensity: 1.8,
});
/** GTAO slices: 3 with 4x multisampling (High), else 2 (Medium); 6 steps each. */
export function gtaoSlices(samples: number) {
  return samples >= 4 ? 3 : 2;
}
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Half-resolution obscurance buffer; never below one pixel. */
export function obscuranceSize(width: number, height: number) {
  if (![width, height].every(Number.isFinite)) throw new Error('Invalid obscurance size');
  return {
    width: Math.max(1, Math.ceil(Math.max(1, width) / 2)),
    height: Math.max(1, Math.ceil(Math.max(1, height) / 2)),
  };
}

const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const viewPosition = /* glsl */ `
  #include <packing>
  uniform sampler2D tDepth;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform vec2 projectionScale;
  float sceneDepth(vec2 uv) { return texture2D(tDepth, uv).x; }
  float viewZAt(vec2 uv) { return perspectiveDepthToViewZ(sceneDepth(uv), cameraNear, cameraFar); }
  vec3 viewAtZ(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * -z / projectionScale, z); }
  vec3 viewAt(vec2 uv) { return viewAtZ(uv, viewZAt(uv)); }
`;
/** Interleaved gradient noise: stable per pixel, never wall-clock animated. */
const interleavedNoise = /* glsl */ `
  float interleavedNoise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
  }
`;
/** Ground-truth ambient occlusion (Jimenez et al. 2016) at half resolution:
 * GTAO_SLICES screen-space slices of 6 horizon steps per side, rotated per
 * pixel by interleaved gradient noise, the cosine-weighted horizon integral
 * against the depth-reconstructed normal, and the multi-bounce fit for an
 * albedo of 0.3 (dark occluders still return some light). Writes
 * R = ambient visibility, G = sun contact visibility, B = direct-light share.
 *
 * Contact shadows: 12 steps over 0.3 m from the surface toward the view-space
 * sun; a depth sample in front of the ray (within a thickness) is a small
 * occluder the shadow map is too coarse to resolve (tyre contact, wing
 * elements, kerb and barrier steps). The direct share is the sun's part of a
 * Lambertian surface's light, d / (d + 1) with d = sunRatio·N·L·V, where V is
 * the key light's own shadow-map visibility: a pixel the shadow map already
 * shades has no direct light left to remove, so shadows never double up. */
const obscuranceFragment = /* glsl */ `
  ${viewPosition}
  ${interleavedNoise}
  uniform vec2 resolution;
  uniform float radius;
  uniform float intensity;
  uniform float bias;
  uniform float maxPixels;
  uniform float fadeStart;
  uniform float fadeEnd;
  uniform float nearStart;
  uniform float nearEnd;
  uniform vec3 sunView;
  uniform float sunRatio;
  uniform sampler2D sunShadowMap;
  uniform mat4 sunShadowMatrix;
  uniform vec2 sunShadowTexel;
  uniform float sunShadowBias;
  uniform float sunShadowed;
  varying vec2 vUv;
  #ifndef GTAO_SLICES
    #define GTAO_SLICES 2
  #endif
  #define GTAO_STEPS 6
  #define CONTACT_STEPS 12
  #define CONTACT_LENGTH 0.3
  #define HALF_PI 1.5707963
  #define PI 3.1415927
  float horizonVisibility(vec3 p, vec3 n, float worldRadius, float pixels, float noise, float jitter) {
    vec3 v = normalize(-p);
    vec2 texel = 1.0 / resolution;
    // Samples beyond the radius fade to the lowest horizon (no occlusion).
    float falloffRange = 0.615 * worldRadius;
    float falloffMul = -1.0 / falloffRange;
    float falloffAdd = (worldRadius - falloffRange) / falloffRange + 1.0;
    float minimum = 1.3 / pixels;
    float visibility = 0.0;
    for (int slice = 0; slice < GTAO_SLICES; slice++) {
      float phi = (float(slice) + noise) * PI / float(GTAO_SLICES);
      vec2 omega = vec2(cos(phi), sin(phi));
      vec3 direction = vec3(omega, 0.0);
      vec3 ortho = direction - dot(direction, v) * v;
      vec3 axis = normalize(cross(ortho, v));
      vec3 projected = n - axis * dot(n, axis);
      float projectedLength = length(projected);
      float cosNormal = clamp(dot(projected, v) / max(projectedLength, 1e-4), -1.0, 1.0);
      float normalAngle = (dot(ortho, projected) < 0.0 ? -1.0 : 1.0) * acos(cosNormal);
      float lowPositive = cos(normalAngle + HALF_PI), lowNegative = cos(normalAngle - HALF_PI);
      float horizonPositive = lowPositive, horizonNegative = lowNegative;
      for (int step = 0; step < GTAO_STEPS; step++) {
        float s = (float(step) + jitter) / float(GTAO_STEPS);
        vec2 offset = omega * ((s * s + minimum) * pixels);
        offset = floor(offset + 0.5) * texel;
        vec3 a = viewAt(vUv + offset) - p, b = viewAt(vUv - offset) - p;
        float la = length(a), lb = length(b);
        float ha = mix(lowPositive, dot(a, v) / max(la, 1e-5), clamp(la * falloffMul + falloffAdd, 0.0, 1.0));
        float hb = mix(lowNegative, dot(b, v) / max(lb, 1e-5), clamp(lb * falloffMul + falloffAdd, 0.0, 1.0));
        horizonPositive = max(horizonPositive, ha);
        horizonNegative = max(horizonNegative, hb);
      }
      float h0 = -acos(clamp(horizonNegative, -1.0, 1.0));
      float h1 = acos(clamp(horizonPositive, -1.0, 1.0));
      h0 = normalAngle + max(h0 - normalAngle, -HALF_PI);
      h1 = normalAngle + min(h1 - normalAngle, HALF_PI);
      float sinNormal = sin(normalAngle);
      float arc0 = cosNormal + 2.0 * h0 * sinNormal - cos(2.0 * h0 - normalAngle);
      float arc1 = cosNormal + 2.0 * h1 * sinNormal - cos(2.0 * h1 - normalAngle);
      visibility += projectedLength * 0.25 * (arc0 + arc1);
    }
    return clamp(visibility / float(GTAO_SLICES), 0.0, 1.0);
  }
  float multiBounce(float visibility) {
    // Jimenez 2016 fit, albedo 0.3: a = 2.0404·ρ - 0.3324, b = -4.7951·ρ + 0.6417, c = 2.7552·ρ + 0.6903.
    float a = 0.27972, b = -0.79683, c = 1.51686;
    return max(visibility, ((visibility * a + b) * visibility + c) * visibility);
  }
  /** Key-light shadow-map visibility (2x2 PCF), 1 outside the map. */
  float sunVisibility(vec3 p, vec3 n) {
    if (sunShadowed < 0.5) return 1.0;
    vec4 coord = sunShadowMatrix * vec4(p + n * (0.03 + 0.002 * -p.z), 1.0);
    coord.xyz /= coord.w;
    if (coord.x < 0.0 || coord.y < 0.0 || coord.x > 1.0 || coord.y > 1.0 || coord.z > 1.0) return 1.0;
    float compare = coord.z + sunShadowBias, lit = 0.0;
    for (int j = 0; j < 2; j++)
      for (int i = 0; i < 2; i++) {
        vec2 offset = (vec2(float(i), float(j)) - 0.5) * sunShadowTexel;
        lit += step(compare, unpackRGBAToDepth(texture2D(sunShadowMap, coord.xy + offset)));
      }
    return lit * 0.25;
  }
  float contactVisibility(vec3 p, vec3 n, float noise) {
    float depth = -p.z;
    float fade = smoothstep(nearStart, nearEnd, depth) * (1.0 - smoothstep(25.0, 40.0, depth));
    if (fade <= 0.0) return 1.0;
    vec3 origin = p + n * (0.003 * depth);
    float occlusion = 0.0;
    for (int i = 0; i < CONTACT_STEPS; i++) {
      float t = (float(i) + noise) / float(CONTACT_STEPS);
      vec3 q = origin + sunView * (CONTACT_LENGTH * t);
      if (q.z > -cameraNear) break;
      vec2 uv = q.xy * projectionScale / -q.z * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
      float ahead = -q.z + viewZAt(uv);
      float epsilon = 0.015 + 0.004 * -q.z;
      float thickness = 0.25 + 0.015 * -q.z;
      float hit = smoothstep(epsilon, 2.0 * epsilon, ahead) * (1.0 - smoothstep(0.6 * thickness, thickness, ahead));
      // Occluders further along the ray leave a lighter, wider penumbra.
      occlusion = max(occlusion, hit * (1.0 - 0.45 * t));
    }
    return 1.0 - occlusion * fade;
  }
  void main() {
    float depth = sceneDepth(vUv);
    if (depth >= 0.99999) { gl_FragColor = vec4(1.0); return; }
    vec3 p = viewAt(vUv);
    vec2 texel = 1.0 / resolution;
    // Reconstruct the facet normal from the least-discontinuous neighbours so
    // silhouettes against distant scenery do not produce halo normals.
    vec3 pr = viewAt(vUv + vec2(texel.x, 0.0)), pl = viewAt(vUv - vec2(texel.x, 0.0));
    vec3 pu = viewAt(vUv + vec2(0.0, texel.y)), pd = viewAt(vUv - vec2(0.0, texel.y));
    vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
    vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
    vec3 n = normalize(cross(dx, dy));
    if (dot(n, p) > 0.0) n = -n;
    vec2 pixel = floor(vUv * resolution);
    float noise = interleavedNoise(pixel);
    float jitter = interleavedNoise(pixel + vec2(5.0, 11.0));
    float ao = 1.0;
    float distanceFade = (1.0 - smoothstep(fadeStart, fadeEnd, -p.z)) * smoothstep(nearStart, nearEnd, -p.z);
    // Near surfaces shrink their world radius; distant ones keep it.
    float worldRadius = min(radius, max(0.06, -p.z * 0.35));
    float pixels = min(maxPixels, worldRadius * projectionScale.y * resolution.y * 0.5 / -p.z);
    if (distanceFade > 0.0 && pixels >= 1.0) {
      // Step off the surface in proportion to depth: float depth precision.
      vec3 origin = p + n * (bias * 0.25 * -p.z);
      float visibility = pow(horizonVisibility(origin, n, worldRadius, pixels, noise, jitter), intensity);
      ao = mix(1.0, multiBounce(visibility), distanceFade);
    }
    float direct = sunRatio > 0.0 ? max(dot(n, sunView), 0.0) * sunRatio : 0.0;
    if (direct > 0.0) direct *= sunVisibility(p, n);
    float contact = direct > 0.02 ? contactVisibility(p, n, jitter) : 1.0;
    gl_FragColor = vec4(ao, contact, direct / (direct + 1.0), 1.0);
  }
`;
const blurFragment = /* glsl */ `
  ${viewPosition}
  uniform sampler2D tObscurance;
  uniform vec2 direction;
  varying vec2 vUv;
  void main() {
    float z = viewZAt(vUv);
    vec3 sum = texture2D(tObscurance, vUv).rgb;
    float weight = 1.0;
    float tolerance = max(0.05, -z * 0.04);
    for (int i = -3; i <= 3; i++) {
      if (i == 0) continue;
      vec2 uv = vUv + direction * float(i);
      float w = exp(-float(i * i) / 8.0) * (1.0 - smoothstep(0.0, tolerance, abs(viewZAt(uv) - z)));
      sum += texture2D(tObscurance, uv).rgb * w;
      weight += w;
    }
    gl_FragColor = vec4(sum / weight, 1.0);
  }
`;
/** Camera motion blur gathered from the scene's own colour and depth. The
 * centre's streak is sampled symmetrically (shutter centred on the frame) with
 * per-pixel jittered taps. A tap clearly nearer than the centre surface,
 * extrapolated along the streak in inverse depth (affine in screen space on a
 * plane), is a sharp foreground occluder and is skipped, so the locked player
 * car is never dragged over the road and grazing road keeps its full streak. */
const motionGather = /* glsl */ `
  ${MOTION_VELOCITY_GLSL}
  #define MOTION_TAPS ${MOTION_BLUR.taps}
  vec3 motionBlur(vec3 base, vec2 uv, float depthZ, vec2 streak, vec2 resolution) {
    float len = length(streak);
    if (len < 0.5) return base;
    if (len > motionMaxPixels) { streak *= motionMaxPixels / len; len = motionMaxPixels; }
    vec2 dir = streak / len;
    vec2 texel = 1.0 / resolution;
    float wc = 1.0 / depthZ;
    float wf = -1.0 / viewZAt(uv + dir * texel), wb = -1.0 / viewZAt(uv - dir * texel);
    float slope = abs(wf - wc) < abs(wc - wb) ? wf - wc : wc - wb;
    float jitter = interleavedNoise(floor(uv * resolution)) - 0.5;
    vec3 sum = base;
    float weight = 1.0;
    for (int i = 0; i < MOTION_TAPS; i++) {
      float s = ((float(i) + 0.5 + jitter) / float(MOTION_TAPS) - 0.5) * len;
      vec2 tap = uv + dir * (s * texel);
      if (tap.x < 0.0 || tap.y < 0.0 || tap.x > 1.0 || tap.y > 1.0) continue;
      float expected = max(wc + slope * s, 1e-7);
      if (-1.0 / viewZAt(tap) > expected * 1.06 + 1e-5) continue;
      sum += texture2D(tColor, tap).rgb;
      weight += 1.0;
    }
    return sum / weight;
  }
`;
const compositeFragment = /* glsl */ `
  ${viewPosition}
  uniform sampler2D tColor;
  uniform sampler2D tObscurance;
  uniform vec2 obscuranceResolution;
  uniform vec2 colorResolution;
  uniform float enabled;
  varying vec2 vUv;
  ${interleavedNoise}
  ${motionGather}
  void main() {
    vec4 color = texture2D(tColor, vUv);
    #ifdef MOTION_DEBUG_VELOCITY
      // Test oracle: unclamped streak (uv units), linear depth, geometry mask.
      float debugZ = viewZAt(vUv);
      vec2 debugStreak = motionActive > 0.5 ? motionPixels(viewAtZ(vUv, debugZ), colorResolution) : vec2(0.0);
      gl_FragColor = vec4(debugStreak / colorResolution, -debugZ, sceneDepth(vUv) < 0.99999 ? 1.0 : 0.0);
      return;
    #endif
    // Low (no AO, no blur) stays a plain copy: no depth read.
    if (motionActive < 0.5 && enabled < 0.5) { gl_FragColor = color; return; }
    float z = viewZAt(vUv);
    if (motionActive > 0.5)
      color.rgb = motionBlur(color.rgb, vUv, -z, motionPixels(viewAtZ(vUv, z), colorResolution), colorResolution);
    if (enabled < 0.5) { gl_FragColor = color; return; }
    // Joint-bilateral upsample: prefer half-resolution texels on the same surface.
    vec2 grid = vUv * obscuranceResolution - 0.5;
    vec2 base = floor(grid), f = grid - base;
    vec3 sum = vec3(0.0);
    float weight = 0.0;
    for (int j = 0; j < 2; j++)
      for (int i = 0; i < 2; i++) {
        vec2 uv = (base + vec2(float(i), float(j)) + 0.5) / obscuranceResolution;
        float bilinear = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
        float w = bilinear / (0.002 + abs(viewZAt(uv) - z) / max(0.1, -z));
        sum += texture2D(tObscurance, uv).rgb * w;
        weight += w;
      }
    vec3 occlusion = weight > 0.0 ? sum / weight : vec3(1.0);
    float ao = occlusion.r, contact = occlusion.g, directShare = occlusion.b;
    // Obscurance occludes indirect light; very bright direct highlights keep more energy.
    float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb *= mix(ao, 1.0, clamp(luminance * 0.12, 0.0, 0.45));
    // Contact shadows remove only the sun's share of the light.
    color.rgb *= mix(1.0, contact, directShare);
    gl_FragColor = color;
  }
`;

/** The pass's fragment sources (read-only; tests and QA tooling inspect them). */
export const SCENE_AMBIENT_GLSL = Object.freeze({
  obscurance: obscuranceFragment,
  blur: blurFragment,
  composite: compositeFragment,
});

/** Renders the linear scene into an optionally multisampled target with a float
 * depth attachment, then composites half-resolution GTAO with sun contact
 * shadows (`attach(motion, sun)`'s light) and the depth-reprojected camera
 * motion blur (`MotionBlur`, when given).
 * It replaces RenderPass without a second geometry draw; with AO and blur off the
 * composite is a copy. */
export class SceneAmbientPass extends Pass {
  readonly target: T.WebGLRenderTarget;
  private obscurance: T.WebGLRenderTarget;
  private blurred: T.WebGLRenderTarget;
  private obscuranceMaterial: T.ShaderMaterial;
  private blurMaterial: T.ShaderMaterial;
  private compositeMaterial: T.ShaderMaterial;
  private quad = new FullScreenQuad();
  private width = 1;
  private height = 1;
  ambientOcclusion = true;
  frames = 0;
  private debugVelocity = false;
  private motion: MotionBlur | null = null;
  /** Temporal anti-aliasing (`temporalAA`); one extra quad only while active. */
  readonly temporal = new TemporalAA();
  /**
   * Late scene layer (vfx soft particles): called after the scene draw, with the
   * same (TAA-jittered) camera, before AO, TAA resolve and the composite. Draw
   * into `target` with `autoClear` off. With multisampling the scene's depth is
   * already resolved into `depth`, which can be sampled while drawing (no
   * feedback loop); without it (Low) `depth` is the attachment itself and must
   * not be sampled. Disable the shadow map update for any extra `render` call.
   */
  lateScene:
    | ((renderer: T.WebGLRenderer, target: T.WebGLRenderTarget, depth: T.DepthTexture) => void)
    | null = null;
  private sun: T.DirectionalLight | null = null;
  private readonly sunDirection = new T.Vector3();
  private readonly sunTarget = new T.Vector3();
  constructor(
    private scene: T.Scene,
    private camera: T.PerspectiveCamera,
    samples = 0,
    motion: MotionBlur | null = null,
    sun: T.DirectionalLight | null = null,
  ) {
    super();
    this.needsSwap = true;
    const depthTexture = new T.DepthTexture(1, 1, T.FloatType);
    depthTexture.minFilter = depthTexture.magFilter = T.NearestFilter;
    this.target = new T.WebGLRenderTarget(1, 1, {
      type: T.HalfFloatType,
      samples,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
    });
    this.target.texture.name = 'APEX linear scene (multisampled)';
    const small = () =>
      new T.WebGLRenderTarget(1, 1, {
        type: T.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: T.LinearFilter,
        magFilter: T.LinearFilter,
      });
    this.obscurance = small();
    this.blurred = small();
    const shared = () => ({
      tDepth: { value: depthTexture as T.Texture },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      projectionScale: { value: new T.Vector2(1, 1) },
    });
    const material = (name: string, fragmentShader: string, uniforms: Record<string, T.IUniform>) =>
      new T.ShaderMaterial({
        name,
        vertexShader: fullscreenVertex,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
        blending: T.NoBlending,
        toneMapped: false,
      });
    this.obscuranceMaterial = material('APEX scalable ambient obscurance', obscuranceFragment, {
      ...shared(),
      resolution: { value: new T.Vector2(1, 1) },
      radius: { value: AMBIENT_OCCLUSION.radius },
      intensity: { value: AMBIENT_OCCLUSION.intensity },
      bias: { value: AMBIENT_OCCLUSION.bias },
      maxPixels: { value: AMBIENT_OCCLUSION.maxPixels },
      fadeStart: { value: AMBIENT_OCCLUSION.fadeStart },
      fadeEnd: { value: AMBIENT_OCCLUSION.fadeEnd },
      nearStart: { value: AMBIENT_OCCLUSION.nearStart },
      nearEnd: { value: AMBIENT_OCCLUSION.nearEnd },
      sunView: { value: new T.Vector3(0, 1, 0) },
      sunRatio: { value: 0 },
      sunShadowMap: { value: null },
      sunShadowMatrix: { value: new T.Matrix4() },
      sunShadowTexel: { value: new T.Vector2(1, 1) },
      sunShadowBias: { value: 0 },
      sunShadowed: { value: 0 },
    });
    this.obscuranceMaterial.defines.GTAO_SLICES = gtaoSlices(samples);
    this.blurMaterial = material('APEX depth-aware obscurance blur', blurFragment, {
      ...shared(),
      tObscurance: { value: null },
      direction: { value: new T.Vector2(1, 0) },
    });
    this.compositeMaterial = material('APEX obscurance composite', compositeFragment, {
      ...shared(),
      tColor: { value: this.target.texture },
      tObscurance: { value: this.blurred.texture },
      obscuranceResolution: { value: new T.Vector2(1, 1) },
      colorResolution: { value: new T.Vector2(1, 1) },
      enabled: { value: 1 },
      ...(createMotionUniforms() as unknown as Record<string, T.IUniform>),
    });
    this.attach(motion, sun);
  }
  /** Gather the camera motion blur in the composite (the controller's uniform
   * objects are bound by identity; it writes them once per frame), and cast
   * contact shadows from `sun`, the key directional light. */
  attach(motion: MotionBlur | null, sun: T.DirectionalLight | null = this.sun) {
    this.sun = sun;
    if (!motion || motion === this.motion) return;
    this.motion = motion;
    Object.assign(this.compositeMaterial.uniforms, motion.uniforms);
    motion.setSize(this.width, this.height);
  }
  get samples() {
    return this.target.samples;
  }
  setSamples(samples: number) {
    if (samples === this.target.samples) return;
    // Sample count is immutable per framebuffer; release it so Three re-creates it.
    this.target.samples = samples;
    this.target.dispose();
    const slices = gtaoSlices(samples);
    if (this.obscuranceMaterial.defines.GTAO_SLICES !== slices) {
      this.obscuranceMaterial.defines.GTAO_SLICES = slices;
      this.obscuranceMaterial.needsUpdate = true;
    }
  }
  override setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.target.setSize(this.width, this.height);
    const small = obscuranceSize(this.width, this.height);
    this.obscurance.setSize(small.width, small.height);
    this.blurred.setSize(small.width, small.height);
    this.obscuranceMaterial.uniforms.resolution.value.set(small.width, small.height);
    this.compositeMaterial.uniforms.obscuranceResolution.value.set(small.width, small.height);
    this.compositeMaterial.uniforms.colorResolution.value.set(this.width, this.height);
    this.motion?.setSize(this.width, this.height);
    this.temporal.setSize(this.width, this.height);
  }
  /** Test and QA oracle: the composite writes (streak uv, linear depth, geometry)
   * instead of colour. Needs a float output target. */
  setDebugVelocity(value: boolean) {
    if (value === this.debugVelocity) return;
    this.debugVelocity = value;
    if (value) this.compositeMaterial.defines.MOTION_DEBUG_VELOCITY = '';
    else delete this.compositeMaterial.defines.MOTION_DEBUG_VELOCITY;
    this.compositeMaterial.needsUpdate = true;
  }
  private syncCamera(shadows: boolean) {
    for (const m of [this.obscuranceMaterial, this.blurMaterial, this.compositeMaterial]) {
      m.uniforms.cameraNear.value = this.camera.near;
      m.uniforms.cameraFar.value = this.camera.far;
      m.uniforms.projectionScale.value.set(
        this.camera.projectionMatrix.elements[0],
        this.camera.projectionMatrix.elements[5],
      );
    }
    // Contact shadows: the view-space direction toward the key light and the
    // direct:ambient irradiance ratio of a sunlit surface (lit:shadow ≈ 10:1 on
    // a clear day at sun 3.9). Weak keys (night moon, overcast) cast none.
    const u = this.obscuranceMaterial.uniforms;
    const sun = this.sun;
    if (!sun) {
      u.sunRatio.value = 0;
      return;
    }
    this.sunDirection.setFromMatrixPosition(sun.matrixWorld);
    this.sunTarget.setFromMatrixPosition(sun.target.matrixWorld);
    this.sunDirection.sub(this.sunTarget);
    const elevation = this.sunDirection.lengthSq() > 0 ? this.sunDirection.normalize().y : -1;
    const strength =
      smoothstep(CONTACT_SUN.minIntensity, CONTACT_SUN.fullIntensity, sun.intensity) *
      smoothstep(-0.02, 0.06, elevation);
    u.sunRatio.value = CONTACT_SUN.ratioPerIntensity * sun.intensity * strength;
    u.sunView.value.copy(this.sunDirection).transformDirection(this.camera.matrixWorldInverse);
    // The key light's shadow map, rendered by this frame's scene draw. With
    // shadow mapping off (shadowSize 0) the scene has no sun shadows, and a
    // map left from an earlier quality is stale: every pixel counts as lit.
    const map = shadows && sun.castShadow ? sun.shadow.map?.texture : undefined;
    u.sunShadowed.value = map ? 1 : 0;
    u.sunShadowMap.value = map ?? null;
    if (map) {
      u.sunShadowMatrix.value.multiplyMatrices(sun.shadow.matrix, this.camera.matrixWorld);
      u.sunShadowTexel.value.set(1 / map.image.width, 1 / map.image.height);
      u.sunShadowBias.value = sun.shadow.bias;
    }
  }
  override render(renderer: T.WebGLRenderer, writeBuffer: T.WebGLRenderTarget) {
    const autoClear = renderer.autoClear;
    try {
      renderer.autoClear = true;
      renderer.setRenderTarget(this.target);
      // High opt-in TAA: sub-pixel jitter for the scene draw only.
      this.temporal.begin(this.camera, this.motion?.live ?? true);
      try {
        renderer.render(this.scene, this.camera);
        this.lateScene?.(renderer, this.target, this.target.depthTexture!);
      } finally {
        this.temporal.end(this.camera);
      }
      const depth = this.target.depthTexture!;
      this.compositeMaterial.uniforms.tColor.value = this.temporal.resolve(
        renderer,
        this.camera,
        this.target.texture,
        depth,
      );
      const occlude = this.ambientOcclusion;
      // The composite reconstructs depth for the motion blur even without AO.
      this.syncCamera(renderer.shadowMap?.enabled !== false);
      if (occlude) {
        this.quad.material = this.obscuranceMaterial;
        renderer.setRenderTarget(this.obscurance);
        this.quad.render(renderer);
        const small = this.obscuranceMaterial.uniforms.resolution.value as T.Vector2;
        this.quad.material = this.blurMaterial;
        this.blurMaterial.uniforms.tObscurance.value = this.obscurance.texture;
        this.blurMaterial.uniforms.direction.value.set(1 / small.x, 0);
        renderer.setRenderTarget(this.blurred);
        this.quad.render(renderer);
        this.blurMaterial.uniforms.tObscurance.value = this.blurred.texture;
        this.blurMaterial.uniforms.direction.value.set(0, 1 / small.y);
        renderer.setRenderTarget(this.obscurance);
        this.quad.render(renderer);
        this.compositeMaterial.uniforms.tObscurance.value = this.obscurance.texture;
      }
      this.compositeMaterial.uniforms.enabled.value = occlude ? 1 : 0;
      this.quad.material = this.compositeMaterial;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this.quad.render(renderer);
      // Oracle reads are not presented frames.
      if (!this.debugVelocity) this.motion?.rendered();
      this.frames++;
    } finally {
      renderer.autoClear = autoClear;
    }
  }
  diagnostics() {
    return {
      samples: this.target.samples,
      ambientOcclusion: this.ambientOcclusion,
      width: this.width,
      height: this.height,
      obscuranceWidth: this.obscurance.width,
      obscuranceHeight: this.obscurance.height,
      frames: this.frames,
      motionBlur: !!this.motion?.enabled,
      temporalAA: this.temporal.diagnostics(),
    };
  }
  override dispose() {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.obscurance.dispose();
    this.blurred.dispose();
    this.obscuranceMaterial.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quad.dispose();
    this.temporal.dispose();
  }
}
