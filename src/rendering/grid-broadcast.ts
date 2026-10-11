import * as T from 'three';
import { GRID_PRESENTATION_SECONDS } from '../core/grid-presentation.ts';

/** A television director's shot list for the pre-race grid. Each shot is a
 * short, purposeful camera move (crane, telephoto creep, dolly, track) and
 * shots are joined by hard cuts, as on a live grid broadcast. Coordinates are
 * in the followed car's frame (+Z forward, metres, car origin ~0.52 m above
 * the grid). Pure function of presentation time: pause, seek and replay
 * reproduce every frame exactly. */
export interface GridShot {
  index: number;
  name: string;
  /** Lower-third caption shown while this shot is live. */
  caption: string;
  eye: T.Vector3;
  target: T.Vector3;
  /** Point the lens is focused on (car frame). */
  focus: T.Vector3;
  fov: number;
  aperture: number;
  maxblur: number;
}

interface ShotDefinition {
  start: number;
  name: string;
  caption: string;
  eye: readonly [readonly [number, number, number], readonly [number, number, number]];
  target: readonly [readonly [number, number, number], readonly [number, number, number]];
  focus?: readonly [number, number, number];
  fov: readonly [number, number];
  aperture: number;
  maxblur: number;
}

/** Shot boundaries follow the crew stages in core/grid-presentation.ts. */
export const GRID_SHOTS: readonly ShotDefinition[] = Object.freeze([
  {
    start: 0,
    name: 'crane establishing',
    caption: 'Grid formed · crews at their cars',
    eye: [
      [-11.5, 10.5, -24],
      [-8.2, 5.2, -15.5],
    ],
    target: [
      [0.5, -0.2, 6],
      [0, 0, 4],
    ],
    fov: [40, 36],
    // Wide shots are deep focus: a blurred wide reads as a miniature.
    aperture: 0,
    maxblur: 0,
  },
  {
    start: 4.2,
    name: 'telephoto down the grid',
    caption: 'Final checks',
    eye: [
      [3.1, 0.75, 44],
      [2.6, 0.72, 40],
    ],
    target: [
      [0.2, 0.05, -2],
      [0.1, 0.05, -2],
    ],
    focus: [0, 0.1, 0.5],
    fov: [8.5, 8],
    aperture: 0.0004,
    maxblur: 0.007,
  },
  {
    start: 8.4,
    name: 'front wheel close',
    caption: 'Tyre preparation · blanket temperature check',
    eye: [
      [-3.2, 0.32, 4.4],
      [-2.55, 0.42, 3.55],
    ],
    target: [
      [-1.35, -0.05, 1.7],
      [-1.4, 0.02, 1.75],
    ],
    focus: [-1.45, 0.05, 1.8],
    fov: [32, 29],
    aperture: 0.0016,
    maxblur: 0.014,
  },
  {
    start: 12.6,
    name: 'rear wheel low',
    caption: 'Blankets off',
    eye: [
      [3.4, 0.28, -4.6],
      [2.75, 0.36, -3.65],
    ],
    target: [
      [1.3, 0.05, -1.55],
      [1.35, 0.15, -1.6],
    ],
    focus: [1.4, 0.15, -1.6],
    fov: [30, 28],
    aperture: 0.0016,
    maxblur: 0.014,
  },
  {
    start: 17.2,
    name: 'driver telephoto',
    caption: 'Driver · visor down',
    eye: [
      [1.25, 1.55, 9.5],
      [1.05, 1.42, 8.6],
    ],
    target: [
      [0, 0.42, -0.35],
      [0, 0.42, -0.35],
    ],
    focus: [0, 0.42, -0.35],
    fov: [11, 10],
    aperture: 0.0012,
    maxblur: 0.012,
  },
  {
    start: 23.4,
    name: 'crew clearing track',
    caption: 'Clear the grid · crews to the pit wall',
    eye: [
      [-6.4, 1.15, 3.2],
      [-6.9, 1.2, -1.2],
    ],
    target: [
      [-2.6, 0.35, 1.6],
      [-4.2, 0.4, -2.4],
    ],
    focus: [-3.4, 0.4, 0],
    fov: [38, 36],
    aperture: 0.0008,
    maxblur: 0.01,
  },
  {
    start: 30.6,
    name: 'pit wall wide',
    caption: 'Grid clear · formation lap next',
    // High on the pit-wall side, clear of the start gantry and its banner.
    eye: [
      [-15, 8.5, 9],
      [-13.5, 7.2, 3],
    ],
    target: [
      [0, -0.2, -10],
      [0, -0.2, -12],
    ],
    focus: [0, 0.3, 0],
    fov: [30, 27],
    aperture: 0,
    maxblur: 0,
  },
]);

const ease = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  // Broadcast operators feather both ends of a move.
  return x * x * x * (x * (6 * x - 15) + 10);
};

const scratch = new T.Vector3();

export function gridShot(): GridShot {
  return {
    index: 0,
    name: '',
    caption: '',
    eye: new T.Vector3(),
    target: new T.Vector3(),
    focus: new T.Vector3(),
    fov: 40,
    aperture: 0,
    maxblur: 0,
  };
}

/** The live shot at presentation time `time`. Reduced motion: one held wide. */
export function gridBroadcastShot(time: number, reducedMotion: boolean, out = gridShot()) {
  if (!Number.isFinite(time)) throw new Error('Invalid grid broadcast time');
  const t = Math.max(0, Math.min(GRID_PRESENTATION_SECONDS, time));
  if (reducedMotion) {
    out.index = 0;
    out.name = 'held wide';
    out.caption = 'Grid formed';
    out.eye.set(-6.4, 2.4, 5.5);
    out.target.set(0, 0.4, 0.3);
    out.focus.copy(out.target);
    out.fov = 46;
    out.aperture = 0;
    out.maxblur = 0;
    return out;
  }
  let index = 0;
  while (index + 1 < GRID_SHOTS.length && t >= GRID_SHOTS[index + 1].start) index++;
  const shot = GRID_SHOTS[index];
  const end =
    index + 1 < GRID_SHOTS.length ? GRID_SHOTS[index + 1].start : GRID_PRESENTATION_SECONDS;
  const u = ease((t - shot.start) / (end - shot.start));
  out.index = index;
  out.name = shot.name;
  out.caption = shot.caption;
  out.eye.fromArray(shot.eye[0]).lerp(scratch.fromArray(shot.eye[1]), u);
  out.target.fromArray(shot.target[0]).lerp(scratch.fromArray(shot.target[1]), u);
  if (shot.focus) out.focus.fromArray(shot.focus);
  else out.focus.copy(out.target);
  // A hand-held operator's breathing on the long lens, deterministic in time.
  const sway = shot.fov[1] < 15 ? 0.006 : 0.0025;
  out.target.x += Math.sin(t * 0.9 + index) * sway * out.eye.distanceTo(out.target) * 0.1;
  out.target.y += Math.sin(t * 1.3 + index * 2) * sway * out.eye.distanceTo(out.target) * 0.06;
  out.fov = shot.fov[0] + (shot.fov[1] - shot.fov[0]) * u;
  out.aperture = shot.aperture;
  out.maxblur = shot.maxblur;
  return out;
}
