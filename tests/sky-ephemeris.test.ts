import { afterEach, describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  BRIGHT_STARS,
  LIVE_SKY,
  liveKeyDirection,
  liveLightingMode,
  skyEphemeris,
  starVector,
  timezoneObserver,
} from '../src/rendering/sky-ephemeris.ts';
import { LiveSky } from '../src/rendering/live-sky.ts';
import { SUN_OFFSET, skyLightDirection, skySunKey } from '../src/rendering/sky-light.ts';
import { cloudLightKey } from '../src/rendering/studio/sky-clouds.ts';
import { configureSky, lightingDirection } from '../src/rendering/daylight.ts';
import { Sky } from 'three/addons/objects/Sky.js';

const greenwich = { latitude: 51.48, longitude: 0 };
const deg = T.MathUtils.radToDeg;

describe('live sky ephemeris', () => {
  it('puts the June solstice noon sun due south at 90 - latitude + 23.4 degrees', () => {
    const sky = skyEphemeris(new Date('2024-06-20T12:02:00Z'), greenwich);
    expect(sky.sunAltitude).toBeGreaterThan(61.5);
    expect(sky.sunAltitude).toBeLessThan(62.3);
    // World frame: +X east, -Z north, so due south is +Z.
    expect(sky.sun.z).toBeGreaterThan(0);
    expect(Math.abs(sky.sun.x)).toBeLessThan(0.02);
  });
  it('raises the equinox sun in the east and sets it in the west', () => {
    const equator = { latitude: 0, longitude: 0 };
    const morning = skyEphemeris(new Date('2024-03-20T06:30:00Z'), equator);
    const evening = skyEphemeris(new Date('2024-03-20T17:30:00Z'), equator);
    expect(morning.sunAltitude).toBeGreaterThan(0);
    expect(morning.sunAltitude).toBeLessThan(12);
    expect(morning.sun.x).toBeGreaterThan(0.95);
    expect(evening.sun.x).toBeLessThan(-0.95);
    expect(skyEphemeris(new Date('2024-03-20T00:00:00Z'), equator).sunAltitude).toBeLessThan(-80);
  });
  it('follows the phases of the moon', () => {
    const full = skyEphemeris(new Date('2024-06-22T01:08:00Z'), greenwich);
    const quarter = skyEphemeris(new Date('2024-06-14T05:18:00Z'), greenwich);
    const fresh = skyEphemeris(new Date('2024-07-05T22:57:00Z'), greenwich);
    expect(full.moonIllumination).toBeGreaterThan(0.98);
    expect(Math.abs(quarter.moonIllumination - 0.5)).toBeLessThan(0.05);
    expect(fresh.moonIllumination).toBeLessThan(0.02);
    // A full moon stands opposite the sun.
    expect(full.moon.dot(full.sun)).toBeLessThan(-0.97);
  });
  it('holds Polaris at the observer latitude and rotates the stars with the sidereal clock', () => {
    const polaris = BRIGHT_STARS.find(([, dec]) => dec > 89)!;
    for (const latitude of [51.48, 35, 10]) {
      const sky = skyEphemeris(new Date('2025-01-10T21:00:00Z'), { latitude, longitude: 0 });
      const world = starVector(polaris[0], polaris[1]).applyMatrix3(
        sky.worldToCelestial.clone().transpose(),
      );
      // Polaris circles 0.74 degrees from the pole.
      expect(Math.abs(deg(Math.asin(world.y)) - latitude)).toBeLessThan(0.8);
      // North is -Z.
      expect(world.z).toBeLessThan(0);
    }
    const sirius = starVector(BRIGHT_STARS[0][0], BRIGHT_STARS[0][1]);
    const at = (iso: string) =>
      sirius
        .clone()
        .applyMatrix3(skyEphemeris(new Date(iso), greenwich).worldToCelestial.clone().transpose());
    // Sirius culminates low in the south around midnight in early January.
    const winter = at('2025-01-01T00:00:00Z');
    expect(deg(Math.asin(winter.y))).toBeGreaterThan(18);
    expect(deg(Math.asin(winter.y))).toBeLessThan(23);
    expect(at('2025-01-01T12:00:00Z').y).toBeLessThan(0);
  });
  it('chooses the lighting from the real sun and keeps the key above the ground', () => {
    expect(liveLightingMode(40)).toBe('day');
    expect(liveLightingMode(LIVE_SKY.dayAltitude - 0.1)).toBe('sunset');
    expect(liveLightingMode(-0.5)).toBe('sunset');
    expect(liveLightingMode(-3)).toBe('night');
    const key = liveKeyDirection(new T.Vector3(1, -0.01, 0), 300);
    expect(key.length()).toBeCloseTo(300, 6);
    expect(deg(Math.asin(key.y / 300))).toBeCloseTo(LIVE_SKY.minimumKeyAltitude, 6);
  });
  it('estimates a position from the time zone alone', () => {
    expect(timezoneObserver(-60, 'Europe/Berlin')).toMatchObject({
      latitude: 40,
      longitude: 15,
      source: 'timezone',
    });
    expect(timezoneObserver(-600, 'Australia/Sydney').latitude).toBeLessThan(0);
    expect(timezoneObserver(300, 'America/New_York').longitude).toBe(-75);
  });
});

describe('LIVE lighting controller', () => {
  const live = new LiveSky();
  afterEach(() => live.stop());
  it('aims the day and golden-hour key at the real sun and restores the presets', () => {
    expect(skySunKey()).toBe('');
    const lighting = live.start(
      { ...greenwich, source: 'device' },
      new Date('2024-06-20T12:00:00Z'),
    );
    expect(lighting).toBe('day');
    const key = skySunKey();
    expect(key).not.toBe('');
    expect(cloudLightKey('day')).toBe(`day${key}`);
    expect(cloudLightKey('night')).toBe('day');
    const sun = lightingDirection('day');
    expect(sun.length()).toBeCloseTo(SUN_OFFSET.length(), 6);
    expect(sun.z).toBeGreaterThan(0);
    // Night keeps the floodlights' fixed key.
    expect(skyLightDirection('night')).toBe(SUN_OFFSET);
    // A minute later the sun has moved less than a step: nothing re-bakes.
    live.update(new Date('2024-06-20T12:01:00Z'));
    expect(skySunKey()).toBe(key);
    // Half an hour later it has.
    live.update(new Date('2024-06-20T12:30:00Z'));
    expect(skySunKey()).not.toBe(key);
    expect(live.update(new Date('2024-06-20T23:00:00Z'))).toBe('night');
    live.stop();
    expect(skySunKey()).toBe('');
    expect(lightingDirection('day')).toBe(SUN_OFFSET);
  });
  it('binds the moon, stars and twilight to the sky dome', () => {
    const sky = new Sky();
    configureSky(sky);
    const u = sky.material.uniforms;
    expect(u.brightStars.value).toHaveLength(BRIGHT_STARS.length);
    expect(sky.material.fragmentShader).toContain('starField(');
    expect(sky.material.fragmentShader).toContain('moonLight(');
    expect(u.moonAmount.value).toBe(0);
    sky.material.dispose();
  });
});
