import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { farShadowChunks } from '../src/rendering/far-shadow.ts';
import { shadowFilterChunk } from '../src/rendering/studio/shadow-filter.ts';
import { midCascadeChunks } from '../src/rendering/ultra/cascades.ts';
import {
  installMxTerrainShadow,
  mxTerrainShadowChunk,
  MX_TERRAIN_SHADOW_HOOK,
} from '../src/rendering/offroad/mx-terrain-shadow.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';

// Imports install the game's filter globally. Read the exact installed vanilla
// source for a separate native-kernel contract, without resetting globals.
const vanilla = readFileSync(
  new URL(
    '../node_modules/three/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js',
    import.meta.url,
  ),
  'utf8',
).split('`')[1];
const nativeLights = readFileSync(
  new URL(
    '../node_modules/three/src/renderers/shaders/ShaderChunk/lights_fragment_begin.glsl.js',
    import.meta.url,
  ),
  'utf8',
).split('`')[1];
const branch = (source: string, start: string, end: string) => source.split(start)[1].split(end)[0];

describe('material-local MX terrain shadow correction', () => {
  it('keeps the native PCF, VSM and point fallbacks exact while correcting all 16 soft taps', () => {
    const patched = mxTerrainShadowChunk(vanilla);
    expect(patched.split('mxTerrainCompare( shadowMap,').length - 1).toBe(16);
    const pcf = '#if defined( SHADOWMAP_TYPE_PCF )',
      soft = '#elif defined( SHADOWMAP_TYPE_PCF_SOFT )';
    expect(branch(patched, pcf, soft)).toBe(branch(vanilla, pcf, soft));
    const vsm = '#elif defined( SHADOWMAP_TYPE_VSM )';
    expect(patched.slice(patched.indexOf(vsm))).toBe(vanilla.slice(vanilla.indexOf(vsm)));
    expect(patched.indexOf('vec2 mxGradient =')).toBeLessThan(
      patched.indexOf('if ( frustumTest )'),
    );
    expect(patched).toContain('floor( tap * size )');
    expect(patched).toContain('size - 1.0');
    expect(patched).toContain('shadowCoord.xy, mxGradient )');
    expect(mxTerrainShadowChunk(patched)).toBe(patched);
  });

  it('normalizes production PCSS blocker depths and preserves its 8/16 tap loops', () => {
    const installed = shadowFilterChunk(vanilla),
      patched = mxTerrainShadowChunk(installed);
    expect(patched).toContain(
      'apexShadowDepth( map, tap ) - mxTerrainPlaneOffset( tap, size, uv, gradient )',
    );
    expect(patched).toContain('mxTerrainCompare( map, tap, z, size, uv, gradient )');
    expect(patched).toContain('shadowCoord.xy, shadowCoord.z, mxGradient )');
    expect(patched.match(/for \( int i = 0; i < \d+; i \+\+ \)/g)).toEqual(
      installed.match(/for \( int i = 0; i < \d+; i \+\+ \)/g),
    );
    expect(patched).toContain('blockerDepth += occluding * d;');
    expect(patched).toContain('abs( z - blockerDepth ) * radius * size.x');
  });

  it('corrects the four far taps and optional mid cascade before their early handovers', () => {
    const far = farShadowChunks(nativeLights, shadowFilterChunk(vanilla));
    const mid = midCascadeChunks(far.lightsBegin, far.shadowPars);
    const patched = mxTerrainShadowChunk(mid.shadowPars);
    const farBody = patched.slice(
      patched.indexOf('float apexFarShadow('),
      patched.indexOf('float apexMidShadow('),
    );
    const midBody = patched.slice(patched.indexOf('float apexMidShadow('));
    expect(farBody.split('mxTerrainCompare( map,').length - 1).toBe(4);
    for (const body of [farBody, midBody]) {
      expect(body.indexOf('mxTerrainDepthGradient( c )')).toBeLessThan(
        body.indexOf('if ( nearWeight >= 1.0 )'),
      );
      expect(body.indexOf('mxTerrainDepthGradient( c )')).toBeLessThan(
        body.indexOf('if ( c.x < 0.0'),
      );
    }
    expect(midBody).toContain('apexShadowFilter( map, size, radius, c.xy, c.z, mxGradient )');
    expect(patched).not.toContain('uniform float mx');
  });

  it('removes false occlusion on a sloping texel while retaining a real raised blocker', () => {
    const size = 1024,
      uv = 0.51713,
      tap = uv + 3.74 / size,
      slope = 0.39,
      z = 0.53;
    const actualCentre = (Math.floor(tap * size) + 0.5) / size;
    const terrainDepth = z + slope * (actualCentre - uv);
    // Choose the opposite downslope tap: its receiver lies closer to the sun.
    const downTap = uv - 3.74 / size,
      downCentre = (Math.floor(downTap * size) + 0.5) / size;
    const downDepth = z + slope * (downCentre - uv);
    expect(downDepth).toBeLessThan(z); // Original fixed-depth compare says shadow.
    expect(z + slope * (downCentre - uv)).toBeCloseTo(downDepth, 14);
    expect(terrainDepth - slope * (actualCentre - uv)).toBeCloseTo(z, 14);
    const blocker = terrainDepth - 0.015;
    expect(blocker - slope * (actualCentre - uv)).toBeLessThan(z - 0.0149);
    // Correcting at the requested UV instead of the fetched texel is inexact.
    expect(Math.abs(z + slope * (tap - uv) - terrainDepth)).toBeGreaterThan(1e-5);
  });

  it('chains once on an MX material without editing shader globals, depth ownership or budgets', () => {
    const globals = { ...T.ShaderChunk },
      material = new T.MeshPhysicalMaterial();
    expect(installMxTerrainShadow(material)).toBe(true);
    const key = material.customProgramCacheKey();
    expect(installMxTerrainShadow(material)).toBe(false);
    expect(material.customProgramCacheKey()).toBe(key);
    const shader = {
      vertexShader: T.ShaderLib.physical.vertexShader,
      fragmentShader: T.ShaderLib.physical.fragmentShader,
      uniforms: T.UniformsUtils.clone(T.ShaderLib.physical.uniforms),
    } as StudioShader;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.vertexShader).toBe(T.ShaderLib.physical.vertexShader);
    expect(Object.keys(shader.uniforms)).toEqual(Object.keys(T.ShaderLib.physical.uniforms));
    expect(T.ShaderChunk).toEqual(globals);
    expect(material.polygonOffset).toBe(false);
    expect(material.side).toBe(T.FrontSide);
    expect(material.shadowSide).toBe(T.DoubleSide);
    material.dispose();
  });

  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s casts the same deforming chunks without a second depth mesh',
    (id) => {
      const view = new TerrainView(rigTrack(id));
      expect(studioHookKeys(view.material)).toContain(MX_TERRAIN_SHADOW_HOOK);
      const meshes = view.group.children as T.Mesh[];
      const first = meshes[0],
        positions = first.geometry.getAttribute('position');
      const base = positions.getY(0),
        geometry = first.geometry;
      for (const mesh of meshes) {
        expect(mesh.castShadow).toBe(true);
        expect(mesh.receiveShadow).toBe(true);
        expect(mesh.material).toBe(view.material);
        expect(mesh.customDepthMaterial).toBeUndefined();
      }
      view.record({ reset: true, wetness: 0, blocks: new Float32Array([0, 0.12, 0.6]) }, 1, true);
      expect(first.geometry).toBe(geometry);
      expect(positions.getY(0)).toBeCloseTo(base - 0.12, 6);
      view.showAt(0);
      expect(positions.getY(0)).toBe(base);
      view.dispose();
    },
  );

  it.each(['kestrel-rx', 'pinewood-stage'] as const)(
    '%s keeps its previous caster/material policy',
    (id) => {
      const view = new TerrainView(rigTrack(id));
      expect(studioHookKeys(view.material)).not.toContain(MX_TERRAIN_SHADOW_HOOK);
      expect(view.material.shadowSide).toBeNull();
      for (const child of view.group.children) expect(child.castShadow).toBe(false);
      view.dispose();
    },
  );
});
