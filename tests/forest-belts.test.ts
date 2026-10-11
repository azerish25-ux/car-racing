import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import {
  FOREST_BELTS,
  beltDensity,
  buildForestBelts,
  forestBeltPlan,
} from '../src/rendering/studio/forest-belts.ts';
import {
  CANOPY,
  FOLIAGE_SHADING_HOOK,
  FOLIAGE_WIND_HOOK,
  foliageSwayAmplitude,
  installFoliageShading,
  installFoliageWind,
} from '../src/rendering/studio/foliage-shading.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';
import { inStandFootprint } from '../src/rendering/grandstand.ts';
import { BELT_TREES_HOOK } from '../src/rendering/studio/belt-trees.ts';

function shaderFor(id: 'standard' | 'depth'): StudioShader {
  const source = T.ShaderLib[id];
  return {
    uniforms: T.UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
  } as unknown as StudioShader;
}

/** A canvas stub that accepts every 2D call (the crown atlas is drawn, not loaded). */
function stubCanvas() {
  const context = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) =>
      key in target
        ? target[key]
        : key.startsWith('create')
          ? () => ({ addColorStop() {} })
          : () => undefined,
    set: (target, key: string, value) => ((target[key] = value), true),
  });
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
}
afterEach(() => vi.unstubAllGlobals());

describe('forest belts', () => {
  const track = new Track();
  const trees = forestBeltPlan(track);

  it('plants 6-12 k deterministic trees 30-120 m behind the nearest boundary', () => {
    expect(trees.length).toBeGreaterThanOrEqual(6000);
    expect(trees.length).toBeLessThanOrEqual(12000);
    expect(forestBeltPlan(track)).toEqual(trees);
    const p = trackPoint();
    for (const tree of trees) {
      const l = track.nearest(tree.x, tree.z, p);
      const behind = Math.abs(l) - track.boundary(p.s, l < 0 ? -1 : 1);
      expect(behind).toBeGreaterThan(FOREST_BELTS.near - FOREST_BELTS.spacing * 0.5);
      expect(behind).toBeLessThan(FOREST_BELTS.far + FOREST_BELTS.spacing);
      expect(inStandFootprint(track, tree.x, tree.z, 0)).toBe(false);
      expect(Number.isFinite(tree.y)).toBe(true);
    }
  });

  it('mixes about 40 % conifers 14-28 m with 15-25 m broadleaf crowns', () => {
    const conifers = trees.filter((t) => t.conifer);
    const share = conifers.length / trees.length;
    expect(share).toBeGreaterThan(0.34);
    expect(share).toBeLessThan(0.46);
    for (const t of trees) {
      const spec = t.conifer ? FOREST_BELTS.conifer : FOREST_BELTS.broadleaf;
      expect(t.height).toBeGreaterThanOrEqual(spec.min);
      expect(t.height).toBeLessThanOrEqual(spec.max);
      // The crown atlas tile follows the aspect: conifers below 0.73.
      if (t.conifer) expect(t.width / t.height).toBeLessThan(0.73);
      else expect(t.width / t.height).toBeGreaterThan(0.93);
    }
  });

  it('clusters into clumps and glades rather than an even lawn of trees', () => {
    const values: number[] = [];
    for (let x = -600; x <= 600; x += 37) values.push(beltDensity(x, 400, 80));
    expect(Math.min(...values)).toBeLessThan(0.1);
    expect(Math.max(...values)).toBeGreaterThan(0.8);
    expect(beltDensity(100, 100, FOREST_BELTS.near)).toBeLessThanOrEqual(
      beltDensity(100, 100, 100),
    );
  });

  it('builds unshadowed, density-scalable 240 m buckets within the draw allocation', () => {
    stubCanvas();
    const group = new T.Group();
    const count = buildForestBelts(track, group);
    expect(count).toBe(trees.length);
    const meshes = group.children as T.InstancedMesh[];
    expect(meshes.length).toBeGreaterThan(0);
    // One draw per bucket and kind: 240 m broadleaf, 480 m conifer buckets.
    expect(meshes.length).toBeLessThanOrEqual(56);
    let total = 0;
    for (const mesh of meshes) {
      expect(mesh).toBeInstanceOf(T.InstancedMesh);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.userData.fullCount).toBe(mesh.count);
      expect(mesh.customDepthMaterial).toBeDefined();
      total += mesh.count;
    }
    expect(total).toBe(trees.length);
    const broadleaf = meshes.filter((m) => m.name.startsWith('Forest belt canopy')),
      conifers = meshes.filter((m) => m.name.startsWith('Forest belt conifers'));
    expect(broadleaf.length + conifers.length).toBe(meshes.length);
    expect(conifers.reduce((n, m) => n + m.count, 0)).toBe(trees.filter((t) => t.conifer).length);
    const cards = broadleaf[0].material as T.MeshStandardMaterial;
    expect(studioHookKeys(cards)).toEqual([FOLIAGE_SHADING_HOOK, FOLIAGE_WIND_HOOK]);
    expect(studioHookKeys(broadleaf[0].customDepthMaterial!)).toEqual([FOLIAGE_WIND_HOOK]);
    expect(cards.alphaToCoverage).toBe(true);
    const solid = conifers[0].material as T.MeshStandardMaterial;
    expect(studioHookKeys(solid)).toEqual([
      BELT_TREES_HOOK,
      FOLIAGE_SHADING_HOOK,
      FOLIAGE_WIND_HOOK,
    ]);
    expect(solid.map).toBeNull();
    expect(solid.alphaToCoverage).toBe(true);
    expect(solid.side).toBe(T.DoubleSide);
    // Two tiers in one shared stream per kind, chosen per view.
    for (const kind of [broadleaf, conifers]) {
      const mesh = kind[0],
        material = mesh.material as T.Material,
        camera = new T.PerspectiveCamera();
      mesh.updateMatrixWorld();
      const far = { ...mesh.geometry.drawRange };
      expect(far.start).toBe(0);
      camera.position.copy(mesh.boundingSphere!.center);
      mesh.onBeforeRender(
        {} as T.WebGLRenderer,
        {} as T.Scene,
        camera,
        mesh.geometry,
        material,
        {} as T.Group,
      );
      const near = { ...mesh.geometry.drawRange };
      expect(near.start).toBe(far.count);
      expect(near.count).toBeGreaterThan(far.count * 1.5);
      camera.position.set(1e5, 0, 1e5);
      mesh.onBeforeRender(
        {} as T.WebGLRenderer,
        {} as T.Scene,
        camera,
        mesh.geometry,
        material,
        {} as T.Group,
      );
      expect(mesh.geometry.drawRange).toEqual(far);
      if (kind.length > 1) expect(kind[1].geometry.index).toBe(mesh.geometry.index);
    }
  });

  it('plants the coastal circuit too', () => {
    const coast = new Track('clear', false, undefined, CIRCUITS.vellamar);
    expect(forestBeltPlan(coast).length).toBeGreaterThan(1000);
  });
});

describe('foliage shading and wind', () => {
  it('grades toward the canopy colour and adds translucency after the lights', () => {
    const material = new T.MeshStandardMaterial();
    installFoliageShading(material);
    expect(installFoliageShading(material)).toBe(false);
    const shader = shaderFor('standard');
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.uniforms.studioSunDir).toBe(studioUniforms.studioSunDir);
    const f = shader.fragmentShader;
    expect(f.indexOf('vec3 canopyTarget')).toBeGreaterThan(f.indexOf('#include <color_fragment>'));
    expect(f.indexOf('float back = pow(')).toBeGreaterThan(
      f.indexOf('#include <lights_fragment_end>'),
    );
    expect(f).toContain(`${CANOPY.translucency.toFixed(4)} * back`);
  });

  it('sways the same way in colour and depth programs, from presented wind only', () => {
    const colour = new T.MeshStandardMaterial(),
      depth = new T.MeshDepthMaterial();
    installFoliageWind(colour);
    installFoliageWind(depth);
    const a = shaderFor('standard'),
      b = shaderFor('depth');
    colour.onBeforeCompile(a, {} as T.WebGLRenderer);
    depth.onBeforeCompile(b, {} as T.WebGLRenderer);
    const block = (s: string) =>
      s.slice(s.indexOf('// D11 wind'), s.indexOf('#include <project_vertex>'));
    expect(block(a.vertexShader)).toBe(block(b.vertexShader));
    expect(block(a.vertexShader)).toContain('studioWind.z');
    expect(a.uniforms.studioWind).toBe(studioUniforms.studioWind);
    expect(a.vertexShader).not.toMatch(/random|Date|performance/);
    // A 20 m crown moves tens of centimetres in a fresh breeze, never metres.
    expect(foliageSwayAmplitude(20, 8, 1)).toBeGreaterThan(0.2);
    expect(foliageSwayAmplitude(20, 8, 1)).toBeLessThan(0.5);
    expect(foliageSwayAmplitude(28, 30, 1)).toBeLessThan(0.7);
  });
  it('moves a mirrored card exactly like the original (e2e/30 canopy front/back)', () => {
    const colour = new T.MeshStandardMaterial();
    installFoliageWind(colour);
    const a = shaderFor('standard');
    colour.onBeforeCompile(a, {} as T.WebGLRenderer);
    const block = a.vertexShader.slice(
      a.vertexShader.indexOf('// D11 wind'),
      a.vertexShader.indexOf('#include <project_vertex>'),
    );
    // World metres through the full object and instance transform (any mirror).
    expect(block).toContain(
      'inverse( mat3( modelMatrix ) * mat3( instanceMatrix ) ) * worldOffset',
    );
    // The flutter phase does not see the sign of local x.
    expect(block).toContain('abs( transformed.x )');
    expect(block).not.toMatch(/dot\( transformed,/);
  });
});
