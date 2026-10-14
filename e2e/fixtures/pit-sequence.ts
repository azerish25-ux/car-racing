/** Read-only observations from the renderer's presented pit state. This is a
 * functional replay sequence, never a live frame-rate or artwork acceptance. */
export interface PitSequenceSample {
  time: number;
  car: number;
  phase: number;
  clock: number;
  speed: number;
  inPit: number;
  jackHeight: number;
  wheelOffsets: number[];
  crewActors: number;
  crews: number;
}
export class PitSequence {
  readonly samples: PitSequenceSample[] = [];
  readonly stages: string[] = [];
  private phase = 0;
  private removal = false;
  private installation = false;
  complete = false;
  observe(sample: PitSequenceSample) {
    if (this.complete) throw new Error('Pit sequence already complete');
    if (
      ![sample.time, sample.clock, sample.speed, sample.jackHeight, ...sample.wheelOffsets].every(
        Number.isFinite,
      ) ||
      !Number.isInteger(sample.phase) ||
      sample.phase < 0 ||
      sample.phase > 6 ||
      sample.car !== 0 ||
      ![0, 1].includes(sample.inPit) ||
      sample.wheelOffsets.length !== 4 ||
      sample.time < 0 ||
      sample.clock < 0 ||
      sample.speed < 0 ||
      sample.jackHeight < 0 ||
      !Number.isInteger(sample.crewActors) ||
      sample.crewActors < 0 ||
      !Number.isInteger(sample.crews) ||
      sample.crews < 0
    )
      throw new Error('Invalid presented pit sample');
    const previous = this.samples.at(-1);
    if (previous && sample.time === previous.time) return;
    if (previous && (sample.time < previous.time || sample.time - previous.time > 1))
      throw new Error(`Non-contiguous presented replay: ${previous.time} -> ${sample.time}`);
    if (!previous && (sample.phase !== 0 || sample.inPit !== 0))
      throw new Error('Replay must begin before pit entry');
    if (this.samples.length >= 2048) throw new Error('Pit observation capacity reached');
    this.samples.push({ ...sample, wheelOffsets: [...sample.wheelOffsets] });
    if (sample.phase !== this.phase) {
      if (sample.phase !== this.phase + 1 && !(this.phase === 6 && sample.phase === 0))
        throw new Error(
          `Missed or reordered presented pit phase: ${this.phase} -> ${sample.phase}`,
        );
      if (sample.phase === 4 && !this.removal)
        throw new Error('Installation started without observed raised four-wheel removal');
      if (sample.phase === 5 && !this.installation)
        throw new Error('Clearance started without observed raised four-wheel installation');
      this.phase = sample.phase;
      this.stages.push(
        ['exit', 'entry', 'arrival', 'removal', 'installation', 'clearance', 'release'][
          sample.phase
        ],
      );
    }
    if (sample.phase > 0 && sample.inPit !== 1) throw new Error('Service phase outside pit lane');
    const raisedService =
      sample.speed < 0.35 &&
      sample.jackHeight > 0.1 &&
      sample.crews === 1 &&
      sample.crewActors === 15 &&
      sample.wheelOffsets.every((offset) => offset > 0);
    // The displayed wheel offset is zero for a loaded hub. Requiring all four
    // displaced wheels also checks actual removal, not merely an unloaded count.
    if (sample.phase === 3 && raisedService) this.removal = true;
    if (sample.phase === 4 && raisedService) this.installation = true;
    if (this.stages.at(-1) === 'exit' && sample.inPit === 0 && sample.speed > 5)
      this.complete = true;
  }
}
