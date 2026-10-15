import type * as T from 'three';
import { chainShaderHook, injectAfter } from './shader-hooks.ts';

/**
 * Wet racing surface detail (D22 weather-wet), on the main road material only
 * (it needs the racing-line attributes of D04's road detail).
 *
 * The simulation's water grid is 5.8 × 2.3 m per cell, so standing water
 * appeared as uniform tiles. Within each cell:
 *  - puddles gather where a two-scale world noise allows, more at the road
 *    edges and less on the racing line (`PUDDLES`);
 *  - a dry line emerges as rain eases: `wet *= mix(1, 0.55, line ·
 *    smoothstep(0.2, 0.65, mm) · (1 − puddle))` (`DRY_LINE`).
 * The darkening already applied for the cell's water is rescaled to the new
 * wetness; roughness and the water-film coat follow automatically. Dry cells
 * are untouched (both terms are 0 there). Deterministic world space.
 */
export const PUDDLES = Object.freeze({
  /** Noise scales, metres. */
  scales: Object.freeze([3.2, 0.9] as const),
  /** Extra puddle bias at the asphalt edge (vEdgeMetres near 0). */
  edgeBias: 0.28,
  /** Puddle suppression on the racing line. */
  lineBias: 0.3,
  /** Extra puddle bias as the water deepens over `depthMm`. */
  depthBias: 0.25,
  depthMm: Object.freeze([0.8, 1.6] as const),
});
export const DRY_LINE = Object.freeze({
  sigma: 0.85,
  depth: 0.55,
  mm: Object.freeze([0.2, 0.65] as const),
});

const f = (v: number) => v.toFixed(4);
const GLSL = /* glsl */ `{
	// D22: sub-cell puddles and an emerging dry line within the water grid.
	float wetLine = exp( -0.5 * pow( vApexLine.x / ${f(DRY_LINE.sigma)}, 2.0 ) );
	// 1 at the asphalt edge, 0 from two and a half metres in.
	float wetEdge = smoothstep( -2.5, -0.2, vEdgeMetres );
	float puddleField = 0.65 * apexRoadNoise( vRoadMetres / ${f(PUDDLES.scales[0])} ) + 0.35 * apexRoadNoise( vRoadMetres / ${f(PUDDLES.scales[1])} + vec2( 7.1, 3.3 ) );
	puddleField += ${f(PUDDLES.edgeBias)} * wetEdge - ${f(PUDDLES.lineBias)} * wetLine;
	float wetBefore = wet;
	// Coverage grows with depth: deeper water joins the hollows into sheets.
	puddleField += ${f(PUDDLES.depthBias)} * smoothstep( ${f(PUDDLES.depthMm[0])}, ${f(PUDDLES.depthMm[1])}, waterMm );
	puddle *= smoothstep( 0.42, 0.62, puddleField + 0.35 * ( puddle - 0.5 ) );
	wet *= mix( 1.0, ${f(DRY_LINE.depth)}, wetLine * smoothstep( ${f(DRY_LINE.mm[0])}, ${f(DRY_LINE.mm[1])}, waterMm ) * ( 1.0 - puddle ) );
	diffuseColor.rgb *= mix( 1.0, 0.6, wet ) / mix( 1.0, 0.58, wetBefore );
}`;

export const WET_DETAIL_HOOK = 'wet-detail-v2';
/** Chain onto the road material after installWetRoad and installRoadDetail. */
export function installWetDetail(material: T.Material) {
  return chainShaderHook(material, WET_DETAIL_HOOK, (shader) => {
    injectAfter(shader, 'color_fragment', GLSL, 'fragment');
  });
}
