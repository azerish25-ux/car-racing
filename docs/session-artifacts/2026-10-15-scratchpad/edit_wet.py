p='src/rendering/materials.ts'
s=open(p).read()
old="""      '#include <roughnessmap_fragment>\\nroughnessFactor=mix(roughnessFactor,mix(0.22,0.08,puddle),wet);',"""
new="""      `#include <roughnessmap_fragment>
      // Water depth, not only the puddle mask, drives the film: from about
      // ${ROAD_FILM.sheetMm[1]} mm the racing surface carries a continuous sheet of water.
      float roadSheet = max(puddle, smoothstep(${ROAD_FILM.sheetMm[0].toFixed(2)}, ${ROAD_FILM.sheetMm[1].toFixed(2)}, waterMm));
      roughnessFactor=mix(roughnessFactor,mix(0.22,0.08,roadSheet),wet);`,"""
assert old in s, 'rough'; s=s.replace(old,new)
old="""      float roadRippleGain = puddle * min(1.,roadWeather.x/18.) * roadRippleResolved * .009;"""
new="""      float roadRippleGain = roadSheet * min(1.,roadWeather.x/18.) * roadRippleResolved * .009;"""
assert old in s, 'ripple'; s=s.replace(old,new)
old="""        clearcoatNormal = normalize(mix(roadFilmNormal, clearcoatNormal, puddle));"""
new="""        clearcoatNormal = normalize(mix(roadFilmNormal, clearcoatNormal, roadSheet));"""
assert old in s, 'ccn'; s=s.replace(old,new)
old="""        material.clearcoat = wet * mix(0.58, 1.0, puddle);
        // Stock clearcoat represents a 1.5-IOR varnish. This lobe is water,
        // whose normal-incidence Fresnel response is approximately half as large.
        material.clearcoatF0 = vec3(${ROAD_FILM_F0.toFixed(9)});
        material.clearcoatRoughness = mix(0.26, mix(0.22, 0.055, puddle), wet);
        // Rain-disturbed film broadens the highlight instead of making every wet
        // cell a perfect mirror. Existing cell water alone still owns coverage.
        material.clearcoatRoughness += min(1.,roadWeather.x/18.)*puddle*.045;"""
new="""        // A sheet of water is a full, smooth coat (roughness ~${ROAD_FILM.sheetRoughness}, ripples
        // on top); a damp film and the emerging dry line (wet ~0.55 there)
        // stay a weaker, broader lobe (~0.15).
        material.clearcoat = wet * mix(0.58, 1.0, roadSheet);
        // Stock clearcoat represents a 1.5-IOR varnish. This lobe is water,
        // whose normal-incidence Fresnel response is approximately half as large.
        material.clearcoatF0 = vec3(${ROAD_FILM_F0.toFixed(9)});
        material.clearcoatRoughness = mix(0.26, mix(0.22, ${ROAD_FILM.sheetRoughness.toFixed(3)}, roadSheet), wet);
        // Rain-disturbed water broadens the highlight a little; the ripple
        // normals carry most of the disturbance.
        material.clearcoatRoughness += min(1.,roadWeather.x/18.)*roadSheet*${ROAD_FILM.rainRoughness.toFixed(3)};"""
assert old in s, 'coat'; s=s.replace(old,new)
s=s.replace("`${previousKey}|apex-physical-asphalt-v5-conforming-film|","`${previousKey}|apex-physical-asphalt-v6-water-sheet|")
old="""export const ROAD_FILM_F0 = ((ROAD_FILM_IOR - 1) / (ROAD_FILM_IOR + 1)) ** 2;"""
new="""export const ROAD_FILM_F0 = ((ROAD_FILM_IOR - 1) / (ROAD_FILM_IOR + 1)) ** 2;
/** Wet road film (photoreal pass): water depth (mm, the simulation's cell
 * water) over which a damp film becomes a continuous sheet, the sheet's coat
 * roughness and the extra roughness of heavy rain on it. A heavy-rain track
 * (0.9 mm) was a 0.58-strength, ~0.22-roughness satin outside the puddle
 * mask, with no reflections of the cars, their rain lights or the sky. */
export const ROAD_FILM = Object.freeze({
  sheetMm: Object.freeze([0.3, 0.55] as const),
  sheetRoughness: 0.065,
  rainRoughness: 0.02,
});"""
assert old in s, 'f0'; s=s.replace(old,new)
open(p,'w').write(s)

p='src/rendering/studio/wet-detail.ts'
s=open(p).read()
old="""	puddle *= smoothstep( 0.42, 0.62, puddleField + 0.35 * ( puddle - 0.5 ) );"""
new="""	// Coverage grows with depth: deeper water joins the hollows into sheets.
	puddleField += ${f(PUDDLES.depthBias)} * smoothstep( ${f(PUDDLES.depthMm[0])}, ${f(PUDDLES.depthMm[1])}, waterMm );
	puddle *= smoothstep( 0.42, 0.62, puddleField + 0.35 * ( puddle - 0.5 ) );"""
assert old in s; s=s.replace(old,new)
old="""  /** Puddle suppression on the racing line. */
  lineBias: 0.3,
});"""
new="""  /** Puddle suppression on the racing line. */
  lineBias: 0.3,
  /** Extra puddle bias as the water deepens over `depthMm`. */
  depthBias: 0.25,
  depthMm: Object.freeze([0.8, 1.6] as const),
});"""
assert old in s; s=s.replace(old,new)
s=s.replace("export const WET_DETAIL_HOOK = 'wet-detail-v1';","export const WET_DETAIL_HOOK = 'wet-detail-v2';")
open(p,'w').write(s)

p='src/rendering/ultra/ssr.ts'
s=open(p).read()
old="""  /** Water/varnish F0. */
  f0: 0.04,
});"""
new="""  /** Water/varnish F0. */
  f0: 0.04,
  /** Wet upward surfaces: reflections stretch along the screen direction to
   * their hit (the view-projected normal) by up to this share of that
   * distance, with `streakTaps` jittered taps per reused ray, so rain lights
   * and the bright horizon become long streaks as on a real wet road. */
  streak: 0.3,
  streakTaps: 4,
});"""
assert old in s; s=s.replace(old,new)
old="""uniform float probeLod;
#ifdef ENVMAP_TYPE_CUBE_UV
uniform sampler2D envMap;
#endif
varying vec2 vUv;"""
new="""uniform float probeLod;
// 0..1 surface wetness: streak length on upward wet surfaces.
uniform float streak;
#ifdef ENVMAP_TYPE_CUBE_UV
uniform sampler2D envMap;
#endif
varying vec2 vUv;"""
assert old in s; s=s.replace(old,new)
old="""	vec3 v = normalize( - p );
	float centreZ = - p.z;
	// Ray reuse: the four nearest half-resolution rays, depth-weighted."""
new="""	vec3 v = normalize( - p );
	float centreZ = - p.z;
	// Wet road streaks: upward surfaces only, jittered per pixel (TAA resolves).
	float stretch = streak * ${SSR.streak.toFixed(3)} * smoothstep( 0.8, 0.95, ( cameraWorld * vec4( n, 0.0 ) ).y );
	float streakJitter = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
	// Ray reuse: the four nearest half-resolution rays, depth-weighted."""
assert old in s; s=s.replace(old,new)
old="""			float w = ray.z * similar;
			sum += limited( texture2D( tColor, ray.xy ).rgb ) * w;"""
new="""			float w = ray.z * similar;
			vec3 hitColour = limited( texture2D( tColor, ray.xy ).rgb );
			if ( stretch > 0.001 ) {
				// Tent-weighted taps along the direction to the hit.
				vec2 axis = ( ray.xy - vUv ) * stretch;
				vec3 streaked = hitColour;
				float streakWeight = 1.0;
				for ( int k = 0; k < ${SSR.streakTaps}; k ++ ) {
					float t = ( ( float( k ) + streakJitter ) / ${SSR.streakTaps.toFixed(1)} ) * 2.0 - 1.0;
					float tw = 1.0 - abs( t );
					streaked += limited( texture2D( tColor, clamp( ray.xy + axis * t, vec2( 0.0 ), vec2( 1.0 ) ) ).rgb ) * tw;
					streakWeight += tw;
				}
				hitColour = streaked / streakWeight;
			}
			sum += hitColour * w;"""
assert old in s; s=s.replace(old,new)
old="""      probeActive: { value: 0 },
      probeLod: { value: 6 },
    });"""
new="""      probeActive: { value: 0 },
      probeLod: { value: 6 },
      streak: { value: 0 },
    });"""
assert old in s; s=s.replace(old,new)
old="""  /** Per frame (pipeline.prepare): rain 0..1 for ripples. */
  rain = 0;"""
new="""  /** Per frame (pipeline.prepare): rain 0..1 for ripples. */
  rain = 0;
  /** Per frame (pipeline.prepare): surface wetness 0..1 for wet-road streaks. */
  wet = 0;"""
assert old in s; s=s.replace(old,new)
old="""    this.syncEnvironment();
    draw(this.resolveMaterial, this.output);"""
new="""    this.syncEnvironment();
    this.resolveMaterial.uniforms.streak.value = Math.min(Math.max(this.wet, 0), 1);
    draw(this.resolveMaterial, this.output);"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/rendering/ultra/pipeline.ts'
s=open(p).read()
old="""    this.ssr.rain = frame.studio ? 0 : rain01;"""
new="""    this.ssr.rain = frame.studio ? 0 : rain01;
    this.ssr.wet = frame.studio ? 0 : wet;"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
