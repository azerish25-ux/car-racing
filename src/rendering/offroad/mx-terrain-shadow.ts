import * as T from 'three';
import { chainShaderHook } from '../studio/shader-hooks.ts';

export const MX_TERRAIN_SHADOW_HOOK = 'mx-terrain-receiver-plane-v1';

/** Receiver-plane depth at the nearest texel actually fetched by r180's
 * packed-depth shadow maps. Correcting only the requested tap UV leaves a
 * half-texel error on jump faces, enough to shadow the whole lit slope.
 * This is a material-local receiver correction, not a bias or depth pass. */
const RECEIVER_GLSL = /* glsl */ `
  vec2 mxTerrainDepthGradient( vec3 c ) {
    vec3 dx = dFdx( c ), dy = dFdy( c );
    float determinant = dx.x * dy.y - dx.y * dy.x;
    if ( abs( determinant ) < 1e-12 ) return vec2( 0.0 );
    return vec2( dx.z * dy.y - dx.y * dy.z, dx.x * dy.z - dx.z * dy.x ) / determinant;
  }
  vec2 mxTerrainSampleCentre( vec2 tap, vec2 size ) {
    return ( clamp( floor( tap * size ), vec2( 0.0 ), size - 1.0 ) + 0.5 ) / size;
  }
  float mxTerrainPlaneOffset( vec2 tap, vec2 size, vec2 origin, vec2 gradient ) {
    return dot( mxTerrainSampleCentre( tap, size ) - origin, gradient );
  }
  float mxTerrainCompare( sampler2D map, vec2 tap, float z, vec2 size, vec2 origin, vec2 gradient ) {
    return texture2DCompare( map, tap, z + mxTerrainPlaneOffset( tap, size, origin, gradient ) );
  }
`;

/** Replace only an individual GLSL function, retaining every unrelated
 * native point, PCF, VSM and unfiltered fallback verbatim. */
function transformFunction(source: string, name: string, transform: (body: string) => string) {
  const signature = new RegExp(`\\bfloat ${name}\\s*\\(`);
  const match = signature.exec(source);
  if (!match) throw new Error(`Missing terrain shadow function ${name}`);
  const first = source.indexOf('{', match.index);
  let depth = 1;
  let end = first + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
    end++;
  }
  if (depth) throw new Error(`Unclosed terrain shadow function ${name}`);
  return (
    source.slice(0, match.index) + transform(source.slice(match.index, end)) + source.slice(end)
  );
}

function replaceOnce(source: string, anchor: string, replacement: string) {
  if (source.split(anchor).length !== 2)
    throw new Error(`Unexpected terrain shadow anchor: ${anchor}`);
  return source.replace(anchor, replacement);
}

/** Patch a copy of the installed chunk. It may be vanilla r180, the shipped
 * Vogel/PCSS filter, or that filter with the far and optional Ultra mid map.
 * No ShaderChunk global is mutated and no sample loop or budget is enlarged.
 */
export function mxTerrainShadowChunk(source: string) {
  if (source.includes('mxTerrainDepthGradient(')) return source;
  let chunk = source;
  const compareEnd = chunk.indexOf('\n\tvec2 texture2DDistribution(');
  if (compareEnd < 0) throw new Error('Unexpected Three.js packed shadow comparison layout');
  chunk = chunk.slice(0, compareEnd) + '\n' + RECEIVER_GLSL + chunk.slice(compareEnd);

  if (chunk.includes('float apexShadowFilter(')) {
    // PCSS blocker depths must be measured on the same receiver plane as
    // the final PCF taps. Otherwise a lit ramp is misidentified as a blocker
    // and its own slope widens the penumbra.
    chunk = transformFunction(chunk, 'apexShadowFilter', (body) => {
      body = replaceOnce(body, 'float z ) {', 'float z, vec2 gradient ) {');
      body = replaceOnce(
        body,
        'float d = apexShadowDepth( map, tap );',
        'float d = apexShadowDepth( map, tap ) - mxTerrainPlaneOffset( tap, size, uv, gradient );',
      );
      return replaceOnce(
        body,
        'texture2DCompare( map, tap, z )',
        'mxTerrainCompare( map, tap, z, size, uv, gradient )',
      );
    });
  }

  chunk = transformFunction(chunk, 'getShadow', (body) => {
    body = replaceOnce(
      body,
      'shadowCoord.z += shadowBias;',
      `shadowCoord.z += shadowBias;
      #if defined( SHADOWMAP_TYPE_PCF_SOFT )
        // Derivatives precede the per-fragment shadow-frustum branch.
        vec2 mxGradient = mxTerrainDepthGradient( shadowCoord.xyz );
      #endif`,
    );
    const softBranch =
      /(#elif defined\( SHADOWMAP_TYPE_PCF_SOFT \)\n)([\s\S]*?)(\n\t\t#elif defined\( SHADOWMAP_TYPE_VSM \))/;
    if (!softBranch.test(body)) throw new Error('Missing native PCF-soft terrain branch');
    return body.replace(softBranch, (_, begin: string, soft: string, end: string) => {
      if (soft.includes('apexShadowFilter('))
        soft = replaceOnce(
          soft,
          'shadowCoord.xy, shadowCoord.z )',
          'shadowCoord.xy, shadowCoord.z, mxGradient )',
        );
      else {
        // Native soft PCF has sixteen texture compares, including nested
        // vec2 arguments. This two-part replacement keeps that kernel intact.
        soft = soft.replaceAll('texture2DCompare( shadowMap,', 'mxTerrainCompare( shadowMap,');
        soft = soft.replaceAll(
          ', shadowCoord.z )',
          ', shadowCoord.z, shadowMapSize, shadowCoord.xy, mxGradient )',
        );
      }
      return begin + soft + end;
    });
  });

  for (const [name, coordinate] of [
    ['apexFarShadow', 'farCoord'],
    ['apexMidShadow', 'midCoord'],
  ] as const) {
    if (!chunk.includes(`float ${name}(`)) continue;
    chunk = transformFunction(chunk, name, (body) => {
      body = replaceOnce(body, `\n\tvec3 c = ${coordinate}.xyz / ${coordinate}.w;`, '');
      body = replaceOnce(body, '\n\tc.z += bias;', '');
      // A hand-over can return before the far frustum is tested. Compute
      // derivatives before either nonuniform condition, including mid maps.
      body = replaceOnce(
        body,
        ') {\n',
        `) {\n\tvec3 c = ${coordinate}.xyz / ${coordinate}.w;
  c.z += bias;
  vec2 mxGradient = mxTerrainDepthGradient( c );\n`,
      );
      if (name === 'apexMidShadow')
        return replaceOnce(
          body,
          'apexShadowFilter( map, size, radius, c.xy, c.z )',
          'apexShadowFilter( map, size, radius, c.xy, c.z, mxGradient )',
        );
      return body
        .replaceAll('texture2DCompare( map,', 'mxTerrainCompare( map,')
        .replaceAll(', c.z )', ', c.z, size, c.xy, mxGradient )');
    });
  }
  return chunk;
}

/** The same deforming front-facing mesh casts into the existing map. Its
 * shadow pass needs both faces: Three's default front-material shadow side
 * would cull the upward terrain surface while looking down from the sun. */
export function installMxTerrainShadow(material: T.MeshPhysicalMaterial) {
  material.side = T.FrontSide;
  material.shadowSide = T.DoubleSide;
  return chainShaderHook(material, MX_TERRAIN_SHADOW_HOOK, (shader) => {
    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      '#include <shadowmap_pars_fragment>',
      mxTerrainShadowChunk(T.ShaderChunk.shadowmap_pars_fragment),
    );
  });
}
