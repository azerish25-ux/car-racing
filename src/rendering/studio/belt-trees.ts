import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '../../core/math.ts';
import { chainShaderHook, injectAfter } from './shader-hooks.ts';

/**
 * Forest-belt conifers as real geometry (D11 forest-vegetation, background).
 *
 * As alpha-tested crossed cards the belt conifers read as dark, vertically
 * striped cut-outs that fizz as their texels minify. Each is now a leader
 * with tiered branch whorls in a unit box (height 1, radius 0.5; the instance
 * scales it to metres): every whorl is a drooping skirt from the leader out
 * to a serrated rim of alternating long and short branch tips, closed by a
 * shaded concave underside, smaller up the tree, each turned by the golden
 * angle and leaning a little, so the silhouette is a clear, ragged cone of
 * tiers. Each rim is feathered into three pointed sub-branches per tip by
 * analytic coverage (its own screen-space width, alpha-to-coverage under
 * MSAA, solid once subpixel): no texture to minify, so nothing fizzes.
 *
 * Normals blend each skirt's cone normal with the tree's (spherical) crown
 * normal, so sun and sky shade the whole tree as one volume; a baked
 * occlusion term (`beltShade.x`) darkens whorl undersides, the leader, the
 * low tiers and the trunk foot. Needle sprays are filtered value noise along
 * each branch. Two tiers (far, near) share one stream as draw ranges.
 */
export const BELT_TREES = Object.freeze({
  conifer: Object.freeze({
    near: Object.freeze({ whorls: 12, tips: 16 }),
    far: Object.freeze({ whorls: 7, tips: 10 }),
  }),
  /** Share of the crown's spherical normal in the shading normal. */
  crownNormal: 0.4,
  /** Linear albedo of needles, leaves and bark (before the instance tint). */
  needles: Object.freeze([0.095, 0.15, 0.1] as const),
  bark: Object.freeze([0.085, 0.065, 0.05] as const),
});

interface Builder {
  position: number[];
  normal: number[];
  color: number[];
  shade: number[];
  uv: number[];
  index: number[];
}
const builder = (): Builder => ({
  position: [],
  normal: [],
  color: [],
  shade: [],
  uv: [],
  index: [],
});
function vertex(
  b: Builder,
  p: T.Vector3,
  n: T.Vector3,
  albedo: readonly number[],
  ao: number,
  conifer: number,
  foliage: number,
  u = 0,
  v = 0,
) {
  b.uv.push(u, v);
  b.position.push(p.x, p.y, p.z);
  b.normal.push(n.x, n.y, n.z);
  b.color.push(albedo[0], albedo[1], albedo[2]);
  b.shade.push(Math.min(1, Math.max(0, ao)), conifer, foliage);
  return b.position.length / 3 - 1;
}
function finish(b: Builder) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(b.position, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(b.normal, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(b.color, 3));
  g.setAttribute('beltShade', new T.Float32BufferAttribute(b.shade, 3));
  g.setAttribute('beltUv', new T.Float32BufferAttribute(b.uv, 2));
  g.setIndex(b.index);
  return g;
}
/** A short tapered trunk with occlusion darkest at the foot. */
function trunk(b: Builder, top: number, radius: number, conifer: number, sides = 6) {
  const base = b.position.length / 3;
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2,
      n = new T.Vector3(Math.cos(a), 0, Math.sin(a));
    vertex(
      b,
      new T.Vector3(n.x * radius * 1.4, 0, n.z * radius * 1.4),
      n,
      BELT_TREES.bark,
      0.35,
      conifer,
      0,
    );
    vertex(b, new T.Vector3(n.x * radius, top, n.z * radius), n, BELT_TREES.bark, 0.6, conifer, 0);
  }
  for (let i = 0; i < sides; i++) {
    const a = base + i * 2;
    b.index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}
const crownNormal = (p: T.Vector3, centreY: number, halfHeight: number, out: T.Vector3) =>
  out.set(p.x / 0.5, (p.y - centreY) / halfHeight, p.z / 0.5).normalize();

/** Conifer of `whorls` drooping, serrated branch tiers on a leader. */
export function coniferGeometry(whorls: number, tips: number, seed = 0x51c0) {
  const b = builder(),
    random = new Random(seed),
    bottom = 0.09,
    span = 1 - bottom,
    step = span / whorls,
    sphere = new T.Vector3(),
    n = new T.Vector3(),
    p = new T.Vector3();
  trunk(b, bottom + step * 1.5, 0.022, 1);
  for (let i = 0; i < whorls; i++) {
    const t = i / whorls,
      baseY = bottom + i * step,
      tipY = Math.min(1, baseY + step * 1.75 + (i === whorls - 1 ? step * 0.6 : 0)),
      radius = 0.5 * Math.pow(1 - t, 0.92) * (0.9 + random.next() * 0.16) + 0.02,
      droop = step * (0.35 + 0.25 * (1 - t)),
      phase = i * 2.39996,
      light = Math.sqrt((i + 1) / whorls),
      // Whorls are never perfectly stacked: each leans a little.
      lean = new T.Vector2(random.next() - 0.5, random.next() - 0.5).multiplyScalar(0.035);
    // Upper surface: the leader out to the rim of branch tips. Each tip
    // interval k has its own apex so the rim parameter (u = k at tip k,
    // v = 0 at the leader, 1 at the rim) interpolates without a seam.
    const top: number[] = [],
      under: number[] = [],
      apexes: number[] = [];
    for (let k = 0; k < tips; k++)
      apexes.push(
        vertex(
          b,
          p.set(lean.x * 0.5, tipY, lean.y * 0.5),
          n.set(0, 1, 0),
          BELT_TREES.needles,
          0.5 + 0.3 * light,
          1,
          1,
          k + 0.5,
          0,
        ),
      );
    const rim: T.Vector3[] = [],
      radials: T.Vector3[] = [],
      longTip: boolean[] = [];
    for (let k = 0; k < tips; k++) {
      const a = phase + (k / tips) * Math.PI * 2 + (random.next() - 0.5) * 0.25,
        long = k % 2 === 0,
        r = radius * (long ? 1 : 0.5) * (0.7 + random.next() * 0.5);
      radials.push(new T.Vector3(Math.cos(a), 0, Math.sin(a)));
      rim.push(
        new T.Vector3(
          radials[k].x * r + lean.x,
          baseY - (long ? droop : droop * 0.35) * (0.6 + random.next() * 0.8),
          radials[k].z * r + lean.y,
        ),
      );
      longTip.push(long);
    }
    for (let k = 0; k <= tips; k++) {
      const j = k % tips;
      crownNormal(rim[j], 0.42, 0.62, sphere);
      n.copy(radials[j])
        .multiplyScalar(0.78)
        .add(new T.Vector3(0, 0.62, 0))
        .normalize()
        .lerp(sphere, BELT_TREES.crownNormal)
        .normalize();
      top.push(
        vertex(
          b,
          rim[j],
          n,
          BELT_TREES.needles,
          (longTip[j] ? 0.95 : 0.78) * (0.7 + 0.3 * light),
          1,
          1,
          k,
          1,
        ),
      );
      n.copy(radials[j])
        .multiplyScalar(0.45)
        .add(new T.Vector3(0, -0.9, 0))
        .normalize();
      under.push(vertex(b, rim[j], n, BELT_TREES.needles, 0.32 + 0.12 * light, 1, 1, k, 1));
    }
    // Concave underside, closed to the leader a little above the rim.
    const collars: number[] = [];
    for (let k = 0; k < tips; k++)
      collars.push(
        vertex(
          b,
          p.set(lean.x * 0.5, baseY + step * 0.55, lean.y * 0.5),
          n.set(0, -1, 0),
          BELT_TREES.needles,
          0.18,
          1,
          1,
          k + 0.5,
          0,
        ),
      );
    for (let k = 0; k < tips; k++) {
      b.index.push(apexes[k], top[k + 1], top[k]);
      b.index.push(collars[k], under[k], under[k + 1]);
    }
  }
  return finish(b);
}

export interface BeltTierRange {
  start: number;
  count: number;
}
/** One indexed stream of conifers: [far tier | near tier]. */
export function beltTreeStream() {
  const parts = [
    coniferGeometry(BELT_TREES.conifer.far.whorls, BELT_TREES.conifer.far.tips),
    coniferGeometry(BELT_TREES.conifer.near.whorls, BELT_TREES.conifer.near.tips),
  ];
  const counts = parts.map((g) => g.index!.count);
  const geometry = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!geometry) throw new Error('Unable to pack belt conifers');
  // Bounds of both tiers, with room for the wind's sway.
  geometry.computeBoundingBox();
  geometry.boundingBox!.expandByScalar(0.04);
  geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new T.Sphere());
  const far: BeltTierRange = { start: 0, count: counts[0] },
    near: BeltTierRange = { start: far.count, count: counts[1] };
  return { geometry, far, near };
}

const VERTEX = /* glsl */ `
attribute vec3 beltShade;
attribute vec2 beltUv;
varying vec3 vBeltShade;
varying vec3 vBeltObject;
varying vec2 vBeltUv;`;
const COLLAPSE = /* glsl */ `
vBeltShade = beltShade;
vBeltObject = position;
vBeltUv = beltUv;`;
const FRAGMENT_COMMON = /* glsl */ `
varying vec3 vBeltShade;
varying vec3 vBeltObject;
varying vec2 vBeltUv;
float beltHash( vec3 p ) { p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.x + p.y ) * p.z ); }
float beltNoise( vec3 p ) {
	vec3 i = floor( p ), f = fract( p ); f = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
	return mix( mix( mix( beltHash( i ), beltHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( beltHash( i + vec3( 0, 1, 0 ) ), beltHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( beltHash( i + vec3( 0, 0, 1 ) ), beltHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( beltHash( i + vec3( 0, 1, 1 ) ), beltHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// 1 while a noise cell spans several pixels, 0 once a pixel spans a cell.
float beltResolved( vec3 p ) { return 1.0 - smoothstep( 0.35, 1.1, length( fwidth( p ) ) ); }
float beltDetail( vec3 p ) { return mix( 0.5, beltNoise( p ), beltResolved( p ) ); }`;
const ALBEDO = /* glsl */ `
{
	float foliage = vBeltShade.z;
	float coverage = 1.0;
	{
		// Branch whorls: three pointed sub-branches per rim tip, notched to a
		// random depth, antialiased analytically and solid once subpixel.
		float sub = fract( vBeltUv.x * 3.0 ), id = floor( vBeltUv.x * 3.0 );
		float notch = 0.2 + 0.2 * beltHash( vec3( id, floor( vBeltObject.y * 40.0 ), 3.0 ) );
		float inside = 1.0 - notch * abs( sub - 0.5 ) * 2.0 - vBeltUv.y;
		float width = fwidth( inside ) + 1e-4;
		float resolved = 1.0 - smoothstep( 0.3, 0.8, fwidth( vBeltUv.x * 3.0 ) );
		coverage = mix( 1.0, smoothstep( - width, width, inside ), resolved * foliage );
		// Needle sprays along each branch: striated radially, brighter tips.
		float sprays = beltDetail( vec3( vBeltUv.x * 6.0, vBeltUv.y * 3.5, vBeltObject.y * 9.0 ) );
		diffuseColor.rgb *= mix( 1.0, ( 0.72 + 0.5 * sprays ) * ( 0.8 + 0.35 * vBeltUv.y ), foliage );
	}
	diffuseColor.a *= coverage;
	diffuseColor.rgb *= mix( 1.0, vBeltShade.x, 0.3 );
	// Seen through a gap, the crown's far side is its shaded interior.
	if ( ! gl_FrontFacing ) diffuseColor.rgb *= 0.6;
}`;
const LIGHT = /* glsl */ `
reflectedLight.indirectDiffuse *= vBeltShade.x * mix( vec3( 1.0 ), vec3( 0.74, 0.84, 0.6 ), vBeltShade.z );
reflectedLight.indirectSpecular *= vBeltShade.x;`;

export const BELT_TREES_HOOK = 'belt-trees-v1';
/** Rim coverage, occlusion and needle detail on the belt conifer material. */
export function installBeltTrees(material: T.Material) {
  return chainShaderHook(material, BELT_TREES_HOOK, (shader) => {
    injectAfter(shader, 'common', VERTEX, 'vertex');
    injectAfter(shader, 'begin_vertex', COLLAPSE, 'vertex');
    injectAfter(shader, 'common', FRAGMENT_COMMON, 'fragment');
    injectAfter(shader, 'color_fragment', ALBEDO, 'fragment');
    injectAfter(shader, 'lights_fragment_end', LIGHT, 'fragment');
  });
}
