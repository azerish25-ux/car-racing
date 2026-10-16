/**
 * GLSL of the scanned ground layer (ground/scanned-ground.ts).
 *
 * Every identifier carries the `apexScan` prefix (car grounding already owns
 * `apexGround*`). The code is compiled only under `#ifdef APEX_SCAN`, which
 * the layer store sets once the photographed sets are resident; without it
 * (Low preset, node tests, a load failure) the procedural surfaces render
 * exactly as before.
 *
 * Sampling
 *  - World-planar: uv = (x, -z) / metres, so a set keeps its photographed
 *    scale everywhere and +V is -Z (an OpenGL normal map's frame on the
 *    ground is then T = +X, B = -Z, N = +Y, right-handed).
 *  - Hex tiling (`APEX_SCAN_HEX`, High and Ultra): the uv plane is cut into a
 *    triangle lattice; each lattice vertex picks a random offset and rotation
 *    of the tile and the three vertices of a pixel's triangle are blended with
 *    barycentric weights sharpened by the samples' own luminance (Mikkelsen,
 *    "Practical Real-Time Hex-Tiling", JCGT 2022; Heitz and Neyret 2018), so
 *    no repetition reads at any distance. Medium samples the tile once with a
 *    rotated second scale instead (two taps).
 *  - Gradients come from the unrotated uv and are rotated with each tap, so
 *    mip selection and anisotropic filtering are those of a plain lookup.
 *  - A sample returns the colour as a ratio to the set's mean (the scan's
 *    structure and hue variation, not its absolute albedo): surfaces keep
 *    their calibrated, art-directed albedo and take the photograph's detail.
 */

/** Rec. 709 luminance weights. */
const LUMA = 'vec3( 0.2126, 0.7152, 0.0722 )';

export const SCAN_COMMON_GLSL = /* glsl */ `
#ifdef APEX_SCAN
struct ApexScanTaps {
	vec2 uv0; vec2 uv1; vec2 uv2;
	vec2 cs0; vec2 cs1; vec2 cs2;
	vec3 w;
	vec2 dx; vec2 dy;
};
struct ApexScanSample {
	vec3 ratio;   // colour / set mean (linear)
	vec3 n;       // tangent-space normal in the world-planar frame (unit)
	float rough;  // roughness / set mean roughness
	float ao;     // ambient occlusion 0..1
	float height; // luminance ratio, a relief proxy for height blending
};
vec4 apexScanHash4( vec2 p ) {
	vec4 p4 = fract( vec4( p.xyxy ) * vec4( .1031, .1030, .0973, .1099 ) );
	p4 += dot( p4, p4.wzxy + 33.33 );
	return fract( ( p4.xxyz + p4.yzzw ) * p4.zywx );
}
vec2 apexScanRotate( vec2 cs, vec2 v ) {
	return vec2( cs.x * v.x - cs.y * v.y, cs.y * v.x + cs.x * v.y );
}
// Lattice taps for uv (tiles) with its screen gradients (taken by the
// caller in uniform control flow). density: lattice cells per tile.
ApexScanTaps apexScanTaps( vec2 uv, vec2 dx, vec2 dy, float density ) {
	ApexScanTaps t;
	t.dx = dx;
	t.dy = dy;
#ifdef APEX_SCAN_HEX
	vec2 g = uv * density;
	vec2 sk = vec2( g.x - 0.57735027 * g.y, 1.15470054 * g.y );
	vec2 base = floor( sk );
	vec2 f = sk - base;
	float z = 1.0 - f.x - f.y;
	vec2 v0, v1, v2;
	if ( z > 0.0 ) {
		t.w = vec3( z, f.y, f.x );
		v0 = base; v1 = base + vec2( 0.0, 1.0 ); v2 = base + vec2( 1.0, 0.0 );
	} else {
		t.w = vec3( - z, 1.0 - f.y, 1.0 - f.x );
		v0 = base + vec2( 1.0 ); v1 = base + vec2( 1.0, 0.0 ); v2 = base + vec2( 0.0, 1.0 );
	}
	vec4 h0 = apexScanHash4( v0 ), h1 = apexScanHash4( v1 ), h2 = apexScanHash4( v2 );
	float a0 = h0.z * 6.2831853, a1 = h1.z * 6.2831853, a2 = h2.z * 6.2831853;
	t.cs0 = vec2( cos( a0 ), sin( a0 ) );
	t.cs1 = vec2( cos( a1 ), sin( a1 ) );
	t.cs2 = vec2( cos( a2 ), sin( a2 ) );
	t.uv0 = apexScanRotate( t.cs0, uv ) + h0.xy * 7.0;
	t.uv1 = apexScanRotate( t.cs1, uv ) + h1.xy * 7.0;
	t.uv2 = apexScanRotate( t.cs2, uv ) + h2.xy * 7.0;
#else
	// Two taps: the tile and a rotated, 0.37x tile, so the period never lines up.
	t.w = vec3( 0.62, 0.38, 0.0 );
	t.cs0 = vec2( 1.0, 0.0 );
	t.cs1 = vec2( 0.8090170, 0.5877853 );
	t.cs2 = vec2( 1.0, 0.0 );
	t.uv0 = uv;
	t.uv1 = apexScanRotate( t.cs1, uv * 0.37 ) + vec2( 0.31, 0.77 );
	t.uv2 = uv;
#endif
	return t;
}
vec4 apexScanTap( sampler2D tex, ApexScanTaps t, int k ) {
	vec2 cs = k == 0 ? t.cs0 : k == 1 ? t.cs1 : t.cs2;
	vec2 uv = k == 0 ? t.uv0 : k == 1 ? t.uv1 : t.uv2;
#ifndef APEX_SCAN_HEX
	float s = k == 1 ? 0.37 : 1.0;
#else
	float s = 1.0;
#endif
	return textureGrad( tex, uv, apexScanRotate( cs, t.dx ) * s, apexScanRotate( cs, t.dy ) * s );
}
vec3 apexScanNormalTap( sampler2D tex, ApexScanTaps t, int k ) {
	vec3 n = apexScanTap( tex, t, k ).xyz * 2.0 - 1.0;
	vec2 cs = k == 0 ? t.cs0 : k == 1 ? t.cs1 : t.cs2;
	// Back from the tap's rotated frame to the world-planar frame.
	n.xy = apexScanRotate( vec2( cs.x, - cs.y ), n.xy );
	return n;
}
// One set: colour (+ normal, + ORM when hasOrm) through the taps.
// info = (1 / metres, 1 / mean colour); meanRough = the ORM's mean G.
// world, wdx, wdy: planar position (x, z) in metres and its screen
// derivatives (dFdx/dFdy taken where control flow is uniform).
ApexScanSample apexScanLayer( sampler2D colorMap, sampler2D normalMap_, sampler2D ormMap, bool hasOrm,
	vec4 info, float meanRough, vec2 world, vec2 wdx, vec2 wdy, float density ) {
	ApexScanSample s;
	vec2 flipV = vec2( info.x, - info.x );
	ApexScanTaps t = apexScanTaps( world * flipV, wdx * flipV, wdy * flipV, density );
	vec3 c0 = apexScanTap( colorMap, t, 0 ).rgb;
	vec3 c1 = apexScanTap( colorMap, t, 1 ).rgb;
	vec3 w = t.w;
#ifdef APEX_SCAN_HEX
	vec3 c2 = apexScanTap( colorMap, t, 2 ).rgb;
	// Luminance-weighted, sharpened barycentrics: the brighter (higher) tap
	// wins a transition instead of a blurred average of three.
	vec3 l = vec3( dot( c0, ${LUMA} ), dot( c1, ${LUMA} ), dot( c2, ${LUMA} ) );
	l = mix( vec3( 1.0 ), l / max( ( l.x + l.y + l.z ) / 3.0, 1e-4 ), 0.6 );
	w = l * pow( max( w, vec3( 0.0 ) ), vec3( 5.0 ) );
	w /= max( w.x + w.y + w.z, 1e-5 );
	vec3 c = c0 * w.x + c1 * w.y + c2 * w.z;
	vec3 n = apexScanNormalTap( normalMap_, t, 0 ) * w.x + apexScanNormalTap( normalMap_, t, 1 ) * w.y +
		apexScanNormalTap( normalMap_, t, 2 ) * w.z;
	vec3 o = hasOrm ? apexScanTap( ormMap, t, 0 ).rgb * w.x + apexScanTap( ormMap, t, 1 ).rgb * w.y +
		apexScanTap( ormMap, t, 2 ).rgb * w.z : vec3( 1.0, meanRough, 0.0 );
#else
	vec3 c = c0 * w.x + c1 * w.y;
	vec3 n = apexScanNormalTap( normalMap_, t, 0 ) * w.x + apexScanNormalTap( normalMap_, t, 1 ) * w.y;
	vec3 o = hasOrm ? apexScanTap( ormMap, t, 0 ).rgb * w.x + apexScanTap( ormMap, t, 1 ).rgb * w.y
		: vec3( 1.0, meanRough, 0.0 );
#endif
	s.ratio = c * info.yzw;
	s.n = normalize( vec3( n.xy, max( n.z, 0.05 ) ) );
	s.rough = o.g / max( meanRough, 0.05 );
	s.ao = o.r;
	s.height = dot( s.ratio, ${LUMA} );
	return s;
}
// A single unrotated tap of a set's colour ratio at a (large) scale: macro
// variation that breaks up the ground beyond the reach of its detail.
vec3 apexScanMacro( sampler2D colorMap, vec4 info, vec2 world, float scale ) {
	return texture2D( colorMap, world * info.x * scale * vec2( 1.0, - 1.0 ) + vec2( 0.17, 0.61 ) ).rgb * info.yzw;
}
// Tangent-space detail (world-planar frame) onto a view-space normal:
// T = +X, B = -Z projected onto the plane of n. strength scales the slope.
vec3 apexScanPerturb( vec3 n, vec3 ts, float strength ) {
	vec3 tWorld = vec3( 1.0, 0.0, 0.0 );
	vec3 tView = mat3( viewMatrix ) * tWorld;
	tView = normalize( tView - n * dot( n, tView ) );
	vec3 bView = cross( n, tView );
	return normalize( n * ts.z + ( tView * ts.x + bView * ts.y ) * strength );
}
// Blend two tangent-space normals (whiteout).
vec3 apexScanMixNormal( vec3 a, vec3 b, float t ) {
	return normalize( mix( a, b, t ) );
}
#endif
`;

/** Vertex: world position for the scanned layers (instancing and batching aware). */
export const SCAN_VERTEX_GLSL = /* glsl */ `
#ifdef APEX_SCAN
{
	vec4 apexScanP = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		apexScanP = batchingMatrix * apexScanP;
	#endif
	#ifdef USE_INSTANCING
		apexScanP = instanceMatrix * apexScanP;
	#endif
	vScanWorld = ( modelMatrix * apexScanP ).xyz;
}
#endif
`;
