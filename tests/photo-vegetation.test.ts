import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { thirdPartyManifest } from '../src/rendering/assets/third-party.ts';
import { CARD_FLOATS, parseVegetation } from '../src/rendering/vegetation/format.ts';
import {
  pickSpecies,
  plantHash,
  plantScale,
  MAX_SCALE,
  plantTint,
  SPECIES,
  speciesForPalette,
  TREE_SPECIES,
  treeRole,
} from '../src/rendering/vegetation/species.ts';
import { GRASS, grassPlan } from '../src/rendering/vegetation/grass.ts';
import { PhotoForest } from '../src/rendering/vegetation/forest.ts';
import {
  photoVegetationEnabled,
  type VegetationLibrary,
  type VegetationSpecies,
} from '../src/rendering/vegetation/library.ts';
import {
  barkMaterial,
  cardDepthMaterials,
  cardMaterial,
  grassMaterial,
  impostorMaterial,
  VEGETATION,
  vegetationUniforms,
} from '../src/rendering/vegetation/materials.ts';
import { validateVegetationRecipe } from '../scripts/assets/vegetation/recipe.ts';
import { readRegister } from '../scripts/assets/register.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';

const ROOT = process.cwd();
const vegetation = thirdPartyManifest.assets.filter((a) => a.kind === 'vegetation');

function shaderFor(id: 'standard' | 'depth' | 'distanceRGBA'): StudioShader {
  const source = T.ShaderLib[id];
  return {
    uniforms: T.UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
  } as unknown as StudioShader;
}
function compile(material: T.Material, id: 'standard' | 'depth' | 'distanceRGBA') {
  const shader = shaderFor(id);
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

describe('photographic vegetation assets', () => {
  it('ships trees, a shrub and meadow grass, each credited CC BY 4.0 to the landscape authors', () => {
    const ids = vegetation.map((a) => a.id).sort();
    expect(ids).toEqual([...Object.values(SPECIES)].sort());
    for (const asset of vegetation) {
      expect(asset.licence).toBe('CC-BY-4.0');
      expect(asset.attribution).toContain(asset.author);
      expect(asset.attribution).toContain('CC BY 4.0');
      expect(asset.attribution).toMatch(/Modified/);
      expect(asset.vegetation).toBeTruthy();
      for (const file of asset.files)
        expect(file.path.startsWith(`assets/third-party/vegetation/${asset.id}/`)).toBe(true);
    }
  });

  it('every register recipe is valid', () => {
    for (const source of readRegister(ROOT).sources)
      if (source.recipe.type === 'vegetation')
        expect(validateVegetationRecipe(source.recipe)).toEqual([]);
  });

  it('every baked plant parses, with unit card frames, atlas UVs inside the atlas and a valid trunk', () => {
    for (const asset of vegetation) {
      const file = asset.files.find((f) => f.role === 'geometry')!;
      const geometry = parseVegetation(
        new Uint8Array(readFileSync(join(ROOT, 'public', file.path))),
      );
      expect(geometry.info).toEqual(asset.vegetation);
      const info = geometry.info;
      if (info.form === 'grass') {
        expect(geometry.tiles?.[0]).toBe(info.cards);
        expect(info.impostorColumns * info.impostorRows).toBeGreaterThanOrEqual(info.cards);
        continue;
      }
      expect(info.height).toBeGreaterThan(0.5);
      expect(geometry.cards.length / CARD_FLOATS).toBe(info.cards);
      expect(info.cards).toBeGreaterThan(40);
      for (let c = 0; c < info.cards; c++) {
        const r = geometry.cards.subarray(c * CARD_FLOATS, (c + 1) * CARD_FLOATS);
        for (const o of [3, 6, 9]) expect(Math.hypot(r[o], r[o + 1], r[o + 2])).toBeCloseTo(1, 3);
        // right . normal = 0, up = normal x right
        expect(r[3] * r[9] + r[4] * r[10] + r[5] * r[11]).toBeCloseTo(0, 3);
        expect(r[12]).toBeGreaterThan(0);
        expect(r[13]).toBeGreaterThan(0);
        expect(Math.max(r[12], r[13])).toBeLessThan(info.height);
        for (const k of [14, 15, 16, 17]) {
          expect(r[k]).toBeGreaterThanOrEqual(0);
          expect(r[k]).toBeLessThanOrEqual(1);
        }
        expect(r[16]).toBeGreaterThan(r[14]);
        expect(r[17]).toBeGreaterThan(r[15]);
        expect(r[18]).toBeGreaterThanOrEqual(0);
        expect(r[18]).toBeLessThanOrEqual(1);
      }
      expect(geometry.trunk).not.toBeNull();
      expect(geometry.trunk!.index.length / 3).toBe(info.trunkTriangles);
      expect(info.trunkTriangles).toBeLessThanOrEqual(12000);
      expect(info.views * 1).toBeLessThanOrEqual(info.impostorColumns * info.impostorRows);
      for (const v of geometry.trunk!.visibility) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      // A tree shrinks millions of source triangles to a few thousand.
      expect(info.sourceTriangles).toBeGreaterThan(50 * (info.trunkTriangles + info.cards * 2));
    }
  });

  it('every atlas ships as mipmapped KTX2 with a smaller WebP fallback', () => {
    for (const asset of vegetation) {
      const roles = new Set(asset.files.map((f) => f.role).filter((r) => r !== 'geometry'));
      expect(roles.size).toBeGreaterThanOrEqual(2);
      for (const role of roles) {
        const ktx = asset.files.find((f) => f.role === role && f.format === 'ktx2');
        const webp = asset.files.find((f) => f.role === role && f.format === 'webp');
        expect(ktx, `${asset.id} ${role}`).toBeTruthy();
        expect(webp, `${asset.id} ${role}`).toBeTruthy();
        expect(webp!.width).toBeLessThan(ktx!.width!);
        expect(Math.max(ktx!.width!, ktx!.height!)).toBeLessThanOrEqual(2048);
        expect(ktx!.colorSpace).toBe(role.endsWith('color') ? 'srgb' : 'linear');
      }
    }
    const bytes = vegetation.reduce((n, a) => n + a.files.reduce((m, f) => m + f.bytes, 0), 0);
    expect(bytes).toBeLessThan(48 * 1024 * 1024);
  });
});

describe('species rules', () => {
  it('maps crown shapes to roles', () => {
    expect(treeRole(20, 8, true)).toBe('conifer');
    expect(treeRole(6, 5)).toBe('small');
    expect(treeRole(14, 7)).toBe('upright');
    expect(treeRole(14, 12)).toBe('broadleaf');
    expect(treeRole(14, 14)).toBe('spreading');
  });
  it('picks only loaded species, deterministically, with alpine venues mostly conifers', () => {
    const all = new Set<string>(TREE_SPECIES);
    for (let i = 0; i < 50; i++) {
      const h = plantHash(i * 3.7, -i * 1.3);
      expect(pickSpecies('broadleaf', 'green', h, all)).toBe(
        pickSpecies('broadleaf', 'green', h, all),
      );
    }
    const only = new Set<string>([SPECIES.linden]);
    expect(pickSpecies('conifer', 'alpine', 0.3, only)).toBe(SPECIES.linden);
    expect(pickSpecies('conifer', 'alpine', 0.3, new Set())).toBeNull();
    const alpine = Array.from({ length: 200 }, (_, i) =>
      pickSpecies('upright', 'alpine', plantHash(i, i), all),
    );
    expect(alpine.every((id) => id === SPECIES.fir || id === SPECIES.firB)).toBe(true);
    expect(speciesForPalette('city')).toContain(SPECIES.grass);
    expect(speciesForPalette('alpine', false, false)).not.toContain(SPECIES.shrub);
  });
  it('keeps scales and tints believable', () => {
    expect(plantScale(10, 100)).toBe(1.75);
    expect(plantScale(10, 1)).toBe(0.55);
    expect(plantScale(10, 12)).toBeCloseTo(1.2, 6);
    // Young firs may grow to the belts' planned conifers; broadleaf may not.
    expect(plantScale(8, 28, MAX_SCALE[SPECIES.fir])).toBe(2.6);
    expect(MAX_SCALE[SPECIES.linden]).toBeUndefined();
    for (let i = 0; i < 20; i++)
      for (const c of plantTint(i / 20, 'green')) {
        expect(c).toBeGreaterThan(0.8);
        expect(c).toBeLessThan(1.2);
      }
  });
});

describe('meadow grass along the circuit edge', () => {
  const track = new Track('clear', false, undefined, CIRCUITS.hochwald);
  const plan = grassPlan(track, {
    ground: () => 0,
    allow: () => true,
    tiles: 8,
    green: 4,
    dry: 0.25,
  });
  it('fills both sides of the lap densely, deterministically', () => {
    expect(plan.length).toBeGreaterThan(track.length * 2);
    const again = grassPlan(track, {
      ground: () => 0,
      allow: () => true,
      tiles: 8,
      green: 4,
      dry: 0.25,
    });
    expect(again).toEqual(plan);
    expect(new Set(plan.map((c) => c.tile)).size).toBe(8);
  });
  it('never grows on a road: outside every section barrier, or at its foot on grass run-off', () => {
    const p = trackPoint();
    for (const clump of plan.filter((_, i) => i % 7 === 0)) {
      const l = track.nearest(clump.x, clump.z, p);
      expect(Math.abs(l)).toBeGreaterThan(p.width + 1.4);
      expect(Math.abs(l)).toBeLessThan(track.boundaryAt(p, l < 0 ? -1 : 1) + GRASS.band + 2);
      expect(Number.isFinite(clump.y)).toBe(true);
    }
  });
});

describe('vegetation materials', () => {
  const tex = () => {
    const t = new T.DataTexture(new Uint8Array(4), 1, 1);
    t.image.width = 2048;
    t.image.height = 2048;
    return t;
  };
  it('card, bark, impostor and grass programs patch three without missing anchors', () => {
    const maps = { color: tex(), normal: tex() };
    const card = compile(cardMaterial(maps, 12, 'test'), 'standard');
    expect(card.vertexShader).toContain('vegCardFrame');
    expect(card.vertexShader).toContain('objectTangent = cR');
    expect(card.fragmentShader).toContain('RE_Direct_Vegetation');
    expect(card.fragmentShader).toContain('vegDither');
    const { depth, distance } = cardDepthMaterials(maps, 12);
    expect(compile(depth, 'depth').vertexShader).toContain('vegCardFrame');
    expect(compile(distance, 'distanceRGBA').vertexShader).toContain('vegCardFrame');
    const bark = barkMaterial({ color: tex(), normal: tex() }, 12, 'bark');
    expect(compile(bark.material, 'standard').fragmentShader).toContain('vBarkVisibility');
    expect(compile(bark.depth, 'depth').vertexShader).toContain('vegNearWeight');
    const impostor = impostorMaterial(
      maps,
      { views: 8, columns: 3, rows: 3, halfWidth: 5, height: 12 },
      12,
      'imp',
    );
    const imp = compile(impostor.material, 'standard');
    expect(imp.fragmentShader).toContain('vImpUvB');
    expect(imp.fragmentShader).not.toContain('#include <map_fragment>');
    expect(compile(impostor.depth, 'depth').vertexShader).toContain('vegAzimuth');
    const grass = grassMaterial(maps, { columns: 2, rows: 4 });
    expect(compile(grass.material, 'standard').vertexShader).toContain('grassTile');
    expect(compile(grass.depth, 'depth').vertexShader).toContain('grassTile');
  });
  it('near cards and impostors use complementary dithers of one fade', () => {
    const maps = { color: tex(), normal: tex() };
    const card = compile(cardMaterial(maps, 12, 'test'), 'standard');
    const imp = compile(
      impostorMaterial(maps, { views: 8, columns: 3, rows: 3, halfWidth: 5, height: 12 }, 12, 'i')
        .material,
      'standard',
    );
    expect(card.fragmentShader).toContain('if ( vVegFade < vegDither() ) discard;');
    expect(imp.fragmentShader).toContain('if ( vVegFade >= vegDither() ) discard;');
    expect(card.uniforms.vegEye).toBe(vegetationUniforms.vegEye);
    expect(imp.uniforms.vegLod).toBe(vegetationUniforms.vegLod);
  });
  it('LOD distances grow with the preset', () => {
    expect(VEGETATION.near.low).toBeLessThan(VEGETATION.near.medium);
    expect(VEGETATION.near.medium).toBeLessThan(VEGETATION.near.high);
    expect(VEGETATION.near.high).toBeLessThan(VEGETATION.near.ultra);
    expect(VEGETATION.grass.low).toBe(0);
    // LOW and MEDIUM keep the procedural planting (and its measured budgets).
    expect(photoVegetationEnabled('low')).toBe(false);
    expect(photoVegetationEnabled('medium')).toBe(false);
    expect(photoVegetationEnabled('high')).toBe(true);
    expect(photoVegetationEnabled('ultra')).toBe(true);
  });
});

describe('photographic forest chunks', () => {
  function stubLibrary(): VegetationLibrary {
    const geometry = new T.PlaneGeometry(1, 1);
    const material = new T.MeshStandardMaterial();
    const species = {
      id: SPECIES.linden,
      info: { height: 11 } as VegetationSpecies['info'],
      cards: geometry,
      trunk: geometry,
      impostor: geometry,
      cardMaterial: material,
      cardDepth: null,
      cardDistance: null,
      barkMaterial: material,
      barkDepth: null,
      barkDistance: null,
      impostorMaterial: material,
      impostorDepth: null,
      grass: null,
      textures: [],
    } as unknown as VegetationSpecies;
    const map = new Map([[SPECIES.linden, species]]);
    return {
      species: map,
      failed: [],
      get: (id: string) => map.get(id as typeof SPECIES.linden) ?? null,
      available: new Set(map.keys()),
      trees: [species],
      dispose() {},
    } as unknown as VegetationLibrary;
  }
  it('draws impostors everywhere and cards and trunks only in chunks near the camera', () => {
    const forest = new PhotoForest(stubLibrary());
    const plants = Array.from({ length: 60 }, (_, i) => ({
      species: SPECIES.linden,
      x: (i % 10) * 60,
      y: 0,
      z: Math.floor(i / 10) * 60,
      scale: 1,
      yaw: i,
      tint: [1, 1, 1] as const,
    }));
    forest.add(plants, { label: 'Test', shadows: true, chunk: 100 });
    expect(forest.plants).toBe(60);
    const camera = new T.PerspectiveCamera();
    camera.position.set(0, 2, 0);
    camera.updateMatrixWorld();
    forest.update(camera, 'high');
    const meshes = forest.root.children as T.InstancedMesh[];
    const near = meshes.filter((m) => m.userData.photoVegetation !== 'impostor');
    const impostors = meshes.filter((m) => m.userData.photoVegetation === 'impostor');
    expect(impostors.reduce((n, m) => n + m.count, 0)).toBe(60);
    expect(impostors.every((m) => !m.castShadow)).toBe(true);
    expect(near.some((m) => m.visible)).toBe(true);
    expect(near.some((m) => !m.visible)).toBe(true);
    expect(vegetationUniforms.vegEye.value.toArray()).toEqual([0, 2, 0]);
    expect(vegetationUniforms.vegLod.value.y).toBe(VEGETATION.near.high);
    forest.dispose();
    expect(forest.root.children.length).toBe(0);
  });

  it('draws cards and trunks only for the plants within the near distance, re-selected as the eye moves', () => {
    const forest = new PhotoForest(stubLibrary());
    // One chunk, a row of plants every 10 m along +x.
    const plants = Array.from({ length: 30 }, (_, i) => ({
      species: SPECIES.linden,
      x: i * 10,
      y: 0,
      z: 5,
      scale: 1,
      yaw: 0,
      tint: [1, 1, 1] as const,
    }));
    forest.add(plants, { label: 'Row', shadows: true, chunk: 1000 });
    const near = (forest.root.children as T.InstancedMesh[]).filter(
      (m) => m.userData.photoVegetation === 'cards',
    );
    expect(near.length).toBe(1);
    const cards = near[0];
    const drawnX = () =>
      Array.from({ length: cards.count }, (_, i) => cards.instanceMatrix.array[i * 16 + 12]);
    const camera = new T.PerspectiveCamera();
    camera.position.set(0, 2, 5);
    camera.updateMatrixWorld();
    forest.update(camera, 'high');
    const reach = VEGETATION.near.high + 2.5;
    expect(drawnX()).toEqual(plants.filter((p) => p.x <= reach).map((p) => p.x));
    camera.position.set(150, 2, 5);
    camera.updateMatrixWorld();
    forest.update(camera, 'high');
    expect(drawnX()).toEqual(plants.filter((p) => Math.abs(p.x - 150) <= reach).map((p) => p.x));
    // The density share keeps the leading plants only, as the impostor count does.
    forest.update(camera, 'high', 0.5);
    expect(Math.max(...drawnX())).toBeLessThan(150);
    // A count changed from outside (density pass) is re-selected next frame.
    cards.count = 30;
    forest.update(camera, 'high', 0.5);
    expect(cards.count).toBe(drawnX().length);
    expect(drawnX().every((x) => Math.abs(x - 150) <= reach && x < 150)).toBe(true);
    forest.dispose();
  });
});
