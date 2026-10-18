import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { openWorld } from '../src/simulation/open-world/world.ts';
import {
  DistantRelief,
  DISTANT_RELIEF,
  smoothMax,
} from '../src/rendering/open-world/distant-relief.ts';
import { DistantLandscape, DISTANT_SNOW } from '../src/rendering/open-world/distant-landscape.ts';
import {
  FestivalAtmosphere,
  festivalAirUniforms,
  festivalGrade,
  festivalSkyline,
  festivalTransmittance,
} from '../src/rendering/open-world/festival-atmosphere.ts';
import { createPhotoSkyUniforms } from '../src/rendering/assets/photo-sky-shader.ts';
import { terrainMaterial } from '../src/rendering/open-world/terrain-material.ts';
import { seasonUniforms } from '../src/rendering/open-world/season.ts';
import { BroadcastGradePass, GRADE_PROFILES } from '../src/rendering/broadcast-grade.ts';

const world = openWorld();
const field = world.field;
const relief = new DistantRelief((x, z, m) => field.height(x, z, m), field.region.seed);
const V = DISTANT_RELIEF.volcano;
const S = DISTANT_RELIEF.inner;

/** Ground under a point anywhere: the region's field inside the streamed
 * square, the distant relief outside it. */
function ground(x: number, z: number) {
  return Math.abs(x) <= S && Math.abs(z) <= S ? field.height(x, z) : relief.height(x, z);
}
/** Lowest height (m) of the cone's sunward silhouette visible from `eye`:
 * the summit is visible down to this height along the sightline. */
function visibleFrom(eye: [number, number, number]) {
  const [ex, ey, ez] = eye;
  const dx = V.x - ex,
    dz = V.z - ez,
    d = Math.hypot(dx, dz);
  // Steepest elevation of the ground between the eye and the cone's foot.
  let horizon = -Infinity;
  for (let t = 0.002; t < 0.7; t += 0.0005) {
    const x = ex + dx * t,
      z = ez + dz * t;
    horizon = Math.max(horizon, (ground(x, z) - ey) / (d * t));
  }
  // The cone's height at its axis that the sightline over that horizon reaches.
  return ey + horizon * d;
}

describe('festival distant relief', () => {
  it('continues the streamed terrain at its edge and rises beyond it', () => {
    // On the coarsest tile's vertices (the terrain mesh interpolates between).
    for (let s = 0; s < 8 * S; s += DISTANT_RELIEF.edgeStep * 3) {
      const [x, z] = DistantRelief.perimeterPoint(s);
      const edge = field.height(x, z, DISTANT_RELIEF.edgeWavelength);
      // The seam lies just under the terrain's own edge.
      expect(relief.height(x, z)).toBeCloseTo(edge - DISTANT_RELIEF.seamDrop, 0);
      expect(DistantRelief.perimeterArc(x, z)).toBeCloseTo(s, 3);
    }
    // Ranges behind the north edge: forested hills to high crests.
    const north: number[] = [];
    for (let x = -20000; x <= 20000; x += 250) north.push(relief.height(x, 26000));
    expect(Math.max(...north)).toBeGreaterThan(1300);
    expect(Math.min(...north)).toBeGreaterThan(100);
    // The open sea south of the region stays sea floor.
    expect(relief.height(0, -20000)).toBeLessThan(-30);
  });

  it('shapes a 3.7 km concave cone with a summit crater and radial gullies', () => {
    expect(relief.volcano(V.x, V.z + 300)).toBeGreaterThan(3650);
    expect(relief.volcano(V.x, V.z)).toBeLessThan(3600);
    // Slope (degrees) between two radii along a ridge between gullies:
    // average over bearings, so the gullies do not bias it.
    const slope = (r0: number, r1: number) => {
      let sum = 0;
      for (let k = 0; k < 64; k++) {
        const a = (k / 64) * Math.PI * 2,
          h0 = relief.volcano(V.x + Math.sin(a) * r0, V.z + Math.cos(a) * r0),
          h1 = relief.volcano(V.x + Math.sin(a) * r1, V.z + Math.cos(a) * r1);
        sum += (Math.atan((h0 - h1) / (r1 - r0)) * 180) / Math.PI;
      }
      return sum / 64;
    };
    const upper = slope(600, 1600),
      middle = slope(2500, 4000),
      lower = slope(7000, 9500),
      apron = slope(11000, 16000);
    expect(upper).toBeGreaterThan(22);
    expect(upper).toBeLessThan(31);
    expect(middle).toBeGreaterThan(17);
    expect(middle).toBeLessThan(upper);
    expect(lower).toBeLessThan(middle);
    expect(apron).toBeLessThan(lower);
    expect(apron).toBeGreaterThan(1.5);
    // Gullies: around the 3 km contour, notches tens of metres deep below the
    // ridges either side (local minima under a +-4 degree running mean).
    const n = 720,
      ring: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      ring.push(relief.volcano(V.x + Math.sin(a) * 3000, V.z + Math.cos(a) * 3000));
    }
    let notches = 0;
    for (let k = 0; k < n; k++) {
      let mean = 0;
      for (let j = -8; j <= 8; j++) mean += ring[(k + j + n) % n] / 17;
      const h = ring[k];
      if (h < ring[(k + 1) % n] && h <= ring[(k - 1 + n) % n] && mean - h > 15) notches++;
    }
    expect(notches).toBeGreaterThan(25);
    expect(notches).toBeLessThan(80);
  });

  it('frames the cone above the region from the spawn street and the Varda pass', () => {
    // Chase camera at the spawn on Harbour Front (heading east).
    const spawn: [number, number, number] = [554, 6.8, -2603.7];
    const summit = V.profile[2][1];
    // At least the top 1.3 km of the cone stand clear of every ridge.
    expect(visibleFrom(spawn)).toBeLessThan(summit - 1300);
    // Bearing from the spawn: within 4 degrees of the street's axis (east).
    const bearing = (Math.atan2(V.x - spawn[0], V.z - spawn[2]) * 180) / Math.PI;
    expect(Math.abs(bearing - 90)).toBeLessThan(4);
    // From the pass road over Mount Varda the cone shows down to its apron.
    expect(visibleFrom([-2729, 512, 2932])).toBeLessThan(summit - 2000);
  });

  it('smooth maximum is continuous and bounded', () => {
    expect(smoothMax(10, 0, 4)).toBe(10);
    expect(smoothMax(0, 10, 4)).toBe(10);
    expect(smoothMax(5, 5, 4)).toBeCloseTo(6, 6);
  });
});

describe('festival distant landscape meshes', () => {
  it('builds two draws within the tier budgets, with finite positions', () => {
    const landscape = new DistantLandscape((x, z, m) => field.height(x, z, m), field.region.seed);
    landscape.setQuality('low');
    const low = landscape.stats.triangles;
    landscape.setQuality('medium');
    const medium = landscape.stats.triangles;
    expect(landscape.root.children).toHaveLength(2);
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(75000);
    for (const mesh of landscape.root.children as T.Mesh[]) {
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) expect(Number.isFinite(position.getY(i))).toBe(true);
      expect(mesh.castShadow).toBe(false);
      expect((mesh.material as T.MeshStandardMaterial).fog).toBe(false);
    }
    landscape.update('day', 3);
    expect(landscape.uniforms.dlSnowLine.value.x).toBe(DISTANT_SNOW.cone[3]);
    landscape.dispose();
  });
});

describe('festival terrain snow', () => {
  it('lays the biome snow only above the season snow line of the ranges', () => {
    const material = terrainMaterial();
    const shader = {
      uniforms: {} as Record<string, T.IUniform>,
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    };
    material.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.owSeason).toBe(seasonUniforms.owSeason);
    expect(shader.fragmentShader).toContain(
      `dot(owSeason, vec4(${DISTANT_SNOW.ranges.map((v) => v.toFixed(1)).join(', ')}))`,
    );
    // Summer keeps the 600-800 m horizon hills free of snow; winter whitens them.
    expect(DISTANT_SNOW.ranges[1]).toBeGreaterThan(1000);
    expect(DISTANT_SNOW.ranges[3]).toBeLessThan(600);
    material.dispose();
  });
});

describe('festival air', () => {
  it('keeps a distant cone readable through clean air, bluer than it reddens', () => {
    // Ref 021/036: flank at 26-37 km keeps ~75-90 % of red and ~40-50 % of blue.
    const [r, g, b] = festivalTransmittance('day', 0.12, 0, 7, 1500, 26000);
    expect(r).toBeGreaterThan(0.7);
    expect(b).toBeLessThan(0.62);
    expect(b).toBeGreaterThan(0.3);
    expect(g).toBeLessThan(r);
    // Ridges 8 km out along the ground: a light veil, not FogExp2's 82 %.
    const [, g8] = festivalTransmittance('day', 0.12, 0, 7, 300, 8000);
    expect(1 - g8).toBeGreaterThan(0.08);
    expect(1 - g8).toBeLessThan(0.3);
    // Golden hour carries more aerosol than noon; rain more again.
    expect(festivalTransmittance('sunset', 0.12, 0, 7, 300, 8000)[1]).toBeLessThan(g8);
    expect(festivalTransmittance('day', 0.12, 24, 7, 300, 8000)[1]).toBeLessThan(g8);
  });

  it('replaces the fog term of eligible materials once', () => {
    const air = new FestivalAtmosphere();
    const standard = new T.MeshStandardMaterial();
    const shader = {
      uniforms: {} as Record<string, T.IUniform>,
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    };
    expect(air.installMaterial(standard)).toBe(true);
    expect(air.installMaterial(standard)).toBe(false);
    standard.onBeforeCompile(shader as never, null as never);
    expect(shader.fragmentShader).toContain('fhAerial(gl_FragColor.rgb, vFhAirRay)');
    expect(shader.fragmentShader).not.toContain('#include <fog_fragment>');
    expect(shader.vertexShader).toContain(
      'vFhAirRay = transpose(mat3(viewMatrix)) * mvPosition.xyz',
    );
    expect(shader.uniforms.fhApRayleigh).toBe(festivalAirUniforms.fhApRayleigh);
    expect(standard.customProgramCacheKey()).toContain('festival-air-v1');
    // Shader materials without fog and own-air materials are left alone.
    expect(air.installMaterial(new T.ShaderMaterial())).toBe(false);
    const own = new T.MeshStandardMaterial();
    own.userData.festivalAir = false;
    expect(air.installMaterial(own)).toBe(false);
    // Scene installs skip excluded subtrees (vehicles, effects, overlays).
    const scene = new T.Scene(),
      car = new T.Group(),
      ground = new T.MeshStandardMaterial(),
      paint = new T.MeshStandardMaterial();
    car.add(new T.Mesh(new T.BoxGeometry(), paint));
    scene.add(new T.Mesh(new T.BoxGeometry(), ground), car);
    air.install(scene, [car]);
    expect(ground.customProgramCacheKey()).toContain('festival-air-v1');
    expect(paint.customProgramCacheKey()).not.toContain('festival-air-v1');
    // Golden hour veils far ground in a warm haze, not the day's blue.
    air.update('sunset', 0.12, 0);
    expect(air.inscatter.r).toBeGreaterThan(air.inscatter.b);
  });

  it('writes clean-air state and a blue horizon for the clear day', () => {
    const air = new FestivalAtmosphere();
    air.update('day', 0.12, 0);
    const c = air.inscatter;
    expect(c.b).toBeGreaterThan(c.r);
    const rayleigh = festivalAirUniforms.fhApRayleigh.value,
      mie = festivalAirUniforms.fhApMie.value;
    expect(rayleigh.z / rayleigh.x).toBeGreaterThan(5);
    expect(mie.y).toBeLessThan(rayleigh.y);
    expect(air.fogDensity).toBeGreaterThan(2e-5);
    expect(air.fogDensity).toBeLessThan(1e-4);
  });

  it('raises a photographed skyline only for listed photos; circuits keep theirs', () => {
    const uniforms = createPhotoSkyUniforms();
    expect(uniforms.photoHorizon.value.w).toBe(0);
    // As bound: both photos' own skyline at the horizon.
    uniforms.photoA.value.set(0, 0, 1, 0);
    uniforms.photoB.value.set(0, 0, 1, 0);
    const material = new T.ShaderMaterial({ uniforms: uniforms as never });
    festivalSkyline(
      material,
      { a: 'kiara-5-noon', b: 'table-mountain-1' },
      new T.Color(0.3, 0.4, 0.6),
      1,
    );
    expect((uniforms.photoA.value.w * 180) / Math.PI).toBeCloseTo(9.8, 3);
    expect(uniforms.photoB.value.w).toBe(0);
    expect(uniforms.photoHorizon.value.w).toBe(1);
  });

  it('grades the festival relative to the shared profiles; circuits keep theirs', () => {
    expect(new BroadcastGradePass().profileAdjust).toBeNull();
    const day = festivalGrade('day', GRADE_PROFILES.day);
    expect(day.saturation).toBeGreaterThan(GRADE_PROFILES.day.saturation);
    expect(day.vibrance).toBeGreaterThan(GRADE_PROFILES.day.vibrance);
    expect(festivalGrade('day', GRADE_PROFILES.day)).toBe(day);
    const sunset = festivalGrade('sunset', GRADE_PROFILES.sunset);
    expect(sunset.highlightTint[2]).toBeLessThan(GRADE_PROFILES.sunset.highlightTint[2]);
    expect(festivalGrade('night', GRADE_PROFILES.night)).toEqual(GRADE_PROFILES.night);
  });
});
