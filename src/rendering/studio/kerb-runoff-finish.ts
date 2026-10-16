import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';
import { installTrackEdgeHelpers } from './track-edge-wear.ts';

/**
 * Kerbs and run-off (D15 track-kerbs-runoff), chained after the circuit
 * finishes (which provide `vFinishMetres` = (lateral m, lap m) and
 * `vFinishWorld`).
 *
 * Kerbs (P9): anti-aliased 1.1 m stripes (a 2.2 m red/white pair; a blue/white
 * complex and a yellow/green corner from `kerbStyle`), ignoring the 3 m vertex
 * colours. The physics ridges (0.65 m period, `kerbHeight` untouched) shade
 * through a derivative normal across the 0.12-0.98 m band, with brown dust
 * settled in their troughs. Paint roughness fresh 0.82 to 0.92 worn; tyre
 * rubber #2a2a2a over the track-side 30 %, weighted by racing-line usage
 * (`kerbUsage`) above a `wearFloor` every kerb carries (cars put wheels on
 * every kerb), with chips where usage is high. Real kerb paint: an oxide red
 * #a82a26 and an off-white #cfccc3 (linear ~0.61), never ink-pure, with stripe
 * edges softened by `edgeOverlap` of rolled paint.
 *
 * Run-off (w+1.1 to w+4): grey asphalt #6f6c68 with a 1.5-2 m painted band in
 * the corner's colour and white chevrons, or astroturf with fibre noise
 * (`runoffStyle`), plus 0.35 m worn-soil seams where the run-off meets the
 * kerb (edge 1.1 m) and the grass (edge 4 m). Paint and chevrons are worn
 * through where cars run over them, and tyre dirt is sprayed off the kerb.
 */
export const KERB = Object.freeze({
  pair: 2.2,
  colours: Object.freeze([
    // Photoreal pass: the KPI 11 albedo #bc0a14 (linear 0.50/0.003/0.007) is a
    // pigment no road paint has and read as candy; #ecebe6 (0.84) as paper.
    [0xa82a26, 0xcfccc3],
    [0x2c4a86, 0xcfccc3],
    [0xc9a53a, 0x3f6e4c],
  ] as const),
  /** Rubber every kerb carries over its track-side 30 %, off the line too. */
  wearFloor: 0.18,
  /** Stripe boundary softness (m): rolled paint overlaps the next colour. */
  edgeOverlap: 0.012,
  /** Brown dust settled in the ridge troughs. */
  dust: 0x5e4c38,
  rubber: 0x2a2a2a,
  // Shading amplitude of the 1.6 cm physics corrugation: the full slope reads
  // as hard bands at chase distance, so the visual relief is softened.
  ridge: Object.freeze({ amplitude: 0.006, period: 0.65, from: 0.12, to: 0.98 }),
  // Fresh paint at 0.5 mirrored the blue sky at grazing angles (pink kerbs).
  roughness: Object.freeze({ fresh: 0.82, worn: 0.92 }),
  width: 1.1,
});
export const RUNOFF = Object.freeze({
  from: 1.1,
  to: 4,
  base: 0x6f6c68,
  bands: Object.freeze([0x3f6e4c, 0xa03a33, 0x34548c, 0xc4a244] as const),
  turf: 0x3f7f50,
  /** Painted band across the run-off, edge metres. */
  band: Object.freeze([1.25, 3.0] as const),
  chevronPitch: 4,
  seam: 0.35,
  soil: 0x6b5a45,
});

const v3 = (hex: number) => {
  const c = new T.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};
const f = (v: number) => v.toFixed(4);

/** Usage weight of a kerb whose track-side edge is `distance` m from the racing line. */
export function kerbUsage(distance: number) {
  return Number.isFinite(distance) ? Math.exp(-((distance / 1.2) ** 2)) : 0;
}

const RELIEF = /* glsl */ `
vec3 apexReliefNormal(vec3 n, float h) {
	vec3 sx = dFdx( - vViewPosition ), sy = dFdy( - vViewPosition );
	vec3 r1 = cross( sy, n ), r2 = cross( n, sx );
	float det = dot( sx, r1 );
	vec3 grad = sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
	return normalize( max( abs( det ), 1e-10 ) * n - grad );
}`;

export const KERB_HOOK = 'kerb-finish-v3';
export const RUNOFF_HOOK = 'runoff-finish-v3';

/** Install on the kerb ribbon material (after `installCircuitFinish(m, 'kerb')`). */
export function installKerbFinish(material: T.MeshStandardMaterial, lapLength = 3600) {
  // Stripe colour is authored in metres in the shader. Disabling the old
  // vertex tint lets construction joints and paint chips survive the colour
  // stage instead of resetting all of them to kerbPaint after color_fragment.
  material.vertexColors = false;
  return chainShaderHook(material, KERB_HOOK, (shader) => {
    installTrackEdgeHelpers(shader, lapLength);
    injectDeclarations(
      shader,
      'common',
      'attribute float kerbStyle;\nattribute float kerbUsage;\nattribute float edgeMetres;\nvarying float vKerbStyle;\nvarying float vKerbUsage;\nvarying float vKerbAcross;',
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      'vKerbStyle = kerbStyle;\nvKerbUsage = kerbUsage;\nvKerbAcross = edgeMetres;',
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      `varying float vKerbStyle;\nvarying float vKerbUsage;\nvarying float vKerbAcross;\nfloat kerbWear;\nvec3 kerbPaint;\n${RELIEF}`,
      'fragment',
    );
    injectAfter(
      shader,
      'map_fragment',
      `{
	// D15 kerb paint: 1.1 m anti-aliased stripes in the corner's scheme.
	float stripePhase = vFinishMetres.y / ${f(KERB.pair)};
	// Hand-rolled edges: a centimetre of overlap and a few millimetres of waver.
	float stripeWaver = ( finishFilteredNoise( vFinishWorld.xz * vec2( 5.3, 4.1 ) ) - .5 ) * ${f(0.008 / KERB.pair)};
	float second = apexStripeCoverage( stripePhase + stripeWaver, max( fwidth( stripePhase ), ${f(KERB.edgeOverlap / KERB.pair)} ), .25 );
	vec3 first = vKerbStyle > 1.5 ? ${v3(KERB.colours[2][0])} : vKerbStyle > .5 ? ${v3(KERB.colours[1][0])} : ${v3(KERB.colours[0][0])};
	vec3 other = vKerbStyle > 1.5 ? ${v3(KERB.colours[2][1])} : ${v3(KERB.colours[0][1])};
	vec3 paint = mix( first, other, second );
	// Tyre rubber over the track-side 30 %, where the line uses the kerb.
	float across = clamp( vKerbAcross / ${f(KERB.width)}, 0.0, 1.0 );
	float trackSide = 1.0 - smoothstep( .18, .42, across );
	float grime = finishFilteredNoise( vFinishWorld.xz * vec2( 3.1, 0.8 ) );
	float kerbUse = max( vKerbUsage, ${f(KERB.wearFloor)} );
	kerbWear = clamp( kerbUse * trackSide * ( .55 + .6 * grime ), 0.0, 1.0 );
	float crossingScuffs = apexEdgeScuffs( vKerbAcross, vFinishMetres.y, sign( vFinishMetres.x ) );
	kerbWear = max( kerbWear, crossingScuffs * ( .2 + .8 * kerbUse ) );
	// Rolled paint over cast concrete: fine grit, and chips through to the
	// grey concrete where tyres strike the kerb, plus dust in the grooves.
	float grit = finishFilteredNoise( vFinishWorld.xz * 41.0 );
	paint *= .9 + .2 * grit;
	float chip = smoothstep( .74, .84, finishFilteredNoise( vFinishWorld.xz * 9.0 + vec2( 3.3, 1.7 ) ) * .7 + grit * .3 );
	paint = mix( paint, vec3( .32, .31, .29 ) * ( .85 + .3 * grit ), chip * ( .25 + .6 * kerbUse ) );
	// Brown dust in the ridge troughs (the same 0.65 m phase as the relief),
	// converged to its mean before the ridges alias.
	float dustBand = smoothstep( ${f(KERB.ridge.from)}, ${f(KERB.ridge.from + 0.06)}, vKerbAcross ) * ( 1.0 - smoothstep( ${f(KERB.ridge.to - 0.06)}, ${f(KERB.ridge.to)}, vKerbAcross ) );
	float dustPhase = vFinishMetres.y * ${f((2 * Math.PI) / KERB.ridge.period)};
	float dustTrough = mix( .3, smoothstep( .2, 1.0, - sin( dustPhase ) ), 1.0 - smoothstep( .8, 2.5, fwidth( dustPhase ) ) );
	paint = mix( paint, ${v3(KERB.dust)} * ( .8 + .4 * grime ), dustBand * dustTrough * ( .22 + .25 * grime ) );
	paint = mix( paint, ${v3(KERB.rubber)}, kerbWear * .78 );
	kerbPaint = paint;
	diffuseColor.rgb = paint;
}`,
      'fragment',
    );
    // Keep the following circuit-finish chips and panel joints. The former
    // colour-stage reset erased them along with the unused legacy vertex tint.
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `roughnessFactor = mix( ${f(KERB.roughness.fresh)}, ${f(KERB.roughness.worn)}, kerbWear );`,
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `{
	// D15 ridges: the 0.65 m physics corrugation, shaded only.
	float band = smoothstep( ${f(KERB.ridge.from)}, ${f(KERB.ridge.from + 0.06)}, vKerbAcross ) * ( 1.0 - smoothstep( ${f(KERB.ridge.to - 0.06)}, ${f(KERB.ridge.to)}, vKerbAcross ) );
	float ridgePhase = vFinishMetres.y * ${f((2 * Math.PI) / KERB.ridge.period)};
	float ridgeAA = 1.0 - smoothstep( .8, 2.5, fwidth( ridgePhase ) );
	normal = apexReliefNormal( normal, ${f(KERB.ridge.amplitude)} * sin( ridgePhase ) * band * ridgeAA );
}`,
      'fragment',
    );
  });
}

/** Install on the run-off ribbon material (after `installCircuitFinish(m, 'paint')`). */
export function installRunoffFinish(material: T.MeshStandardMaterial, lapLength = 3600) {
  material.color.setHex(0xffffff);
  return chainShaderHook(material, RUNOFF_HOOK, (shader) => {
    installTrackEdgeHelpers(shader, lapLength);
    injectDeclarations(
      shader,
      'common',
      'attribute float runoffStyle;\nattribute float kerbUsage;\nattribute float edgeMetres;\nvarying float vRunoffStyle;\nvarying float vRunoffUsage;\nvarying float vRunoffEdge;',
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      'vRunoffStyle = runoffStyle;\nvRunoffUsage = kerbUsage;\nvRunoffEdge = edgeMetres;',
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      'varying float vRunoffStyle;\nvarying float vRunoffUsage;\nvarying float vRunoffEdge;',
      'fragment',
    );
    injectAfter(
      shader,
      'map_fragment',
      `{
	// D15 run-off: painted band and chevrons over grey, or astroturf.
	float e = vRunoffEdge;
	float tex = dot( diffuseColor.rgb, vec3( .3333 ) ) / .32;
	float grain = finishFilteredNoise( vFinishWorld.xz * 6.0 );
	// Derivatives are evaluated before the per-style branch. The same paths
	// on the adjacent kerb continue through the painted apron without a seam.
	float crossingScuffs = apexEdgeScuffs( e, vFinishMetres.y, sign( vFinishMetres.x ) );
	float vergeWear = apexVergeWear( vFinishWorld.xz, e );
	vec3 vergeSoil = apexVergeSoil( vFinishWorld.xz );
	vec3 base = ${v3(RUNOFF.base)} * ( .9 + .2 * grain ) * clamp( tex, .75, 1.25 );
	int style = int( vRunoffStyle + .5 );
	vec3 surface;
	if ( style == 4 ) {
		// Astroturf: fibre noise along s and a slight sheen variation.
		float fibre = finishFilteredNoise( vFinishMetres * vec2( 9.0, 40.0 ) );
		surface = ${v3(RUNOFF.turf)} * ( .78 + .34 * fibre ) * ( .92 + .16 * grain );
	} else {
		vec3 bandColour = style == 1 ? ${v3(RUNOFF.bands[1])} : style == 2 ? ${v3(RUNOFF.bands[2])} : style == 3 ? ${v3(RUNOFF.bands[3])} : ${v3(RUNOFF.bands[0])};
		float px = max( fwidth( e ), 1e-4 );
		float band = smoothstep( ${f(RUNOFF.band[0])} - px, ${f(RUNOFF.band[0])} + px, e ) * ( 1.0 - smoothstep( ${f(RUNOFF.band[1])} - px, ${f(RUNOFF.band[1])} + px, e ) );
		// White chevrons inside the band, pointing along the lap.
		float u = ( e - ${f(RUNOFF.band[0])} ) / ${f(RUNOFF.band[1] - RUNOFF.band[0])};
		float chevPhase = vFinishMetres.y / ${f(RUNOFF.chevronPitch)} + abs( u - .5 ) * .6;
		float chevron = apexStripeCoverage( chevPhase, fwidth( chevPhase ), .07 ) * band;
		// Road paint is rolled onto the asphalt: the chips carry it, the voids
		// between them stay darker, so the aggregate reads through the colour.
		float paintTex = clamp( tex, .8, 1.16 );
		// Rolled paint that cars drive over: worn through in broken patches
		// (more on the chevrons), never a fresh vinyl print.
		float paintWear = smoothstep( .5, .85, finishFilteredNoise( vFinishWorld.xz * 1.3 + vec2( 7.1, 2.9 ) ) * .6 + finishFilteredNoise( vFinishWorld.xz * 11.0 ) * .4 );
		surface = mix( base, bandColour * ( .92 + .14 * grain ) * paintTex, band * .92 * ( 1.0 - .35 * paintWear ) );
		surface = mix( surface, vec3( .62 ) * paintTex, chevron * .85 * ( 1.0 - .55 * paintWear ) );
		// Tyre dirt sprayed off the kerb across the first metre or so.
		float spray = ( 1.0 - smoothstep( ${f(RUNOFF.from)}, ${f(RUNOFF.from + 1.6)}, e ) ) * smoothstep( .35, .8, finishFilteredNoise( vFinishWorld.xz * vec2( 3.7, 1.1 ) ) );
		surface = mix( surface, vec3( .07, .065, .06 ), spray * .35 );
		// Rubber laid by cars running wide: dark arcs along the lap that start
		// at the kerb and fade across the run-off, in sparse corner groups.
		float wideRun = smoothstep( .55, .78, finishFilteredNoise( vec2( vFinishMetres.y * .045, 3.7 ) ) );
		float arc = smoothstep( .52, .7, finishFilteredNoise( vec2( e * 3.2 + vFinishMetres.y * .02, vFinishMetres.y * .11 ) ) );
		float runMarks = wideRun * arc * ( 1.0 - smoothstep( ${f(RUNOFF.from + 0.3)}, ${f(RUNOFF.to - 0.3)}, e ) );
		surface = mix( surface, vec3( .045, .043, .041 ), runMarks * .42 );
		surface = mix( surface, ${v3(KERB.rubber)}, crossingScuffs * ( .2 + .8 * max( vRunoffUsage, ${f(KERB.wearFloor)} ) ) * .78 );
		// Fine grit and dust swept off the grass onto the painted surface.
		float grit = finishFilteredNoise( vFinishWorld.xz * 23.0 );
		surface *= .93 + .14 * grit;
	}
	// Worn soil where the run-off meets the kerb and the grass.
	float seam = 1.0 - smoothstep( 0.0, ${f(RUNOFF.seam)}, abs( e - ${f(RUNOFF.from)} - .1 ) );
	surface = mix( surface, ${v3(RUNOFF.soil)} * ( .8 + .4 * grain ), seam * .55 );
	float grassJoin = smoothstep( 3.62, 4.0, e ) * vergeWear;
	surface = mix( surface, vergeSoil, grassJoin * .78 );
	diffuseColor.rgb = surface;
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `roughnessFactor = int( vRunoffStyle + .5 ) == 4 ? .78 : mix( roughnessFactor, .62, step( ${f(RUNOFF.band[0])}, vRunoffEdge ) * step( vRunoffEdge, ${f(RUNOFF.band[1])} ) );`,
      'fragment',
    );
  });
}
