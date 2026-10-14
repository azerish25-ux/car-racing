import { FLAG } from '../simulation/marshal.ts';
import { F, H, carBase } from '../simulation/protocol.ts';
import { SC_PHASE } from '../simulation/safety-car.ts';

/** Race communication arbiter (masterplan §20.4, D084-D087). Messages carry
 * a speaker, an urgency, a relevance window in simulation seconds and a
 * cooldown. Race control outranks the engineer; a more urgent message
 * interrupts a less urgent one; a message whose moment has passed is dropped
 * instead of being read out late. Everything is derived from authoritative
 * snapshots, so the same frames always produce the same captions (replay
 * consistency), and every message is captioned with its speaker. */
export type Speaker = 'RACE CONTROL' | 'ENGINEER';
export const URGENCY = { INFO: 0, STRATEGY: 1, WARNING: 2, RACE_CONTROL: 3 } as const;
export interface RadioMessage {
  key: string;
  speaker: Speaker;
  text: string;
  urgency: number;
  /** Simulation time after which the message is stale. */
  expires: number;
  /** Minimum on-screen time once shown (s). */
  hold: number;
}
export interface RadioOptions {
  /** Engineer flavour/strategy chatter; race control is never muted. */
  engineer: boolean;
}
export class RadioArbiter {
  current: RadioMessage | null = null;
  private shownAt = 0;
  private readonly queue: RadioMessage[] = [];
  private readonly lastSent = new Map<string, number>();
  private previous: Float32Array | null = null;
  constructor(
    private readonly options: RadioOptions = { engineer: true },
    private readonly cooldown = 20,
  ) {}
  reset() {
    this.current = null;
    this.queue.length = 0;
    this.lastSent.clear();
    this.previous = null;
  }
  /** Offer a message; repeated keys inside the cooldown are ignored. */
  post(message: RadioMessage, now: number) {
    if (message.speaker === 'ENGINEER' && !this.options.engineer) return;
    const last = this.lastSent.get(message.key);
    if (last !== undefined && now - last < this.cooldown) return;
    this.lastSent.set(message.key, now);
    const queued = this.queue.findIndex((m) => m.key === message.key);
    if (queued >= 0) this.queue.splice(queued, 1);
    this.queue.push(message);
  }
  /** Advance to simulation time `now`; returns the caption to display. */
  update(now: number): RadioMessage | null {
    for (let i = this.queue.length - 1; i >= 0; i--)
      if (this.queue[i].expires < now) this.queue.splice(i, 1);
    this.queue.sort((a, b) => b.urgency - a.urgency);
    const next = this.queue[0];
    const held = this.current && now - this.shownAt < this.current.hold;
    if (this.current && (this.current.expires < now || !held)) this.current = null;
    if (next && (!this.current || next.urgency > this.current.urgency)) {
      this.queue.shift();
      this.current = next;
      this.shownAt = now;
    }
    return this.current;
  }
  /** Derive messages for the player car from consecutive snapshots. */
  observe(frame: Float32Array, laps: number) {
    const now = frame[H.TIME],
      o = carBase(0),
      prev = this.previous;
    this.previous = frame.slice();
    if (!prev || prev[H.CARS] !== frame[H.CARS]) return this.update(now);
    const sc = frame[H.SC_PHASE];
    if (sc !== prev[H.SC_PHASE] && sc !== SC_PHASE.NONE)
      this.post(
        {
          key: `sc-${sc}`,
          speaker: 'RACE CONTROL',
          text:
            sc === SC_PHASE.VSC
              ? 'Virtual safety car. Hold the delta speed, no overtaking.'
              : sc === SC_PHASE.DEPLOYED
                ? 'Safety car deployed. Close up behind it, no overtaking.'
                : 'Safety car in this lap. Racing resumes at the line.',
          urgency: URGENCY.RACE_CONTROL,
          expires: now + 8,
          hold: 4,
        },
        now,
      );
    const flag = frame[o + F.LOCAL_FLAG];
    if (flag !== prev[o + F.LOCAL_FLAG] && (flag === FLAG.YELLOW || flag === FLAG.DOUBLE_YELLOW))
      this.post(
        {
          key: `yellow-${Math.round(frame[o + F.CONTROL_SEQUENCE])}`,
          speaker: 'RACE CONTROL',
          text:
            flag === FLAG.DOUBLE_YELLOW
              ? 'Double yellow ahead. Slow right down, no overtaking, be ready to stop.'
              : 'Yellow flag ahead. Lift and do not overtake until the green.',
          urgency: URGENCY.RACE_CONTROL,
          expires: now + 5,
          hold: 3,
        },
        now,
      );
    if (flag === FLAG.BLUE && prev[o + F.LOCAL_FLAG] !== FLAG.BLUE)
      this.post(
        {
          key: 'blue',
          speaker: 'RACE CONTROL',
          text: 'Blue flag: a lapping car is behind. Let it through cleanly.',
          urgency: URGENCY.WARNING,
          expires: now + 6,
          hold: 3,
        },
        now,
      );
    const penalty = frame[o + F.PENALTY] - prev[o + F.PENALTY];
    if (penalty > 0)
      this.post(
        {
          key: `penalty-${frame[o + F.CONTROL_PENALTIES]}`,
          speaker: 'RACE CONTROL',
          text: `Time penalty +${penalty.toFixed(0)} s, added to your race time at the flag. Respect track limits, flags and the pit speed limit to avoid more.`,
          urgency: URGENCY.RACE_CONTROL,
          expires: now + 10,
          hold: 5,
        },
        now,
      );
    const warnings = frame[o + F.WARNINGS];
    if (warnings > prev[o + F.WARNINGS])
      this.post(
        {
          key: `limits-${warnings}`,
          speaker: 'RACE CONTROL',
          text: `Track limits warning ${Math.round(warnings)}. Keep two wheels inside the white lines; repeated offences are penalised.`,
          urgency: URGENCY.WARNING,
          expires: now + 6,
          hold: 3,
        },
        now,
      );
    if (frame[o + F.IN_PIT] && !prev[o + F.IN_PIT])
      this.post(
        {
          key: 'pit-limit',
          speaker: 'ENGINEER',
          text: 'Pit entry. Limiter is automatic: 80 km/h until the exit line.',
          urgency: URGENCY.WARNING,
          expires: now + 6,
          hold: 3,
        },
        now,
      );
    const completed = frame[o + F.LAPS];
    if (laps > 1 && completed !== prev[o + F.LAPS] && completed === laps - 1)
      this.post(
        {
          key: 'final-lap',
          speaker: 'ENGINEER',
          text: 'Final lap. Bring it home.',
          urgency: URGENCY.STRATEGY,
          expires: now + 10,
          hold: 3,
        },
        now,
      );
    // Fuel lead time: warn while two laps' margin remains, not at empty.
    const length = frame[H.LENGTH],
      lapsLeft = Math.max(0, laps - completed),
      need = lapsLeft * (length / 1000) * 0.37;
    if (lapsLeft > 0 && frame[o + F.FUEL] < need && prev[o + F.FUEL] >= need)
      this.post(
        {
          key: 'fuel',
          speaker: 'ENGINEER',
          text: `Fuel is marginal for ${lapsLeft} laps. Lift and coast into the braking zones.`,
          urgency: URGENCY.STRATEGY,
          expires: now + 15,
          hold: 4,
        },
        now,
      );
    return this.update(now);
  }
}
