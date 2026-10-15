p='src/rendering/materials/procedural.ts'
s=open(p).read()
old="""  | 'concrete-smooth'
  | 'concrete-rough';"""
new="""  | 'concrete-smooth'
  | 'concrete-rough'
  | 'soil';"""
assert old in s; s=s.replace(old,new)
old="""  'concrete-smooth',
  'concrete-rough',
]);"""
new="""  'concrete-smooth',
  'concrete-rough',
  'soil',
]);"""
assert old in s; s=s.replace(old,new)
old="""});

const vertexShader = /* glsl */ `"""
new="""  // Worked soil: clods, a scatter of small stones and fine grain; cavities
  // between clods are darker and rougher, stone tops a little smoother.
  soil: {
    relief: 2.2,
    glsl: `
float clods( vec2 uv ) {
	vec4 v = voronoi( uv, 14.0 );
	return smoothstep( 0.55, 0.12, v.x ) * ( 0.55 + 0.45 * v.y );
}
float stones( vec2 uv ) {
	vec4 v = voronoi( uv, 52.0 );
	return step( v.y, 0.2 ) * smoothstep( 0.3, 0.1, v.x );
}
float height( vec2 uv ) {
	return 0.45 * clods( uv ) + 0.3 * fbm( uv, 20.0, 4 ) + 0.3 * stones( uv );
}
vec3 orm( vec2 uv ) {
	float h = height( uv );
	return vec3( mix( 0.66, 1.0, smoothstep( 0.05, 0.55, h ) ), 1.0 - 0.18 * stones( uv ) + 0.06 * fbm( uv, 10.0, 2 ), 1.0 );
}
vec3 albedo( vec2 uv ) {
	float tone = 0.84 + 0.2 * fbm( uv, 4.0, 4 ) + 0.12 * clods( uv );
	return vec3( tone * ( 1.0 + 0.3 * stones( uv ) ) );
}`,
  },
});

const vertexShader = /* glsl */ `"""
assert old in s; s=s.replace(old,new,1)
open(p,'w').write(s)

p='src/rendering/materials/library.ts'
s=open(p).read()
old="""// --- Vegetation ------------------------------------------------------------"""
new="""// --- Soil (off-road venues) -------------------------------------------------
export interface SoilOptions {
  /** Detail tile in metres. */
  tile?: number;
}
const SOIL_VERTEX = /* glsl */ `vApexSoil = apexSoilState;`;
const SOIL_COLOR = /* glsl */ `
{
	// Moisture (cell base plus the session's soaking) darkens worked soil; a
	// fresh rut is turned-over, darker earth.
	float wet = clamp( vApexSoil.x + apexSoilWetness, 0.0, 1.0 );
	diffuseColor.rgb *= 1.0 - 0.42 * smoothstep( 0.08, 0.85, wet );
	diffuseColor.rgb *= 1.0 - 0.18 * clamp( vApexSoil.z * 6.0, 0.0, 1.0 );
}`;
const SOIL_ROUGHNESS = /* glsl */ `
{
	float wet = clamp( vApexSoil.x + apexSoilWetness, 0.0, 1.0 );
	// Saturated mud carries a film; compacted lines are slightly polished.
	roughnessFactor = mix( roughnessFactor, 0.5, 0.55 * smoothstep( 0.55, 0.95, wet ) );
	roughnessFactor *= 1.0 - 0.15 * clamp( vApexSoil.y, 0.0, 1.0 );
}`;
/** Loose soil for terrain venues (loam, clay, sand, mud, gravel): the
 * soil kind comes in as the vertex colour; the `apexSoilState` attribute
 * carries (base moisture, compaction, rut depth m) per vertex, and
 * `userData.soil.apexSoilWetness` the session's soaking. Wet soil darkens
 * (porous albedo) and, saturated, gains a water film through the shared
 * surface weather (puddles in ruts). */
export function soil(options: SoilOptions = {}) {
  const repeat = 1 / clamp(options.tile ?? 1.4, 0.05, 20);
  const material = new T.MeshPhysicalMaterial({
    name: 'APEX library soil',
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
    map: textures.get('soil', 'albedo', repeat),
    normalMap: textures.get('soil', 'normal', repeat),
    roughnessMap: textures.get('soil', 'orm', repeat),
    aoMap: textures.get('soil', 'orm', repeat),
    aoMapIntensity: 0.55,
  });
  material.normalScale.set(0.9, 0.9);
  material.color.multiplyScalar(ALBEDO_SCALE);
  const local = { apexSoilWetness: { value: 0 } as T.IUniform<number> };
  material.userData.soil = local;
  chainShaderHook(material, 'library-soil-v1', (shader) => {
    Object.assign(shader.uniforms, local);
    injectDeclarations(shader, 'common', 'attribute vec3 apexSoilState;\\nvarying vec3 vApexSoil;', 'vertex');
    injectAfter(shader, 'begin_vertex', SOIL_VERTEX, 'vertex');
    injectDeclarations(
      shader,
      'common',
      'varying vec3 vApexSoil;\\nuniform float apexSoilWetness;',
      'fragment',
    );
    injectAfter(shader, 'color_fragment', SOIL_COLOR, 'fragment');
    injectAfter(shader, 'roughnessmap_fragment', SOIL_ROUGHNESS, 'fragment');
  });
  installWetSurface(material, { wetAmount: 0.7, puddles: 0.45, porosity: 1 });
  return tag(material, 'soil', false);
}

// --- Vegetation ------------------------------------------------------------"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/rendering/materials/index.ts'
s=open(p).read()
s=s.replace("""  setSurfaceWeather,
  vegetation,
  wetRoad,
} from './library.ts';""","""  setSurfaceWeather,
  soil,
  vegetation,
  wetRoad,
} from './library.ts';""")
s=s.replace("""  concrete,
  vegetation,
  boxProjectUv,""","""  concrete,
  soil,
  vegetation,
  boxProjectUv,""")
s=s.replace("""  RubberOptions,
  VegetationOptions,""","""  RubberOptions,
  SoilOptions,
  VegetationOptions,""")
s=s.replace(""" *   materials.vegetation({ translucency: 0.4, alphaMap });""",""" *   materials.vegetation({ translucency: 0.4, alphaMap });
 *   materials.soil({ tile: 1.4 });""")
open(p,'w').write(s)
