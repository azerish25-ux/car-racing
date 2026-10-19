import type { SessionOptions } from '../simulation/config.ts';
import { rulesetFor } from '../simulation/events.ts';
import { offroadCourse } from '../simulation/offroad/venues.ts';
import {
  carBase,
  H,
  F,
  R,
  RACE_BASE,
  B,
  BIKE_BASE,
  O,
  OFFROAD_BASE,
} from '../simulation/protocol.ts';
import { PHASE } from '../simulation/race.ts';
import { FLAG } from '../simulation/marshal.ts';
import { trackPoint, type Track } from '../simulation/track.ts';
import { clamp, mod } from '../core/math.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import { motocrossApproachCue, MotocrossRhythm } from '../simulation/offroad/rhythm-coach.ts';
import {
  isMotocrossLandingTarget,
  MotocrossLandingChallenge,
} from '../simulation/offroad/landing-challenge.ts';
import { motocrossBrakeHeldInFlight } from './motocross-brake-cue.ts';
import {
  assessMotocrossLanding,
  LANDING_RULES,
  motocrossAlignment,
} from '../simulation/offroad/riding-feedback.ts';

function alignment(frame: Float32Array, base: number) {
  const x = frame[base + F.QX],
    y = frame[base + F.QY],
    z = frame[base + F.QZ],
    w = frame[base + F.QW];
  return motocrossAlignment(
    2 * (x * z + w * y),
    1 - 2 * (x * x + y * y),
    frame[base + F.VX],
    frame[base + F.VZ],
  );
}

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
 * the countdown to this car's start (queued, then at the control), a jump
 * start and the running stage time. Hidden on paved circuits. */
export class OffroadHud {
  private element: HTMLElement | null = null;
  private ride: HTMLElement | null = null;
  private rideFields: HTMLElement[] = [];
  private readonly rhythm = new MotocrossRhythm();
  private readonly targets = new MotocrossLandingChallenge();
  private readonly targetPoint = trackPoint();
  private airUntil = 0;
  private airTime = 0;
  private landedAirTime = 0;
  private wasAirborne = false;
  private lastTrack: Track | null = null;
  private lastTime = -Infinity;
  private landingAt = -Infinity;
  private landingRough = false;
  private flightYaw = 0;
  private landingWhip = false;
  private landingSideways = 0;
  private landing: ReturnType<typeof assessMotocrossLanding> | null = null;
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
  private rideNode() {
    if (!this.ride) {
      this.ride = document.createElement('section');
      this.ride.className = 'mx-ride-hud';
      this.ride.setAttribute('aria-label', 'Motocross jump and landing information');
      // The numeric airtime changes continuously, so this is deliberately not
      // a live region. Only the discrete start/holeshot line uses role=status.
      this.ride.innerHTML =
        '<div class="mx-ride-heading"><span></span><span></span></div><div class="mx-ride-main"><strong></strong><b></b></div><div class="mx-ride-note"></div><div class="mx-ride-progress"><i></i></div>';
      this.rideFields = Array.from(
        this.ride.querySelectorAll<HTMLElement>(
          '.mx-ride-heading span, .mx-ride-main strong, .mx-ride-main b, .mx-ride-note',
        ),
      );
      this.hud.append(this.ride);
    }
    return this.ride;
  }
  private updateRide(
    frame: Float32Array,
    track: Track,
    options: SessionOptions,
    airborne: boolean,
    playerControlled: boolean,
  ) {
    const course = offroadCourse(track.circuit)!;
    const targetCount = course.jumps.filter(isMotocrossLandingTarget).length;
    const node = this.rideNode(),
      base = carBase(0),
      o = base + OFFROAD_BASE;
    const s = mod(frame[base + F.S], track.length),
      time = frame[H.TIME];
    const crashed = frame[base + BIKE_BASE + B.STATE] > 0.5;
    const globalFlag = frame[H.FLAG],
      localFlag = frame[base + F.LOCAL_FLAG];
    const doubleYellow = globalFlag === FLAG.DOUBLE_YELLOW || localFlag === FLAG.DOUBLE_YELLOW;
    const caution = doubleYellow || globalFlag === FLAG.YELLOW || localFlag === FLAG.YELLOW;
    let next = course.jumps[0],
      distance = Infinity;
    for (const jump of course.jumps) {
      const d = mod(jump.start - s, track.length);
      if (s >= jump.start && s <= jump.end) {
        next = jump;
        distance = 0;
        break;
      }
      if (d < distance) {
        next = jump;
        distance = d;
      }
    }
    let heading = course.kind === 'supercross' ? 'SUPERCROSS' : 'MOTOCROSS';
    let tag = frame[o + O.MOISTURE] > 0.58 ? 'WET SOIL' : 'TRACK FLOW';
    let title = next?.name ?? 'FIND YOUR LINE',
      metric = next ? `${Math.round(distance)} M` : '';
    let note =
      options.assist === 'raw'
        ? 'Throttle and brake control pitch in flight.'
        : 'Assisted pitch · line up with the landing slope.';
    let tone = 'approach',
      progress = next ? Math.round(clamp(1 - distance / 100, 0, 1) * 100) : 0;
    if (next && distance <= 0.01) {
      tag = next.kind.toUpperCase();
      metric = 'ON COURSE';
    }
    if (next) {
      const approach = motocrossApproachCue(
        next,
        mod(next.takeoff - s, track.length),
        frame[base + F.SPEED],
        frame[o + O.MOISTURE] > 0.58,
      );
      if (approach) {
        tag = `LIP ~${approach.targetKph} KM/H`;
        note = approach.cue;
        tone = approach.kind === 'roll' || approach.kind === 'ease' ? 'heavy' : 'approach';
      }
    }
    if (next && distance > 160) {
      title = 'BUILD YOUR RHYTHM';
      note = `Next: ${next.name.toLowerCase()} · ${Math.round(distance)} m`;
      metric = '';
      progress = 0;
    }
    if (options.mode === 'practice' && this.rhythm.completed > 0)
      heading += ` · RUN ${this.rhythm.streak}/3`;
    if (options.mode === 'practice' && targetCount > 0 && playerControlled)
      heading = `PRACTICE · TARGETS ${this.targets.cleared.size}/${targetCount}`;
    if (options.mode === 'race' && frame[H.PHASE] < PHASE.RACING) {
      heading = 'START GATE';
      tag = 'READY';
      title = 'WAIT FOR THE DROP';
      metric = `GATE ${Math.max(1, Math.round(frame[o + O.SLOT]))}`;
      note = 'Settle the bike. Pick your line into the first berm.';
      progress = 0;
    } else if (crashed) {
      tag = 'RECOVERY';
      title = 'RESET YOUR RHYTHM';
      metric = '';
      tone = 'crash';
      note = 'The rider is recovering. Prepare a smooth restart.';
      progress = 0;
    } else if (caution) {
      // A surveyed lip speed is not permission to jump under race control.
      // Already-airborne riders cannot roll a face: finish that landing first.
      heading = 'TRACK CAUTION';
      tag = doubleYellow ? 'DOUBLE YELLOW' : 'YELLOW FLAG';
      title = airborne ? 'LAND THEN SLOW DOWN' : 'ROLL THE NEXT JUMP';
      metric = airborne ? `${this.airTime.toFixed(2)} S` : '';
      note = airborne
        ? 'Match the downslope, then reduce speed. No overtaking.'
        : 'Reduce speed · no overtaking or jumping. Follow the marshal.';
      tone = 'heavy';
      progress = 0;
    } else if (airborne) {
      heading = 'IN FLIGHT';
      tag = next?.name ?? 'AIR';
      title = 'MATCH THE LANDING';
      metric = `${this.airTime.toFixed(2)} S`;
      tone = 'air';
      const yaw = Math.abs(alignment(frame, base).yaw);
      title = yaw > 0.18 ? 'BRING IT BACK' : 'MATCH THE LANDING';
      note =
        yaw > 0.18
          ? 'Release steering to square the wheels · throttle and brake set pitch.'
          : 'Steer to whip · release to square · throttle lifts the nose, brake lowers it.';
      if (playerControlled && yaw <= 0.18 && motocrossBrakeHeldInFlight(frame)) {
        title = 'RELEASE THE BRAKE';
        note = 'Let the wheels roll before touchdown. A held brake drags the landing.';
        tone = 'heavy';
      }
      progress = Math.round(clamp(this.airTime / 2, 0, 1) * 100);
    } else if (time < this.airUntil && this.landing) {
      heading = 'LAST JUMP';
      tag =
        options.mode === 'practice' && this.rhythm.streak > 0
          ? `${this.rhythm.streak} CLEAN IN A ROW`
          : 'TOUCHDOWN';
      title = this.landing.label.toUpperCase();
      metric = `${this.landedAirTime.toFixed(2)} S`;
      note = this.landing.cue;
      if (
        this.landingWhip &&
        this.landing.kind === 'clean' &&
        Number.isFinite(this.landingAt) &&
        time - this.landingAt >= LANDING_RULES.settleSeconds
      ) {
        title = 'WHIP LANDED';
        note = 'Squared up for touchdown. Carry the drive into the next section.';
      }
      if (options.mode === 'practice' && this.rhythm.streak >= 3)
        note = `Rhythm target reached · best run ${this.rhythm.best}. Keep it flowing.`;
      tone =
        this.landing.tone === 'good'
          ? 'clean'
          : this.landing.tone === 'warning'
            ? 'heavy'
            : 'landing';
      const target = this.targets.last;
      if (options.mode === 'practice' && playerControlled && target?.at === this.landingAt) {
        const count = this.targets.cleared.size;
        if (target.kind === 'target') {
          if (title !== 'WHIP LANDED') title = 'TARGET LANDED';
          tag = `${count}/${targetCount} LANDING TARGETS`;
          note =
            count === targetCount
              ? 'Every landing target cleared. Link them into one flowing lap.'
              : `${target.jump.name} ${target.first ? 'cleared' : 'confirmed'} · ${targetCount - count} targets left.`;
        } else if (target.kind === 'rough') {
          tag = 'TARGET NOT CLEARED';
          // O.BOTTOM decays after contact. The target keeps every observed
          // settling sample, so explain a rejected attempt even if the latest
          // instantaneous landing grade has recovered to clean.
          if (this.landing.kind === 'clean') {
            title = 'SETTLE THE LANDING';
            note =
              'The bike recovered after a rough contact. Match the downslope and settle smoothly to clear it.';
          }
          tone = 'heavy';
        } else if (this.landing.kind === 'clean') {
          tag = target.kind === 'short' ? 'SHORT OF TARGET' : 'PAST THE TARGET';
          note =
            target.kind === 'short'
              ? 'Smooth contact. Build the approach to reach the surveyed downslope.'
              : 'Smooth contact. Ease the approach to meet the surveyed downslope.';
        }
      }
      progress = Math.round(clamp((this.airUntil - time) / 2.8, 0, 1) * 100);
    }
    node.hidden = false;
    node.dataset.tone = tone;
    const values = [heading, tag, title, metric, note];
    for (let i = 0; i < this.rideFields.length; i++)
      if (this.rideFields[i].textContent !== values[i]) this.rideFields[i].textContent = values[i];
    const width = `${progress}%`;
    if (node.style.getPropertyValue('--mx-progress') !== width)
      node.style.setProperty('--mx-progress', width);
  }
  /** The off-road part of the results card (WP42): the holeshot, joker laps
   * against the requirement, or each car's stage time; empty elsewhere. */
  results(
    frame: Float32Array,
    track: Track,
    options: SessionOptions,
    name: (id: number) => string,
  ) {
    if (!offroadCourse(track.circuit) || options.mode !== 'race') return '';
    const format = rulesetFor(options).format;
    if (!format) return '';
    const cars = Math.round(frame[H.CARS]),
      at = (id: number, field: number) => frame[carBase(id) + OFFROAD_BASE + field],
      ids = Array.from({ length: cars }, (_, id) => id);
    const escape = (text: string) =>
      text.replace(
        /[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
      );
    const lines: string[] = [];
    if (format.start === 'gate') {
      const hole = ids.find((id) => at(id, O.FORMAT) > 0.5);
      lines.push(`Holeshot: ${hole === undefined ? '—' : escape(name(hole))}.`);
      const jumped = ids.filter((id) => at(id, O.START) > 2.5).map((id) => escape(name(id)));
      if (jumped.length) lines.push(`Jump start (penalised): ${jumped.join(', ')}.`);
    }
    if (format.kind === 'rallycross') {
      const required = format.joker?.required ?? 1;
      lines.push(
        `Joker laps (${required} required, ${format.joker?.penaltySeconds ?? 0} s per difference): ` +
          ids.map((id) => `${escape(name(id))} ${Math.round(at(id, O.JOKERS))}`).join(' · ') +
          '.',
      );
    }
    if (format.kind === 'stage')
      lines.push(
        'Stage times: ' +
          ids
            .map(
              (id) => `${escape(name(id))} ${at(id, O.FORMAT) > 0 ? clock(at(id, O.FORMAT)) : '—'}`,
            )
            .join(' · ') +
          '.',
      );
    return `<p class="offroad-results">${lines.join('<br>')}</p>`;
  }
  update(
    frame: Float32Array,
    track: Track,
    options: SessionOptions,
    playerControlled = true,
    replay = false,
  ) {
    const course = offroadCourse(track.circuit);
    if (!course) {
      if (this.element) this.element.hidden = true;
      if (this.ride) this.ride.hidden = true;
      this.lastTrack = null;
      this.rhythm.reset();
      this.targets.reset();
      return;
    }
    const format = rulesetFor(options).format,
      o = carBase(0) + OFFROAD_BASE,
      phase = frame[H.PHASE],
      time = frame[H.TIME],
      parts: string[] = [];
    // Snapshot time is nondecreasing outside a seek. Even a short rewind
    // across a takeoff must not look like a new touchdown in this frame.
    if (track !== this.lastTrack || time < this.lastTime || time > this.lastTime + 2) {
      this.airTime = this.landedAirTime = this.airUntil = 0;
      this.wasAirborne = false;
      this.landing = null;
      this.landingAt = -Infinity;
      this.landingRough = false;
      this.flightYaw = this.landingSideways = 0;
      this.landingWhip = false;
    }
    this.lastTrack = track;
    this.lastTime = time;
    // Air time of the last real jump, held for two seconds after landing.
    const airborne = frame[o + O.AIRBORNE] > 0.5;
    if (airborne) {
      this.airTime = frame[o + O.AIR_TIME];
      // A new flight owns its own touchdown measurements, including a tiny
      // rebound. It must never regrade the previous qualifying jump.
      if (!this.wasAirborne) {
        this.landingAt = -Infinity;
        this.flightYaw = 0;
      }
      const yaw = Math.abs(alignment(frame, carBase(0)).yaw);
      if (Number.isFinite(yaw)) this.flightYaw = Math.max(this.flightYaw, yaw);
    }
    if (this.wasAirborne && !airborne) {
      // Physics retains completed airtime until the next takeoff. Prefer its
      // final value to the last airborne presentation sample.
      const completedAirTime = Math.max(this.airTime, frame[o + O.AIR_TIME]);
      if (completedAirTime > 0.2) {
        this.landedAirTime = completedAirTime;
        this.airUntil = time + 2.8;
        this.landingAt = time;
        this.landingRough = course.isRough(mod(frame[carBase(0) + F.S], track.length));
        this.landingWhip = this.flightYaw > 0.18;
        this.landingSideways = Math.abs(alignment(frame, carBase(0)).lateralSpeed);
      }
    }
    // The spring can bottom a few frames after the first tyre contact. Keep
    // grading that short settling window rather than promising a clean landing
    // before the measured suspension and crash state have arrived.
    if (
      !airborne &&
      time >= this.landingAt &&
      time - this.landingAt <= LANDING_RULES.settleSeconds
    ) {
      const b = carBase(0);
      const spec = vehicleAt(Math.round(frame[b + RACE_BASE + R.VEHICLE])).bike?.offroad;
      this.landingSideways = Math.max(
        this.landingSideways,
        Math.abs(alignment(frame, b).lateralSpeed),
      );
      this.landing = assessMotocrossLanding(
        frame[o + O.LANDING_PITCH],
        frame[o + O.LANDING_SPEED],
        frame[o + O.BOTTOM],
        frame[b + BIKE_BASE + B.STATE] > 0.5,
        spec,
        this.landingRough,
        this.landingSideways,
      );
    }
    const player = carBase(0);
    const riderSpec = vehicleAt(Math.round(frame[player + RACE_BASE + R.VEHICLE])).bike?.offroad;
    const feedback = assessMotocrossLanding(
      frame[o + O.LANDING_PITCH],
      frame[o + O.LANDING_SPEED],
      frame[o + O.BOTTOM],
      frame[player + BIKE_BASE + B.STATE] > 0.5,
      riderSpec,
      course.isRough(mod(frame[player + F.S], track.length)),
      Number.isFinite(this.landingAt) ? this.landingSideways : 0,
    );
    this.rhythm.update({
      course: track,
      time,
      airborne,
      airTime: frame[o + O.AIR_TIME],
      crashed: frame[player + BIKE_BASE + B.STATE] > 0.5,
      landing: feedback,
    });
    const motocross = course.kind === 'motocross' || course.kind === 'supercross';
    if (replay) this.targets.suspend();
    else if (motocross && options.mode === 'practice') {
      const s = frame[player + F.S];
      track.at(s, this.targetPoint);
      const cautioned = [frame[H.FLAG], frame[player + F.LOCAL_FLAG]].some(
        (flag) => flag === FLAG.YELLOW || flag === FLAG.DOUBLE_YELLOW,
      );
      this.targets.update({
        course: track,
        machine: `${frame[player + RACE_BASE + R.VEHICLE]}:${options.assist}`,
        jumps: course.jumps,
        length: track.length,
        time,
        s,
        speed: frame[player + F.SPEED],
        lateral: frame[player + F.LATERAL],
        halfWidth: this.targetPoint.width,
        airborne,
        airTime: frame[o + O.AIR_TIME],
        crashed: frame[player + BIKE_BASE + B.STATE] > 0.5,
        eligible:
          playerControlled &&
          !cautioned &&
          frame[player + F.IN_PIT] < 0.5 &&
          frame[player + F.RETIRED] < 0.5,
        landing: feedback,
      });
    } else this.targets.reset();
    this.wasAirborne = airborne;
    if (motocross) this.updateRide(frame, track, options, airborne, playerControlled && !replay);
    else if (this.ride) this.ride.hidden = true;
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
      // Before this car's start the block carries the countdown (negative).
      const t = frame[o + O.FORMAT],
        start = frame[o + O.START];
      if (start > 2.5) parts.push('JUMP START');
      parts.push(
        t >= 0
          ? `STAGE ${clock(t)}`
          : `${start > 0.5 ? 'AT THE CONTROL' : 'QUEUED'} · START IN ${Math.ceil(-t)}`,
      );
    }
    if (!motocross && time < this.airUntil) parts.push(`AIR ${this.landedAirTime.toFixed(2)} S`);
    const node = this.node();
    node.hidden = parts.length === 0;
    const text = parts.join('  ·  ');
    if (node.textContent !== text) node.textContent = text;
  }
}
