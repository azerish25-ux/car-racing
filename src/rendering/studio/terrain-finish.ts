import * as T from 'three';
import type { Track } from '../../simulation/track.ts';
import { TrackDistanceField } from '../track-field.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';

/**
 * Far landscape finish (D17 terrain-landform), chained after the circuit's
 * 'terrain' finish (which provides vFinishWorld, vFinishNormal and the
 * filtered noise).
 *
 *  - Canopy carpet: beyond `FAR.forestFrom` m from the circuit and on slopes
 *    under 0.6, the hills read as forest: albedo between #2f3d2c and #3f4b3e,
 *    crowns 6-14 m across from two noise octaves, dark crevices between them,
 *    and a crown-bump normal; broad glades break it up.
 *  - Strata rock (#8a8378) on slopes over 0.55 with horizontal banding.
 *  - Drier meadows on the south-facing open land.
 *
 * `trackDistance` (metres, per terrain vertex, capped at `FAR.cap`) comes
 * from the TrackDistanceField. No draw calls; deterministic world-space.
 */
export const FAR = Object.freeze({
  forestFrom: 350,
  forestFull: 470,
  cap: 1000,
  canopy: Object.freeze([0x2f3d2c, 0x3f4b3e] as const),
  rock: 0x8a8378,
  maxForestSlope: 0.6,
  rockSlope: 0.55,
  crownMetres: Object.freeze([6, 14] as const),
});

/** Per-vertex distance to the circuit (metres, capped) for a terrain geometry. */
export function terrainTrackDistance(track: Track, geometry: T.BufferGeometry) {
  const field = new TrackDistanceField(track, 2750, 20, FAR.forestFull + 60);
  const position = geometry.getAttribute('position');
  const values = new Float32Array(position.count);
  const sample = { distance: 0, height: 0 };
  for (let i = 0; i < position.count; i++) {
    field.sample(position.getX(i), position.getZ(i), sample);
    values[i] = Number.isFinite(sample.distance) ? Math.min(FAR.cap, sample.distance) : FAR.cap;
  }
  geometry.setAttribute('trackDistance', new T.BufferAttribute(values, 1));
  return values;
}

const v3 = (hex: number) => {
  const c = new T.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};
const f = (v: number) => v.toFixed(4);

/** Landform micro-relief: four octaves of value noise with analytic
 * gradients (cell metres, relief metres), so 17 m terrain cells gain ridges,
 * gullies and spurs without screen-derivative blocks. Each octave fades out
 * before a pixel spans a third of its cell; steep ground is sculpted harder.
 * The same field darkens moist gullies and dries the spurs. */
export const LANDFORM = Object.freeze({
  octaves: Object.freeze([
    [95, 7.5],
    [41, 3.2],
    [17, 1.3],
    [7, 0.45],
  ] as const),
  steepGain: 1.8,
  tone: 0.2,
});
const LANDFORM_GLSL = LANDFORM.octaves
  .map(
    ([cell, relief], i) => `
	{
		float w = 1.0 - smoothstep( 0.12, 0.33, landFootprint / ${f(cell)} );
		vec3 n = apexLandNoised( vFinishWorld.xz / ${f(cell)} + vec2( ${f(i * 17.31)}, ${f(i * 7.77)} ) );
		apexLandGrad += n.yz * ${f(relief / cell)} * w;
		landTone += ( n.x - 0.5 ) * w * ${f(1 / (i + 1))};
	}`,
  )
  .join('');

const FINISH = /* glsl */ `{
	// D17 far landscape: canopy carpet, strata rock, dry south meadows.
	float slope = 1.0 - clamp( normalize( vFinishNormal ).y, 0.0, 1.0 );
	// Landform relief and its moisture tone (see LANDFORM).
	float landFootprint = max( length( fwidth( vFinishWorld.xz ) ), 1e-3 );
	float landTone = 0.0;
	apexLandGrad = vec2( 0.0 );
	${LANDFORM_GLSL}
	apexLandGrad *= 1.0 + ${f(LANDFORM.steepGain)} * smoothstep( 0.15, 0.5, slope );
	diffuseColor.rgb *= 1.0 + ${f(LANDFORM.tone)} * landTone;
	float far = smoothstep( ${f(FAR.forestFrom)}, ${f(FAR.forestFull)}, vTrackDistance );
	float glade = smoothstep( 0.28, 0.42, finishFilteredNoise( vFinishWorld.xz * 0.0021 + vec2( 7.3, 1.9 ) ) );
	float flatEnough = 1.0 - smoothstep( ${f(FAR.maxForestSlope - 0.1)}, ${f(FAR.maxForestSlope)}, slope );
	float forest = far * glade * flatEnough;
	float crownA = finishFilteredNoise( vFinishWorld.xz / ${f(FAR.crownMetres[1])} );
	float crownB = finishFilteredNoise( vFinishWorld.xz / ${f(FAR.crownMetres[0])} + vec2( 3.7, 9.1 ) );
	float crowns = 0.6 * crownA + 0.4 * crownB;
	vec3 canopy = mix( ${v3(FAR.canopy[0])}, ${v3(FAR.canopy[1])}, smoothstep( 0.3, 0.75, crowns ) );
	canopy *= mix( 0.55, 1.08, smoothstep( 0.22, 0.62, crowns ) );
	apexCanopy = forest;
	apexCanopyHeight = 7.0 * crowns * forest;
	// South-facing open land dries out (warm, paler grass).
	float south = smoothstep( 0.0, -900.0, vFinishWorld.z ) * far * ( 1.0 - forest );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.18, 1.06, 0.74 ), south * 0.7 );
	diffuseColor.rgb = mix( diffuseColor.rgb, canopy, forest );
	// Exposed strata on steep faces.
	float rock = smoothstep( ${f(FAR.rockSlope - 0.05)}, ${f(FAR.rockSlope + 0.08)}, slope );
	float strata = 0.82 + 0.18 * sin( vFinishWorld.y * 1.7 + finishFilteredNoise( vFinishWorld.xz * 0.05 ) * 6.0 );
	diffuseColor.rgb = mix( diffuseColor.rgb, ${v3(FAR.rock)} * strata * ( 0.85 + 0.3 * crownB ), rock );
}`;

export const TERRAIN_FINISH_HOOK = 'terrain-finish-v1';
/** Chain the far-landscape finish onto the terrain material. */
export function installTerrainFinish(material: T.Material) {
  return chainShaderHook(material, TERRAIN_FINISH_HOOK, (shader) => {
    injectDeclarations(
      shader,
      'common',
      'attribute float trackDistance;\nvarying float vTrackDistance;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vTrackDistance = trackDistance;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `varying float vTrackDistance;\nfloat apexCanopy = 0.0;\nfloat apexCanopyHeight = 0.0;\nvec2 apexLandGrad = vec2( 0.0 );
float apexLandHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
// Value noise and its gradient (x: value, yz: d/dp).
vec3 apexLandNoised( vec2 p ) {
	vec2 i = floor( p ), q = fract( p );
	vec2 u = q * q * ( 3.0 - 2.0 * q ), du = 6.0 * q * ( 1.0 - q );
	float a = apexLandHash( i ), b = apexLandHash( i + vec2( 1.0, 0.0 ) );
	float c = apexLandHash( i + vec2( 0.0, 1.0 ) ), d = apexLandHash( i + vec2( 1.0, 1.0 ) );
	float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
	return vec3( a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2( k1 + k4 * u.y, k2 + k4 * u.x ) );
}
vec3 apexTerrainRelief( vec3 n, float h ) {
	vec3 sx = dFdx( - vViewPosition ), sy = dFdy( - vViewPosition );
	vec3 r1 = cross( sy, n ), r2 = cross( n, sx );
	float det = dot( sx, r1 );
	vec3 grad = sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
	return normalize( max( abs( det ), 1e-10 ) * n - grad );
}`,
      'fragment',
    );
    // After the circuit's terrain finish (which follows map_fragment).
    injectAfter(shader, 'color_fragment', FINISH, 'fragment');
    injectAfter(
      shader,
      'normal_fragment_maps',
      `if ( apexCanopy > 0.0 ) normal = apexTerrainRelief( normal, apexCanopyHeight );
// Landform relief: tilt by the world-space height gradient (analytic, stable).
normal = normalize( normal - mat3( viewMatrix ) * vec3( apexLandGrad.x, 0.0, apexLandGrad.y ) );`,
      'fragment',
    );
  });
}
