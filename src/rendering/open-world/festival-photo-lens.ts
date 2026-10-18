import * as T from 'three';
import { FILMIC_GRADE_PROFILES, GRADE_PROFILES, type GradeProfile } from '../broadcast-grade.ts';
import type { LightingMode } from '../daylight.ts';
import {
  PHOTO_FILTERS,
  photoFov,
  photoGrade,
  validatePhoto,
  type PhotoFilter,
} from '../photo-camera.ts';
import { DepthOfFieldPass } from '../studio/dof-pass.ts';
import { focalLength, thinLensScale } from '../ultra/replay-lens.ts';

/**
 * Festival photo mode lens: a thin lens on a full-frame gate (24 mm high)
 * focused on the car or at a set distance, gathered from the scene pass's
 * depth (no re-render, one quad, 48 taps on a Vogel disc, foreground taps
 * always spread so near grass blurs over a sharp car: FH6 ref 021), plus
 * the photo look: zoom, exposure, filter and vignette.
 *
 * c(d) = f^2 / (N (s - f) h) (1 - s / d) of the screen height, capped at
 * `maxBlur`. Ref 021 (a 1080p photo-mode frame): foreground grass ~10-15 px
 * of blur radius with the car sharp and the cone only slightly soft, i.e.
 * a ~60-85 mm lens near f/2 focused at ~6 m (c = -1 to -1.4 %).
 *
 * Depth of field is off (f-number 0) until the player picks an aperture, so
 * a photo-mode frame without lens changes is the gameplay image (inspection
 * captures use that mode).
 */
export const FESTIVAL_PHOTO = Object.freeze({
  /** Full-frame gate height, metres. */
  sensorHeight: 0.024,
  /** Selectable f-numbers (0: depth of field off). */
  fStops: Object.freeze([0, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16]),
  /** Largest circle of confusion, fraction of the screen height. */
  maxBlur: 0.022,
  taps: 48,
  /** Nearest focus, metres. */
  minFocus: 0.8,
  /** Focal lengths (mm) the zoom offers; null keeps the photo camera's own 45 deg. */
  focalLengths: Object.freeze([18, 24, 35, 50, 85, 135]),
});

export interface FestivalPhotoSettings {
  /** f-number, 0 = depth of field off. */
  fStop: number;
  /** Manual focus distance (m), or null to focus on the car. */
  focus: number | null;
  /** Lens focal length (mm, full frame), or null for the default view. */
  focalLength: number | null;
  /** Exposure compensation, EV. */
  exposure: number;
  filter: PhotoFilter;
  vignette: number;
}
export const DEFAULT_FESTIVAL_PHOTO: Readonly<FestivalPhotoSettings> = Object.freeze({
  fStop: 0,
  focus: null,
  focalLength: null,
  exposure: 0,
  filter: 'neutral',
  vignette: 0.12,
});

/** Settings within their ranges (unknown values fall back to the defaults). */
export function validateFestivalPhoto(value: unknown): FestivalPhotoSettings {
  const p = (value && typeof value === 'object' ? value : {}) as Partial<FestivalPhotoSettings>;
  const finite = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    fStop: FESTIVAL_PHOTO.fStops.includes(p.fStop as number) ? (p.fStop as number) : 0,
    focus:
      typeof p.focus === 'number' && Number.isFinite(p.focus) ? finite(p.focus, 0.8, 500, 6) : null,
    focalLength:
      typeof p.focalLength === 'number' && Number.isFinite(p.focalLength)
        ? finite(p.focalLength, 14, 200, 50)
        : null,
    exposure: finite(p.exposure, -2, 2, 0),
    filter: PHOTO_FILTERS.includes(p.filter as PhotoFilter) ? (p.filter as PhotoFilter) : 'neutral',
    vignette: finite(p.vignette, 0, 0.6, DEFAULT_FESTIVAL_PHOTO.vignette),
  };
}

export class FestivalPhotoLens {
  readonly pass: DepthOfFieldPass;
  settings: FestivalPhotoSettings = { ...DEFAULT_FESTIVAL_PHOTO };
  frames = 0;
  private readonly scratch = new T.Vector3();
  private readonly looks = new Map<string, GradeProfile>();
  constructor(
    private readonly camera: T.PerspectiveCamera,
    depth: T.DepthTexture,
  ) {
    this.pass = new DepthOfFieldPass(
      camera,
      { focus: 10, aperture: 0, maxblur: FESTIVAL_PHOTO.maxBlur },
      depth,
      { taps: FESTIVAL_PHOTO.taps, thinLens: true },
    );
    this.pass.enabled = false;
  }
  set(value: Partial<FestivalPhotoSettings>) {
    this.settings = validateFestivalPhoto({ ...this.settings, ...value });
    this.looks.clear();
  }
  reset() {
    this.settings = { ...DEFAULT_FESTIVAL_PHOTO };
    this.looks.clear();
  }
  /** Vertical field of view for the photo camera (degrees), or null. */
  get fov() {
    const f = this.settings.focalLength;
    return f === null ? null : photoFov(f);
  }
  /** Per frame: lens on the photo camera (focus on `subject` unless manual). */
  update(active: boolean, subject: T.Vector3) {
    const s = this.settings;
    if (!active || !(s.fStop > 0)) {
      this.pass.enabled = false;
      return false;
    }
    this.camera.updateMatrixWorld();
    const depth = -this.scratch.copy(subject).applyMatrix4(this.camera.matrixWorldInverse).z;
    const f = focalLength(this.camera.fov, FESTIVAL_PHOTO.sensorHeight);
    const focus = Math.max(FESTIVAL_PHOTO.minFocus, f + 0.05, s.focus ?? depth);
    const u = this.pass.materialBokeh.uniforms;
    u.focus.value = focus;
    u.lensK.value = thinLensScale(this.camera.fov, focus, s.fStop, FESTIVAL_PHOTO.sensorHeight);
    u.maxblur.value = FESTIVAL_PHOTO.maxBlur;
    this.pass.enabled = true;
    this.frames++;
    return true;
  }
  /** The photo look over the festival's gameplay grade, or null when the
   * settings leave the image as it is. */
  look(
    mode: LightingMode,
    filmic: boolean,
    adjust: ((mode: LightingMode, base: Readonly<GradeProfile>) => Readonly<GradeProfile>) | null,
  ): Readonly<GradeProfile> | null {
    const s = this.settings;
    if (s.filter === 'neutral' && s.vignette === DEFAULT_FESTIVAL_PHOTO.vignette) return null;
    const key = `${mode}|${filmic}`;
    let look = this.looks.get(key);
    if (!look) {
      const base = (filmic ? FILMIC_GRADE_PROFILES : GRADE_PROFILES)[mode];
      look = photoGrade(
        adjust ? adjust(mode, base) : base,
        validatePhoto({ filter: s.filter, vignette: s.vignette, grain: 0, saturation: 1 }),
      );
      this.looks.set(key, look);
    }
    return look;
  }
  diagnostics() {
    const u = this.pass.materialBokeh.uniforms;
    return {
      ...this.settings,
      enabled: this.pass.enabled,
      focusDistance: u.focus.value as number,
      backgroundBlur: u.lensK.value as number,
      frames: this.frames,
    };
  }
  dispose() {
    this.pass.dispose();
  }
}
