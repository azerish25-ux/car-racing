import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { crowdGarmentColour } from '../src/rendering/crowd-wardrobe.ts';
import { Stadium } from '../src/rendering/offroad/stadium.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';

function compile(material: T.Material) {
  const source = T.ShaderLib.standard;
  const shader = {
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
    uniforms: T.UniformsUtils.clone(source.uniforms),
  } as StudioShader;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

describe('motocross stadium audience', () => {
  it('draws every occupied seat once with detailed lower rows below the previous crowd geometry cost', () => {
    const arena = new Stadium(rigTrack('arena-nord-sx'));
    const all = arena.crowd,
      close = arena.nearCrowd,
      phases = all.geometry.getAttribute('spectatorPhase'),
      closePhases = close.geometry.getAttribute('spectatorPhase');
    const shader = compile(all.material as T.Material);
    const range = shader.uniforms.crowdLodRange.value as T.Vector2;
    const chairs = arena.root.getObjectByName(
      'Moulded stadium chairs (instanced)',
    ) as T.InstancedMesh;
    const a = new T.Matrix4(),
      b = new T.Matrix4();
    let closeIndex = 0,
      distantCount = 0,
      meshes = 0,
      triangles = 0;
    for (let i = 0; i < all.count; i++) {
      const phase = phases.getX(i);
      if (phase / (Math.PI * 2) < range.x) {
        expect(closePhases.getX(closeIndex)).toBe(phase);
        all.getMatrixAt(i, a);
        close.getMatrixAt(closeIndex, b);
        expect(a.elements).toEqual(b.elements);
        closeIndex++;
      } else distantCount++;
    }
    expect(closeIndex).toBe(close.count);
    expect(close.count).toBeGreaterThan(200);
    expect(closeIndex + distantCount).toBe(all.count);
    expect(chairs.count).toBe(all.count);
    expect(all.count).toBeGreaterThan(1000);
    arena.root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      meshes++;
      triangles +=
        (object.geometry.index!.count / 3) * (object instanceof T.InstancedMesh ? object.count : 1);
    });
    const submittedCrowd =
      (all.geometry.index!.count / 3) * all.count + (close.geometry.index!.count / 3) * close.count;
    // The old shared person used 220 clothing triangles plus a 56-triangle
    // head for every seat. The new distant representation costs two triangles.
    const previousCrowd = 276 * all.count;
    expect(submittedCrowd).toBeLessThan(previousCrowd * 0.5);
    expect(meshes).toBeLessThanOrEqual(15);
    console.info(
      JSON.stringify({
        seats: all.count,
        sculpted: close.count,
        distant: distantCount,
        meshes,
        submittedCrowd,
        previousCrowd,
        totalStadiumTriangles: triangles,
      }),
    );
    arena.dispose();
  });

  it('keeps mixed seated/standing figures and muted clothing without modifying the seat plan', () => {
    const arena = new Stadium(rigTrack('arena-nord-sx'));
    const crowd = arena.crowd,
      styles = crowd.geometry.getAttribute('spectatorStyle'),
      phases = crowd.geometry.getAttribute('spectatorPhase'),
      color = new T.Color(),
      garment = new T.Color();
    let standing = 0,
      luminance = 0;
    const tones = new Set<string>();
    for (let i = 0; i < crowd.count; i++) {
      standing += styles.getZ(i) > 0.5 ? 1 : 0;
      crowd.getColorAt(i, color);
      crowdGarmentColour(color, phases.getX(i), garment);
      luminance += garment.r * 0.2126 + garment.g * 0.7152 + garment.b * 0.0722;
      tones.add(garment.getHexString());
    }
    expect(standing / crowd.count).toBeGreaterThan(0.15);
    expect(standing / crowd.count).toBeLessThan(0.4);
    expect(tones.size).toBeGreaterThan(200);
    expect(luminance / crowd.count).toBeGreaterThan(0.04);
    expect(luminance / crowd.count).toBeLessThan(0.18);
    arena.dispose();
  });

  it('freezes on held simulation time and exactly restores all animated uniforms after seeking', () => {
    const arena = new Stadium(rigTrack('arena-nord-sx'));
    const shader = compile(arena.nearCrowd.material as T.Material);
    const state = () => ({
      clock: (shader.uniforms.crowdClock.value as T.Vector2).toArray(),
      reaction: (shader.uniforms.crowdReaction.value as T.Vector2).toArray(),
      motion: shader.uniforms.crowdMotion.value,
    });
    const instances = Array.from(arena.nearCrowd.instanceMatrix.array);
    arena.update(17.25);
    const held = state();
    arena.update(17.25);
    expect(state()).toEqual(held);
    arena.update(45);
    expect(state()).not.toEqual(held);
    arena.update(17.25);
    expect(state()).toEqual(held);
    expect(Array.from(arena.nearCrowd.instanceMatrix.array)).toEqual(instances);
    expect(() => arena.update(Number.NaN)).toThrow('Invalid stadium presentation time');
    arena.dispose();
    expect(arena.root.children).toHaveLength(0);
  });
});
