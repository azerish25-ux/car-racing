import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RIPPLE_GLSL } from '../materials/ripples.ts';
import { studioUniforms } from '../studio/studio-frame.ts';
import { halton } from '../studio/temporal-aa.ts';
import { SSR_DECODE_GLSL, SSR_MASK, ssrMaskUniforms } from './ssr-mask.ts';

/**
 * Hierarchical-depth screen-space reflections (ULTRA `ssr`).
 *
 * Runs inside the scene pass, after the (jittered) scene draw and before the
 * temporal resolve, so TAA accumulates the stochastic reflection rays.
 *
 *  1. Hi-Z: a conservative closest-depth pyramid of the raw depth buffer
 *     (HIZ.levels separate R32F targets, level 0 at half resolution). Raw
 *     perspective depth is affine in screen space, so a ray is a straight line
 *     in (u, v, depth) and each level can skip whole cells it cannot hit.
 *  2. Trace (half resolution): for every pixel whose material opted into the
 *     SSR mask (ssr-mask.ts: roughness in the scene alpha), a GGX-importance-
 *     sampled reflection direction about the depth-reconstructed normal (rain
 *     ripples perturb upward water films) is marched through the pyramid
 *     (Uludag, "Hi-Z Screen-Space Cone-Traced Reflections", GPU Pro 5). Hits
 *     are thickness-tested; confidence fades at screen edges, for rays toward
 *     the camera, near the iteration limit and with roughness.
 *  3. Resolve (full resolution): the four nearest traced rays are reused with
 *     depth-aware weights (Stachowiak, "Stochastic Screen-Space Reflections",
 *     2015), the hit radiance is firefly-limited, and the reflection replaces
 *     the environment probe's share by Schlick-roughness Fresnel and confidence:
 *     out = scene + F · c · (ssr − probe). Where c = 0 the probe stands.
 *
 * Deterministic: ray noise is interleaved-gradient per pixel and advances with
 * the TAA jitter index only on frames TAA resolves; held frames trace the same
 * rays. Needs EXT_color_buffer_float (R32F); without it the stage reports
 * unsupported and the renderer keeps its probe and planar reflections.
 */
export const HIZ = Object.freeze({
  levels: 6,
});
export const SSR = Object.freeze({
  maxIterations: 56,
  /** View-space ray length, metres. */
  maxDistance: 260,
  /** Thickness of a hit surface: base + share of its distance, metres. */
  thickness: 0.4,
  thicknessPerMetre: 0.03,
  /** Screen-edge fade width (uv). */
  edgeFade: 0.06,
  /** Linear HDR ceiling of reflected radiance (firefly limit). */
  radianceLimit: 48,
  /** Truncation of the GGX lobe's tail (lower variance, slight bias). */
  lobeBias: 0.7,
  /** Water/varnish F0. */
  f0: 0.04,
});

/** Hi-Z level sizes: level 0 is ceil(size / 2), each next level ceil(previous / 2). */
export function hizLevelSizes(width: number, height: number, levels: number = HIZ.levels) {
  if (!(width >= 1 && height >= 1) || !Number.isInteger(levels) || levels < 1)
    throw new Error('Invalid Hi-Z size');
  const out: { width: number; height: number }[] = [];
  let w = Math.ceil(width / 2),
    h = Math.ceil(height / 2);
  for (let i = 0; i < levels; i++) {
    out.push({ width: w, height: h });
    w = Math.max(1, Math.ceil(w / 2));
    h = Math.max(1, Math.ceil(h / 2));
  }
  return out;
}

/** CPU reference pyramid (closest = minimum raw depth) of a row-major depth image. */
export function buildDepthPyramid(
  depth: Float32Array,
  width: number,
  height: number,
  levels: number = HIZ.levels,
) {
  if (depth.length !== width * height) throw new Error('Depth image size mismatch');
  const sizes = hizLevelSizes(width, height, levels);
  const out: { width: number; height: number; data: Float32Array }[] = [];
  let source = { width, height, data: depth };
  for (const size of sizes) {
    const data = new Float32Array(size.width * size.height);
    for (let y = 0; y < size.height; y++)
      for (let x = 0; x < size.width; x++)
        data[y * size.width + x] = reduceCell(source, size, x, y);
    out.push({ ...size, data });
    source = out[out.length - 1];
  }
  return out;
}
/** Conservative reduce: every source texel whose area overlaps the target texel. */
function reduceCell(
  source: { width: number; height: number; data: Float32Array },
  target: { width: number; height: number },
  x: number,
  y: number,
) {
  const x0 = Math.floor((x * source.width) / target.width),
    x1 = Math.min(source.width - 1, Math.ceil(((x + 1) * source.width) / target.width) - 1);
  const y0 = Math.floor((y * source.height) / target.height),
    y1 = Math.min(source.height - 1, Math.ceil(((y + 1) * source.height) / target.height) - 1);
  let m = Infinity;
  for (let j = y0; j <= y1; j++)
    for (let i = x0; i <= x1; i++) m = Math.min(m, source.data[j * source.width + i]);
  return m;
}

export interface HizHit {
  hit: boolean;
  u: number;
  v: number;
  depth: number;
  iterations: number;
}
/**
 * CPU reference of the shader's Hi-Z traversal. `origin` and `direction` are in
 * (u, v, raw depth) with direction spanning the whole ray (t in [0, 1]).
 */
export function traceHiz(
  pyramid: readonly { width: number; height: number; data: Float32Array }[],
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  maxIterations: number = SSR.maxIterations,
): HizHit {
  const d = [
    Math.abs(direction[0]) < 1e-7 ? (direction[0] < 0 ? -1e-7 : 1e-7) : direction[0],
    Math.abs(direction[1]) < 1e-7 ? (direction[1] < 0 ? -1e-7 : 1e-7) : direction[1],
    direction[2],
  ];
  const o = origin;
  const step = [d[0] >= 0 ? 1 : 0, d[1] >= 0 ? 1 : 0];
  const offset = [(d[0] >= 0 ? 1 : -1) * 1e-5, (d[1] >= 0 ? 1 : -1) * 1e-5];
  const at = (t: number): [number, number, number] => [
    o[0] + d[0] * t,
    o[1] + d[1] * t,
    o[2] + d[2] * t,
  ];
  const boundary = (cx: number, cy: number, w: number, h: number) => {
    const bx = (cx + step[0]) / w + offset[0],
      by = (cy + step[1]) / h + offset[1];
    return Math.min((bx - o[0]) / d[0], (by - o[1]) / d[1]);
  };
  const levels = pyramid.length;
  let level = 0;
  const p0 = pyramid[0];
  let ray = at(
    boundary(Math.floor(o[0] * p0.width), Math.floor(o[1] * p0.height), p0.width, p0.height),
  );
  let i = 0;
  for (; i < maxIterations; i++) {
    if (ray[0] < 0 || ray[1] < 0 || ray[0] > 1 || ray[1] > 1 || ray[2] <= 0 || ray[2] >= 1) break;
    const p = pyramid[level];
    const cx = Math.min(p.width - 1, Math.floor(ray[0] * p.width)),
      cy = Math.min(p.height - 1, Math.floor(ray[1] * p.height));
    const zmin = p.data[cy * p.width + cx];
    let next = ray;
    let crossed = false;
    if (zmin > ray[2]) {
      if (d[2] > 0) {
        next = at((zmin - o[2]) / d[2]);
        crossed = Math.floor(next[0] * p.width) !== cx || Math.floor(next[1] * p.height) !== cy;
      } else crossed = true;
    }
    if (crossed) {
      next = at(boundary(cx, cy, p.width, p.height));
      level = Math.min(levels - 1, level + 2);
    }
    ray = next;
    level--;
    if (level < 0) return { hit: true, u: ray[0], v: ray[1], depth: ray[2], iterations: i + 1 };
  }
  return { hit: false, u: ray[0], v: ray[1], depth: ray[2], iterations: i };
}

/** Schlick Fresnel with the roughness-aware F90 (Fdez-Agüera 2019 approximation). */
export function fresnelRoughness(cosTheta: number, roughness: number, f0: number = SSR.f0) {
  const c = Math.min(Math.max(cosTheta, 0), 1);
  const f90 = Math.max(1 - roughness, f0);
  return f0 + (f90 - f0) * (1 - c) ** 5;
}
/** GGX half-vector sample (tangent space, +Z normal) for uniform `u1`, `u2`. */
export function sampleGgx(roughness: number, u1: number, u2: number) {
  const a = Math.max(roughness * roughness, 1e-4);
  const xi = u2 * SSR.lobeBias;
  const cosTheta = Math.sqrt((1 - xi) / (1 + (a * a - 1) * xi));
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = 2 * Math.PI * u1;
  return [sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), cosTheta] as const;
}
/** Per-frame stratified ray seed (Halton 2,3 on the TAA jitter index). */
export function raySeed(index: number) {
  const i = ((Math.floor(index) % 16) + 16) % 16;
  return [halton(i + 1, 2), halton(i + 1, 3)] as const;
}

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

/** Conservative 2x reduction of raw depth (closest = minimum); the target is
 * ceil(source / 2) on each axis, as hizLevelSizes. */
const hizFragment = /* glsl */ `
uniform sampler2D tSource;
varying vec2 vUv;
void main() {
	ivec2 target = ivec2( gl_FragCoord.xy );
	ivec2 sourceSize = textureSize( tSource, 0 );
	ivec2 targetSize = ( sourceSize + 1 ) / 2;
	// Every source texel overlapping this one (2, or 3 across an odd edge).
	ivec2 lo = ( target * sourceSize ) / targetSize;
	ivec2 hi = min( sourceSize - 1, ( ( target + 1 ) * sourceSize + targetSize - 1 ) / targetSize - 1 );
	float m = 1.0;
	for ( int j = 0; j < 3; j ++ )
		for ( int i = 0; i < 3; i ++ ) {
			ivec2 p = lo + ivec2( i, j );
			if ( p.x <= hi.x && p.y <= hi.y ) m = min( m, texelFetch( tSource, p, 0 ).x );
		}
	gl_FragColor = vec4( m, 0.0, 0.0, 1.0 );
}`;

const VIEW_GLSL = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform mat4 cameraProjection;
uniform mat4 cameraProjectionInverse;
uniform mat4 cameraWorld;
vec3 viewAtDepth( vec2 uv, float depth ) {
	vec4 clip = vec4( vec3( uv, depth ) * 2.0 - 1.0, 1.0 );
	vec4 view = cameraProjectionInverse * clip;
	return view.xyz / view.w;
}
float depthAt( vec2 uv ) { return texture2D( tDepth, uv ).x; }
vec3 viewNormal( vec2 uv, vec2 texel, vec3 p ) {
	vec3 pr = viewAtDepth( uv + vec2( texel.x, 0.0 ), depthAt( uv + vec2( texel.x, 0.0 ) ) );
	vec3 pl = viewAtDepth( uv - vec2( texel.x, 0.0 ), depthAt( uv - vec2( texel.x, 0.0 ) ) );
	vec3 pu = viewAtDepth( uv + vec2( 0.0, texel.y ), depthAt( uv + vec2( 0.0, texel.y ) ) );
	vec3 pd = viewAtDepth( uv - vec2( 0.0, texel.y ), depthAt( uv - vec2( 0.0, texel.y ) ) );
	vec3 dx = abs( pr.z - p.z ) < abs( p.z - pl.z ) ? pr - p : p - pl;
	vec3 dy = abs( pu.z - p.z ) < abs( p.z - pd.z ) ? pu - p : p - pd;
	vec3 n = normalize( cross( dx, dy ) );
	return dot( n, p ) > 0.0 ? - n : n;
}
float interleavedNoise( vec2 pixel ) {
	return fract( 52.9829189 * fract( dot( pixel, vec2( 0.06711056, 0.00583715 ) ) ) );
}`;

const traceFragment = /* glsl */ `
${VIEW_GLSL}
${SSR_DECODE_GLSL}
${RIPPLE_GLSL}
uniform sampler2D tColor;
uniform sampler2D tHiz0;
uniform sampler2D tHiz1;
uniform sampler2D tHiz2;
uniform sampler2D tHiz3;
uniform sampler2D tHiz4;
uniform sampler2D tHiz5;
uniform vec2 fullResolution;
uniform vec2 seed;
uniform float pixelOffset;
uniform float rain;
uniform float time;
varying vec2 vUv;
#define HIZ_LEVELS ${HIZ.levels}
#define MAX_ITERATIONS ${SSR.maxIterations}
float hizFetch( int level, vec2 cell ) {
	ivec2 c = ivec2( cell );
	if ( level == 0 ) return texelFetch( tHiz0, c, 0 ).x;
	if ( level == 1 ) return texelFetch( tHiz1, c, 0 ).x;
	if ( level == 2 ) return texelFetch( tHiz2, c, 0 ).x;
	if ( level == 3 ) return texelFetch( tHiz3, c, 0 ).x;
	if ( level == 4 ) return texelFetch( tHiz4, c, 0 ).x;
	return texelFetch( tHiz5, c, 0 ).x;
}
vec2 hizSize( int level ) {
	if ( level == 0 ) return vec2( textureSize( tHiz0, 0 ) );
	if ( level == 1 ) return vec2( textureSize( tHiz1, 0 ) );
	if ( level == 2 ) return vec2( textureSize( tHiz2, 0 ) );
	if ( level == 3 ) return vec2( textureSize( tHiz3, 0 ) );
	if ( level == 4 ) return vec2( textureSize( tHiz4, 0 ) );
	return vec2( textureSize( tHiz5, 0 ) );
}
vec3 project( vec3 view ) {
	vec4 clip = cameraProjection * vec4( view, 1.0 );
	return clip.xyz / clip.w * 0.5 + 0.5;
}
float boundaryT( vec3 o, vec3 d, vec2 cell, vec2 size, vec2 crossStep, vec2 crossOffset ) {
	vec2 boundary = ( cell + crossStep ) / size + crossOffset;
	vec2 delta = ( boundary - o.xy ) / d.xy;
	return min( delta.x, delta.y );
}
void main() {
	// One full-resolution pixel per 2x2 block, rotating with the jitter index.
	vec2 fullPixel = floor( gl_FragCoord.xy ) * 2.0 + vec2( mod( pixelOffset, 2.0 ), floor( pixelOffset / 2.0 ) );
	vec2 uv = ( min( fullPixel, fullResolution - 1.0 ) + 0.5 ) / fullResolution;
	vec4 scene = texture2D( tColor, uv );
	float roughness = apexSsrDecode( scene.a );
	float depth = depthAt( uv );
	if ( roughness > ${SSR_MASK.maxRoughness.toFixed(3)} || depth >= 0.99999 ) { gl_FragColor = vec4( 0.0 ); return; }
	vec2 texel = 1.0 / fullResolution;
	vec3 p = viewAtDepth( uv, depth );
	vec3 n = viewNormal( uv, texel, p );
	vec3 worldNormal = ( cameraWorld * vec4( n, 0.0 ) ).xyz;
	if ( rain > 0.001 && worldNormal.y > 0.8 ) {
		vec3 world = ( cameraWorld * vec4( p, 1.0 ) ).xyz;
		vec2 slope = apexRippleSlope( world.xz / 0.35, time ) * rain * 0.22;
		vec3 perturbed = normalize( worldNormal - vec3( slope.x, 0.0, slope.y ) );
		n = normalize( ( vec4( perturbed, 0.0 ) * cameraWorld ).xyz );
	}
	vec3 v = normalize( - p );
	// GGX half vector about n (tail-truncated), rotated per pixel.
	float noise = interleavedNoise( fullPixel );
	vec2 xi = fract( seed + vec2( noise, interleavedNoise( fullPixel + vec2( 19.0, 47.0 ) ) ) );
	float a = max( roughness * roughness, 1e-4 );
	float e = xi.y * ${SSR.lobeBias.toFixed(3)};
	float cosTheta = sqrt( ( 1.0 - e ) / ( 1.0 + ( a * a - 1.0 ) * e ) );
	float sinTheta = sqrt( max( 0.0, 1.0 - cosTheta * cosTheta ) );
	float phi = 6.2831853 * xi.x;
	vec3 up = abs( n.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
	vec3 tx = normalize( cross( up, n ) ), ty = cross( n, tx );
	vec3 h = normalize( tx * ( sinTheta * cos( phi ) ) + ty * ( sinTheta * sin( phi ) ) + n * cosTheta );
	vec3 r = reflect( - v, h );
	if ( dot( r, n ) <= 0.01 ) r = reflect( - v, n );
	// Clip the ray at the near plane.
	float len = ${SSR.maxDistance.toFixed(1)};
	if ( r.z > 0.0 ) len = min( len, ( - cameraNear * 1.01 - p.z ) / r.z );
	vec3 o = vec3( uv, depth );
	vec3 d = project( p + r * len ) - o;
	d.xy = vec2( abs( d.x ) < 1e-7 ? ( d.x < 0.0 ? -1e-7 : 1e-7 ) : d.x, abs( d.y ) < 1e-7 ? ( d.y < 0.0 ? -1e-7 : 1e-7 ) : d.y );
	vec2 crossStep = vec2( d.x >= 0.0 ? 1.0 : 0.0, d.y >= 0.0 ? 1.0 : 0.0 );
	vec2 crossOffset = vec2( d.x >= 0.0 ? 1.0 : -1.0, d.y >= 0.0 ? 1.0 : -1.0 ) * 1e-5;
	vec2 size0 = hizSize( 0 );
	vec3 ray = o + d * boundaryT( o, d, floor( o.xy * size0 ), size0, crossStep, crossOffset );
	int level = 0;
	bool hit = false;
	int iterations = 0;
	for ( int i = 0; i < MAX_ITERATIONS; i ++ ) {
		iterations = i;
		if ( ray.x < 0.0 || ray.y < 0.0 || ray.x > 1.0 || ray.y > 1.0 || ray.z <= 0.0 || ray.z >= 1.0 ) break;
		vec2 size = hizSize( level );
		vec2 cell = min( floor( ray.xy * size ), size - 1.0 );
		float zmin = hizFetch( level, cell );
		vec3 next = ray;
		bool crossed = false;
		if ( zmin > ray.z ) {
			if ( d.z > 0.0 ) {
				next = o + d * ( ( zmin - o.z ) / d.z );
				crossed = any( notEqual( floor( next.xy * size ), cell ) );
			} else crossed = true;
		}
		if ( crossed ) {
			next = o + d * boundaryT( o, d, cell, size, crossStep, crossOffset );
			level = min( HIZ_LEVELS - 1, level + 2 );
		}
		ray = next;
		level --;
		if ( level < 0 ) { hit = true; break; }
	}
	float confidence = 0.0;
	if ( hit ) {
		float surface = depthAt( ray.xy );
		float surfaceZ = - perspectiveDepthToViewZ( surface, cameraNear, cameraFar );
		float rayZ = - perspectiveDepthToViewZ( ray.z, cameraNear, cameraFar );
		float thickness = ${SSR.thickness.toFixed(3)} + ${SSR.thicknessPerMetre.toFixed(3)} * surfaceZ;
		bool valid = surface < 0.99999 && rayZ - surfaceZ < thickness;
		vec2 edge = smoothstep( vec2( 0.0 ), vec2( ${SSR.edgeFade.toFixed(3)} ), ray.xy ) * smoothstep( vec2( 0.0 ), vec2( ${SSR.edgeFade.toFixed(3)} ), 1.0 - ray.xy );
		float toward = 1.0 - smoothstep( 0.15, 0.6, r.z );
		float budget = 1.0 - smoothstep( 0.7, 1.0, float( iterations ) / float( MAX_ITERATIONS ) );
		float gloss = 1.0 - smoothstep( ${(SSR_MASK.maxRoughness * 0.6).toFixed(3)}, ${SSR_MASK.maxRoughness.toFixed(3)}, roughness );
		confidence = valid ? edge.x * edge.y * toward * budget * gloss : 0.0;
	}
	gl_FragColor = vec4( ray.xy, confidence, roughness );
}`;

const resolveFragment = /* glsl */ `
${VIEW_GLSL}
${SSR_DECODE_GLSL}
uniform sampler2D tColor;
uniform sampler2D tTrace;
uniform vec2 fullResolution;
uniform float environmentIntensity;
uniform float hasEnvironment;
// The followed car's local probe (when it owns the road and paint envMaps).
uniform samplerCube probeCube;
uniform float probeActive;
uniform float probeLod;
#ifdef ENVMAP_TYPE_CUBE_UV
uniform sampler2D envMap;
#endif
varying vec2 vUv;
${T.ShaderChunk.cube_uv_reflection_fragment}
vec3 limited( vec3 c ) {
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	if ( !( l < 65000.0 ) || !( l >= 0.0 ) ) return vec3( 0.0 );
	return c * ( ${SSR.radianceLimit.toFixed(1)} / max( l, ${SSR.radianceLimit.toFixed(1)} ) );
}
void main() {
	vec4 scene = texture2D( tColor, vUv );
	float roughness = apexSsrDecode( scene.a );
	float depth = depthAt( vUv );
	if ( roughness > ${SSR_MASK.maxRoughness.toFixed(3)} || depth >= 0.99999 ) { gl_FragColor = vec4( scene.rgb, 1.0 ); return; }
	vec2 texel = 1.0 / fullResolution;
	vec3 p = viewAtDepth( vUv, depth );
	vec3 n = viewNormal( vUv, texel, p );
	vec3 v = normalize( - p );
	float centreZ = - p.z;
	// Ray reuse: the four nearest half-resolution rays, depth-weighted.
	vec2 traceSize = vec2( textureSize( tTrace, 0 ) );
	vec2 grid = vUv * traceSize - 0.5;
	vec2 base = floor( grid );
	vec3 sum = vec3( 0.0 );
	float weight = 0.0, coverage = 0.0, considered = 0.0;
	for ( int j = 0; j < 2; j ++ )
		for ( int i = 0; i < 2; i ++ ) {
			vec2 cell = clamp( base + vec2( float( i ), float( j ) ), vec2( 0.0 ), traceSize - 1.0 );
			vec4 ray = texelFetch( tTrace, ivec2( cell ), 0 );
			vec2 cellUv = ( cell + 0.5 ) / traceSize;
			float z = - perspectiveDepthToViewZ( depthAt( cellUv ), cameraNear, cameraFar );
			float similar = 1.0 / ( 1.0 + 40.0 * abs( z - centreZ ) / max( centreZ, 0.1 ) );
			considered += similar;
			if ( ray.z <= 0.0 ) continue;
			float w = ray.z * similar;
			sum += limited( texture2D( tColor, ray.xy ).rgb ) * w;
			weight += w;
			coverage += w;
		}
	float confidence = considered > 0.0 ? coverage / considered : 0.0;
	if ( weight <= 0.0 || confidence <= 0.001 ) { gl_FragColor = vec4( scene.rgb, 1.0 ); return; }
	vec3 reflection = sum / weight;
	float nov = clamp( dot( n, v ), 0.0, 1.0 );
	float f90 = max( 1.0 - roughness, ${SSR.f0.toFixed(3)} );
	float fresnel = ${SSR.f0.toFixed(3)} + ( f90 - ${SSR.f0.toFixed(3)} ) * pow( 1.0 - nov, 5.0 );
	// The environment term the forward pass added: the local probe where it owns
	// the glossy materials, else the sky PMREM at its specular scale.
	vec3 probe = vec3( 0.0 );
	vec3 reflected = normalize( mix( reflect( - v, n ), n, roughness * roughness ) );
	vec3 worldDir = normalize( ( cameraWorld * vec4( reflected, 0.0 ) ).xyz );
	if ( probeActive > 0.5 ) probe = textureLod( probeCube, worldDir, roughness * probeLod ).rgb;
	#ifdef ENVMAP_TYPE_CUBE_UV
	else if ( hasEnvironment > 0.5 ) probe = textureCubeUV( envMap, worldDir, roughness ).rgb * environmentIntensity;
	#endif
	vec3 delta = fresnel * confidence * ( reflection - probe );
	gl_FragColor = vec4( scene.rgb + max( delta, - 0.5 * scene.rgb ), 1.0 );
}`;

function material(name: string, fragmentShader: string, uniforms: Record<string, T.IUniform>) {
  return new T.ShaderMaterial({
    name,
    vertexShader,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
    toneMapped: false,
  });
}

/** Environment CubeUV layout defines (three's WebGLProgram generateCubeUVSize). */
export function cubeUvDefines(imageHeight: number) {
  if (!(imageHeight >= 16)) throw new Error('Invalid CubeUV height');
  const maxMip = Math.log2(imageHeight) - 2;
  return {
    ENVMAP_TYPE_CUBE_UV: '',
    CUBEUV_TEXEL_WIDTH: 1 / (3 * Math.max(2 ** maxMip, 7 * 16)),
    CUBEUV_TEXEL_HEIGHT: 1 / imageHeight,
    CUBEUV_MAX_MIP: `${maxMip}.0`,
  };
}

export interface SceneStageContext {
  renderer: T.WebGLRenderer;
  camera: T.PerspectiveCamera;
  color: T.Texture;
  depth: T.DepthTexture;
  /** The temporal resolve runs this frame (stochastic rays may rotate). */
  temporal: boolean;
  /** TAA jitter index of this frame. */
  index: number;
}

export class ScreenSpaceReflections {
  /** Settings switch; `active` also needs support and a live scene. */
  enabled = false;
  readonly supported: boolean;
  /** Per frame (pipeline.prepare): rain 0..1 for ripples. */
  rain = 0;
  frames = 0;
  private live = false;
  private readonly levels: T.WebGLRenderTarget[] = [];
  private readonly trace: T.WebGLRenderTarget;
  private readonly output: T.WebGLRenderTarget;
  private readonly reduceFirst: T.ShaderMaterial;
  private readonly reduce: T.ShaderMaterial;
  private readonly traceMaterial: T.ShaderMaterial;
  private readonly resolveMaterial: T.ShaderMaterial;
  private readonly quad = new FullScreenQuad();
  private width = 1;
  private height = 1;
  private envHeight = 0;
  private scene: T.Scene | null = null;
  constructor(floatColorBuffer: boolean) {
    this.supported = floatColorBuffer;
    for (let i = 0; i < HIZ.levels; i++) {
      const target = new T.WebGLRenderTarget(1, 1, {
        type: T.FloatType,
        format: T.RedFormat,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: T.NearestFilter,
        magFilter: T.NearestFilter,
        generateMipmaps: false,
      });
      target.texture.name = `APEX SSR Hi-Z level ${i}`;
      this.levels.push(target);
    }
    this.trace = new T.WebGLRenderTarget(1, 1, {
      type: T.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: T.NearestFilter,
      magFilter: T.NearestFilter,
      generateMipmaps: false,
    });
    this.trace.texture.name = 'APEX SSR rays';
    this.output = new T.WebGLRenderTarget(1, 1, {
      type: T.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      generateMipmaps: false,
    });
    this.output.texture.name = 'APEX SSR resolved scene';
    this.reduceFirst = material('APEX Hi-Z reduce (depth)', hizFragment, {
      tSource: { value: null },
    });
    this.reduce = material('APEX Hi-Z reduce', hizFragment, { tSource: { value: null } });
    const view = () => ({
      tDepth: { value: null },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      cameraProjection: { value: new T.Matrix4() },
      cameraProjectionInverse: { value: new T.Matrix4() },
      cameraWorld: { value: new T.Matrix4() },
      fullResolution: { value: new T.Vector2(1, 1) },
      tColor: { value: null },
    });
    this.traceMaterial = material('APEX SSR Hi-Z trace', traceFragment, {
      ...view(),
      ...Object.fromEntries(this.levels.map((level, i) => [`tHiz${i}`, { value: level.texture }])),
      seed: { value: new T.Vector2() },
      pixelOffset: { value: 0 },
      rain: { value: 0 },
      time: studioUniforms.studioTime,
    });
    this.resolveMaterial = material('APEX SSR resolve', resolveFragment, {
      ...view(),
      tTrace: { value: this.trace.texture },
      environmentIntensity: { value: 1 },
      hasEnvironment: { value: 0 },
      envMap: { value: null },
      probeCube: { value: null },
      probeActive: { value: 0 },
      probeLod: { value: 6 },
    });
  }
  /** The scene whose environment the probe term reads. */
  bindScene(scene: T.Scene) {
    this.scene = scene;
  }
  /** Where the glossy materials' environment comes from this frame: a local
   * probe cubemap (radiance at scale 1) or null for the scene's sky PMREM at
   * `skyScale` (environment intensity x specular IBL gain). */
  environment: { probe: T.Texture | null; skyScale: number } = { probe: null, skyScale: 1 };
  /** Per frame: `live` is false for menu, studio and frames without a scene. */
  prepare(live: boolean) {
    this.live = live;
  }
  get active() {
    return this.enabled && this.supported && this.live;
  }
  /** Inside the scene draw: opted-in materials write their roughness to alpha. */
  beforeScene() {
    ssrMaskUniforms.apexSsrEncode.value = this.active ? 1 : 0;
  }
  afterScene() {
    ssrMaskUniforms.apexSsrEncode.value = 0;
  }
  setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const sizes = hizLevelSizes(this.width, this.height);
    sizes.forEach((size, i) => this.levels[i].setSize(size.width, size.height));
    this.trace.setSize(sizes[0].width, sizes[0].height);
    this.output.setSize(this.width, this.height);
  }
  private syncEnvironment() {
    const environment = this.scene?.environment as T.Texture | null | undefined;
    const u = this.resolveMaterial.uniforms;
    const height =
      environment && environment.mapping === T.CubeUVReflectionMapping
        ? ((environment.image as { height?: number } | undefined)?.height ?? 0)
        : 0;
    if (height !== this.envHeight) {
      this.envHeight = height;
      for (const key of [
        'ENVMAP_TYPE_CUBE_UV',
        'CUBEUV_TEXEL_WIDTH',
        'CUBEUV_TEXEL_HEIGHT',
        'CUBEUV_MAX_MIP',
      ])
        delete this.resolveMaterial.defines[key];
      if (height >= 16) Object.assign(this.resolveMaterial.defines, cubeUvDefines(height));
      this.resolveMaterial.needsUpdate = true;
    }
    u.envMap.value = height >= 16 ? environment : null;
    u.hasEnvironment.value = height >= 16 ? 1 : 0;
    u.environmentIntensity.value = this.environment.skyScale;
    const probe = this.environment.probe as (T.Texture & { isCubeTexture?: boolean }) | null;
    const cube = probe && probe.isCubeTexture ? probe : null;
    u.probeCube.value = cube;
    u.probeActive.value = cube ? 1 : 0;
    const size = (cube?.image as { width?: number }[] | undefined)?.[0]?.width ?? 256;
    // Box-filtered mips approximate the GGX lobe of glossy (r < 0.6) finishes.
    u.probeLod.value = Math.max(1, Math.log2(Math.max(1, size)) - 2);
  }
  /** Returns the scene colour with reflections (or `color` when inactive). */
  render(context: SceneStageContext): T.Texture {
    if (!this.active) return context.color;
    const { renderer, camera, color, depth } = context;
    const draw = (shader: T.ShaderMaterial, target: T.WebGLRenderTarget) => {
      this.quad.material = shader;
      renderer.setRenderTarget(target);
      this.quad.render(renderer);
    };
    this.reduceFirst.uniforms.tSource.value = depth;
    draw(this.reduceFirst, this.levels[0]);
    for (let i = 1; i < this.levels.length; i++) {
      this.reduce.uniforms.tSource.value = this.levels[i - 1].texture;
      draw(this.reduce, this.levels[i]);
    }
    for (const m of [this.traceMaterial, this.resolveMaterial]) {
      const u = m.uniforms;
      u.tDepth.value = depth;
      u.tColor.value = color;
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      u.cameraProjection.value.copy(camera.projectionMatrix);
      u.cameraProjectionInverse.value.copy(camera.projectionMatrixInverse);
      u.cameraWorld.value.copy(camera.matrixWorld);
      u.fullResolution.value.set(this.width, this.height);
    }
    const t = this.traceMaterial.uniforms;
    // Rays rotate only on frames the temporal resolve accumulates.
    const index = context.temporal ? context.index : 0;
    const [sx, sy] = raySeed(index);
    t.seed.value.set(context.temporal ? sx : 0, context.temporal ? sy : 0);
    t.pixelOffset.value = context.temporal ? index % 4 : 0;
    t.rain.value = Math.min(Math.max(this.rain, 0), 1);
    draw(this.traceMaterial, this.trace);
    this.syncEnvironment();
    draw(this.resolveMaterial, this.output);
    this.frames++;
    return this.output.texture;
  }
  diagnostics() {
    const sizes = this.levels.map((l) => [l.width, l.height]);
    return {
      enabled: this.enabled,
      supported: this.supported,
      active: this.active,
      frames: this.frames,
      hizLevels: sizes,
      traceSize: [this.trace.width, this.trace.height],
      maxIterations: SSR.maxIterations,
      // Full-screen quads per frame while active: pyramid + trace + resolve.
      extraDraws: this.active ? HIZ.levels + 2 : 0,
      environmentProbe: this.envHeight > 0,
      localProbe: !!this.environment.probe,
    };
  }
  /** GLSL sources (read-only, for tests and QA tooling). */
  static readonly glsl = Object.freeze({
    hiz: hizFragment,
    trace: traceFragment,
    resolve: resolveFragment,
  });
  dispose() {
    this.levels.forEach((l) => l.dispose());
    this.trace.dispose();
    this.output.dispose();
    for (const m of [this.reduceFirst, this.reduce, this.traceMaterial, this.resolveMaterial])
      m.dispose();
    this.quad.dispose();
  }
}
