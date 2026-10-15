/** Procedural rain-drop ripples shared by wet materials and the SSR trace.
 * `apexRippleSlope(p, time)` returns the world-XZ slope of the water film for
 * `p` in units of the 0.35 m drop grid; deterministic in presented time. */
export const RIPPLE_GLSL = /* glsl */ `
float apexHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float apexNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p ), u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( apexHash( i ), apexHash( i + vec2( 1.0, 0.0 ) ), u.x ),
		mix( apexHash( i + vec2( 0.0, 1.0 ) ), apexHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
// Expanding rain-drop rings on a 0.35 m grid: world-XZ slope of the film.
vec2 apexRippleSlope( vec2 p, float time ) {
	vec2 cell = floor( p ), slope = vec2( 0.0 );
	for ( int y = -1; y <= 1; y ++ )
		for ( int x = -1; x <= 1; x ++ ) {
			vec2 c = cell + vec2( float( x ), float( y ) );
			float h = apexHash( c );
			vec2 centre = c + 0.5 + ( vec2( h, apexHash( c + 7.3 ) ) - 0.5 ) * 0.7;
			float age = fract( time * ( 0.8 + 0.4 * h ) + h );
			vec2 d = p - centre;
			float r = length( d ) + 1e-4;
			float front = r - age * 0.9;
			float wave = sin( front * 31.4 ) * exp( - front * front * 60.0 ) * ( 1.0 - age ) * ( 1.0 - age );
			slope += d / r * wave;
		}
	return slope;
}`;
