import { ReviewAudioTap } from './review-tap.ts';
import {
  CueSynth,
  DrivingCueDirector,
  validateDrivingAudio,
  type DrivingAudioSettings,
} from './driving-cues.ts';
import type { Track } from '../simulation/track.ts';
import { ContactAudio } from './surface-audio.ts';
import { EngineVoices } from './engine-voices.ts';
import { PowerUnitAudio } from './power-unit.ts';
import type { AudioView } from './spatial.ts';
import { H } from '../simulation/protocol.ts';
import { clamp, Random } from '../core/math.ts';

/** The live context owns the master bus, ambient wind/rain, spatial engine graph
 * and player contact graph. Rendering supplies the actual listener pose; no
 * audio output is allowed to modify physics or recorded state. */
export class RacingAudio {
  private context: AudioContext | null = null;
  private reviewTap: ReviewAudioTap | null = null;
  captureOutput() {
    if (!this.context || !this.compressor) throw new Error('Game audio is not initialized');
    this.reviewTap?.release();
    this.reviewTap = new ReviewAudioTap(this.context, this.compressor);
    return this.reviewTap;
  }
  private cueDirector: DrivingCueDirector | null = null;
  private cueSettings = validateDrivingAudio(null);
  private cueSynth: CueSynth | null = null;
  private previewSynth: CueSynth | null = null;
  private lastPreview = -Infinity;
  configureDriving(track: Track, settings: DrivingAudioSettings) {
    if (this.cueDirector?.track !== track) this.cueDirector = new DrivingCueDirector(track);
    this.cueSettings = validateDrivingAudio(settings);
    this.cueDirector.reset();
    this.cueSynth?.silence();
  }
  async previewDriving(settings: DrivingAudioSettings) {
    await this.start();
    const ctx = this.context;
    if (!ctx || !this.previewSynth || this.muted || ctx.currentTime - this.lastPreview < 0.8)
      return;
    this.lastPreview = ctx.currentTime;
    const p = validateDrivingAudio(settings),
      invert = p.invertStereo ? -1 : 1;
    for (const [offset, frequency, pan] of [
      [0, 660, -0.85],
      [0.25, 800, 0],
      [0.5, 660, 0.85],
    ])
      this.previewSynth.play(
        { kind: 'turn', frequency, pan: pan * invert, duration: 0.15 },
        ctx.currentTime + offset,
        p.volume * this.volume * 0.8,
      );
  }
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private engines: EngineVoices | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];
  private wind: GainNode | null = null;
  private rain: GainNode | null = null;
  private contactPan: StereoPannerNode | null = null;
  private contactAudio: ContactAudio | null = null;
  private powerUnit: PowerUnitAudio | null = null;
  private last = -Infinity;
  private wasPlaying = false;
  private contactAttenuation = 0;
  volume = 0.45;
  muted = false;
  async start() {
    if (this.context) {
      await this.context.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;
    this.master.connect(this.compressor).connect(ctx.destination);
    this.engines = new EngineVoices(ctx, this.master);
    this.cueSynth = new CueSynth(ctx, this.master);
    this.previewSynth = new CueSynth(ctx, this.compressor);
    const random = new Random(331),
      buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      previous = 0.83 * previous + 0.17 * (random.next() * 2 - 1);
      data[i] = previous * 2;
    }
    const noise = (type: BiquadFilterType, frequency: number) => {
      const source = ctx.createBufferSource(),
        filter = ctx.createBiquadFilter(),
        gain = ctx.createGain();
      source.buffer = buffer;
      source.loop = true;
      filter.type = type;
      filter.frequency.value = frequency;
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master!);
      source.start();
      this.sources.push(source);
      this.nodes.push(source, filter, gain);
      return gain;
    };
    this.wind = noise('lowpass', 700);
    this.rain = noise('highpass', 1700);
    this.contactPan = ctx.createStereoPanner();
    this.contactPan.connect(this.master);
    this.nodes.push(this.contactPan, this.master, this.compressor);
    this.contactAudio = new ContactAudio(ctx, this.contactPan);
    // Player power-unit character shares the contact bus stereo position.
    this.powerUnit = new PowerUnitAudio(ctx, this.contactPan);
    await ctx.resume();
  }
  update(
    frame: Float32Array,
    cockpit: boolean,
    playing: boolean,
    view: AudioView,
    liveHuman = false,
  ) {
    const ctx = this.context;
    if (!ctx || !this.master || ctx.currentTime - this.last < 0.025) return;
    this.last = ctx.currentTime;
    const time = ctx.currentTime;
    const cue = this.cueDirector?.sample(
      frame,
      playing && liveHuman && !this.muted,
      time,
      this.cueSettings,
    );
    if (cue) this.cueSynth?.play(cue, time, this.cueSettings.volume);
    if (!playing || !liveHuman || this.muted) this.cueSynth?.silence();
    this.master.gain.setTargetAtTime(playing && !this.muted ? this.volume * 0.8 : 0, time, 0.06);
    if (!playing) {
      if (this.wasPlaying) this.resetPresentation();
      this.wasPlaying = false;
      return;
    }
    this.wasPlaying = true;
    this.engines!.update(frame, view, time);
    const player = this.engines!.spatial.player;
    this.contactAttenuation = clamp(player.gain / 0.82, 0, 1);
    this.contactPan!.pan.setTargetAtTime(player.pan, time, 0.025);
    this.contactAudio!.output.gain.setTargetAtTime(0.85 * this.contactAttenuation, time, 0.04);
    this.contactAudio!.update(frame, cockpit, time);
    this.powerUnit!.update(frame, 0, time, this.contactAttenuation, cockpit);
    // Trackside listeners hear ambient wind, not 300 km/h cockpit wind. Rain
    // remains local to the listener even when the player's contact bus is distant.
    const airSpeed = Math.hypot(view.vx - frame[H.WIND_X], view.vy, view.vz - frame[H.WIND_Z]);
    this.wind!.gain.setTargetAtTime(Math.min(0.25, (airSpeed / 100) ** 2 * 0.23), time, 0.04);
    this.rain!.gain.setTargetAtTime(
      clamp(frame[H.RAIN] * 0.0025, 0, 0.12) * (1 - this.contactAttenuation) * 0.85,
      time,
      0.04,
    );
  }
  resetPresentation() {
    this.contactAudio?.reset();
    this.powerUnit?.reset();
  }
  diagnostics() {
    return {
      state: this.context?.state ?? 'uninitialized',
      playing: this.wasPlaying,
      drivingCues: {
        enabled: this.cueSettings.enabled,
        last: this.cueDirector?.lastKind ?? null,
        emitted: this.cueDirector?.emitted ?? 0,
      },
      contactAttenuation: this.contactAttenuation,
      landings: this.contactAudio?.landings ?? 0,
      lastLanding: this.contactAudio?.lastLanding ?? 0,
      powerUnit: this.powerUnit ? { ...this.powerUnit.mix, bursts: this.powerUnit.bursts } : null,
      voices: this.engines?.spatial.voices.map((voice) => ({ ...voice })) ?? [],
    };
  }
  stop() {
    this.cueDirector?.reset();
    this.cueSynth?.silence();
    this.previewSynth?.silence();
    this.master?.gain.setTargetAtTime(0, this.context?.currentTime ?? 0, 0.03);
    this.resetPresentation();
    this.wasPlaying = false;
  }
  async dispose() {
    this.reviewTap?.release();
    this.reviewTap = null;
    this.cueSynth?.dispose();
    this.previewSynth?.dispose();
    this.cueSynth = this.previewSynth = null;
    this.contactAudio?.dispose();
    this.contactAudio = null;
    this.powerUnit?.dispose();
    this.powerUnit = null;
    this.engines?.dispose();
    this.engines = null;
    for (const source of this.sources) source.stop();
    for (const node of this.nodes) node.disconnect();
    this.sources.length = this.nodes.length = 0;
    if (this.context) await this.context.close();
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.wind = this.rain = null;
    this.contactPan = null;
    this.last = -Infinity;
    this.wasPlaying = false;
  }
}
