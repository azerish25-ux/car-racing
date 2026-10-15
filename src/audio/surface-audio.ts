import {
  F,
  H,
  O,
  OFFROAD_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import { MATERIAL } from '../simulation/surface-material.ts';
import { SURFACE } from '../simulation/track.ts';
import { clamp, Random, TAU } from '../core/math.ts';
import { landingDuration, landingThump } from './airborne-audio.ts';

export interface ContactMix {
  asphalt: number;
  grass: number;
  gravel: number;
  /** Loose ground (terrain venues, open-world tracks): packed dirt, mud (wet
   * dirt counts toward it with the recorded soil moisture), sand and snow
   * (ice a glassy trace of it). Wheel slip on loose ground throws soil
   * instead of squealing, so it feeds these layers, not `scrub`. */
  dirt: number;
  mud: number;
  sand: number;
  snow: number;
  kerb: number;
  scrub: number;
  scrubHz: number;
  spray: number;
  rain: number;
  bottom: number;
  flat: number;
  flatHz: number;
  hybrid: number;
  hybridHz: number;
}
export function contactMix(frame: Float32Array, out: ContactMix): ContactMix {
  const o = carBase(0),
    speed = Math.max(0, frame[o + F.SPEED]);
  out.asphalt = out.grass = out.gravel = out.kerb = out.scrub = out.spray = out.flat = 0;
  out.dirt = out.mud = out.sand = out.snow = 0;
  // Wet dirt sounds like mud: the share follows the soil moisture under the machine.
  const wet = smoothShare(frame[o + OFFROAD_BASE + O.MOISTURE]);
  let slipPower = 0,
    lockPower = 0,
    spinPower = 0,
    flatWeight = 0,
    flatRate = 0;
  for (let i = 0; i < 4; i++) {
    const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
    const load = clamp(frame[p + W.LOAD] / 2000, 0, 2);
    if (load <= 0) continue; // A rotating airborne wheel cannot make contact noise.
    const surface = Math.round(frame[p + W.SURFACE]);
    const roll = (clamp(speed / 60, 0, 1.5) * load) / 4;
    if (surface === SURFACE.ASPHALT || surface === SURFACE.PAINT || surface === SURFACE.PIT)
      out.asphalt += roll * 0.028;
    if (surface === SURFACE.GRASS) out.grass += roll * 0.16;
    if (surface === SURFACE.GRAVEL) out.gravel += roll * 0.23;
    if (surface === SURFACE.KERB) out.kerb += roll * 0.1;
    const power = Math.max(0, frame[p + W.SLIP_POWER]);
    if (surface >= MATERIAL.DIRT && surface <= MATERIAL.GRAVEL_ROAD) {
      // Loose ground: rolling and slip both throw soil (no tyre squeal).
      const thrown = roll + clamp(power / 300000, 0, 0.5);
      if (surface === MATERIAL.DIRT) {
        out.dirt += thrown * 0.19 * (1 - wet);
        out.mud += thrown * 0.17 * wet;
      } else if (surface === MATERIAL.MUD) out.mud += thrown * 0.17;
      else if (surface === MATERIAL.SAND) out.sand += thrown * 0.2;
      else if (surface === MATERIAL.SNOW) out.snow += thrown * 0.12;
      else if (surface === MATERIAL.ICE) out.snow += thrown * 0.04;
      else out.gravel += thrown * 0.18;
    } else {
      slipPower += power;
      if (frame[p + W.SLIP] < -0.5) lockPower += power;
      if (frame[p + W.SLIP] > 0.3) spinPower += power;
    }
    out.spray += Math.max(0, frame[p + W.WATER]) * speed * load * 0.0008;
    const fault = clamp(frame[p + W.FLAT] + frame[p + W.PUNCTURED] * 0.7, 0, 1);
    const weight = fault * load * clamp(speed / 10, 0, 1);
    flatWeight += weight;
    flatRate += (Math.abs(frame[p + W.OMEGA]) / TAU) * weight;
  }
  out.scrub = clamp(slipPower / 260000, 0, 0.3);
  out.scrubHz =
    1050 +
    (1350 * lockPower) / Math.max(1, slipPower) +
    (2200 * spinPower) / Math.max(1, slipPower);
  out.spray = clamp(out.spray, 0, 0.22);
  for (const key of ['dirt', 'mud', 'sand', 'snow', 'gravel'] as const)
    out[key] = clamp(out[key], 0, 0.3);
  out.flat = clamp(flatWeight * 0.055, 0, 0.19);
  out.flatHz = clamp(flatRate / Math.max(flatWeight, 1e-6), 1, 80);
  out.rain = clamp(frame[H.RAIN] * 0.0025, 0, 0.12);
  out.bottom = clamp(Math.max(0, frame[o + F.BOTTOM_ENERGY]) / 150000, 0, 0.23);
  const electrical = Math.abs(frame[o + F.MOTOR_POWER]) + Math.abs(frame[o + F.REGEN_POWER]) * 0.65;
  out.hybrid = clamp(electrical / 120000, 0, 1) * 0.034;
  out.hybridHz = 700 + Math.max(0, frame[o + F.RPM]) * 0.18;
  for (const value of Object.values(out))
    if (!Number.isFinite(value)) throw new Error('Invalid contact audio state');
  return out;
}
/** 0 dry .. 1 wet soil, from the recorded moisture (0..1, 0.45 starts to tell). */
function smoothShare(moisture: number) {
  const t = clamp(((Number.isFinite(moisture) ? moisture : 0) - 0.45) / 0.4, 0, 1);
  return t * t * (3 - 2 * t);
}
export const newContactMix = (): ContactMix => ({
  asphalt: 0,
  grass: 0,
  gravel: 0,
  dirt: 0,
  mud: 0,
  sand: 0,
  snow: 0,
  kerb: 0,
  scrub: 0,
  scrubHz: 1050,
  spray: 0,
  rain: 0,
  bottom: 0,
  flat: 0,
  flatHz: 1,
  hybrid: 0,
  hybridHz: 700,
});
interface Layer {
  gain: GainNode;
  filter: BiquadFilterNode;
}

/** Original synthesized contact sound; no recordings/assets. BaseAudioContext
 * lets the exact playback graph also run through a real OfflineAudioContext.
 * https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext */
export class ContactAudio {
  readonly mix = newContactMix();
  readonly output: GainNode;
  private sources: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];
  private layers = {} as Record<
    | 'asphalt'
    | 'grass'
    | 'gravel'
    | 'dirt'
    | 'mud'
    | 'sand'
    | 'snow'
    | 'land'
    | 'clack'
    | 'kerb'
    | 'scrub'
    | 'spray'
    | 'rain'
    | 'bottom'
    | 'impact'
    | 'shift',
    Layer
  >;
  private flat: OscillatorNode;
  private flatGain: GainNode;
  private hybrid: OscillatorNode;
  private hybridGain: GainNode;
  private lastImpact = 0;
  private lastGear = 1;
  private lastTime = -1;
  private lastLoad = new Float64Array(4);
  private kerbEnvelope = 0;
  /** Flight state of the last snapshot, the vertical speed while airborne,
   * the last recorded landing speed and bottoming level (touchdown cues). */
  private wasAirborne = false;
  private airVy = 0;
  private lastLandingSpeed = 0;
  private lastBottom = 0;
  /** Touchdowns heard and the last one's impact speed (diagnostics). */
  landings = 0;
  lastLanding = 0;
  private disposed = false;
  constructor(
    private context: BaseAudioContext,
    destination: AudioNode = context.destination,
  ) {
    this.output = context.createGain();
    this.output.gain.value = 0.85;
    this.output.connect(destination);
    this.nodes.push(this.output);
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0),
      random = new Random(82719);
    for (let i = 0; i < data.length; i++) data[i] = random.next() * 2 - 1;
    const settings = [
      ['asphalt', 'lowpass', 430, 0.5],
      ['grass', 'lowpass', 240, 0.8],
      ['gravel', 'bandpass', 2400, 0.7],
      // Loose ground: a dry mid crunch, a low wet slap, a high granular hiss
      // and a muffled creak; touchdown thump and bump-stop clack below.
      ['dirt', 'bandpass', 900, 0.6],
      ['mud', 'lowpass', 330, 1.1],
      ['sand', 'bandpass', 3600, 0.5],
      ['snow', 'bandpass', 1500, 1],
      ['land', 'lowpass', 110, 0.7],
      ['clack', 'bandpass', 420, 1.4],
      ['kerb', 'lowpass', 180, 0.7],
      ['scrub', 'bandpass', 1600, 1.7],
      ['spray', 'highpass', 2900, 0.7],
      ['rain', 'highpass', 1700, 0.7],
      ['bottom', 'bandpass', 500, 0.6],
      ['impact', 'lowpass', 210, 0.6],
      ['shift', 'bandpass', 650, 1.3],
    ] as const;
    for (const [name, type, frequency, q] of settings) {
      const source = context.createBufferSource(),
        filter = context.createBiquadFilter(),
        gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.output);
      source.start(0, this.sources.length * 0.071);
      this.layers[name] = { gain, filter };
      this.sources.push(source);
      this.nodes.push(source, filter, gain);
    }
    this.flat = context.createOscillator();
    const real = new Float32Array(16),
      imag = new Float32Array(16);
    for (let k = 1; k < real.length; k++) real[k] = 0.76 ** k;
    this.flat.setPeriodicWave(context.createPeriodicWave(real, imag));
    this.flatGain = context.createGain();
    this.flatGain.gain.value = 0;
    this.flat.connect(this.flatGain).connect(this.output);
    this.flat.start();
    this.hybrid = context.createOscillator();
    this.hybrid.type = 'sine';
    this.hybridGain = context.createGain();
    this.hybridGain.gain.value = 0;
    this.hybrid.connect(this.hybridGain).connect(this.output);
    this.hybrid.start();
    this.sources.push(this.flat, this.hybrid);
    this.nodes.push(this.flat, this.flatGain, this.hybrid, this.hybridGain);
  }
  update(frame: Float32Array, cockpit: boolean, time = this.context.currentTime) {
    if (this.disposed) return;
    if (!Number.isFinite(time) || time < 0) throw new Error('Invalid audio timestamp');
    contactMix(frame, this.mix);
    const o = carBase(0),
      simTime = frame[H.TIME],
      elapsed = simTime - this.lastTime;
    const continuity = this.lastTime >= 0 && elapsed >= 0 && elapsed <= 0.25;
    const set = (param: AudioParam, value: number, smoothing = 0.025) =>
      param.setTargetAtTime(value, time, smoothing);
    for (const key of [
      'asphalt',
      'grass',
      'gravel',
      'dirt',
      'mud',
      'sand',
      'snow',
      'scrub',
      'spray',
      'rain',
      'bottom',
    ] as const)
      set(this.layers[key].gain.gain, this.mix[key] * (cockpit && key === 'rain' ? 0.45 : 1));
    set(this.layers.scrub.filter.frequency, this.mix.scrubHz);
    this.kerbEnvelope = continuity ? this.kerbEnvelope * Math.exp(-elapsed * 24) : 0;
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE,
        load = frame[p + W.LOAD];
      if (continuity && frame[p + W.SURFACE] === SURFACE.KERB && frame[o + F.SPEED] > 1)
        this.kerbEnvelope = Math.min(
          0.24,
          this.kerbEnvelope + Math.max(0, load - this.lastLoad[i]) / 40000,
        );
      this.lastLoad[i] = load;
    }
    set(this.layers.kerb.gain.gain, this.mix.kerb + this.kerbEnvelope, 0.008);
    set(this.flatGain.gain, this.mix.flat);
    set(this.flat.frequency, this.mix.flatHz, 0.008);
    set(this.hybridGain.gain, this.mix.hybrid * (cockpit ? 1 : 0.65));
    set(this.hybrid.frequency, this.mix.hybridHz);
    const impact = frame[o + F.IMPACT],
      gear = frame[o + F.GEAR];
    if (continuity && impact > this.lastImpact + 0.03)
      this.pulse('impact', impact * 0.45, time, 0.18);
    if (continuity && gear !== this.lastGear) this.pulse('shift', 0.13, time, 0.055);
    // Touchdown: the suspension thump scales with the normal impact speed
    // (the recorded landing speed of a dirt bike, else the vertical speed
    // the machine fell at); a bump-stop hit adds its own clack.
    const k = o + OFFROAD_BASE,
      airborne = frame[k + O.AIRBORNE] > 0.5,
      landingSpeed = frame[k + O.LANDING_SPEED],
      bottom = frame[k + O.BOTTOM];
    if (continuity && this.wasAirborne && !airborne) {
      const recorded = landingSpeed !== this.lastLandingSpeed ? landingSpeed : 0,
        hit = Math.max(recorded, -this.airVy);
      this.lastLanding = hit;
      this.landings++;
      const level = landingThump(hit);
      if (level > 0) this.pulse('land', level, time, landingDuration(hit));
    }
    if (airborne) this.airVy = Number.isFinite(frame[o + F.VY]) ? frame[o + F.VY] : 0;
    if (continuity && bottom > this.lastBottom + 0.05)
      this.pulse('clack', clamp(bottom, 0, 1) * 0.45, time, 0.09);
    this.wasAirborne = airborne;
    this.lastLandingSpeed = landingSpeed;
    this.lastBottom = bottom;
    this.lastImpact = impact;
    this.lastGear = gear;
    this.lastTime = simTime;
  }
  /** A seek/pause is not an impact or gear-change event. Cancel old envelopes
   * before accepting the next recorded baseline, including very short seeks. */
  reset(time = this.context.currentTime) {
    if (this.disposed) return;
    this.lastTime = -1;
    this.lastImpact = 0;
    this.lastLoad.fill(0);
    this.kerbEnvelope = 0;
    this.wasAirborne = false;
    this.airVy = this.lastLandingSpeed = this.lastBottom = 0;
    for (const name of ['impact', 'shift', 'land', 'clack'] as const) {
      const param = this.layers[name].gain.gain;
      param.cancelScheduledValues(time);
      param.setValueAtTime(0, time);
    }
  }
  private pulse(
    name: 'impact' | 'shift' | 'land' | 'clack',
    level: number,
    time: number,
    duration: number,
  ) {
    const param = this.layers[name].gain.gain;
    param.cancelScheduledValues(time);
    param.setValueAtTime(Math.max(0.0001, Math.min(0.7, level)), time);
    param.exponentialRampToValueAtTime(0.0001, time + duration);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.sources.forEach((source) => source.stop());
    this.nodes.forEach((node) => node.disconnect());
    this.sources.length = this.nodes.length = 0;
  }
}
