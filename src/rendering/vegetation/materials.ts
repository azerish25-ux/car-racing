import * as T from 'three';
import { chainShaderHook, injectAfter, injectBefore } from '../studio/shader-hooks.ts';
import { useStudioUniforms } from '../studio/studio-frame.ts';

/**
 * Shading of the baked photographic vegetation (scripts/assets/vegetation):
 * leaf cards, decimated trunks, multi-view impostors and grass clumps. All
 * are MeshStandardMaterial (sun, sky IBL, shadows and fog as every other
 * surface) with chained shader hooks:
 *
 *  - cards turn part-way toward the viewer (`VEGETATION.facing`) about their
 *    centre, so the billboard cloud keeps its volume from every side; the
 *    frame is computed from the shared main-camera eye (`vegEye`), so colour
 *    and shadow passes draw the same cards;
 *  - per-instance distance LOD with a dithered crossfade: near trees (cards
 *    + trunk) fade out over `vegLod.x..y`, impostors fade in over the same
 *    band with the complementary dither, so no pixel is drawn twice or never;
 *  - wind: whole-tree sway growing with height², leaf-card flutter by the
 *    card's flex (distance from the trunk) — on colour and depth alike;
 *  - coverage-preserving minification (alpha grows with the mip level) and
 *    alpha-to-coverage edges;
 *  - sky visibility (volumetric AO baked through the crown) in the normal
 *    atlas alpha darkens indirect light fully and direct light partly;
 *  - leaf translucency: sunlight through the leaf (back-lit diffuse
 *    transmission and forward scatter toward the viewer), shadowed per light.
 */
export const VEGETATION = Object.freeze({
  /** Share of the camera-facing frame in a leaf card's orientation. */
  facing: 0.5,
  /** Near-LOD end (m) per preset and the crossfade band. */
  near: Object.freeze({ low: 26, medium: 40, high: 56, ultra: 72 }),
  band: 6,
  /** Grass clump draw distance (m) per preset. */
  grass: Object.freeze({ low: 0, medium: 28, high: 40, ultra: 55 }),
  /** Indirect / direct occlusion by the baked sky visibility. */
  indirectOcclusion: 1,
  directOcclusion: 0.45,
  /** Diffuse transmission (back-lit) and forward scatter strengths. */
  transmission: 0.55,
  scatter: 0.6,
  roughness: 0.62,
  barkRoughness: 0.88,
  /** Sway (fraction of tree height) and flutter (m) at a 10 m/s wind. */
  sway: 0.008,
  flutter: 0.045,
});

/** Shared per-frame state: the main camera eye and LOD distances. */
export const vegetationUniforms = {
  vegEye: { value: new T.Vector3(0, -1e6, 0) },
  /** (near fade start, near fade end, grass fade start, grass end). */
  vegLod: { value: new T.Vector4(46, 56, 30, 40) },
};

const COMMON_VERTEX = /* glsl */ `
uniform vec3 vegEye;
uniform vec4 vegLod;
uniform float vegPlantHeight;
varying float vVegFade;
vec3 vegOrigin() {
#ifdef USE_INSTANCING
	return ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
#else
	return ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
#endif
}
mat3 vegBasis() {
#ifdef USE_INSTANCING
	return mat3( modelMatrix ) * mat3( instanceMatrix );
#else
	return mat3( modelMatrix );
#endif
}
/** Near-LOD weight of this plant: 1 near, 0 beyond the crossfade band. */
float vegNearWeight() {
	vec3 o = vegOrigin();
	return 1.0 - smoothstep( vegLod.x, vegLod.y, distance( vegEye.xz, o.xz ) );
}
/** World-space wind offset direction and strength (studioWind: x, z m/s, time, gust). */
vec3 vegWind( float heightShare, float flex, float phase, vec3 cardNormal ) {
	vec2 windXZ = studioWind.xy;
	float speed = length( windXZ );
	vec2 dir = speed > 1e-3 ? windXZ / speed : vec2( 0.7071, 0.7071 );
	float strength = clamp( speed / 10.0, 0.12, 1.6 ) * ( 0.6 + 0.4 * studioWind.w );
	vec3 o = vegOrigin();
	float treePhase = dot( o.xz, vec2( 0.37, 0.61 ) );
	float t = studioWind.z;
	float sway = ${VEGETATION.sway.toFixed(4)} * vegPlantHeight * heightShare * heightShare *
		( sin( 0.9 * t + treePhase ) + 0.35 * sin( 2.1 * t + treePhase * 1.7 ) ) * strength;
	float flutter = ${VEGETATION.flutter.toFixed(4)} * flex * sin( 6.0 * t + phase + treePhase * 3.0 ) * strength;
	return vec3( dir.x, 0.0, dir.y ) * ( sway + 0.4 * flutter ) + cardNormal * flutter;
}
`;

/** Collapse a vertex outside the clip volume (its triangle is discarded). */
const COLLAPSE = /* glsl */ `
if ( vVegFade <= 0.0 ) gl_Position = vec4( 0.0, 0.0, -2.0, 1.0 );
`;

const DITHER_FRAGMENT = /* glsl */ `
varying float vVegFade;
float vegDither() {
	return fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
}
`;

/** Card frame, flutter and LOD: shared by colour and shadow programs. */
const CARD_VERTEX = /* glsl */ `
attribute vec2 cardCorner;
attribute vec2 cardSize;
attribute vec3 cardRight;
attribute vec2 cardWind;
uniform float vegFacing;
void vegCardFrame( out vec3 R, out vec3 U, out vec3 N ) {
	mat3 basis = vegBasis();
	vec3 toEye = vegEye - ( vegOrigin() + basis * position );
	vec3 eye = normalize( transpose( basis ) * toEye );
	vec3 fN = normalize( vec3( eye.x, eye.y * 0.5, eye.z ) );
	vec3 fR = normalize( cross( vec3( 0.0, 1.0, 0.0 ), fN ) );
	float side = dot( normal, fN ) < 0.0 ? -1.0 : 1.0;
	N = normalize( mix( normal, fN * side, vegFacing ) );
	R = mix( cardRight, fR * side, vegFacing );
	R = normalize( R - N * dot( R, N ) );
	U = cross( N, R );
}
`;

function cardVertexHook(shader: T.WebGLProgramParametersWithUniforms, lit: boolean) {
  useStudioUniforms(shader, ['studioWind'], 'vertex');
  Object.assign(shader.uniforms, vegetationUniforms);
  injectAfter(shader, 'common', COMMON_VERTEX + CARD_VERTEX, 'vertex');
  if (lit)
    injectAfter(
      shader,
      'beginnormal_vertex',
      /* glsl */ `{
	vec3 cR, cU, cN;
	vegCardFrame( cR, cU, cN );
	objectNormal = cN;
	#ifdef USE_TANGENT
	objectTangent = cR;
	#endif
}`,
      'vertex',
    );
  injectAfter(
    shader,
    'begin_vertex',
    /* glsl */ `{
	vec3 cR, cU, cN;
	vegCardFrame( cR, cU, cN );
	transformed = position + cR * cardCorner.x * cardSize.x + cU * cardCorner.y * cardSize.y;
	vec3 windW = vegWind( clamp( transformed.y / max( vegPlantHeight, 0.1 ), 0.0, 1.2 ), cardWind.x, cardWind.y, vec3( 0.0 ) );
	mat3 basis = vegBasis();
	transformed += transpose( basis ) * windW / max( dot( basis[0], basis[0] ), 1e-6 );
	transformed += cN * ${VEGETATION.flutter.toFixed(4)} * cardWind.x * sin( 6.0 * studioWind.z + cardWind.y ) * clamp( length( studioWind.xy ) / 10.0, 0.12, 1.6 );
	vVegFade = vegNearWeight();
}`,
    'vertex',
  );
  injectAfter(shader, 'project_vertex', COLLAPSE, 'vertex');
}

/** Trunk sway and LOD (no card frame). */
function barkVertexHook(shader: T.WebGLProgramParametersWithUniforms) {
  useStudioUniforms(shader, ['studioWind'], 'vertex');
  Object.assign(shader.uniforms, vegetationUniforms);
  injectAfter(shader, 'common', COMMON_VERTEX, 'vertex');
  injectAfter(
    shader,
    'begin_vertex',
    /* glsl */ `{
	vec3 windW = vegWind( clamp( transformed.y / max( vegPlantHeight, 0.1 ), 0.0, 1.2 ), 0.0, 0.0, vec3( 0.0 ) );
	mat3 basis = vegBasis();
	transformed += transpose( basis ) * windW / max( dot( basis[0], basis[0] ), 1e-6 );
	vVegFade = vegNearWeight();
}`,
    'vertex',
  );
  injectAfter(shader, 'project_vertex', COLLAPSE, 'vertex');
}

/** Near-LOD dither: keep a fragment while its fade exceeds the dither. */
function nearFadeFragment(shader: T.WebGLProgramParametersWithUniforms) {
  injectAfter(shader, 'common', DITHER_FRAGMENT, 'fragment');
  injectAfter(
    shader,
    'clipping_planes_fragment',
    'if ( vVegFade < vegDither() ) discard;',
    'fragment',
  );
}

/** Alpha grows with the mip level so minified cards keep their coverage. */
function coverageFragment(shader: T.WebGLProgramParametersWithUniforms, sizeUniform: string) {
  injectAfter(shader, 'common', `uniform vec2 ${sizeUniform};`, 'fragment');
  injectBefore(
    shader,
    'alphatest_fragment',
    /* glsl */ `{
	#ifdef USE_MAP
	vec2 texels = vMapUv * ${sizeUniform};
	float mip = max( 0.0, 0.5 * log2( max( dot( dFdx( texels ), dFdx( texels ) ), dot( dFdy( texels ), dFdy( texels ) ) ) ) );
	diffuseColor.a *= 1.0 + min( mip * 0.08, 0.24 );
	#endif
}`,
    'fragment',
  );
}

const TRANSLUCENT_LIGHTING = /* glsl */ `
float vegThin = 1.0;
void RE_Direct_Vegetation( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	// Light through the leaf: diffuse transmission when lit from behind and a
	// forward lobe toward a viewer looking into the light.
	float back = saturate( - dot( geometryNormal, directLight.direction ) );
	float forward = pow( saturate( dot( - geometryViewDir, directLight.direction ) ), 5.0 );
	reflectedLight.directDiffuse += directLight.color * material.diffuseColor * vegThin *
		( ${VEGETATION.transmission.toFixed(3)} * back + ${VEGETATION.scatter.toFixed(3)} * forward );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Vegetation
`;

/** Sky visibility from `source` (GLSL float) and leaf translucency. */
function foliageLightingHook(shader: T.WebGLProgramParametersWithUniforms, visibility: string) {
  injectAfter(shader, 'lights_physical_pars_fragment', TRANSLUCENT_LIGHTING, 'fragment');
  injectBefore(
    shader,
    'lights_fragment_begin',
    `float vegVisibility = ${visibility};\nvegThin = 0.35 + 0.65 * vegVisibility;`,
    'fragment',
  );
  injectBefore(
    shader,
    'aomap_fragment',
    /* glsl */ `
	reflectedLight.indirectDiffuse *= mix( 1.0, vegVisibility, ${VEGETATION.indirectOcclusion.toFixed(3)} );
	reflectedLight.indirectSpecular *= vegVisibility;
	reflectedLight.directDiffuse *= mix( 1.0, vegVisibility, ${VEGETATION.directOcclusion.toFixed(3)} );
	reflectedLight.directSpecular *= vegVisibility;`,
    'fragment',
  );
}

export interface FoliageMaps {
  color: T.Texture;
  normal: T.Texture;
}

function plantUniforms(height: number, atlas: T.Texture) {
  const image = atlas.image as { width?: number; height?: number } | undefined;
  return {
    vegPlantHeight: { value: height },
    vegFacing: { value: VEGETATION.facing },
    vegAtlasSize: { value: new T.Vector2(image?.width ?? 2048, image?.height ?? 2048) },
  };
}

/** Leaf-card colour material (double-sided, alpha-to-coverage). */
export function cardMaterial(maps: FoliageMaps, plantHeight: number, name: string) {
  const material = new T.MeshStandardMaterial({
    name,
    map: maps.color,
    normalMap: maps.normal,
    roughness: VEGETATION.roughness,
    metalness: 0,
    side: T.DoubleSide,
    alphaTest: 0.5,
    alphaToCoverage: true,
  });
  const uniforms = plantUniforms(plantHeight, maps.color);
  chainShaderHook(material, 'photo-foliage-cards-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    cardVertexHook(shader, true);
    nearFadeFragment(shader);
    coverageFragment(shader, 'vegAtlasSize');
    // Back faces mirror the card normal only (sky-up stays up).
    injectAfter(
      shader,
      'normal_fragment_begin',
      /* glsl */ `
	#if defined( DOUBLE_SIDED ) && defined( USE_NORMALMAP_TANGENTSPACE )
	tbn[0] *= faceDirection;
	tbn[1] *= faceDirection;
	#endif`,
      'fragment',
    );
    foliageLightingHook(shader, 'texture2D( normalMap, vNormalMapUv ).a');
  });
  material.userData.vegetationUniforms = uniforms;
  return material;
}

/** Shadow-pass programs of leaf cards (same frame, wind, LOD and coverage). */
export function cardDepthMaterials(maps: FoliageMaps, plantHeight: number) {
  const uniforms = plantUniforms(plantHeight, maps.color);
  const hook = (shader: T.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    cardVertexHook(shader, false);
    nearFadeFragment(shader);
    coverageFragment(shader, 'vegAtlasSize');
  };
  const depth = new T.MeshDepthMaterial({
    depthPacking: T.RGBADepthPacking,
    map: maps.color,
    alphaTest: 0.5,
    side: T.DoubleSide,
  });
  const distance = new T.MeshDistanceMaterial({
    map: maps.color,
    alphaTest: 0.5,
    side: T.DoubleSide,
  });
  chainShaderHook(depth, 'photo-foliage-cards-v1', hook);
  chainShaderHook(distance, 'photo-foliage-cards-v1', hook);
  return { depth, distance };
}

export interface BarkMaps {
  color: T.Texture | null;
  normal: T.Texture | null;
}
/** Trunk and limbs: bark texture, relief normal, baked sky visibility, sway. */
export function barkMaterial(maps: BarkMaps, plantHeight: number, name: string) {
  const material = new T.MeshStandardMaterial({
    name,
    map: maps.color,
    normalMap: maps.normal,
    color: maps.color ? 0xffffff : 0x5d5246,
    roughness: VEGETATION.barkRoughness,
    metalness: 0,
  });
  const uniforms = { vegPlantHeight: { value: plantHeight } };
  chainShaderHook(material, 'photo-foliage-bark-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    barkVertexHook(shader);
    injectAfter(
      shader,
      'common',
      'attribute float barkVisibility;\nvarying float vBarkVisibility;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vBarkVisibility = barkVisibility;', 'vertex');
    injectAfter(shader, 'common', 'varying float vBarkVisibility;', 'fragment');
    nearFadeFragment(shader);
    injectBefore(
      shader,
      'aomap_fragment',
      /* glsl */ `
	reflectedLight.indirectDiffuse *= vBarkVisibility;
	reflectedLight.indirectSpecular *= vBarkVisibility;
	reflectedLight.directDiffuse *= mix( 1.0, vBarkVisibility, ${VEGETATION.directOcclusion.toFixed(3)} );`,
      'fragment',
    );
  });
  const hook = (shader: T.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    barkVertexHook(shader);
    nearFadeFragment(shader);
  };
  const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
  const distance = new T.MeshDistanceMaterial();
  chainShaderHook(depth, 'photo-foliage-bark-v1', hook);
  chainShaderHook(distance, 'photo-foliage-bark-v1', hook);
  return { material, depth, distance };
}

export interface ImpostorLayout {
  views: number;
  columns: number;
  rows: number;
  halfWidth: number;
  height: number;
}

/**
 * Multi-view impostor: a quad turned about the trunk axis toward the camera,
 * blending the two baked views nearest the viewer's azimuth (colour, coverage,
 * tangent-space normal and sky visibility), lit like the cards. Fades in
 * where the near trees fade out (complementary dither).
 */
export function impostorMaterial(
  maps: FoliageMaps,
  layout: ImpostorLayout,
  plantHeight: number,
  name: string,
) {
  const material = new T.MeshStandardMaterial({
    name,
    map: maps.color,
    roughness: VEGETATION.roughness,
    metalness: 0,
    side: T.DoubleSide,
    alphaTest: 0.5,
    alphaToCoverage: true,
  });
  const uniforms = {
    vegPlantHeight: { value: plantHeight },
    vegImpostor: {
      value: new T.Vector4(layout.views, layout.columns, layout.rows, layout.halfWidth),
    },
    vegImpostorHeight: { value: layout.height },
    vegImpostorNormal: { value: maps.normal },
    vegAtlasSize: plantUniforms(plantHeight, maps.color).vegAtlasSize,
  };
  chainShaderHook(material, 'photo-foliage-impostor-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    impostorVertex(shader, true);
    injectAfter(shader, 'common', DITHER_FRAGMENT + IMPOSTOR_FRAGMENT_PARS, 'fragment');
    injectAfter(
      shader,
      'clipping_planes_fragment',
      'if ( vVegFade >= vegDither() ) discard;',
      'fragment',
    );
    // Two views blended: replaces the single map sample.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
	vec4 impA = texture2D( map, vImpUvA );
	vec4 impB = texture2D( map, vImpUvB );
	vec4 impColor = mix( impA, impB, vImpBlend );
	diffuseColor *= impColor;`,
    );
    coverageFragmentImpostor(shader);
    injectAfter(
      shader,
      'normal_fragment_maps',
      /* glsl */ `{
	vec4 nA = texture2D( vegImpostorNormal, vImpUvA );
	vec4 nB = texture2D( vegImpostorNormal, vImpUvB );
	vec3 tA = nA.xyz * 2.0 - 1.0, tB = nB.xyz * 2.0 - 1.0;
	vec3 oA = vImpRightA * tA.x + vec3( 0.0, tA.y, 0.0 ) + vImpFrontA * tA.z;
	vec3 oB = vImpRightB * tB.x + vec3( 0.0, tB.y, 0.0 ) + vImpFrontB * tB.z;
	normal = normalize( ( viewMatrix * vec4( normalize( mix( oA, oB, vImpBlend ) ), 0.0 ) ).xyz );
	impVisibility = mix( nA.a, nB.a, vImpBlend );
}`,
      'fragment',
    );
    foliageLightingHook(shader, 'impVisibility');
  });
  const depth = new T.MeshDepthMaterial({
    depthPacking: T.RGBADepthPacking,
    map: maps.color,
    alphaTest: 0.5,
  });
  chainShaderHook(depth, 'photo-foliage-impostor-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    impostorVertex(shader, false);
    injectAfter(shader, 'common', DITHER_FRAGMENT + IMPOSTOR_FRAGMENT_PARS, 'fragment');
    injectAfter(
      shader,
      'clipping_planes_fragment',
      'if ( vVegFade >= vegDither() ) discard;',
      'fragment',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      'diffuseColor *= mix( texture2D( map, vImpUvA ), texture2D( map, vImpUvB ), vImpBlend );',
    );
  });
  return { material, depth };
}

const IMPOSTOR_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D vegImpostorNormal;
varying vec2 vImpUvA;
varying vec2 vImpUvB;
varying float vImpBlend;
varying vec3 vImpRightA;
varying vec3 vImpFrontA;
varying vec3 vImpRightB;
varying vec3 vImpFrontB;
float impVisibility = 1.0;
`;

function coverageFragmentImpostor(shader: T.WebGLProgramParametersWithUniforms) {
  injectBefore(
    shader,
    'alphatest_fragment',
    /* glsl */ `{
	vec2 texels = vImpUvA * vegAtlasSize;
	float mip = max( 0.0, 0.5 * log2( max( dot( dFdx( texels ), dFdx( texels ) ), dot( dFdy( texels ), dFdy( texels ) ) ) ) );
	diffuseColor.a *= 1.0 + min( mip * 0.08, 0.24 );
}`,
    'fragment',
  );
  injectAfter(shader, 'common', 'uniform vec2 vegAtlasSize;', 'fragment');
}

/** Billboard about the trunk axis; view pair and blend from the azimuth. */
function impostorVertex(shader: T.WebGLProgramParametersWithUniforms, lit: boolean) {
  useStudioUniforms(shader, ['studioWind'], 'vertex');
  Object.assign(shader.uniforms, vegetationUniforms);
  injectAfter(
    shader,
    'common',
    COMMON_VERTEX +
      /* glsl */ `
uniform vec4 vegImpostor;
uniform float vegImpostorHeight;
varying vec2 vImpUvA;
varying vec2 vImpUvB;
varying float vImpBlend;
varying vec3 vImpRightA;
varying vec3 vImpFrontA;
varying vec3 vImpRightB;
varying vec3 vImpFrontB;
vec2 vegCellUv( float k, vec2 corner ) {
	float columns = vegImpostor.y, rows = vegImpostor.z;
	float col = mod( k, columns ), row = floor( k / columns );
	return vec2( ( col + corner.x ) / columns, 1.0 - ( row + 1.0 - corner.y ) / rows );
}
float vegAzimuth() {
	mat3 basis = vegBasis();
	vec3 eye = transpose( basis ) * ( cameraPosition - vegOrigin() );
	// Orthographic (shadow) cameras: toward the camera is its +Z axis.
	if ( isOrthographic ) eye = transpose( basis ) * vec3( viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2] );
	return atan( eye.x, eye.z );
}
`,
    'vertex',
  );
  if (lit)
    injectAfter(
      shader,
      'beginnormal_vertex',
      'objectNormal = vec3( sin( vegAzimuth() ), 0.0, cos( vegAzimuth() ) );',
      'vertex',
    );
  injectAfter(
    shader,
    'begin_vertex',
    /* glsl */ `{
	float views = vegImpostor.x;
	float az = vegAzimuth();
	float f = az / 6.283185307 * views;
	float k0 = floor( f );
	vImpBlend = f - k0;
	float kA = mod( k0, views ), kB = mod( k0 + 1.0, views );
	vec2 corner = vec2( position.x * 0.5 + 0.5, position.y );
	vImpUvA = vegCellUv( kA, corner );
	vImpUvB = vegCellUv( kB, corner );
	float aA = kA / views * 6.283185307, aB = kB / views * 6.283185307;
	mat3 basis = vegBasis();
	vec3 xW = normalize( basis[0] ), zW = normalize( basis[2] );
	vImpRightA = xW * cos( aA ) - zW * sin( aA );
	vImpFrontA = xW * sin( aA ) + zW * cos( aA );
	vImpRightB = xW * cos( aB ) - zW * sin( aB );
	vImpFrontB = xW * sin( aB ) + zW * cos( aB );
	vec3 right = vec3( cos( az ), 0.0, - sin( az ) );
	transformed = right * position.x * vegImpostor.w + vec3( 0.0, position.y * vegImpostorHeight, 0.0 );
	vec3 windW = vegWind( position.y, 0.0, 0.0, vec3( 0.0 ) );
	transformed += transpose( basis ) * windW / max( dot( basis[0], basis[0] ), 1e-6 );
	vVegFade = vegNearWeight();
}`,
    'vertex',
  );
  injectAfter(
    shader,
    'project_vertex',
    'if ( vVegFade >= 1.0 ) gl_Position = vec4( 0.0, 0.0, -2.0, 1.0 );',
    'vertex',
  );
}

/** Grass clump cards: crossed quads, tile per instance, sway at the tips,
 * shrink-out beyond the grass distance; normals lean toward the sky. */
export function grassMaterial(maps: FoliageMaps, tileLayout: { columns: number; rows: number }) {
  const material = new T.MeshStandardMaterial({
    name: 'Photographed meadow grass clumps',
    map: maps.color,
    normalMap: maps.normal,
    roughness: 0.75,
    metalness: 0,
    side: T.DoubleSide,
    alphaTest: 0.5,
    alphaToCoverage: true,
  });
  const uniforms = {
    vegGrassTiles: { value: new T.Vector2(tileLayout.columns, tileLayout.rows) },
    vegAtlasSize: plantUniforms(1, maps.color).vegAtlasSize,
  };
  const hook = (shader: T.WebGLProgramParametersWithUniforms, lit: boolean) => {
    Object.assign(shader.uniforms, uniforms, vegetationUniforms);
    useStudioUniforms(shader, ['studioWind'], 'vertex');
    injectAfter(
      shader,
      'common',
      /* glsl */ `
uniform vec3 vegEye;
uniform vec4 vegLod;
uniform vec2 vegGrassTiles;
attribute float grassTile;
varying float vVegFade;
`,
      'vertex',
    );
    injectAfter(
      shader,
      'uv_vertex',
      /* glsl */ `
#ifdef USE_MAP
{
	float col = mod( grassTile, vegGrassTiles.x ), row = floor( grassTile / vegGrassTiles.x );
	vMapUv = vec2( ( col + uv.x ) / vegGrassTiles.x, 1.0 - ( row + 1.0 - uv.y ) / vegGrassTiles.y );
	#ifdef USE_NORMALMAP
	vNormalMapUv = vMapUv;
	#endif
}
#endif`,
      'vertex',
    );
    if (lit)
      injectAfter(
        shader,
        'beginnormal_vertex',
        'objectNormal = normalize( mix( objectNormal, vec3( 0.0, 1.0, 0.0 ), 0.55 ) );',
        'vertex',
      );
    injectAfter(
      shader,
      'begin_vertex',
      /* glsl */ `{
#ifdef USE_INSTANCING
	vec3 o = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	mat3 basis = mat3( modelMatrix ) * mat3( instanceMatrix );
#else
	vec3 o = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	mat3 basis = mat3( modelMatrix );
#endif
	float d = distance( vegEye, o );
	vVegFade = 1.0 - smoothstep( vegLod.z, vegLod.w, d );
	// Shrink into the ground at the far edge instead of popping.
	transformed.y *= mix( 0.2, 1.0, vVegFade );
	vec2 windXZ = studioWind.xy;
	float speed = length( windXZ );
	vec2 dir = speed > 1e-3 ? windXZ / speed : vec2( 0.7071, 0.7071 );
	float bend = uv.y * uv.y * clamp( speed / 10.0, 0.15, 1.6 ) *
		( 0.06 + 0.04 * sin( 2.3 * studioWind.z + dot( o.xz, vec2( 0.9, 1.3 ) ) ) );
	transformed += transpose( basis ) * vec3( dir.x, 0.0, dir.y ) * bend / max( dot( basis[0], basis[0] ), 1e-6 );
}`,
      'vertex',
    );
    injectAfter(shader, 'project_vertex', COLLAPSE, 'vertex');
    injectAfter(shader, 'common', DITHER_FRAGMENT, 'fragment');
    injectAfter(
      shader,
      'clipping_planes_fragment',
      'if ( vVegFade < vegDither() ) discard;',
      'fragment',
    );
    coverageFragment(shader, 'vegAtlasSize');
    // The slab bake occludes the clump by the whole meadow patch around it;
    // a clump on an open verge sees more sky, so its occlusion is halved.
    if (lit)
      foliageLightingHook(shader, '( 0.45 + 0.55 * texture2D( normalMap, vNormalMapUv ).a )');
  };
  chainShaderHook(material, 'photo-grass-v2', (shader) => hook(shader, true));
  const depth = new T.MeshDepthMaterial({
    depthPacking: T.RGBADepthPacking,
    map: maps.color,
    alphaTest: 0.5,
    side: T.DoubleSide,
  });
  chainShaderHook(depth, 'photo-grass-v1', (shader) => hook(shader, false));
  return { material, depth };
}
