import { F, carBase } from '../simulation/protocol.ts';
import { clamp } from '../core/math.ts';
import { SpatialAudioScene, type AudioView } from './spatial.ts';
import {
  SOUND_PROFILES,
  frameCharacter,
  type SoundFamily,
  type SoundProfile,
} from './sound-profiles.ts';

const BAND_MULTIPLIER = [0.5, 1, 2] as const;
interface Voice {
  id: number;
  family: SoundFamily | null;
  osc: OscillatorNode[];
  bands: GainNode[];
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
}
/** Actual production graph, also executable by OfflineAudioContext. All four
 * engines use original harmonic bands; spatial motion controls their frequency,
 * attenuation and stereo image. Voice reassignment dips gain before retuning. */
export class EngineVoices {
  readonly spatial = new SpatialAudioScene();
  private voices: Voice[] = [];
  private disposed = false;
  private waves = new Map<SoundFamily, PeriodicWave[]>();
  constructor(
    private context: BaseAudioContext,
    destination: AudioNode = context.destination,
  ) {
    for (let i = 0; i < 4; i++) {
      const gain = context.createGain(),
        filter = context.createBiquadFilter(),
        pan = context.createStereoPanner();
      gain.gain.value = 0;
      filter.type = 'lowpass';
      filter.frequency.value = 2200;
      filter.Q.value = 0.5;
      gain.connect(filter).connect(pan).connect(destination);
      const osc: OscillatorNode[] = [],
        bands: GainNode[] = [];
      for (let j = 0; j < 3; j++) {
        const o = context.createOscillator(),
          g = context.createGain();
        g.gain.value = 0;
        o.connect(g).connect(gain);
        osc.push(o);
        bands.push(g);
      }
      this.voices.push({ id: -1, family: null, osc, bands, filter, gain, pan });
    }
    for (const voice of this.voices) {
      this.assign(voice, SOUND_PROFILES['v6-turbo-hybrid']);
      for (const o of voice.osc) o.start();
    }
  }
  /** Harmonic spectrum per band from the family brief (odd/third emphasis, roll-off). */
  private wavesFor(profile: SoundProfile) {
    let waves = this.waves.get(profile.family);
    if (!waves) {
      waves = BAND_MULTIPLIER.map((_, band) => {
        const real = new Float32Array(40),
          imag = new Float32Array(40);
        for (let k = 1; k < 40; k++)
          imag[k] =
            (band === 0
              ? k % 2
                ? 1
                : profile.odd
              : band === 1
                ? k % 3
                  ? profile.third
                  : 1
                : 0.65) /
            k ** (profile.rolloff - band * 0.35);
        return this.context.createPeriodicWave(real, imag);
      });
      this.waves.set(profile.family, waves);
    }
    return waves;
  }
  private assign(voice: Voice, profile: SoundProfile) {
    if (voice.family === profile.family) return;
    const waves = this.wavesFor(profile);
    for (let j = 0; j < 3; j++) voice.osc[j].setPeriodicWave(waves[j]);
    voice.family = profile.family;
  }
  update(frame: Float32Array, view: AudioView, time: number) {
    if (this.disposed) return;
    if (!Number.isFinite(time) || time < 0) throw new Error('Invalid engine audio timestamp');
    this.spatial.update(frame, view);
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i],
        state = this.spatial.voices[i],
        id = state.id;
      if (id < 0) {
        voice.gain.gain.setTargetAtTime(0, time, 0.02);
        voice.id = -1;
        continue;
      }
      const o = carBase(id),
        rpm = frame[o + F.RPM];
      if (!Number.isFinite(rpm + frame[o + F.ENGINE_TORQUE]))
        throw new Error('Invalid engine audio state');
      const character = frameCharacter(frame, id),
        p = character.profile,
        limiter = character.limiterRPM;
      const load = clamp(Math.abs(frame[o + F.ENGINE_TORQUE]) / character.loadTorque, 0, 1);
      const changed = voice.id !== id || voice.family !== p.family,
        at = changed ? time + 0.02 : time;
      if (changed) {
        voice.gain.gain.cancelScheduledValues(time);
        voice.gain.gain.setTargetAtTime(0, time, 0.003);
        this.assign(voice, p);
      }
      // Electric families have no firing order: the voice follows motor speed.
      const electric = p.firingsPerRev === 0,
        road = Math.max(0, frame[o + F.SPEED]);
      for (let band = 0; band < 3; band++) {
        const hz = Math.max(
          50,
          (electric ? road * p.motorHzPerMS * 0.25 : (rpm / 60) * p.firingsPerRev) *
            BAND_MULTIPLIER[band] *
            state.doppler,
        );
        const frequency = voice.osc[band].frequency;
        if (changed) {
          frequency.cancelScheduledValues(at);
          frequency.setValueAtTime(hz, at);
        } else frequency.setTargetAtTime(hz, at, 0.035);
        const weight = electric
          ? band === 1
            ? clamp(road / 40, 0, 1)
            : 0
          : Math.exp(-(((rpm - p.bandCentres[band] * limiter) / (p.bandWidth * limiter)) ** 2)) *
            (band === 0 ? 1 + p.burble * (1 - clamp(rpm / limiter, 0, 1)) : 1);
        const gain = electric ? p.motorGain * 4 : p.bandGain[band];
        voice.bands[band].gain.setTargetAtTime(weight * gain * (0.45 + load * 0.55), at, 0.04);
      }
      voice.gain.gain.setTargetAtTime(state.gain, at, 0.03);
      voice.pan.pan.setTargetAtTime(state.pan, at, 0.025);
      voice.filter.frequency.setTargetAtTime(
        view.interior && id === view.followedCar ? 1500 + load * 2300 : 2500 + load * 4600,
        at,
        0.04,
      );
      voice.id = id;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const voice of this.voices) {
      for (const osc of voice.osc) {
        osc.stop();
        osc.disconnect();
      }
      for (const band of voice.bands) band.disconnect();
      voice.gain.disconnect();
      voice.filter.disconnect();
      voice.pan.disconnect();
    }
    this.voices.length = 0;
  }
}
