import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { describe, expect, it } from 'vitest';
import { RadioArbiter, URGENCY, type RadioMessage } from '../src/core/radio.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { SC_PHASE } from '../src/simulation/safety-car.ts';

const message = (
  key: string,
  urgency: number,
  now: number,
  speaker: RadioMessage['speaker'] = 'ENGINEER',
): RadioMessage => ({
  key,
  speaker,
  text: key,
  urgency,
  expires: now + 5,
  hold: 2,
});
const frame = (time: number) => {
  const f = new Float32Array(HEADER + CAR_STRIDE);
  f[H.CARS] = 1;
  f[H.TIME] = time;
  f[H.LENGTH] = 3000;
  f[carBase(0) + F.FUEL] = 50;
  return f;
};
describe('§20.4 radio arbitration', () => {
  it('race control interrupts the engineer and stale messages are dropped', () => {
    const radio = new RadioArbiter();
    radio.post(message('tip', URGENCY.INFO, 0), 0);
    expect(radio.update(0)?.key).toBe('tip');
    radio.post(message('sc', URGENCY.RACE_CONTROL, 0.5, 'RACE CONTROL'), 0.5);
    expect(radio.update(0.5)?.speaker).toBe('RACE CONTROL');
    radio.post(message('late', URGENCY.STRATEGY, 1), 1);
    // Never read out after its relevance window has passed.
    expect(radio.update(20)).toBeNull();
  });
  it('rate-limits repeated keys and can mute engineer chatter only', () => {
    const quiet = new RadioArbiter({ engineer: false });
    quiet.post(message('tip', URGENCY.INFO, 0), 0);
    expect(quiet.update(0)).toBeNull();
    quiet.post(message('flag', URGENCY.RACE_CONTROL, 0, 'RACE CONTROL'), 0);
    expect(quiet.update(0)?.key).toBe('flag');
    const radio = new RadioArbiter();
    radio.post(message('x', URGENCY.INFO, 0), 0);
    radio.update(0);
    radio.update(3);
    radio.post(message('x', URGENCY.INFO, 4), 4);
    expect(radio.update(4)).toBeNull();
  });
  it('derives explained, captioned race-control messages from snapshots', () => {
    const radio = new RadioArbiter();
    radio.observe(frame(10), 5);
    const sc = frame(10.1);
    sc[H.SC_PHASE] = SC_PHASE.DEPLOYED;
    expect(radio.observe(sc, 5)?.text).toMatch(/Safety car deployed/);
    const penalty = frame(30);
    penalty[carBase(0) + F.PENALTY] = 5;
    penalty[carBase(0) + F.CONTROL_PENALTIES] = 1;
    radio.observe(frame(29.9), 5);
    const shown = radio.observe(penalty, 5);
    expect(shown?.speaker).toBe('RACE CONTROL');
    expect(shown?.text).toMatch(/\+5 s.*avoid more/);
  });
});

describe('§21.5 communication and motion accessibility settings', () => {
  it('defaults captions and engineer radio on, reduced motion off, and keeps older saves valid', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      captions: true,
      engineerRadio: true,
      reducedMotion: false,
    });
    const old = validateSettings({ version: 6 });
    expect(old).toMatchObject({ captions: true, engineerRadio: true, reducedMotion: false });
    expect(validateSettings({ version: 6, captions: false, reducedMotion: true })).toMatchObject({
      captions: false,
      reducedMotion: true,
    });
  });
});
