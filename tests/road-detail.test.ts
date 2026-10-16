import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { installWetRoad } from '../src/rendering/materials.ts';
import {
  ROAD_REPAIRS,
  ROAD_REPAIR_GLSL,
  ROAD_SEALANT,
  roadRepair,
} from '../src/rendering/road-macro.ts';
import { ASPHALT_TONE } from '../src/rendering/circuit-finish.ts';
import {
  ASPHALT_DETAIL,
  LAUNCH_RUBBER,
  ROAD_DETAIL,
  START_GRID,
  apexLineAt,
  apexLineProfile,
  installAsphaltDetail,
  installRoadDetail,
  surfaceGridFor,
} from '../src/rendering/studio/road-detail.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import {
  ASPHALT_TEXELS,
  asphaltMesoPixels,
  asphaltTexelMeans,
  surfaceMaterial,
  surfaceNormalPixels,
  surfacePixels,
} from '../src/rendering/surface-detail.ts';
import { TYRE_MARKS, tyreMarkZones, tyreMarks } from '../src/rendering/tyre-marks.ts';
import { racingLineFor } from '../src/simulation/racing-line.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';

function stubCanvas() {
  class Canvas {
    width = 300;
    height = 150;
    getContext() {
      return new Proxy(
        { canvas: this },
        {
          get: (t, k) =>
            k === 'createImageData'
              ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
              : (Reflect.get(t, k) ?? (() => {})),
        },
      );
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
}
afterEach(() => vi.unstubAllGlobals());

const compile = (material: T.Material) => {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  } as unknown as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};
const roadMaterial = (lap = 2972.7) => {
  const material = surfaceMaterial('asphalt', undefined, true);
  const state = new T.DataTexture(new Uint8Array(4), 1, 1);
  installWetRoad(material, state, true);
  installRoadDetail(material, lap);
  return { material, state };
};

describe('asphalt texels (P4 tone, Sobel normals, meso tile)', () => {
  it('authors warm-neutral asphalt with the chip contrast inside the byte guard', () => {
    const data = surfacePixels('asphalt', 128);
    const means = asphaltTexelMeans(data);
    // Linear mean of a dark near-neutral binder (sRGB ~#565553 to #615f5d),
    // blue a little below red (B/R 0.88-1.0).
    expect(means.albedo[0]).toBeGreaterThan(0.085);
    expect(means.albedo[0]).toBeLessThan(0.115);
    const br = means.albedo[2] / means.albedo[0];
    expect(br).toBeGreaterThan(0.88);
    expect(br).toBeLessThan(1.0);
    expect(means.roughness).toBeGreaterThan(0.75);
    expect(means.roughness).toBeLessThan(0.86);
    // The meso tile and chip coverage occupy the unread red/blue channels.
    const meso = asphaltMesoPixels(128);
    for (let i = 0; i < meso.length; i += 97) {
      expect(data.roughness[i * 4]).toBe(Math.round(meso[i] * 255));
      expect(data.roughness[i * 4 + 1]).toBeGreaterThanOrEqual(188);
    }
  });
  it('builds a seamless, normalised meso tile with its own seed', () => {
    const size = 128,
      meso = asphaltMesoPixels(size);
    expect(asphaltMesoPixels(size)).toEqual(meso);
    let sum = 0,
      sq = 0;
    for (const v of meso) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      sum += v;
      sq += v * v;
    }
    const mean = sum / meso.length,
      std = Math.sqrt(sq / meso.length - mean * mean);
    expect(mean).toBeCloseTo(0.5, 1);
    expect(std).toBeGreaterThan(0.13);
    expect(std).toBeLessThan(0.17);
    // Wrapped edges are as continuous as interior neighbours.
    let seam = 0,
      interior = 0;
    for (let y = 0; y < size; y++) {
      seam += Math.abs(meso[y * size + size - 1] - meso[y * size]);
      interior += Math.abs(meso[y * size + 63] - meso[y * size + 64]);
    }
    expect(seam).toBeLessThan(interior * 1.6 + 1);
    // Not the chip tile's field under another name.
    const chip = surfacePixels('asphalt', size).height;
    let same = 0;
    for (let i = 0; i < meso.length; i++) if (Math.abs(meso[i] * 255 - chip[i]) < 2) same++;
    expect(same).toBeLessThan(meso.length * 0.1);
    expect(() => asphaltMesoPixels(7)).toThrow();
  });
  it('derives tangent-space normals from the height bytes with a Sobel operator', () => {
    const size = 16,
      flat = surfaceNormalPixels(new Uint8Array(size * size).fill(90), size);
    for (let i = 0; i < size * size; i++)
      expect([...flat.slice(i * 4, i * 4 + 4)]).toEqual([128, 128, 255, 255]);
    // Height rising to +x (+U) tilts the normal toward -U; rising down the
    // canvas (-V after the upload flip) tilts it toward +V.
    const rampX = new Uint8Array(size * size),
      rampY = new Uint8Array(size * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        rampX[y * size + x] = 100 + 4 * Math.min(x, size - 1 - x);
        rampY[y * size + x] = 100 + 4 * Math.min(y, size - 1 - y);
      }
    // At 16 px a texel spans 32 of the 512 px authoring texels: scale the
    // gain so the ramps carry the same slope per metre as at full size.
    const gain = (ASPHALT_TEXELS.normalStrength * 512) / size;
    const nx = surfaceNormalPixels(rampX, size, gain),
      ny = surfaceNormalPixels(rampY, size, gain);
    expect(nx[(5 * size + 4) * 4]).toBeLessThan(128);
    expect(nx[(5 * size + 12) * 4]).toBeGreaterThan(128);
    expect(ny[(4 * size + 5) * 4 + 1]).toBeGreaterThan(128);
    // Higher strength tilts further; normals stay unit length within bytes.
    const strong = surfaceNormalPixels(rampX, size, gain * 3);
    expect(strong[(5 * size + 4) * 4]).toBeLessThan(nx[(5 * size + 4) * 4]);
    for (let i = 0; i < size * size; i++) {
      const v = [0, 1, 2].map((c) => strong[i * 4 + c] / 127.5 - 1);
      expect(Math.hypot(...v)).toBeCloseTo(1, 1);
    }
    expect(() => surfaceNormalPixels(rampX, 15)).toThrow();
    expect(() => surfaceNormalPixels(rampX, size, NaN)).toThrow();
  });
  it('gives asphalt a linear normal map (no bump map) and keeps three textures', () => {
    stubCanvas();
    const asphalt = surfaceMaterial('asphalt');
    expect(asphalt.bumpMap).toBeNull();
    expect(asphalt.normalMap).toBeInstanceOf(T.Texture);
    expect(asphalt.normalMap!.colorSpace).toBe(T.NoColorSpace);
    expect(asphalt.roughnessMap!.colorSpace).toBe(T.NoColorSpace);
    expect(asphalt.map!.colorSpace).toBe(T.SRGBColorSpace);
    expect(asphalt.normalScale.x).toBeGreaterThanOrEqual(0.6);
    expect(asphalt.normalScale.x).toBeLessThanOrEqual(0.9);
    const textures = Object.values(asphalt).filter((v) => v instanceof T.Texture);
    expect(new Set(textures).size).toBe(3);
    expect(studioHookKeys(asphalt)).toEqual(['asphalt-detail-v2']);
    // Other surfaces keep their bump relief.
    const gravel = surfaceMaterial('gravel');
    expect(gravel.bumpMap).toBeInstanceOf(T.Texture);
    expect(gravel.normalMap).toBeNull();
    expect(studioHookKeys(gravel)).toEqual([]);
  });
});

describe('asphalt detail shader', () => {
  it('fades the chip tile to its mean over 15-40 m and adds meso tone and relief', () => {
    stubCanvas();
    const material = surfaceMaterial('asphalt');
    const shader = compile(material);
    const f = shader.fragmentShader;
    expect(f).toContain(
      `smoothstep(${ASPHALT_DETAIL.microFade[0].toFixed(5)}, ${ASPHALT_DETAIL.microFade[1].toFixed(5)}, apexAsphaltDistance)`,
    );
    expect(f).toContain('texture2D(roughnessMap, apexMesoUv).r');
    expect(f).toContain(`vAsphaltWorld * ${(1 / ASPHALT_DETAIL.mesoTile).toFixed(5)}`);
    // Order: fade after the map sample, frame tilt before the normal map.
    // TEST-UPDATE (env realism): the chip tile now spans dark voids to polished
    // chips in its own bytes, so the near-field lift is the configured gain.
    expect(f.indexOf(`apexMicro * ${ASPHALT_DETAIL.microContrast.toFixed(5)}`)).toBeGreaterThan(
      f.indexOf('#include <map_fragment>'),
    );
    expect(f.indexOf('tbn[2] = apexTilted')).toBeLessThan(
      f.indexOf('#include <normal_fragment_maps>'),
    );
    expect(f.indexOf('tbn[2] = apexTilted')).toBeGreaterThan(
      f.indexOf('#include <normal_fragment_begin>'),
    );
    expect(shader.vertexShader).toContain('vAsphaltWorld = (modelMatrix * asphaltWorld).xz;');
    expect(material.customProgramCacheKey()).toContain('|asphalt-detail-v2');
    // Idempotent and validated.
    expect(installAsphaltDetail(material, { albedo: [0.1, 0.1, 0.1], roughness: 0.8 })).toBe(false);
    expect(() =>
      installAsphaltDetail(new T.MeshStandardMaterial(), { albedo: [0, 0.1, 0.1], roughness: 0.8 }),
    ).toThrow();
  });
});

describe('racing surface layer', () => {
  it('keeps the wet road uniform keys and composes after its state sample', () => {
    stubCanvas();
    const { material, state } = roadMaterial();
    const shader = compile(material);
    expect(Object.keys(shader.uniforms)).toEqual([
      'roadWeather',
      'trackState',
      'surfaceDeposits',
      'roadLampRadius',
      'apexMotorcycleSurface',
    ]);
    const f = shader.fragmentShader;
    const line = f.indexOf('apexLineMask = apexCore * apexRubber');
    expect(line).toBeGreaterThan(f.indexOf('vec4 roadState = texture2D(trackState, vTrackUV)'));
    expect(line).toBeLessThan(f.indexOf('#include <color_fragment>'));
    expect(f).toContain(`smoothstep(0.0, ${ROAD_DETAIL.rubberFull.toFixed(5)}, roadState.g)`);
    expect(f).toContain(
      `float apexSigma = mix(${ROAD_DETAIL.lineSigma.toFixed(5)}, 0.56, apexMotorcycleSurface)`,
    );
    expect(f).toContain(
      `(${ROAD_DETAIL.lineDarkening.toFixed(5)} + ${ROAD_DETAIL.brakeDarkening.toFixed(5)} * apexBrake) * apexLineMask`,
    );
    // Rubber and sealant roughness precede the water film, which wins when wet.
    const rough = f.indexOf(
      `roughnessFactor -= ${ROAD_DETAIL.lineRoughness.toFixed(5)} * apexLineMask`,
    );
    expect(rough).toBeGreaterThan(f.indexOf('#include <roughnessmap_fragment>'));
    expect(rough).toBeLessThan(
      f.indexOf('roughnessFactor=mix(roughnessFactor,mix(0.22,0.08,roadSheet),wet)'),
    );
    // The macro noise is declared before the functions that call it.
    expect(f.indexOf('float apexRoadNoise(')).toBeLessThan(f.indexOf('float apexLapNoise('));
    expect(f.indexOf('float apexRoadNoise(')).toBeLessThan(f.indexOf('float apexRoadSealant('));
    expect(shader.vertexShader).toContain('attribute vec2 apexLine;');
    expect(shader.vertexShader).toContain('attribute float edgeMetres;');
    expect(material.customProgramCacheKey()).toContain('road-macro-v1');
    expect(material.customProgramCacheKey()).toContain('|road-detail-v6');
    // The wet road hook is not a studio chain, so only the newer key is listed.
    expect(studioHookKeys(material)).toEqual(['road-detail-v6']);
    material.dispose();
    state.dispose();
  });
  it('changes vehicle-family wear through one live uniform without recompiling the road', () => {
    stubCanvas();
    const material = surfaceMaterial('asphalt', undefined, true),
      state = new T.DataTexture(new Uint8Array(4), 1, 1),
      motorcycle = { value: 0 };
    installWetRoad(material, state, true);
    installRoadDetail(material, 3000, motorcycle);
    const shader = compile(material),
      key = material.customProgramCacheKey(),
      version = material.version;
    expect(shader.uniforms.apexMotorcycleSurface).toBe(motorcycle);
    motorcycle.value = 1;
    expect(shader.uniforms.apexMotorcycleSurface.value).toBe(1);
    expect(material.customProgramCacheKey()).toBe(key);
    expect(material.version).toBe(version);
    motorcycle.value = 0;
    expect(shader.uniforms.apexMotorcycleSurface.value).toBe(0);
    material.dispose();
    state.dispose();
  });
  it('refuses a material without the wet road or the asphalt detail', () => {
    const plain = new T.MeshPhysicalMaterial();
    installRoadDetail(plain, 3000);
    expect(() => compile(plain)).toThrow(/wet road/);
    expect(() => installRoadDetail(new T.MeshPhysicalMaterial(), 0)).toThrow();
  });
  it('takes derivatives in uniform control flow and never inverts the chip relief', () => {
    stubCanvas();
    const { material, state } = roadMaterial();
    const f = compile(material).fragmentShader;
    // GLSL leaves derivatives inside non-uniform branches undefined: the grid
    // branch and the per-cell repair early return use footprints taken before.
    const branch = f.indexOf('if (apexFromLine >');
    expect(branch).toBeGreaterThan(f.indexOf('float apexWheelAA = max(fwidth(vRoadMetres.x)'));
    expect(f.slice(branch, f.indexOf('apexLineMask = max(apexLineMask', branch))).not.toContain(
      'fwidth(',
    );
    const repair = ROAD_REPAIR_GLSL.slice(
      ROAD_REPAIR_GLSL.indexOf('vec3 apexRoadRepair('),
      ROAD_REPAIR_GLSL.indexOf('float apexRoadSealant('),
    );
    const early = repair.indexOf('return vec3(0.0, 1.0, 0.0);');
    expect(repair.indexOf('fwidth(m)')).toBeLessThan(early);
    expect(repair.slice(early)).not.toContain('fwidth(');
    // Seams are box-filtered across their own cut: lateral footprint on the
    // long sides, along-track on the ends.
    expect(repair).toContain('fd = dx < dy ? dm.x : dm.y');
    // The striated line mask peaks above 1: shares and relief are clamped.
    expect(f).toContain('max(0.0, 1.0 - apexLineMask)');
    expect(f).toContain(
      `float apexRelief = max(0.0, 1.0 - (1.0 - ${ROAD_DETAIL.lineRelief.toFixed(5)}) * apexLineMask`,
    );
    material.dispose();
    state.dispose();
  });
  it('samples the solved line and braking weights along the lap', () => {
    const track = new Track('clear'),
      line = racingLineFor(track),
      profile = apexLineProfile(track);
    expect(apexLineProfile(track)).toBe(profile);
    for (const s of [0, 120.5, 1000, 2500.25, track.length - 0.5]) {
      const [x, brake] = apexLineAt(track, s, 1.5);
      expect(x).toBeCloseTo(1.5 - line.offsetAt(s), 1);
      expect(brake).toBeGreaterThanOrEqual(0);
      expect(brake).toBeLessThanOrEqual(1);
    }
    const zones = tyreMarkZones(track).filter((z) => z.kind === 'braking');
    for (const zone of zones) {
      // Heaviest at the apex, light at the zone's start.
      const atApex = apexLineAt(track, zone.end, 0)[1],
        atStart = apexLineAt(track, zone.start + 1, 0)[1];
      expect(atApex).toBeGreaterThan(0.4);
      expect(atApex).toBeGreaterThan(atStart);
    }
    // The long start straight carries no braking weight.
    expect(apexLineAt(track, 0, 0)[1]).toBe(0);
  });
  it('writes apexLine on the road ribbon and edgeMetres on every ribbon', () => {
    const track = new Track('clear', true),
      scene = Object.assign(Object.create(CircuitScene.prototype), {
        track,
        group: new T.Group(),
        surfaces: new T.Group(),
      }) as CircuitScene;
    const p = trackPoint();
    const road = scene.ribbon(new T.MeshStandardMaterial(), {
      start: 1180,
      end: 1240,
      step: 1.8,
      columns: 14,
      road: true,
      offset: (s, t) => {
        track.at(s, p);
        return (t * 2 - 1) * p.width;
      },
    });
    const kerb = scene.ribbon(new T.MeshStandardMaterial(), {
      start: 1180,
      end: 1200,
      step: 0.5,
      columns: 2,
      offset: (s, t) => {
        track.at(s, p);
        return p.width + t * 1.1;
      },
    });
    const apex = road.geometry.getAttribute('apexLine'),
      edge = road.geometry.getAttribute('edgeMetres');
    expect(apex.itemSize).toBe(2);
    expect(apex.count).toBe(road.geometry.getAttribute('position').count);
    for (let i = 0; i < apex.count; i++) {
      expect(edge.getX(i)).toBeLessThanOrEqual(1e-5);
      expect(edge.getX(i)).toBeGreaterThanOrEqual(-8.7);
      expect(apex.getY(i)).toBeGreaterThanOrEqual(0);
      expect(apex.getY(i)).toBeLessThanOrEqual(1);
    }
    // Across one row the line distance changes exactly with the lateral offset.
    expect(apex.getX(14) - apex.getX(0)).toBeCloseTo(track.at(1180, p).width * 2, 3);
    expect(kerb.geometry.hasAttribute('apexLine')).toBe(false);
    const kerbEdge = kerb.geometry.getAttribute('edgeMetres');
    expect(kerbEdge.getX(0)).toBeCloseTo(0, 5);
    expect(kerbEdge.getX(2)).toBeCloseTo(1.1, 5);
    road.geometry.dispose();
    kerb.geometry.dispose();
  });
});

describe('repairs, sealant and braking streaks', () => {
  it('cuts 1-4 m repairs 10-15 % darker that never cross the start line', () => {
    for (const lap of [2972.7, 3997.3]) {
      let count = 0;
      for (let cell = 0; cell * ROAD_REPAIRS.cell < lap + ROAD_REPAIRS.cell; cell++) {
        const repair = roadRepair(cell, lap);
        if (!repair) continue;
        count++;
        expect(repair.length).toBeGreaterThanOrEqual(1);
        expect(repair.length).toBeLessThanOrEqual(4);
        expect(repair.start).toBeGreaterThanOrEqual(cell * ROAD_REPAIRS.cell);
        expect(repair.start + repair.length).toBeLessThanOrEqual(lap);
        expect(repair.tone).toBeGreaterThanOrEqual(0.85);
        expect(repair.tone).toBeLessThanOrEqual(0.9);
        expect(Math.max(Math.abs(repair.low), Math.abs(repair.high))).toBeLessThanOrEqual(6.8);
      }
      expect(count).toBeGreaterThan(lap / 150);
      expect(count).toBeLessThan(lap / 40);
    }
    expect(ROAD_REPAIR_GLSL).toContain('vec3 apexRoadRepair(vec2 m, float lap)');
    expect(ROAD_REPAIR_GLSL).toContain(
      `${ROAD_SEALANT.halfWidth[0].toFixed(4)}, ${ROAD_SEALANT.halfWidth[1].toFixed(4)}`,
    );
    // #2a2927 in linear light.
    expect(ROAD_REPAIR_GLSL).toContain(
      'const vec3 apexSealantColour = vec3(0.0232, 0.0222, 0.0203);',
    );
  });
  it('lays braking streak pairs 20-60 m long that end at the apex', () => {
    const track = new Track('clear'),
      zones = tyreMarkZones(track).filter((z) => z.kind === 'braking');
    let pairs = 0;
    for (const zone of zones) {
      const marks = tyreMarks(track, [zone]);
      expect(marks.length).toBeGreaterThan(0);
      const length = zone.end - zone.start;
      for (const mark of marks) {
        const first = mark.s[0],
          last = mark.s[mark.s.length - 1];
        expect(last - first).toBeGreaterThanOrEqual(TYRE_MARKS.brakingLength[0] - 1e-3);
        expect(last - first).toBeLessThanOrEqual(TYRE_MARKS.brakingLength[1] + 1e-3);
        expect(last).toBeLessThanOrEqual(zone.end + 1e-3);
        expect(last).toBeGreaterThanOrEqual(zone.end - 0.12 * length - 1e-3);
        // Darkest late in the streak, faint where it starts.
        expect(mark.alpha[0]).toBeLessThan(Math.max(...mark.alpha));
      }
      // Both wheels of a pass usually mark: at least one pair per zone.
      const ends = marks.map((m) => m.s[m.s.length - 1]);
      if (new Set(ends.map((e) => e.toFixed(3))).size < ends.length) pairs++;
    }
    expect(pairs).toBeGreaterThanOrEqual(zones.length - 1);
  });
});

describe('grid launch rubber and asphalt tone', () => {
  it('derives painting coordinates from the same venue slots as the simulation', () => {
    const track = new Track('clear');
    expect(surfaceGridFor(track)).toEqual({
      front: track.pit.gridStart,
      spacing: track.pit.gridRow,
      rows: START_GRID.rows,
      lateral: track.pit.gridColumn,
    });
  });
  it('lays launch tracks from the same slots the simulation starts cars in', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 11 });
    const p = trackPoint(),
      length = sim.track.length;
    const slots = new Set<string>();
    for (const car of sim.cars) {
      const from = length - car.s;
      const row = (from - START_GRID.front) / START_GRID.spacing;
      expect(Math.abs(row - Math.round(row))).toBeLessThan(1e-6);
      expect(Math.round(row)).toBeGreaterThanOrEqual(0);
      expect(Math.round(row)).toBeLessThan(START_GRID.rows);
      expect(Math.abs(car.lateral)).toBeCloseTo(START_GRID.lateral, 6);
      slots.add(`${Math.round(row)}:${Math.sign(car.lateral)}`);
      sim.track.at(car.s, p);
      expect(
        Math.abs(car.lateral) + LAUNCH_RUBBER.halfTrack + LAUNCH_RUBBER.halfWidth * 1.7,
      ).toBeLessThan(p.width);
    }
    expect(slots.size).toBe(START_GRID.rows * 2);
  });
  it('compiles the launch tracks continuously across the start line', () => {
    stubCanvas();
    const { material, state } = roadMaterial(2972.7);
    const f = compile(material).fragmentShader;
    expect(f).toContain(
      'float apexFromLine = vRoadMetres.y > 1486.35000 ? vRoadMetres.y - 2972.70000 : vRoadMetres.y;',
    );
    expect(f).toContain(`for (int k = 0; k < ${START_GRID.rows}; k++)`);
    expect(f).toContain(`exp(-apexAlong / ${LAUNCH_RUBBER.decay.toFixed(5)})`);
    // Launch rubber shares the line's roughness and relief response.
    expect(f.indexOf('apexLineMask = max(apexLineMask')).toBeLessThan(
      f.indexOf(`roughnessFactor -= ${ROAD_DETAIL.lineRoughness.toFixed(5)} * apexLineMask`),
    );
    material.dispose();
    state.dispose();
  });
  it('lifts the racing asphalt by one calibrated tone gain in its finish', () => {
    stubCanvas();
    // Brighter than the texels, never a hue swing: B/R and G/R within 10 %.
    for (const v of ASPHALT_TONE) {
      expect(v).toBeGreaterThan(1);
      expect(v).toBeLessThan(1.9);
    }
    expect(ASPHALT_TONE[2] / ASPHALT_TONE[0]).toBeLessThan(1.1);
    expect(ASPHALT_TONE[1] / ASPHALT_TONE[0]).toBeLessThan(1.1);
    // The effective mean albedo is real race asphalt (linear 0.08-0.13), near
    // neutral (channels within 6 % of each other), below the rendered turf.
    const means = asphaltTexelMeans(surfacePixels('asphalt', 128));
    const effective = means.albedo.map((v, c) => v * ASPHALT_TONE[c]);
    for (const v of effective) {
      expect(v).toBeGreaterThan(0.08);
      expect(v).toBeLessThan(0.13);
    }
    expect(Math.max(...effective) / Math.min(...effective)).toBeLessThan(1.06);
    const asphalt = surfaceMaterial('asphalt');
    expect(compile(asphalt).fragmentShader).toContain(
      `diffuseColor.rgb *= vec3(${ASPHALT_TONE.map((v) => v.toFixed(3)).join(',')}) * (.92 + broad*.08`,
    );
    // Painted run-off keeps its own finish without the racing-surface gain.
    const runOff = surfaceMaterial('asphalt', 'paint');
    expect(compile(runOff).fragmentShader).not.toContain('* (.92 + broad*.08');
  });
});
