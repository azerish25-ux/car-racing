import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { PhotoSky } from '../src/rendering/assets/photo-sky.ts';
import { FESTIVAL_PALETTE } from '../src/rendering/assets/sky-catalogue.ts';
import { GRADE_PROFILES } from '../src/rendering/broadcast-grade.ts';
import { configureSky, lightingDirection, SUNSET_OFFSET } from '../src/rendering/daylight.ts';
import {
  FESTIVAL_AIR,
  FestivalAtmosphere,
  festivalExtinction,
  festivalGrade,
} from '../src/rendering/open-world/festival-atmosphere.ts';
import {
  DUSK_KEY,
  DUSK_SUN,
  FESTIVAL_DUSK,
  bindDuskSky,
  duskLightColours,
  duskShadowAnchor,
  festivalDuskLight,
  installDuskSky,
} from '../src/rendering/open-world/festival-dusk.ts';
import { FestivalRenderer } from '../src/rendering/open-world/festival-renderer.ts';
import { FestivalSky } from '../src/rendering/open-world/festival-sky.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';
import { festivalMenuState } from '../src/session/festival-controls.ts';
import {
  FESTIVAL_LIGHTINGS,
  FESTIVAL_LIGHTING_LABEL,
  festivalBaseLighting,
  festivalNightAmount,
  isFestivalLighting,
} from '../src/session/festival-lighting.ts';
import { validateFestivalSave } from '../src/session/festival-save.ts';

const Y = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const elevation = (v: T.Vector3) => (Math.asin(v.y / v.length()) * 180) / Math.PI;
const azimuth = (v: { x: number; z: number }) => Math.atan2(v.z, v.x);

describe('festival time of day', () => {
  it('adds a festival-only blue hour on the shared night machinery', () => {
    expect(FESTIVAL_LIGHTINGS).toEqual(['day', 'sunset', 'dusk', 'night']);
    expect(FESTIVAL_LIGHTING_LABEL.dusk).toMatch(/dusk/i);
    expect(festivalBaseLighting('dusk')).toBe('night');
    for (const mode of ['day', 'sunset', 'night'] as const)
      expect(festivalBaseLighting(mode)).toBe(mode);
    // Circuits never see it: the shared lighting parser still refuses it.
    expect(() => lightingDirection('dusk' as never)).toThrow();
    expect(isFestivalLighting('dusk')).toBe(true);
    expect(isFestivalLighting('noon')).toBe(false);
    expect(isFestivalLighting(undefined)).toBe(false);
  });

  it('turns the lamps, windows and headlights on at dusk, a little below night', () => {
    const night = (lighting: string) =>
      Object.getOwnPropertyDescriptor(FestivalRenderer.prototype, 'night')!.get!.call({
        lighting,
      }) as number;
    expect(night('day')).toBe(0);
    expect(night('sunset')).toBe(0.25);
    expect(night('dusk')).toBe(festivalNightAmount('dusk'));
    expect(night('dusk')).toBeGreaterThanOrEqual(0.75);
    expect(night('dusk')).toBeLessThan(night('night'));
  });

  it('keeps old saves valid and remembers a time of day chosen in the menu', () => {
    const old = { version: 1, discovered: ['a'], best: {}, vehicle: 'tc1' };
    const loaded = validateFestivalSave(old)!;
    expect(loaded).not.toBeNull();
    expect('lighting' in loaded).toBe(false);
    expect(validateFestivalSave({ ...old, lighting: 'dusk' })!.lighting).toBe('dusk');
    expect('lighting' in validateFestivalSave({ ...old, lighting: 'twilight' })!).toBe(false);
    const menu = festivalMenuState(null, { ...loaded, lighting: 'dusk' }, 'dusk');
    expect(menu.lighting).toBe('dusk');
  });
});

describe('festival blue-hour dome', () => {
  const configured = () => {
    const sky = new Sky();
    configureSky(sky);
    return sky.material;
  };

  it('patches only the festival sky, off by default and idempotent', () => {
    const circuit = configured(),
      festival = configured();
    const before = festival.fragmentShader;
    const u = installDuskSky(festival);
    expect(installDuskSky(festival)).toBe(u);
    expect(u.duskAmount.value).toBe(0);
    expect(festival.fragmentShader).toContain('festivalDuskSky(direction)');
    expect(festival.fragmentShader.length).toBeGreaterThan(before.length);
    // The procedural and photographed skies are skipped under a full dusk.
    expect(festival.fragmentShader).toContain('duskAmount < 1.0 && photoAmount < 1.0');
    expect(festival.fragmentShader).toContain('if (photoAmount > 0.0 && duskAmount < 1.0) {');
    // ... and the PMREM ground blend still applies after it.
    expect(festival.fragmentShader.indexOf('festivalDuskSky(direction), duskAmount')).toBeLessThan(
      festival.fragmentShader.indexOf('Ground hemisphere for the PMREM only'),
    );
    expect(circuit.uniforms.duskAmount).toBeUndefined();
    expect(circuit.fragmentShader).not.toContain('festivalDuskSky');
    expect(bindDuskSky(circuit, 1)).toBe(false);
    expect(() =>
      installDuskSky(new T.ShaderMaterial({ fragmentShader: 'void main() {}' })),
    ).toThrow();
  });

  it('draws the dusk dome in the visible sky and every capture, and recaptures on the switch', () => {
    const material = configured();
    installDuskSky(material);
    const u = material.uniforms;
    let photoBinds = 0;
    const photo = {
      palette: FESTIVAL_PALETTE,
      key: 'coast:2k:1',
      shownPair: null,
      bind: (m: T.ShaderMaterial) => {
        photoBinds++;
        m.uniforms.photoAmount.value = 1;
        return true;
      },
      fogPalette: () => null,
    } as unknown as PhotoSky;
    const sky = new FestivalSky(photo);
    sky.dusk = true;
    for (const capture of [false, true]) {
      u.photoAmount.value = 1;
      expect(sky.bind(material, 0.12, 'night', capture)).toBe(false);
      expect(u.duskAmount.value).toBe(1);
      expect(u.photoAmount.value).toBe(0);
    }
    expect(photoBinds).toBe(0);
    // Another key than the night photograph's: switching recaptures the PMREM.
    expect(sky.key).not.toBe(photo.key);
    sky.dusk = false;
    expect(sky.key).toBe(photo.key);
    expect(sky.bind(material, 0.12, 'night', false)).toBe(true);
    expect(u.duskAmount.value).toBe(0);
    expect(photoBinds).toBe(1);
  });

  it('is the measured blue hour: violet zenith, lilac-pink low sky, warm afterglow', () => {
    const s = FESTIVAL_DUSK.sky;
    // Deep blue-violet zenith (043/083): blue well over red, darker than the low sky.
    expect(s.zenith[2] / s.zenith[0]).toBeGreaterThan(3);
    expect(Y(s.zenith)).toBeLessThan(Y(s.high));
    expect(Y(s.high)).toBeLessThan(Y(s.horizon));
    // Lilac-pink away from the set sun (083 #c396d7, 061 #dab8d8): red over green.
    expect(s.horizon[0]).toBeGreaterThan(s.horizon[1]);
    expect(s.horizon[2]).toBeGreaterThan(s.horizon[0]);
    // Toward the set sun warmer and brighter (081, 075), an orange band on it.
    expect(s.sunSide[0] / s.sunSide[2]).toBeGreaterThan(s.horizon[0] / s.horizon[2]);
    expect(Y(s.sunSide)).toBeGreaterThan(Y(s.horizon));
    expect(s.glow[0]).toBeGreaterThan(s.glow[1]);
    expect(s.glow[1]).toBeGreaterThan(s.glow[2]);
    expect(s.cloudLit[0] / s.cloudLit[2]).toBeGreaterThan(1.5);
    expect(s.cloud[2]).toBeGreaterThan(s.cloud[0]);
  });
});

describe('festival blue-hour light', () => {
  it('has no sun: it set a few degrees below the golden-hour azimuth', () => {
    expect(elevation(DUSK_SUN)).toBeCloseTo(-FESTIVAL_DUSK.sunDepression, 6);
    expect(DUSK_SUN.y).toBeLessThan(0);
    expect(azimuth(DUSK_SUN)).toBeCloseTo(azimuth(SUNSET_OFFSET), 6);
    // The key stands in for the bright western sky above it.
    expect(azimuth(DUSK_KEY)).toBeCloseTo(azimuth(SUNSET_OFFSET), 6);
    expect(elevation(DUSK_KEY)).toBeCloseTo(FESTIVAL_DUSK.keyElevation, 6);
  });

  it('lights the scene with the dome, a dim lilac key and a low fill', () => {
    const light = festivalDuskLight({
      sun: 3.9,
      fill: 1,
      environment: 0.2,
      exposure: 1.12,
      cover: 0.12,
    });
    expect(light.environment).toBe(FESTIVAL_DUSK.light.environment);
    expect(light.sun).toBeLessThan(0.4);
    expect(light.sun).toBeGreaterThan(0);
    expect(light.fill).toBeLessThan(0.2);
    // A deck dims the western sky's key and opens the camera a little.
    const overcast = festivalDuskLight({
      sun: 3.9,
      fill: 1,
      environment: 0.2,
      exposure: 1,
      cover: 1,
    });
    expect(overcast.sun).toBeLessThan(light.sun * 0.5);
    expect(overcast.exposure).toBeGreaterThan(light.exposure);
    const sun = new T.Color(),
      sky = new T.Color(),
      ground = new T.Color();
    duskLightColours(0.12, sun, sky, ground);
    // Lilac-pink key (red over green, blue over green), violet-blue sky fill.
    expect(sun.r).toBeGreaterThan(sun.g);
    expect(sun.b).toBeGreaterThan(sun.g);
    expect(sky.b).toBeGreaterThan(sky.r);
    expect(Y([ground.r, ground.g, ground.b])).toBeLessThan(0.1);
  });

  it('snaps the dusk key shadow in its own light space', () => {
    const size = 2048,
      half = 70,
      texel = (2 * half) / size;
    const right = new T.Vector3(0, 1, 0).cross(DUSK_KEY).normalize(),
      up = DUSK_KEY.clone().cross(right).normalize();
    // On a texel corner of the key's light space.
    const target = new T.Vector3()
      .addScaledVector(right, 140 * texel)
      .addScaledVector(up, -35 * texel)
      .addScaledVector(DUSK_KEY, 12);
    const a = duskShadowAnchor(target, size, half, new T.Vector3());
    expect(a.distanceTo(target)).toBeLessThan(1e-6);
    // A move smaller than half a texel across the light leaves the anchor.
    for (const [axis, k] of [
      [right, 0.3],
      [up, -0.3],
    ] as const) {
      const b = duskShadowAnchor(
        target.clone().addScaledVector(axis, texel * k),
        size,
        half,
        new T.Vector3(),
      );
      expect(b.distanceTo(a)).toBeLessThan(1e-6);
    }
    // Along the light it follows the target exactly.
    const c = duskShadowAnchor(
      target.clone().addScaledVector(DUSK_KEY, 3),
      size,
      half,
      new T.Vector3(),
    );
    expect(c.distanceTo(a.clone().addScaledVector(DUSK_KEY, 3))).toBeLessThan(1e-6);
    expect(() => duskShadowAnchor(new T.Vector3(NaN, 0, 0), size, half, new T.Vector3())).toThrow();
  });

  it('fills the air with blue-violet haze toward a warm afterglow', () => {
    const atmosphere = new FestivalAtmosphere();
    atmosphere.update('dusk', 0.12, 0);
    const c = atmosphere.inscatter.clone();
    expect(c.b).toBeGreaterThan(c.r * 2);
    expect(studioUniforms.studioSunDir.value.distanceTo(DUSK_KEY)).toBeLessThan(1e-6);
    // Evening air: hazier than the clear night, clearer than the golden hour.
    const mie = (mode: 'dusk' | 'night' | 'sunset') => festivalExtinction(mode, 0.12, 0).mie[1];
    expect(mie('dusk')).toBeGreaterThan(mie('night'));
    expect(mie('dusk')).toBeLessThan(mie('sunset'));
    expect(FESTIVAL_AIR.haze.dusk).toBe(FESTIVAL_DUSK.air.haze);
    // The deck greys it.
    atmosphere.update('dusk', 1, 0);
    expect(atmosphere.inscatter.b / atmosphere.inscatter.r).toBeLessThan(c.b / c.r);
    atmosphere.update('day', 0.12, 0);
  });

  it('grades dusk over the night profile, warmer highlights, violet shadows', () => {
    const night = festivalGrade('night', GRADE_PROFILES.night),
      dusk = festivalGrade('dusk', GRADE_PROFILES.night);
    expect(dusk).not.toBe(night);
    expect(dusk.saturation).toBeGreaterThan(night.saturation);
    expect(dusk.highlightTint[0]).toBeGreaterThan(dusk.highlightTint[2]);
    expect(dusk.shadowTint[2]).toBeGreaterThan(dusk.shadowTint[1]);
    expect(festivalGrade('dusk', GRADE_PROFILES.night)).toBe(dusk);
  });
});
