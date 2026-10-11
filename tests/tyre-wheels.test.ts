import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { BAND_COVERAGE, TYRE_ART, wheelBlur } from '../src/rendering/studio/tyre-letters.ts';
import {
  WHEEL_LOOK,
  anthraciteRimMaterial,
  installSuppliedWheelBlur,
  isSuppliedTyreArt,
  wheelCoverMaterial,
} from '../src/rendering/studio/wheel-blur.ts';
import { treadMaterial } from '../src/rendering/tire-finish.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { BRANDS } from '../src/rendering/studio/brand-atlas.ts';
import {
  configureSuppliedMaterial,
  suppliedDecalCoverageControl,
} from '../src/rendering/supplied-player-materials.ts';
import {
  installSuppliedShaderWork,
  suppliedShaderWorkControl,
} from '../src/rendering/supplied-shader-work.ts';

const compile = (m: T.Material, id: 'standard' | 'physical' = 'standard') => {
  const source = T.ShaderLib[id];
  const shader = {
    uniforms: T.UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
  } as unknown as StudioShader;
  m.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};

describe('tyre sidewall art', () => {
  it('blurs from 18 to 45 rad/s, deterministically', () => {
    expect(wheelBlur(0)).toBe(0);
    expect(wheelBlur(18)).toBe(0);
    expect(wheelBlur(45)).toBe(1);
    expect(wheelBlur(-60)).toBe(1);
    expect(wheelBlur(31.5)).toBeCloseTo(0.5, 6);
    expect(wheelBlur(NaN)).toBe(0);
    // Two 150 deg arcs cover 5/6 of the band ring.
    expect(BAND_COVERAGE).toBeCloseTo(5 / 6, 10);
  });

  it('uses only original wordmarks on the tyres', () => {
    expect(TYRE_ART.words).toEqual(['APEX CORSA', 'SLICK 18']);
    const allowed = new Set<string>([...BRANDS, 'APEX', 'CORSA', 'SLICK', '18']);
    for (const word of TYRE_ART.words.flatMap((w) => w.split(' ')))
      expect(allowed.has(word)).toBe(true);
  });

  it('paints tread and sidewall, the compound band and the lettering in the tread shader', () => {
    const tread = treadMaterial(0.19);
    expect(tread.material.color.getHex()).toBe(TYRE_ART.tread.color);
    expect(tread.material.roughness).toBe(TYRE_ART.tread.roughness);
    tread.band.value.setHex(0xe2262f);
    tread.side.value.x = 0.5;
    const shader = compile(tread.material);
    expect(shader.uniforms.treadBandColor).toBe(tread.band);
    expect(shader.uniforms.treadSide).toBe(tread.side);
    const f = shader.fragmentShader;
    expect(f).toContain('diffuseColor.rgb = mix(treadSidewallColor, diffuseColor.rgb, tireCrown);');
    expect(f).toContain('// D12 sidewall: band arcs, lettering and rotational blur.');
    expect(f).toContain(`smoothstep(${TYRE_ART.band[0].toFixed(3)} - bandEdge`);
    // Without a canvas (unit tests) no lettering is sampled.
    expect(tread.side.value.y).toBe(0);
    // The original drainage and contact behaviour is still compiled in.
    expect(f).toContain('tireGroove');
    expect(tread.material.customProgramCacheKey()).toContain('sidewall');
  });
});

describe('wheel covers and rims', () => {
  it('paints covers in the team colours with a speed-blurred sweep', () => {
    const blur = { value: 0.7 };
    const { material, uniforms } = wheelCoverMaterial(0xb3121e, 0x3a0a0e, 0xf2f2ee, blur);
    expect(material).toBeInstanceOf(T.MeshPhysicalMaterial);
    expect(material.color.getHex()).toBe(new T.Color(0xb3121e).getHex());
    expect(material.clearcoat).toBe(1);
    expect(uniforms.coverBlur).toBe(blur);
    expect(studioHookKeys(material)).toEqual(['wheel-cover-v1']);
    const shader = compile(material, 'physical');
    expect(shader.uniforms.coverBlur).toBe(blur);
    expect(shader.fragmentShader).toContain(
      `sweep = mix( sweep, ${WHEEL_LOOK.sweepCoverage.toFixed(4)}, clamp( coverBlur, 0.0, 1.0 ) ) * band;`,
    );
    expect(shader.vertexShader).toContain('vWheelLocal = position;');
  });

  it('uses anthracite alloy with a lighter lip', () => {
    const rim = anthraciteRimMaterial();
    expect(rim.color.getHex()).toBe(new T.Color(WHEEL_LOOK.rim.color).getHex());
    expect(rim.metalness).toBe(0.75);
    expect(rim.roughness).toBe(0.38);
    const shader = compile(rim);
    expect(shader.fragmentShader).toContain(
      `${WHEEL_LOOK.lipRadius.toFixed(4)}, length( vWheelLocal.yz )`,
    );
  });

  it('reinstalls source shader and zero-alpha coverage hooks on cloned tyre decals', () => {
    const decal = new T.MeshPhysicalMaterial({
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      map: new T.Texture(),
    });
    decal.name = 'Decal | tyre_pzero';
    configureSuppliedMaterial(decal);
    installSuppliedShaderWork(decal);
    const sourceCoverage = suppliedDecalCoverageControl(decal);
    expect(sourceCoverage).not.toBeNull();
    const geometry = new T.BoxGeometry();
    const spins = Array.from({ length: 4 }, () => {
      const spin = new T.Group();
      spin.add(new T.Mesh(geometry, decal));
      return spin;
    });
    const result = installSuppliedWheelBlur(spins);
    expect(result.materials.map((copies) => copies.length)).toEqual([1, 1, 1, 1]);
    const controls = spins.map((spin, i) => {
      const copy = (spin.children[0] as T.Mesh).material as T.MeshPhysicalMaterial;
      expect(copy).not.toBe(decal);
      expect(copy.map).toBe(decal.map);
      expect(copy.forceSinglePass).toBe(true);
      const coverage = suppliedDecalCoverageControl(copy);
      expect(coverage).not.toBeNull();
      expect(coverage).not.toBe(sourceCoverage);
      expect(suppliedShaderWorkControl(copy)).not.toBeNull();
      const shader = compile(copy, 'physical');
      expect(shader.uniforms.apexDiscardEmptyDecal).toBe(coverage);
      expect(shader.uniforms.apexShaderWork).toBe(suppliedShaderWorkControl(copy));
      expect(shader.uniforms.wheelBlurAmount).toBe(result.blur[i]);
      expect(shader.fragmentShader).toContain('diffuseColor.a == 0.0');
      expect(shader.fragmentShader).toContain('if ( wheelBlurAmount > 0.01 )');
      return coverage!;
    });
    expect(new Set(controls).size).toBe(4);
    controls[0].value = false;
    expect(controls.slice(1).every((control) => control.value)).toBe(true);
    expect(sourceCoverage!.value).toBe(true);
    for (const spin of spins) ((spin.children[0] as T.Mesh).material as T.Material).dispose();
    geometry.dispose();
    decal.dispose();
  });

  it('gives each supplied wheel its own blurred copies of the tyre art, in its own axle frame', () => {
    const decal = new T.MeshStandardMaterial({ name: 'Decal | tyre_pzero', map: new T.Texture() });
    const ink = new T.MeshStandardMaterial({ name: 'Tyre | compound sidewall ink' });
    const rubber = new T.MeshStandardMaterial({ name: 'Tyre | lightly scrubbed slick' });
    expect([decal, ink, rubber].map(isSuppliedTyreArt)).toEqual([true, true, false]);
    const spins = [-1, 1].map((side) => {
      const spin = new T.Group();
      spin.position.set(side * 0.8, 0.33, 1.8);
      const tyre = new T.Group();
      tyre.position.set(-side * 0.8, -0.33, -1.8); // primitives authored in car space
      spin.add(tyre);
      for (const m of [decal, ink, rubber]) tyre.add(new T.Mesh(new T.BoxGeometry(), m));
      new T.Group().add(spin);
      return spin;
    });
    const result = installSuppliedWheelBlur(spins);
    expect(result.blur).toHaveLength(2);
    expect(result.materials.map((list) => list.length)).toEqual([2, 2]);
    const meshes = spins.map((spin) => spin.children[0].children as T.Mesh[]);
    // Each wheel's art is its own copy; plain rubber stays shared.
    expect(meshes[0][0].material).not.toBe(decal);
    expect(meshes[0][0].material).not.toBe(meshes[1][0].material);
    expect(meshes[0][2].material).toBe(rubber);
    expect((meshes[0][0].material as T.Material).name).toBe('Decal | tyre_pzero | wheel 0');
    const shader = compile(meshes[1][0].material as T.Material);
    expect(shader.uniforms.wheelBlurAmount).toBe(result.blur[1]);
    // The wheel centre is found in the primitive's frame (car space here).
    expect(
      (shader.uniforms.wheelCentre.value as T.Vector3).toArray().map((v) => +v.toFixed(6)),
    ).toEqual([0.8, 0.33, 1.8]);
    expect((shader.uniforms.wheelAxis.value as T.Vector3).toArray()).toEqual([1, 0, 0]);
    expect(shader.fragmentShader).toContain('if ( wheelBlurAmount > 0.01 )');
  });
});
