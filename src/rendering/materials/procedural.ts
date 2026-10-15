import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * GPU-generated detail textures for the shared material library.
 *
 * No texture is downloaded: every map is drawn once on the GPU from a small
 * tileable recipe (periodic hash noise, Voronoi aggregate, flakes, brushing),
 * read back into a mipmapped, repeating DataTexture and shared by source with
 * every clone a material asks for (each clone owns its own repeat).
 *
 * Until `bake(renderer)` runs (or where it never can, e.g. unit tests), every
 * texture holds its identity value - a flat tangent normal, white ORM/albedo -
 * so a material created early renders exactly as its untextured parameters.
 * Baking replaces the pixels in place at the same size: no reallocation, no
 * program change.
 *
 * Outputs: `normal` (tangent space, OpenGL +Y), `orm` (R ambient occlusion,
 * G roughness multiplier, B metalness multiplier: three's aoMap/roughnessMap/
 * metalnessMap channels) and `albedo` (sRGB multiplier of the material colour).
 */
export type ProceduralRecipe =
  | 'flake'
  | 'brushed'
  | 'micro'
  | 'asphalt-fresh'
  | 'asphalt-worn'
  | 'asphalt-patched'
  | 'concrete-smooth'
  | 'concrete-rough';
export type ProceduralOutput = 'normal' | 'orm' | 'albedo';
export const PROCEDURAL_RECIPES: readonly ProceduralRecipe[] = Object.freeze([
  'flake',
  'brushed',
  'micro',
  'asphalt-fresh',
  'asphalt-worn',
  'asphalt-patched',
  'concrete-smooth',
  'concrete-rough',
]);
/** Texels per side of every baked map (power of two: full mip chain). */
export const PROCEDURAL_SIZE = 512;
/** Identity texel of each output (RGBA8). */
export const PROCEDURAL_IDENTITY: Readonly<Record<ProceduralOutput, readonly number[]>> =
  Object.freeze({
    normal: Object.freeze([128, 128, 255, 255]),
    orm: Object.freeze([255, 255, 255, 255]),
    albedo: Object.freeze([255, 255, 255, 255]),
  });

const COMMON = /* glsl */ `
varying vec2 vUv;
uniform vec2 texel;
float hash12( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
vec2 hash22( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.xx + p3.yz ) * p3.zy );
}
// Value noise, periodic with \`period\` cells along each axis.
float vnoise( vec2 p, vec2 period ) {
	vec2 i = floor( p ), f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float a = hash12( mod( i, period ) );
	float b = hash12( mod( i + vec2( 1.0, 0.0 ), period ) );
	float c = hash12( mod( i + vec2( 0.0, 1.0 ), period ) );
	float d = hash12( mod( i + vec2( 1.0, 1.0 ), period ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
float fbm( vec2 uv, float cells, int octaves ) {
	float sum = 0.0, amplitude = 0.5, norm = 0.0;
	for ( int i = 0; i < 6; i ++ ) {
		if ( i >= octaves ) break;
		sum += amplitude * vnoise( uv * cells, vec2( cells ) );
		norm += amplitude;
		cells *= 2.0;
		amplitude *= 0.5;
	}
	return sum / norm;
}
// Periodic Voronoi: (nearest distance, nearest id hash, edge distance, unused).
vec4 voronoi( vec2 uv, float cells ) {
	vec2 p = uv * cells, i = floor( p ), f = fract( p );
	float d1 = 8.0, d2 = 8.0;
	vec2 id = vec2( 0.0 );
	for ( int y = -1; y <= 1; y ++ )
		for ( int x = -1; x <= 1; x ++ ) {
			vec2 g = vec2( float( x ), float( y ) );
			vec2 c = mod( i + g, vec2( cells ) );
			vec2 r = g + hash22( c ) * 0.85 + 0.075 - f;
			float d = dot( r, r );
			if ( d < d1 ) { d2 = d1; d1 = d; id = c; }
			else if ( d < d2 ) d2 = d;
		}
	return vec4( sqrt( d1 ), hash12( id + 17.0 ), sqrt( d2 ) - sqrt( d1 ), 0.0 );
}
vec3 linearToSrgb( vec3 c ) {
	return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
}
`;

interface Recipe {
  /** GLSL defining `float height(vec2 uv)`, `vec3 orm(vec2 uv)` and `vec3 albedo(vec2 uv)`
   * (linear), or `vec3 directNormal(vec2 uv)` with `#define DIRECT_NORMAL`. */
  glsl: string;
  /** Height-to-slope gain of the normal output. */
  relief: number;
}

const flat =
  'vec3 orm( vec2 uv ) { return vec3( 1.0 ); }\nvec3 albedo( vec2 uv ) { return vec3( 1.0 ); }';
const aggregate = (
  cells: number,
  exposure: number,
  binder: number,
  stone: number,
  patched: boolean,
) => `
float stones( vec2 uv ) {
	vec4 v = voronoi( uv, ${cells.toFixed(1)} );
	float size = 0.34 + 0.18 * v.y;
	return smoothstep( size, size * 0.35, v.x ) * ( 0.65 + 0.35 * v.y );
}
float patchMask( vec2 uv ) {
	${patched ? 'return smoothstep( 0.52, 0.58, fbm( uv, 3.0, 3 ) );' : 'return 0.0;'}
}
float height( vec2 uv ) {
	float s = stones( uv ) * ${exposure.toFixed(3)};
	float b = 0.18 + 0.12 * fbm( uv, 16.0, 4 );
	float h = max( b, s );
	// Patches: a younger, finer and slightly proud overlay.
	float p = patchMask( uv );
	return mix( h, 0.32 + 0.08 * fbm( uv, 48.0, 3 ), p );
}
vec3 orm( vec2 uv ) {
	float s = stones( uv ), p = patchMask( uv );
	float cavity = mix( 0.72, 1.0, smoothstep( 0.1, 0.45, height( uv ) ) );
	// Binder is rough; exposed stone tops are polished by tyres.
	float rough = mix( 1.0, ${(0.62 + 0.25 * (1 - exposure)).toFixed(3)}, smoothstep( 0.2, 0.7, s ) );
	return vec3( cavity, mix( rough, 0.96, p ), 1.0 );
}
vec3 albedo( vec2 uv ) {
	vec4 v = voronoi( uv, ${cells.toFixed(1)} );
	float s = stones( uv ), p = patchMask( uv );
	float binderTone = ${binder.toFixed(4)} * ( 0.85 + 0.3 * fbm( uv, 6.0, 3 ) );
	float stoneTone = ${stone.toFixed(4)} * ( 0.7 + 0.6 * v.y );
	float tone = mix( binderTone, stoneTone, smoothstep( 0.15, 0.55, s * ${exposure.toFixed(3)} ) );
	return vec3( mix( tone, binderTone * 0.8, p ) );
}`;

/** Albedo values are linear multipliers relative to the base colour 1.0 (they
 * are combined with each material's colour). */
const RECIPES: Readonly<Record<ProceduralRecipe, Recipe>> = Object.freeze({
  // Metallic paint flakes: 128 flakes per tile side, each a tilted mirror facet
  // (tilt ~ 0.45 * sqrt(u) radians) in a flat binder; edges antialiased.
  flake: {
    relief: 1,
    glsl: `#define DIRECT_NORMAL
vec3 directNormal( vec2 uv ) {
	vec4 v = voronoi( uv, 128.0 );
	vec2 h = hash22( vec2( v.y * 913.0, v.y * 271.0 ) );
	float tilt = 0.45 * sqrt( h.x ), phi = 6.2831853 * h.y;
	vec3 facet = vec3( sin( tilt ) * cos( phi ), sin( tilt ) * sin( phi ), cos( tilt ) );
	float inside = smoothstep( 0.46, 0.38, v.x );
	return normalize( mix( vec3( 0.0, 0.0, 1.0 ), facet, inside ) );
}
${flat}`,
  },
  // Brushed metal: fine scratches along U (anisotropic value noise 4 x 900).
  brushed: {
    relief: 0.9,
    glsl: `
float height( vec2 uv ) {
	float lines = vnoise( uv * vec2( 4.0, 900.0 ), vec2( 4.0, 900.0 ) );
	float streaks = vnoise( uv * vec2( 2.0, 220.0 ), vec2( 2.0, 220.0 ) );
	return 0.65 * lines + 0.35 * streaks;
}
vec3 orm( vec2 uv ) { return vec3( 1.0, 0.85 + 0.3 * vnoise( uv * vec2( 3.0, 60.0 ), vec2( 3.0, 60.0 ) ), 1.0 ); }
vec3 albedo( vec2 uv ) { return vec3( 0.96 + 0.08 * vnoise( uv * vec2( 2.0, 300.0 ), vec2( 2.0, 300.0 ) ) ); }`,
  },
  // Isotropic micro-relief: moulded rubber, bare cast metal (no lettering).
  micro: {
    relief: 0.35,
    glsl: `
float height( vec2 uv ) { return 0.7 * fbm( uv, 64.0, 3 ) + 0.3 * vnoise( uv * 256.0, vec2( 256.0 ) ); }
vec3 orm( vec2 uv ) { return vec3( 1.0, 0.92 + 0.16 * fbm( uv, 32.0, 2 ), 1.0 ); }
vec3 albedo( vec2 uv ) { return vec3( 0.94 + 0.12 * fbm( uv, 12.0, 3 ) ); }`,
  },
  'asphalt-fresh': { relief: 1.6, glsl: aggregate(48, 0.55, 0.85, 1.6, false) },
  'asphalt-worn': { relief: 2.4, glsl: aggregate(40, 1.0, 1.0, 2.6, false) },
  'asphalt-patched': { relief: 2.0, glsl: aggregate(44, 0.85, 0.95, 2.2, true) },
  'concrete-smooth': {
    relief: 0.8,
    glsl: `
float pores( vec2 uv ) {
	vec4 v = voronoi( uv, 90.0 );
	return step( v.y, 0.28 ) * smoothstep( 0.16, 0.06, v.x );
}
float height( vec2 uv ) { return 0.5 * fbm( uv, 8.0, 5 ) - 0.35 * pores( uv ); }
vec3 orm( vec2 uv ) { return vec3( 1.0 - 0.35 * pores( uv ), 0.9 + 0.12 * fbm( uv, 24.0, 3 ), 1.0 ); }
vec3 albedo( vec2 uv ) {
	float stain = smoothstep( 0.45, 0.75, fbm( uv, 2.0, 4 ) );
	return vec3( ( 0.9 + 0.18 * fbm( uv, 10.0, 4 ) ) * ( 1.0 - 0.18 * stain ) * ( 1.0 - 0.3 * pores( uv ) ) );
}`,
  },
  'concrete-rough': {
    relief: 1.4,
    glsl: `
float height( vec2 uv ) {
	vec4 v = voronoi( uv, 70.0 );
	float grit = smoothstep( 0.4, 0.15, v.x ) * v.y;
	return 0.45 * fbm( uv, 12.0, 5 ) + 0.35 * grit;
}
vec3 orm( vec2 uv ) { return vec3( mix( 0.78, 1.0, height( uv ) ), 0.97, 1.0 ); }
vec3 albedo( vec2 uv ) {
	vec4 v = voronoi( uv, 70.0 );
	return vec3( ( 0.85 + 0.25 * v.y * smoothstep( 0.4, 0.15, v.x ) ) * ( 0.9 + 0.2 * fbm( uv, 4.0, 3 ) ) );
}`,
  },
});

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

function fragmentShader(recipe: ProceduralRecipe, output: ProceduralOutput) {
  const r = RECIPES[recipe];
  const normal = r.glsl.includes('#define DIRECT_NORMAL')
    ? 'vec3 n = directNormal( vUv );'
    : `float hx = height( vUv + vec2( texel.x, 0.0 ) ) - height( vUv - vec2( texel.x, 0.0 ) );
	float hy = height( vUv + vec2( 0.0, texel.y ) ) - height( vUv - vec2( 0.0, texel.y ) );
	// Slope per texel pair, scaled so relief reads alike at any bake size.
	vec3 n = normalize( vec3( -hx * ${r.relief.toFixed(3)} * 0.5 / ( texel.x * 64.0 ), -hy * ${r.relief.toFixed(3)} * 0.5 / ( texel.y * 64.0 ), 1.0 ) );`;
  const body =
    output === 'normal'
      ? `${normal}\n\tgl_FragColor = vec4( n * 0.5 + 0.5, 1.0 );`
      : output === 'orm'
        ? 'gl_FragColor = vec4( clamp( orm( vUv ), 0.0, 1.0 ), 1.0 );'
        : 'gl_FragColor = vec4( linearToSrgb( clamp( albedo( vUv ) * 0.5, 0.0, 1.0 ) ), 1.0 );';
  return `${COMMON}\n${r.glsl}\nvoid main() {\n\t${body}\n}`;
}

/** Albedo maps store half the multiplier (range 0..2 in an 8-bit sRGB map). */
export const ALBEDO_SCALE = 2;

interface Master {
  recipe: ProceduralRecipe;
  output: ProceduralOutput;
  texture: T.DataTexture;
  baked: boolean;
}

/** The procedural texture set. One instance is shared by the library. */
export class ProceduralTextures {
  private readonly masters = new Map<string, Master>();
  private readonly handed = new Set<T.DataTexture>();
  private unbaked = 0;
  bakes = 0;
  lastBakeMs = 0;
  failures = 0;
  constructor(readonly size = PROCEDURAL_SIZE) {
    if (!Number.isInteger(Math.log2(size)) || size < 4 || size > 2048)
      throw new Error('Invalid procedural texture size');
  }
  private master(recipe: ProceduralRecipe, output: ProceduralOutput) {
    if (!PROCEDURAL_RECIPES.includes(recipe)) throw new Error(`Unknown recipe "${recipe}"`);
    const key = `${recipe}:${output}`;
    let entry = this.masters.get(key);
    if (!entry) {
      const data = new Uint8Array(this.size * this.size * 4);
      const identity = PROCEDURAL_IDENTITY[output];
      for (let i = 0; i < data.length; i += 4) data.set(identity, i);
      const texture = new T.DataTexture(data, this.size, this.size, T.RGBAFormat);
      texture.name = `APEX procedural ${key}`;
      texture.wrapS = texture.wrapT = T.RepeatWrapping;
      texture.magFilter = T.LinearFilter;
      texture.minFilter = T.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 8;
      texture.colorSpace = output === 'albedo' ? T.SRGBColorSpace : T.NoColorSpace;
      // Obeys the user's anisotropy budget (TextureBudget) without resampling.
      texture.userData.surfaceDetail = true;
      texture.needsUpdate = true;
      entry = { recipe, output, texture, baked: false };
      this.masters.set(key, entry);
      this.unbaked++;
    }
    return entry;
  }
  /** A repeating texture sharing the recipe's pixels; `repeat` tiles per UV unit. */
  get(recipe: ProceduralRecipe, output: ProceduralOutput, repeat = 1): T.DataTexture {
    if (!(repeat > 0) || !Number.isFinite(repeat)) throw new Error('Invalid texture repeat');
    const clone = this.master(recipe, output).texture.clone();
    clone.repeat.set(repeat, repeat);
    clone.userData = { ...clone.userData, procedural: `${recipe}:${output}` };
    clone.needsUpdate = true;
    this.handed.add(clone);
    return clone;
  }
  /** Recipes still holding identity pixels. */
  get pending() {
    let n = 0;
    for (const m of this.masters.values()) if (!m.baked) n++;
    return n;
  }
  /** Draw every pending recipe on the GPU and publish it to all clones. Returns
   * the number baked. Restores the renderer's target and clear state. */
  bake(renderer: T.WebGLRenderer) {
    // Called every frame by the renderer: nothing to do allocates nothing.
    if (!this.unbaked) return 0;
    const pending = [...this.masters.values()].filter((m) => !m.baked);
    this.unbaked = 0;
    if (!pending.length) return 0;
    const start = performance.now();
    const target = new T.WebGLRenderTarget(this.size, this.size, {
      type: T.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    const quad = new FullScreenQuad();
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const xr = renderer.xr.enabled;
    let baked = 0;
    try {
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      for (const master of pending) {
        const material = new T.ShaderMaterial({
          name: `APEX bake ${master.recipe}:${master.output}`,
          vertexShader,
          fragmentShader: fragmentShader(master.recipe, master.output),
          uniforms: { texel: { value: new T.Vector2(1 / this.size, 1 / this.size) } },
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });
        try {
          quad.material = material;
          renderer.setRenderTarget(target);
          quad.render(renderer);
          const image = master.texture.image as { data: Uint8Array };
          renderer.readRenderTargetPixels(target, 0, 0, this.size, this.size, image.data);
          master.baked = true;
          baked++;
        } catch (error) {
          this.failures++;
          // Identity pixels stay: the material renders untextured, never broken.
          console.warn(`Procedural texture ${master.recipe}:${master.output} kept flat`, error);
          master.baked = true;
        } finally {
          material.dispose();
        }
      }
    } finally {
      renderer.setRenderTarget(previous);
      renderer.autoClear = autoClear;
      renderer.xr.enabled = xr;
      quad.dispose();
      target.dispose();
    }
    for (const master of pending) master.texture.needsUpdate = true;
    for (const texture of this.handed) texture.needsUpdate = true;
    this.bakes += baked;
    this.lastBakeMs = performance.now() - start;
    return baked;
  }
  /** GLSL of one recipe output (read-only; tests and tooling inspect it). */
  static source(recipe: ProceduralRecipe, output: ProceduralOutput) {
    return fragmentShader(recipe, output);
  }
  diagnostics() {
    return {
      size: this.size,
      recipes: this.masters.size,
      pending: this.pending,
      bakes: this.bakes,
      failures: this.failures,
      lastBakeMs: this.lastBakeMs,
      clones: this.handed.size,
      bytes: this.masters.size * this.size * this.size * 4,
    };
  }
  dispose() {
    for (const texture of this.handed) texture.dispose();
    for (const master of this.masters.values()) master.texture.dispose();
    this.handed.clear();
    this.masters.clear();
  }
}
