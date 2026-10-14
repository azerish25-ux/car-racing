import { describe, expect, it } from 'vitest';
import { PitSequence, type PitSequenceSample } from '../e2e/fixtures/pit-sequence.ts';
const sample = (
  time: number,
  phase: number,
  patch: Partial<PitSequenceSample> = {},
): PitSequenceSample => ({
  time,
  car: 0,
  phase,
  clock: Math.max(0, phase - 1),
  speed: phase === 0 ? 8 : 0,
  inPit: phase === 0 ? 0 : 1,
  jackHeight: phase === 3 || phase === 4 ? 0.19 : 0,
  wheelOffsets: Array(4).fill(phase === 3 || phase === 4 ? 0.3 : 0),
  crewActors: phase >= 2 && phase <= 5 ? 15 : 0,
  crews: phase >= 2 && phase <= 5 ? 1 : 0,
  ...patch,
});
const service = () => [0, 1, 2, 3, 4, 5, 6, 0].map((phase, i) => sample(i * 0.5, phase));
describe('recorded pit sequence evidence', () => {
  it('requires all seven ordered transitions with displaced wheels and complete crew', () => {
    const sequence = new PitSequence();
    service().forEach((s) => sequence.observe(s));
    expect(sequence.complete).toBe(true);
    expect(sequence.stages).toEqual([
      'entry',
      'arrival',
      'removal',
      'installation',
      'clearance',
      'release',
      'exit',
    ]);
  });
  it('rejects the failed CI trace pattern: arrival directly to installation', () => {
    const sequence = new PitSequence();
    [sample(0, 0), sample(0.25, 1), sample(0.5, 2)].forEach((s) => sequence.observe(s));
    expect(() => sequence.observe(sample(0.75, 4))).toThrow(/Missed or reordered/);
    expect(sequence.complete).toBe(false);
  });
  it.each([
    { name: 'loaded wheel', patch: { wheelOffsets: [0.3, 0.3, 0, 0.3] } },
    { name: 'lowered jack', patch: { jackHeight: 0.05 } },
    { name: 'moving car', patch: { speed: 1 } },
    { name: 'missing actor', patch: { crewActors: 14 } },
    { name: 'different crew', patch: { crews: 2 } },
  ])('does not qualify removal with $name', ({ patch }) => {
    const sequence = new PitSequence();
    [sample(0, 0), sample(0.25, 1), sample(0.5, 2), sample(0.75, 3, patch)].forEach((s) =>
      sequence.observe(s),
    );
    expect(() => sequence.observe(sample(1, 4))).toThrow(
      /without observed raised four-wheel removal/,
    );
  });
  it('does not qualify missing installation', () => {
    const sequence = new PitSequence();
    service()
      .slice(0, 4)
      .forEach((s) => sequence.observe(s));
    sequence.observe(sample(2, 4, { wheelOffsets: [0, 0, 0, 0] }));
    expect(() => sequence.observe(sample(2.5, 5))).toThrow(
      /without observed raised four-wheel installation/,
    );
  });
  it.each([-0.1, 1.01])('rejects backward playback and gaps of %s seconds', (time) => {
    const sequence = new PitSequence();
    sequence.observe(sample(0, 0));
    expect(() => sequence.observe(sample(time, 1))).toThrow();
  });
  it('held frames never advance the sequence', () => {
    const sequence = new PitSequence();
    sequence.observe(sample(0, 0));
    for (let i = 0; i < 100; i++) sequence.observe(sample(0, 3));
    expect(sequence.stages).toEqual([]);
    expect(sequence.samples).toHaveLength(1);
    expect(sequence.complete).toBe(false);
  });
  it('requires a pre-entry sample and validates identity and finite values', () => {
    for (const s of [
      sample(0, 1),
      sample(0, 0, { car: 1 }),
      sample(0, 0, { clock: NaN }),
      sample(0, 0, { wheelOffsets: [0] }),
    ])
      expect(() => new PitSequence().observe(s)).toThrow();
  });
  it('owns sample bytes and waits for an actual moving exit', () => {
    const sequence = new PitSequence(),
      first = sample(0, 0);
    sequence.observe(first);
    first.wheelOffsets[0] = 100;
    expect(sequence.samples[0].wheelOffsets).toEqual([0, 0, 0, 0]);
    service()
      .slice(1, -1)
      .forEach((s) => sequence.observe(s));
    sequence.observe(sample(3.5, 0, { speed: 0 }));
    expect(sequence.complete).toBe(false);
    sequence.observe(sample(4, 0));
    expect(sequence.complete).toBe(true);
  });
});
