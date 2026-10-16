import type * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';

/** Original surface treatment from REF_041, REF_043–047, REF_058 and REF_060:
 * narrow curved contact paths cross kerb and paint, and the grass starts with
 * an uneven worn soil edge. Metre coordinates and filtered coverage keep both
 * features coherent across ribbon chunks and useful at riding-camera height. */
export const TRACK_EDGE_WEAR_GLSL = /* glsl */ `
uniform float apexEdgeLapLength;

float apexEdgeScuffs( float edge, float lap, float side ) {
	float cells = max( 1.0, floor( apexEdgeLapLength / 36.0 + .5 ) );
	float phase = lap * cells / apexEdgeLapLength;
	float block = mod( floor( phase ), cells );
	float along = fract( phase ) * apexEdgeLapLength / cells;
	float rubber = 0.0;
	for ( int pass = 0; pass < 3; pass++ ) {
		vec2 key = vec2( block, side * 11.0 + float( pass ) * 5.7 );
		float seed = finishHash( key + 17.3 );
		float start = 1.5 + finishHash( key + 3.1 ) * 8.0;
		float span = 7.0 + finishHash( key + 8.6 ) * 13.0;
		float u = ( along - start ) / span;
		// A wheel curves outward across the edge as a rider runs wide.
		float path = .02 + float( pass ) * .12 + u * 2.65 + sin( u * 3.14159 ) * .3;
		float distance = edge - path;
		float footprint = max( fwidth( distance ), .001 );
		float width = .052 + seed * .047;
		float stripe = 1.0 - smoothstep( width - footprint, width + footprint, abs( distance ) );
		float ends = smoothstep( .0, .16, u ) * ( 1.0 - smoothstep( .75, 1.0, u ) );
		float event = smoothstep( .35, .7, finishHash( vec2( block, side + 31.7 ) ) );
		// Fading a subpixel stripe avoids crawl without widening the tread.
		float resolved = 1.0 - smoothstep( .18, .55, footprint );
		rubber = max( rubber, stripe * ends * event * resolved * ( .68 + .32 * seed ) );
	}
	return rubber;
}

float apexVergeWear( vec2 world, float edge ) {
	float erosion = finishFilteredNoise( world * .43 + vec2( 11.7, 3.8 ) );
	float fine = finishFilteredNoise( world * 3.2 );
	float reach = 4.06 + erosion * .58 + ( fine - .5 ) * .11;
	float feather = max( fwidth( edge ), .06 );
	return 1.0 - smoothstep( reach - feather, reach + .14 + feather, edge );
}

vec3 apexVergeSoil( vec2 world ) {
	// Same warm, desaturated soil on either side of the paint/grass join.
	return vec3( .1470, .1022, .0595 ) * ( .8 + .4 * finishFilteredNoise( world * 6.0 ) );
}
`;

export function installTrackEdgeHelpers(
  shader: T.WebGLProgramParametersWithUniforms,
  lapLength: number,
) {
  if (!Number.isFinite(lapLength) || lapLength <= 0) throw new Error('Invalid edge-wear lap');
  shader.uniforms.apexEdgeLapLength = { value: lapLength };
  injectAfter(shader, 'clipping_planes_pars_fragment', TRACK_EDGE_WEAR_GLSL, 'fragment');
}

/** Only grass ribbons have the edgeMetres attribute. The far terrain keeps
 * its existing treatment rather than assuming it is a circuit verge. */
export function installVergeFinish(material: T.MeshStandardMaterial) {
  return chainShaderHook(material, 'track-verge-wear-v1', (shader) => {
    installTrackEdgeHelpers(shader, 1);
    injectDeclarations(
      shader,
      'common',
      'attribute float edgeMetres; varying float vVergeEdge;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vVergeEdge = edgeMetres;', 'vertex');
    injectDeclarations(shader, 'common', 'varying float vVergeEdge;', 'fragment');
    // After the photographed turf: keep the original scan's fine structure,
    // while the actual material boundary becomes worn soil instead of a ruler.
    injectAfter(
      shader,
      'color_fragment',
      `{
	float soil = apexVergeWear( vFinishWorld.xz, vVergeEdge );
	float detail = clamp( dot( diffuseColor.rgb, vec3( .2126, .7152, .0722 ) ) / .095, .65, 1.3 );
	diffuseColor.rgb = mix( diffuseColor.rgb, apexVergeSoil( vFinishWorld.xz ) * detail, soil * .88 );
}`,
      'fragment',
    );
  });
}
