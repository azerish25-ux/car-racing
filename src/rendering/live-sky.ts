import * as T from 'three';
import { SUN_OFFSET, setSkySun, type LightingMode } from './sky-light.ts';
import {
  LIVE_SKY,
  liveKeyDirection,
  liveLightingMode,
  setLiveCelestial,
  skyEphemeris,
  type Observer,
} from './sky-ephemeris.ts';

const PREFERENCE_KEY = 'apex.sky.live.v1';

/**
 * LIVE circuit lighting: the sky over the player's real location at the real
 * clock. Each `update` re-reads the ephemeris for the moon, stars and twilight
 * (cheap, every few seconds); the scene sun only re-aims, re-baking the
 * atmosphere, clouds, environment and far shadow, when the real sun has moved
 * LIVE_SKY.stepDegrees or crossed into another lighting.
 */
export class LiveSky {
  private observerValue: Observer | null = null;
  private aimed: T.Vector3 | null = null;
  private lighting: LightingMode | null = null;
  get observer() {
    return this.observerValue;
  }
  get active() {
    return this.observerValue !== null;
  }
  /** Follow `observer`; returns the lighting the real sun calls for. */
  start(observer: Observer, date = new Date()) {
    this.observerValue = observer;
    this.aimed = null;
    this.lighting = null;
    return this.update(date)!;
  }
  /** Back to the presets' fixed sky. */
  stop() {
    this.observerValue = null;
    this.aimed = null;
    this.lighting = null;
    setLiveCelestial(null);
    setSkySun(null);
  }
  /** The lighting for `date` (null when not live). */
  update(date = new Date()): LightingMode | null {
    if (!this.observerValue) return null;
    const sky = skyEphemeris(date, this.observerValue);
    setLiveCelestial(sky);
    const lighting = liveLightingMode(sky.sunAltitude),
      key = liveKeyDirection(sky.sun, SUN_OFFSET.length());
    const moved = this.aimed
      ? T.MathUtils.radToDeg(this.aimed.angleTo(key)) >= LIVE_SKY.stepDegrees
      : true;
    if (moved || lighting !== this.lighting) {
      setSkySun(key);
      this.aimed = key;
      this.lighting = lighting;
    }
    return this.lighting;
  }
}

/** Whether the player last chose LIVE lighting (per browser). */
export function liveSkyPreferred() {
  try {
    return globalThis.localStorage?.getItem(PREFERENCE_KEY) === '1';
  } catch {
    return false;
  }
}
export function setLiveSkyPreferred(value: boolean) {
  try {
    if (value) globalThis.localStorage?.setItem(PREFERENCE_KEY, '1');
    else globalThis.localStorage?.removeItem(PREFERENCE_KEY);
  } catch {
    // A preference that cannot be stored still applies to this session.
  }
}
