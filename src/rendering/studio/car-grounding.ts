import type * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';
import { useStudioUniforms } from './studio-frame.ts';

/**
 * Analytic vehicle grounding (D08 shadows-grounding).
 *
 * The sun's shadow map gives each car a cast shadow, but nothing darkens the
 * sky light under the floor, so in overcast or in the car's own shadow the
 * ground under it is as bright as the open road and the car floats. This hook
 * reads every car's `studioCarPose` (x, z, yaw, groundY; written once per frame
 * by StudioFrame, 0 draw calls) on the ground materials (road, pit road, kerb,
 * run-off, grass, gravel) and darkens what lies under a footprint shaped like
 * an open-wheel car: floor and sidepods, nose, front and rear wings and the
 * four tyre contacts, each with a 0.2 m soft edge (the tyres a tighter one).
 * GP prototypes instead use two crown-projected tyre contacts and a narrow
 * engine/rider footprint. Their presented lean moves that footprint, a lifted
 * tyre loses its contact term, and a separated rider leaves no seated lobe.
 * Other vehicle classes keep the existing car path.
 *
 * Indirect light (sky, IBL) under the floor drops by up to
 * `CAR_GROUNDING.indirect`, direct light by up to `CAR_GROUNDING.direct`
 * (squared falloff, so sunlit ground beside the car stays lit). Receivers more
 * than `CAR_GROUNDING.height` metres from the cars' ground level are left
 * alone. Deterministic: the pose is presented simulation state.
 */
export const CAR_GROUNDING = Object.freeze({
  indirect: 0.6,
  direct: 0.32,
  falloff: 0.2,
  tyreFalloff: 0.09,
  height: 0.45,
  /** Cars further than this (metres, footprint centre) are skipped per pixel. */
  reach: 4,
});

/** Footprint parts in car-local (across, along) metres: centre, half size,
 * strength. Wheel contacts are at (±0.83, 1.82) and (±0.83, -1.62). */
export const CAR_FOOTPRINT = Object.freeze([
  { name: 'floor', centre: [0, -0.3], half: [0.78, 1.5], strength: 1 },
  { name: 'nose', centre: [0, 1.9], half: [0.28, 0.7], strength: 0.45 },
  { name: 'front wing', centre: [0, 2.5], half: [0.95, 0.28], strength: 0.5 },
  { name: 'rear wing', centre: [0, -2.3], half: [0.5, 0.35], strength: 0.5 },
] as const);
export const CAR_TYRES = Object.freeze({
  across: 0.83,
  front: 1.82,
  rear: -1.62,
  half: [0.19, 0.34],
});

/** GP slick contact half sizes in metres. These fit inside the rendered
 * front/rear crowns (0.12/0.20 m wide); soft indirect occlusion extends beyond
 * the loaded patch. Body values are a lighting approximation, not collision
 * dimensions. REF 018/039/060/067/071/087/098 show this compact contact scale. */
export const GP_GROUNDING = Object.freeze({
  frontHalf: [0.055, 0.085] as const,
  rearHalf: [0.085, 0.11] as const,
  tyreFalloff: 0.04,
  bodyFalloff: 0.18,
  bodyAcross: 0.2,
  bodyLeanAcross: 0.4,
  bodyAlong: 0.5,
  bodyStrength: 0.42,
  fallenStrength: 0.74,
  riderStrength: 0.22,
  liftFade: 5,
});

const f = (v: number) => v.toFixed(3);
const box = (part: (typeof CAR_FOOTPRINT)[number]) =>
  `occ = max( occ, ${f(part.strength)} * apexGroundBox( q, vec2( ${f(part.centre[0])}, ${f(part.centre[1])} ), vec2( ${f(part.half[0])}, ${f(part.half[1])} ), ${f(CAR_GROUNDING.falloff)} ) );`;

const DECLARATIONS = /* glsl */ `
varying vec3 vApexGroundWorld;
float apexGroundBox( vec2 q, vec2 centre, vec2 extent, float falloff ) {
	vec2 d = abs( q - centre ) - extent;
	float sdf = length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 );
	return 1.0 - smoothstep( - falloff, falloff, sdf );
}
float apexGpGrounding( vec3 p, vec4 pose, vec4 front, vec4 rear, vec4 shape ) {
	float c = cos( pose.z ), s = sin( pose.z );
	vec3 l = studioCarPoseLocal( pose, p );
	vec2 axleSpan = front.xy - rear.xy;
	float alongSpan = dot( axleSpan, vec2( s, c ) );
	float slope = abs( alongSpan ) > 0.1 ? ( front.z - rear.z ) / alongSpan : 0.0;
	float gate = 1.0 - smoothstep( ${f(CAR_GROUNDING.height * 0.4)}, ${f(CAR_GROUNDING.height)}, abs( l.y - slope * l.z ) );
	if ( gate <= 0.0 ) return 0.0;
	float lean = min( abs( shape.y ), 1.0 );
	float upright = sqrt( max( 0.0, 1.0 - lean * lean ) );
	float down = 1.0 - smoothstep( 0.45, 0.95, upright );
	float width = ${f(GP_GROUNDING.bodyAcross)} * upright + ${f(GP_GROUNDING.bodyLeanAcross)} * lean;
	float occ = mix( ${f(GP_GROUNDING.bodyStrength)}, ${f(GP_GROUNDING.fallenStrength)}, down ) * apexGroundBox( l.xz, vec2( -0.18 * shape.y, -0.05 ), vec2( width, ${f(GP_GROUNDING.bodyAlong)} ), ${f(GP_GROUNDING.bodyFalloff)} );
	// A remounting/separated rider has a world pose away from this saddle.
	if ( shape.x < 1.5 ) {
		vec2 rider = vec2( 0.32 * shape.y + 0.85 * shape.z * upright, -0.12 );
		occ = max( occ, ${f(GP_GROUNDING.riderStrength)} * apexGroundBox( l.xz, rider, vec2( 0.17, 0.34 ), 0.18 ) );
	}
	occ *= exp( -${f(GP_GROUNDING.liftFade)} * shape.w );
	vec2 fd = p.xz - front.xy, rd = p.xz - rear.xy;
	vec2 fq = vec2( fd.x * c - fd.y * s, fd.x * s + fd.y * c );
	vec2 rq = vec2( rd.x * c - rd.y * s, rd.x * s + rd.y * c );
	float fcontact = front.w * apexGroundBox( fq, vec2( 0.0 ), vec2( ${f(GP_GROUNDING.frontHalf[0])}, ${f(GP_GROUNDING.frontHalf[1])} ), ${f(GP_GROUNDING.tyreFalloff)} );
	float rcontact = rear.w * apexGroundBox( rq, vec2( 0.0 ), vec2( ${f(GP_GROUNDING.rearHalf[0])}, ${f(GP_GROUNDING.rearHalf[1])} ), ${f(GP_GROUNDING.tyreFalloff)} );
	return max( occ, max( fcontact, rcontact ) ) * gate;
}
float apexCarGrounding( vec3 p ) {
	float total = 0.0;
	for ( int i = 0; i < STUDIO_MAX_CARS; i ++ ) {
		if ( i >= studioCarCount ) break;
		vec4 pose = studioCarPose[ i ];
		vec2 d = p.xz - pose.xy;
		if ( dot( d, d ) > ${f(CAR_GROUNDING.reach * CAR_GROUNDING.reach)} ) continue;
		if ( studioGpShape[ i ].x > 0.5 ) {
			total = max( total, apexGpGrounding( p, pose, studioGpFront[ i ], studioGpRear[ i ], studioGpShape[ i ] ) );
			continue;
		}
		vec3 l = studioCarPoseLocal( pose, p );
		float gate = 1.0 - smoothstep( ${f(CAR_GROUNDING.height * 0.4)}, ${f(CAR_GROUNDING.height)}, abs( l.y ) );
		if ( gate <= 0.0 ) continue;
		vec2 q = l.xz;
		float occ = 0.0;
		${CAR_FOOTPRINT.map(box).join('\n\t\t')}
		vec2 w = vec2( abs( q.x ), q.y );
		occ = max( occ, apexGroundBox( w, vec2( ${f(CAR_TYRES.across)}, ${f(CAR_TYRES.front)} ), vec2( ${f(CAR_TYRES.half[0])}, ${f(CAR_TYRES.half[1])} ), ${f(CAR_GROUNDING.tyreFalloff)} ) );
		occ = max( occ, apexGroundBox( w, vec2( ${f(CAR_TYRES.across)}, ${f(CAR_TYRES.rear)} ), vec2( ${f(CAR_TYRES.half[0])}, ${f(CAR_TYRES.half[1])} ), ${f(CAR_GROUNDING.tyreFalloff)} ) );
		total = max( total, occ * gate );
	}
	return total;
}
`;

const APPLY = /* glsl */ `{
	// D08 car grounding: sky and sun light under the cars' footprints.
	float apexGround = apexCarGrounding( vApexGroundWorld );
	if ( apexGround > 0.0 ) {
		float apexIndirect = 1.0 - ${f(CAR_GROUNDING.indirect)} * apexGround;
		float apexDirect = 1.0 - ${f(CAR_GROUNDING.direct)} * apexGround * apexGround;
		reflectedLight.indirectDiffuse *= apexIndirect;
		reflectedLight.indirectSpecular *= apexIndirect;
		reflectedLight.directDiffuse *= apexDirect;
		reflectedLight.directSpecular *= apexDirect;
	}
}`;

export const CAR_GROUNDING_HOOK = 'car-grounding-v2';

/** Install the grounding term on a lit ground material (Standard/Physical).
 * Idempotent; chains any existing hook. */
export function installCarGrounding(material: T.Material) {
  return chainShaderHook(material, CAR_GROUNDING_HOOK, (shader) => {
    useStudioUniforms(
      shader,
      ['studioCarCount', 'studioCarPose', 'studioGpFront', 'studioGpRear', 'studioGpShape'],
      'fragment',
    );
    injectDeclarations(shader, 'common', 'varying vec3 vApexGroundWorld;', 'vertex');
    injectAfter(
      shader,
      'project_vertex',
      `{
	vec4 apexGroundWorld = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
	apexGroundWorld = batchingMatrix * apexGroundWorld;
	#endif
	#ifdef USE_INSTANCING
	apexGroundWorld = instanceMatrix * apexGroundWorld;
	#endif
	vApexGroundWorld = ( modelMatrix * apexGroundWorld ).xyz;
}`,
      'vertex',
    );
    injectAfter(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'aomap_fragment', APPLY, 'fragment');
  });
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function groundBox(
  qx: number,
  qz: number,
  cx: number,
  cz: number,
  hx: number,
  hz: number,
  falloff: number,
) {
  const dx = Math.abs(qx - cx) - hx,
    dz = Math.abs(qz - cz) - hz;
  const sdf = Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
  return 1 - smooth(-falloff, falloff, sdf);
}
/** CPU reference of the shader's `apexCarGrounding` for one car: occlusion
 * 0..1 at car-local (across, height above ground, along). */
export function carGroundingAt(across: number, height: number, along: number) {
  const gate = 1 - smooth(CAR_GROUNDING.height * 0.4, CAR_GROUNDING.height, Math.abs(height));
  if (gate <= 0) return 0;
  let occ = 0;
  for (const part of CAR_FOOTPRINT)
    occ = Math.max(
      occ,
      part.strength *
        groundBox(
          across,
          along,
          part.centre[0],
          part.centre[1],
          part.half[0],
          part.half[1],
          CAR_GROUNDING.falloff,
        ),
    );
  for (const z of [CAR_TYRES.front, CAR_TYRES.rear])
    occ = Math.max(
      occ,
      groundBox(
        Math.abs(across),
        along,
        CAR_TYRES.across,
        z,
        CAR_TYRES.half[0],
        CAR_TYRES.half[1],
        CAR_GROUNDING.tyreFalloff,
      ),
    );
  return occ * gate;
}

/** CPU reference for GP footprint inspection, using StudioFrame's world
 * contacts. Ground plane and lit-material application match the shader;
 * no separate translucent shadow card or wet-surface overlay is created. */
export function gpGroundingAt(
  point: Pick<T.Vector3, 'x' | 'y' | 'z'>,
  pose: Pick<T.Vector4, 'x' | 'y' | 'z' | 'w'>,
  front: Pick<T.Vector4, 'x' | 'y' | 'z' | 'w'>,
  rear: Pick<T.Vector4, 'x' | 'y' | 'z' | 'w'>,
  shape: Pick<T.Vector4, 'x' | 'y' | 'z' | 'w'>,
) {
  if (shape.x <= 0.5) return 0;
  const c = Math.cos(pose.z),
    s = Math.sin(pose.z),
    dx = point.x - pose.x,
    dz = point.z - pose.y;
  if (dx * dx + dz * dz > CAR_GROUNDING.reach * CAR_GROUNDING.reach) return 0;
  const across = dx * c - dz * s,
    along = dx * s + dz * c,
    span = (front.x - rear.x) * s + (front.y - rear.y) * c,
    slope = Math.abs(span) > 0.1 ? (front.z - rear.z) / span : 0,
    gate =
      1 -
      smooth(
        CAR_GROUNDING.height * 0.4,
        CAR_GROUNDING.height,
        Math.abs(point.y - pose.w - slope * along),
      );
  if (gate <= 0) return 0;
  const lean = Math.min(Math.abs(shape.y), 1),
    upright = Math.sqrt(Math.max(0, 1 - lean * lean)),
    down = 1 - smooth(0.45, 0.95, upright),
    width = GP_GROUNDING.bodyAcross * upright + GP_GROUNDING.bodyLeanAcross * lean;
  let occ =
    (GP_GROUNDING.bodyStrength + (GP_GROUNDING.fallenStrength - GP_GROUNDING.bodyStrength) * down) *
    groundBox(
      across,
      along,
      -0.18 * shape.y,
      -0.05,
      width,
      GP_GROUNDING.bodyAlong,
      GP_GROUNDING.bodyFalloff,
    );
  if (shape.x < 1.5)
    occ = Math.max(
      occ,
      GP_GROUNDING.riderStrength *
        groundBox(
          across,
          along,
          0.32 * shape.y + 0.85 * shape.z * upright,
          -0.12,
          0.17,
          0.34,
          0.18,
        ),
    );
  occ *= Math.exp(-GP_GROUNDING.liftFade * shape.w);
  for (let i = 0; i < 2; i++) {
    const contact = i === 0 ? front : rear,
      half = i === 0 ? GP_GROUNDING.frontHalf : GP_GROUNDING.rearHalf,
      x = point.x - contact.x,
      z = point.z - contact.y;
    occ = Math.max(
      occ,
      contact.w *
        groundBox(x * c - z * s, x * s + z * c, 0, 0, half[0], half[1], GP_GROUNDING.tyreFalloff),
    );
  }
  return occ * gate;
}
