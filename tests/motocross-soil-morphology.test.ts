import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  installMxSoilMorphology,
  MX_SOIL_MORPHOLOGY_HOOK,
  MX_SOIL_MORPHOLOGY_KINDS,
} from '../src/rendering/offroad/mx-soil-morphology.ts';
import { sampleMxSoilTransition } from '../src/rendering/offroad/mx-soil-transition.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { SOIL_KINDS } from '../src/simulation/offroad/course.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track } from '../src/simulation/track.ts';

describe('MX material-specific earth structure', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    'uses the same integrated %s cell fractions for material structure without mutating the surface',
    (id) => {
      const track = rigTrack(id),
        terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain;
      const source = {
        soil: terrain.soil.slice(),
        moisture: terrain.baseMoisture.slice(),
        hash: terrain.hash(),
      };
      const view = new TerrainView(track);
      const represented = new Set<string>();
      let transitions = 0;
      for (const object of view.group.children) {
        const mesh = object as T.Mesh,
          coordinates = mesh.geometry.getAttribute('mxCourse'),
          composition = mesh.geometry.getAttribute('mxSoilMix'),
          position = mesh.geometry.getAttribute('position');
        expect(composition.count).toBe(position.count);
        expect(composition.itemSize).toBe(4);
        for (let vertex = 0; vertex < position.count; vertex += 19) {
          const sample = sampleMxSoilTransition(
            terrain,
            coordinates.getX(vertex),
            coordinates.getY(vertex),
          );
          let sum = 0,
            mixed = 0;
          for (let component = 0; component < 4; component++) {
            const kind = MX_SOIL_MORPHOLOGY_KINDS[component],
              fraction = composition.getComponent(vertex, component);
            expect(fraction).toBeCloseTo(sample.weights[SOIL_KINDS.indexOf(kind)], 5);
            expect(fraction).toBeGreaterThanOrEqual(0);
            expect(fraction).toBeLessThanOrEqual(1);
            if (fraction > 0.9) represented.add(kind);
            if (fraction > 0.01) mixed++;
            sum += fraction;
          }
          expect(sum).toBeLessThanOrEqual(coordinates.getZ(vertex) + 1e-6);
          if (mixed > 1) transitions++;
        }
      }
      expect(represented.has('hardpack')).toBe(true);
      expect(represented.has('loam')).toBe(true);
      if (id === 'valley-ridge-mx') {
        expect(represented.has('sand')).toBe(true);
        expect(represented.has('mud')).toBe(true);
      }
      expect(transitions).toBeGreaterThan(0);
      expect(terrain.soil).toEqual(source.soil);
      expect(terrain.baseMoisture).toEqual(source.moisture);
      expect(terrain.hash()).toBe(source.hash);
      expect(studioHookKeys(view.material)).toContain(MX_SOIL_MORPHOLOGY_HOOK);
      view.dispose();
    },
  );

  it('rewinds wet film, compaction and geometry to before the first export, then restores the same live field', () => {
    const view = new TerrainView(rigTrack('valley-ridge-mx'));
    const geometry = (view.group.children[0] as T.Mesh).geometry,
      positions = geometry.getAttribute('position') as T.BufferAttribute,
      states = geometry.getAttribute('apexSoilState'),
      composition = geometry.getAttribute('mxSoilMix');
    const originalY = positions.getY(0),
      sourceMix = composition.array.slice(),
      moisture = states.getX(0),
      uniform = (view.material.userData.soil as { apexSoilWetness: T.IUniform<number> })
        .apexSoilWetness;
    view.record(
      { reset: true, wetness: 0.76, blocks: new Float32Array([0, 0.09, 0.72]) },
      12,
      true,
    );
    expect(uniform.value).toBe(0.76);
    expect(positions.getY(0)).toBeCloseTo(originalY - 0.09, 5);
    expect(states.getY(0)).toBeCloseTo(0.72, 5);
    view.showAt(4);
    expect(uniform.value).toBe(0);
    expect(positions.getY(0)).toBe(originalY);
    expect(states.getY(0)).toBe(0);
    expect(states.getZ(0)).toBe(0);
    expect(states.getX(0)).toBe(moisture);
    expect(view.deformedBlocks).toBe(0);
    view.showLive();
    expect(uniform.value).toBe(0.76);
    expect(positions.getY(0)).toBeCloseTo(originalY - 0.09, 5);
    expect(states.getZ(0)).toBeCloseTo(0.09, 5);
    expect(composition.array).toEqual(sourceMix);
    const version = positions.version;
    view.showAt(12); // Holding the snapshot does not re-upload/rebuild any field.
    expect(positions.version).toBe(version);
    view.dispose();
  });

  it('composes once with the scanned, groomed and wet material, and excludes rallycross', () => {
    const view = new TerrainView(rigTrack('arena-nord-sx')),
      source = T.ShaderLib.physical,
      compiled = {
        vertexShader: source.vertexShader,
        fragmentShader: source.fragmentShader,
        uniforms: T.UniformsUtils.clone(source.uniforms),
      } as StudioShader;
    expect(installMxSoilMorphology(view.material)).toBe(false);
    view.material.onBeforeCompile(compiled, {} as T.WebGLRenderer);
    expect(compiled.fragmentShader.indexOf('float mxSoilHash(')).toBeLessThan(
      compiled.fragmentShader.indexOf('vec2 mxSoilFragment('),
    );
    expect(compiled.fragmentShader.indexOf('mxMorphFilm = smoothstep(')).toBeLessThan(
      compiled.fragmentShader.indexOf('normal = normalize( mix( normal, nonPerturbedNormal,'),
    );
    expect((compiled.fragmentShader.match(/vec2 mxSoilFragment\(/g) ?? []).length).toBe(1);
    expect(compiled.vertexShader).not.toMatch(/transformed\.[xyz]\s*[+*-]=/);
    view.dispose();
    const rx = new TerrainView(rigTrack('kestrel-rx'));
    expect(studioHookKeys(rx.material)).not.toContain(MX_SOIL_MORPHOLOGY_HOOK);
    expect((rx.group.children[0] as T.Mesh).geometry.hasAttribute('mxSoilMix')).toBe(false);
    rx.dispose();
  });
});
