import type { SessionOptions } from '../simulation/config.ts';
import { rulesetFor } from '../simulation/events.ts';
import { offroadCourse } from '../simulation/offroad/venues.ts';
import { carBase, H, O, OFFROAD_BASE } from '../simulation/protocol.ts';
import { PHASE } from '../simulation/race.ts';
import type { Track } from '../simulation/track.ts';

function clock(seconds: number) {
  if (!(seconds >= 0)) return '—';
  const m = Math.floor(seconds / 60),
    s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
/** The off-road readout for the player's entrant (WP42): one compact line
 * over the race HUD on terrain venues. Motocross / supercross: the gate pick
 * while held, the release, a jump start, the holeshot and the last jump's
 * air time; rallycross: joker laps taken of those required; rally stage:
 * the start countdown and the running stage time. Hidden on paved circuits. */
export class OffroadHud {
  private element: HTMLElement | null = null;
  private airUntil = 0;
  private airTime = 0;
  private wasAirborne = false;
  constructor(private readonly hud: HTMLElement) {}
  private node() {
    if (!this.element) {
      this.element = document.createElement('div');
      this.element.className = 'offroad-readout';
      this.element.setAttribute('role', 'status');
      this.element.style.cssText =
        'position:absolute;top:64px;left:50%;transform:translateX(-50%);padding:4px 12px;' +
        'font:600 13px/1.4 var(--font-mono, monospace);letter-spacing:.08em;color:#f1efe8;' +
        'background:rgba(12,13,15,.62);border-left:3px solid #c98b3c;pointer-events:none;white-space:nowrap';
      this.hud.appendChild(this.element);
    }
    return this.element;
  }
  update(frame: Float32Array, track: Track, options: SessionOptions) {
    const course = offroadCourse(track.circuit);
    if (!course) {
      if (this.element) this.element.hidden = true;
      return;
    }
    const format = rulesetFor(options).format,
      o = carBase(0) + OFFROAD_BASE,
      phase = frame[H.PHASE],
      time = frame[H.TIME],
      parts: string[] = [];
    // Air time of the last real jump, held for two seconds after landing.
    const airborne = frame[o + O.AIRBORNE] > 0.5;
    if (airborne) this.airTime = frame[o + O.AIR_TIME];
    if (this.wasAirborne && !airborne && this.airTime > 0.35) this.airUntil = time + 2;
    this.wasAirborne = airborne;
    if (format?.start === 'gate' && options.mode !== 'practice') {
      if (frame[o + O.START] > 2.5) parts.push('JUMP START');
      else if (phase < PHASE.RACING) parts.push(`GATE ${Math.round(frame[o + O.SLOT])}`);
      else if (frame[H.RACE_TIME] < 2) parts.push('GATE DROP');
      if (frame[o + O.FORMAT] > 0.5) parts.push('HOLESHOT');
    }
    if (format?.kind === 'rallycross') {
      const taken = Math.round(frame[o + O.JOKERS]),
        required = format.joker?.required ?? 1;
      parts.push(taken >= required ? `JOKER ${taken}/${required} ✓` : `JOKER ${taken}/${required}`);
    }
    if (format?.kind === 'stage') {
      const t = frame[o + O.FORMAT];
      parts.push(t >= 0 ? `STAGE ${clock(t)}` : 'STAGE · AT THE CONTROL');
    }
    if (time < this.airUntil) parts.push(`AIR ${this.airTime.toFixed(2)} S`);
    const node = this.node();
    node.hidden = parts.length === 0;
    const text = parts.join('  ·  ');
    if (node.textContent !== text) node.textContent = text;
  }
}
