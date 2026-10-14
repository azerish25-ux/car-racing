import { describe, expect, it } from 'vitest';
import { TELEPHOTO, tracksideFraming } from '../src/rendering/trackside.ts';
import {
  DEFAULT_PHOTO,
  PHOTO_FILTERS,
  photoGrade,
  validatePhoto,
} from '../src/rendering/photo-camera.ts';
import { GRADE_PROFILES } from '../src/rendering/broadcast-grade.ts';
import {
  REPLAY_DIRECTOR,
  REPLAY_HUD,
  ReplayDirector,
  closestBattle,
  pitSubject,
  lowerThird,
  replayShot,
} from '../src/ui/replay-hud.ts';
import { subjectLens } from '../src/rendering/studio/subject-focus.ts';
import { SHOWROOM } from '../src/rendering/menu-preview.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';

describe('broadcast telephoto', () => {
  it('frames moving cars with a 12-24 degree lens that zooms with distance', () => {
    let previous = Infinity;
    for (const distance of [28, 35, 45, 60, 80]) {
      const framing = tracksideFraming(distance, 40, 16 / 9);
      expect(framing.fits).toBe(true);
      expect(framing.fov).toBeGreaterThanOrEqual(TELEPHOTO.minFov);
      expect(framing.fov).toBeLessThanOrEqual(TELEPHOTO.maxFov);
      expect(framing.fov).toBeLessThanOrEqual(previous);
      previous = framing.fov;
    }
    // Long-lens compression: under the depth-of-field threshold from 40 m.
    expect(tracksideFraming(40, 40, 16 / 9).fov).toBeLessThan(TELEPHOTO.dofBelow);
    // A close pass widens only as far as the fit needs.
    expect(tracksideFraming(10, 40, 16 / 9).fits).toBe(true);
  });
});

describe('photo looks', () => {
  it('validates the filter and the vignette, grain and saturation sliders', () => {
    expect(validatePhoto(null)).toEqual(DEFAULT_PHOTO);
    expect(DEFAULT_PHOTO.filter).toBe('neutral');
    expect(validatePhoto({ filter: 'sepia' }).filter).toBe('neutral');
    expect(validatePhoto({ grain: 9, vignette: -1, saturation: 5 })).toMatchObject({
      grain: 0.12,
      vignette: 0,
      saturation: 2,
    });
    expect(PHOTO_FILTERS).toEqual(['neutral', 'vivid', 'cinematic', 'mono', 'warm', 'cool']);
  });

  it('derives a photo-only grade and never touches gameplay grain', () => {
    const day = GRADE_PROFILES.day;
    const neutral = photoGrade(day, { ...DEFAULT_PHOTO });
    expect(neutral).toMatchObject({
      contrast: day.contrast,
      saturation: day.saturation,
      vignette: DEFAULT_PHOTO.vignette,
      grain: 0,
    });
    const mono = photoGrade(day, { ...DEFAULT_PHOTO, filter: 'mono', grain: 0.05 });
    expect(mono.saturation).toBe(0);
    expect(mono.vibrance).toBe(0);
    expect(mono.grain).toBe(0.05);
    const warm = photoGrade(day, { ...DEFAULT_PHOTO, filter: 'warm' });
    expect(warm.highlightTint[0]).toBeGreaterThan(day.highlightTint[0]);
    expect(warm.highlightTint[2]).toBeLessThan(day.highlightTint[2]);
    for (const profile of Object.values(GRADE_PROFILES)) expect(profile.grain).toBe(0);
  });
});

describe('replay presentation', () => {
  it('letterboxes 12.2 % and names the followed driver for 2.5 s', () => {
    expect(REPLAY_HUD.letterbox).toBe(0.122);
    expect(REPLAY_HUD.lowerThirdSeconds).toBe(2.5);
    const frame = new Float32Array(HEADER + 3 * CAR_STRIDE);
    frame[carBase(2) + F.RANK] = 1;
    frame[carBase(2) + F.LAPS] = 4;
    expect(lowerThird(frame, 2)).toMatchObject({ position: 'P1', name: 'SATO', detail: 'LAP 5' });
    expect(lowerThird(frame, 0).name).toBe('PLAYER');
  });
});

describe('subject depth of field', () => {
  it('focuses the showroom and tight trackside lenses, never gameplay chase or photo mode', () => {
    expect(subjectLens(true, false, 'chase', 32)).toBe(SHOWROOM);
    expect(subjectLens(false, false, 'trackside', 15)).toBe(TELEPHOTO);
    expect(subjectLens(false, false, 'trackside', 22)).toBeNull();
    expect(subjectLens(false, false, 'chase', 15)).toBeNull();
    expect(subjectLens(true, true, 'trackside', 15)).toBeNull();
  });
});

describe('replay director', () => {
  const frameWith = (cars: { s: number; rank: number; speed: number }[]) => {
    const frame = new Float32Array(HEADER + cars.length * CAR_STRIDE);
    frame[H.CARS] = cars.length;
    cars.forEach((c, id) => {
      frame[carBase(id) + F.S] = c.s;
      frame[carBase(id) + F.RANK] = c.rank;
      frame[carBase(id) + F.SPEED] = c.speed;
    });
    return frame;
  };
  it('cuts every 3-6 s on a fixed timeline, so a seek lands on the same shot', () => {
    let previous = replayShot(0);
    expect(previous.start).toBe(0);
    for (let t = 0; t < 120; t += 0.25) {
      const shot = replayShot(t);
      expect(shot.length).toBeGreaterThanOrEqual(REPLAY_DIRECTOR.minShot);
      expect(shot.length).toBeLessThanOrEqual(REPLAY_DIRECTOR.maxShot);
      expect(t).toBeGreaterThanOrEqual(shot.start);
      expect(t).toBeLessThan(shot.start + shot.length);
      if (shot.index !== previous.index) expect(shot.index).toBe(previous.index + 1);
      previous = shot;
    }
    expect(replayShot(57.3)).toEqual(replayShot(57.3));
  });
  it('follows the closest battle under 1.0 s, else the player', () => {
    const L = 3000;
    // P1 at 500 m, P2 at 470 m (0.5 s at 60 m/s), P3 at 300 m (far behind).
    const battle = frameWith([
      { s: 300, rank: 3, speed: 60 },
      { s: 500, rank: 1, speed: 60 },
      { s: 470, rank: 2, speed: 60 },
    ]);
    expect(closestBattle(battle, L)).toBe(2);
    const spread = frameWith([
      { s: 300, rank: 3, speed: 60 },
      { s: 500, rank: 1, speed: 60 },
      { s: 400, rank: 2, speed: 60 },
    ]);
    expect(closestBattle(spread, L)).toBe(-1);
    const director = new ReplayDirector();
    expect(director.follow(battle, 0.1, L)).toBe(2);
    // Within the shot the choice holds even when the battle ends.
    expect(director.follow(spread, 0.2, L)).toBe(2);
    expect(director.follow(spread, replayShot(0).length + 0.01, L)).toBe(0);
  });
  it('shows a pit visit before any battle: the player first, else a rival in service', () => {
    const L = 3000;
    const battle = frameWith([
      { s: 300, rank: 3, speed: 60 },
      { s: 500, rank: 1, speed: 60 },
      { s: 470, rank: 2, speed: 60 },
    ]);
    expect(pitSubject(battle)).toBe(-1);
    battle[carBase(1) + F.IN_PIT] = 1;
    battle[carBase(1) + F.PIT_PHASE] = 3;
    expect(pitSubject(battle)).toBe(1);
    battle[carBase(0) + F.IN_PIT] = 1;
    battle[carBase(0) + F.PIT_PHASE] = 1;
    expect(pitSubject(battle)).toBe(0);
    expect(new ReplayDirector().follow(battle, 0.1, L)).toBe(0);
  });
});
