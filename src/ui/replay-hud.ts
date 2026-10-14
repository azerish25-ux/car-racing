import styles from './replay-hud.css?inline';
import { DRIVERS, LIVERIES } from '../simulation/config.ts';
import { F, H, carBase } from '../simulation/protocol.ts';

/**
 * Replay presentation (D30 replay-photo): a 12.2 % cinematic letterbox on the
 * trackside (broadcast) cameras, a 2.5 s lower third naming the followed
 * driver on every camera cut, and a transport bar that fades after 2.5 s
 * without pointer or keyboard activity (it stays while focused). The REPLAY
 * badge is the existing `.replay-tag`. Times are presented simulation seconds,
 * so a paused replay holds the lower third.
 */
export const REPLAY_HUD = Object.freeze({
  letterbox: 0.122,
  lowerThirdSeconds: 2.5,
  idleMs: 2500,
});

/** Broadcast replay director: on the trackside cameras the followed car is
 * re-chosen at every shot boundary (shots last 3-6 s of replay time, from a
 * fixed hash, so a seek lands on the same shot), preferring a pit visit
 * (pitSubject), then the closest battle (under `battleGap` s to the car
 * ahead), else the player. */
export const REPLAY_DIRECTOR = Object.freeze({ minShot: 3, maxShot: 6, battleGap: 1.0 });
const shotHash = (i: number) => {
  let h = Math.imul(i + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};
/** Index and start time of the shot containing replay time `time` (s). */
export function replayShot(time: number) {
  let start = 0,
    index = 0;
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  for (;;) {
    const length =
      REPLAY_DIRECTOR.minShot +
      (REPLAY_DIRECTOR.maxShot - REPLAY_DIRECTOR.minShot) * shotHash(index);
    if (start + length > t) return { index, start, length };
    start += length;
    index++;
  }
}
/** The car in the closest battle (interval to the car ahead under the gap), or -1. */
export function closestBattle(frame: Float32Array, length: number) {
  const cars = Math.round(frame[H.CARS]);
  const progress = (id: number) => frame[carBase(id) + F.LAPS] * length + frame[carBase(id) + F.S];
  let best = -1,
    bestGap: number = REPLAY_DIRECTOR.battleGap;
  for (let id = 0; id < cars; id++) {
    const o = carBase(id),
      rank = Math.round(frame[o + F.RANK]);
    if (rank <= 1 || frame[o + F.IN_PIT] || frame[o + F.RETIRED]) continue;
    for (let other = 0; other < cars; other++) {
      if (Math.round(frame[carBase(other) + F.RANK]) !== rank - 1) continue;
      const gap = (progress(other) - progress(id)) / Math.max(10, frame[o + F.SPEED]);
      if (gap >= 0 && gap < bestGap) {
        bestGap = gap;
        best = id;
      }
    }
  }
  return best;
}
/** Race events outrank battles (masterplan §17.9): the player's own pit
 * visit, else a rival stationary in service, else -1. A replay of a stop must
 * show that stop, not a battle elsewhere on the lap. */
export function pitSubject(frame: Float32Array) {
  if (frame[carBase(0) + F.IN_PIT]) return 0;
  const cars = Math.round(frame[H.CARS]);
  for (let id = 1; id < cars; id++) {
    const phase = frame[carBase(id) + F.PIT_PHASE];
    if (frame[carBase(id) + F.IN_PIT] && phase >= 2 && phase <= 5) return id;
  }
  return -1;
}
export class ReplayDirector {
  private shot = -1;
  private chosen = 0;
  /** The car to follow at replay time `time` (constant through a shot). */
  follow(frame: Float32Array, time: number, length: number) {
    const shot = replayShot(time).index;
    if (shot !== this.shot) {
      this.shot = shot;
      const event = pitSubject(frame);
      const battle = event >= 0 ? event : closestBattle(frame, length);
      this.chosen = battle >= 0 ? battle : 0;
    }
    return this.chosen;
  }
  reset() {
    this.shot = -1;
    this.chosen = 0;
  }
}

export interface ReplayShot {
  /** Replay mode is active. */
  active: boolean;
  camera: string;
  /** Trackside rig id (-1 for other cameras). */
  rig: number;
  follow: number;
}

/** The followed driver's lower-third text: position and surname, and its team colour. */
export function lowerThird(frame: Float32Array, follow: number) {
  const name = DRIVERS[follow] ?? `CAR ${follow + 1}`;
  const rank = Math.round(frame[carBase(follow) + F.RANK]);
  return {
    position: rank > 0 ? `P${rank}` : '',
    name: name === 'YOU' ? 'PLAYER' : (name.split(' ').pop() ?? name),
    detail: `LAP ${Math.max(1, Math.round(frame[carBase(follow) + F.LAPS]) + 1)}`,
    colour: `#${(LIVERIES[follow % LIVERIES.length] ?? 0xfc4854).toString(16).padStart(6, '0')}`,
  };
}

export class ReplayHud {
  readonly letterbox: HTMLElement;
  readonly lowerThirdElement: HTMLElement;
  private shotKey = '';
  private shotSince = -Infinity;
  private lastActive = -Infinity;
  private readonly now: () => number;
  constructor(
    private readonly root: HTMLElement,
    now: () => number = () => performance.now(),
  ) {
    const style = document.createElement('style');
    style.textContent = styles;
    this.letterbox = document.createElement('div');
    this.letterbox.className = 'replay-letterbox';
    this.letterbox.dataset.on = 'false';
    this.letterbox.setAttribute('aria-hidden', 'true');
    this.lowerThirdElement = document.createElement('div');
    this.lowerThirdElement.className = 'replay-lower-third';
    this.lowerThirdElement.dataset.on = 'false';
    this.lowerThirdElement.setAttribute('aria-hidden', 'true');
    this.lowerThirdElement.innerHTML = '<b></b><span><em></em><small></small></span>';
    root.append(style, this.letterbox, this.lowerThirdElement);
    const wake = () => {
      this.lastActive = now();
      root.dataset.replayIdle = 'false';
    };
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel'])
      root.addEventListener(type, wake, { passive: true });
    this.now = now;
  }
  /** Once per presented frame. `time` is the presented simulation time. */
  update(frame: Float32Array, shot: ReplayShot, time: number) {
    const cinematic = shot.active && shot.camera === 'trackside';
    this.letterbox.dataset.on = String(cinematic);
    const key = `${shot.camera}:${shot.rig}:${shot.follow}`;
    if (!shot.active) {
      this.shotKey = '';
      this.lowerThirdElement.dataset.on = 'false';
      this.root.dataset.replayIdle = 'false';
      return;
    }
    if (key !== this.shotKey) {
      this.shotKey = key;
      this.shotSince = time;
      const text = lowerThird(frame, shot.follow);
      this.lowerThirdElement.querySelector('b')!.textContent = text.position;
      this.lowerThirdElement.querySelector('em')!.textContent = text.name;
      this.lowerThirdElement.querySelector('small')!.textContent = text.detail;
      this.lowerThirdElement.style.setProperty('--team', text.colour);
    }
    const age = time - this.shotSince;
    this.lowerThirdElement.dataset.on = String(
      frame[H.CARS] > 0 && age >= 0 && age < REPLAY_HUD.lowerThirdSeconds,
    );
    if (!Number.isFinite(this.lastActive)) this.lastActive = this.now();
    this.root.dataset.replayIdle = String(this.now() - this.lastActive > REPLAY_HUD.idleMs);
  }
}
