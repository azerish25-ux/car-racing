import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { controls } from '../src/simulation/config.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { HorizonGuidance } from '../src/rendering/open-world/horizon-guidance.ts';

/** Prevent a browser review from waiting for an impossible race card at a
 * drive-through activity. Uses real travel and simulation input, not pose edits. */
describe('Solvane R2 event-entry review contracts', () => {
  it('opens a Coast to Summit race card and provides real wet corner advice after Start', () => {
    const sim = new OpenWorldSimulation({
      vehicle: 'tc1',
      discovered: ['coast-to-summit'],
      weather: 'rain',
    });
    sim.command({ type: 'travel', event: 'coast-to-summit' });
    for (let i = 0; i < 240; i++) sim.step(1 / 120);
    expect(sim.status().card?.id).toBe('coast-to-summit');
    expect(sim.status().mode).toBe('card');
    sim.command({ type: 'start', event: 'coast-to-summit' });
    expect(sim.status().mode).toBe('countdown');
    const event = sim.events.find((e) => e.spec.id === 'coast-to-summit')!;
    const p = sim.player.body.position;
    const guidance = new HorizonGuidance();
    guidance.update(
      event,
      event.marker,
      new T.Vector3(p.x, p.y, p.z),
      sim.player.speed,
      () => p.y,
      0.7,
    );
    expect(guidance.cue).not.toBeNull();
    expect(guidance.cue?.wet).toBe(true);
    expect(guidance.cue?.distance).toBeGreaterThan(0);
    expect(guidance.cue?.direction).toBe('right');
    guidance.dispose();
  });
  it('does not open a race card for Kestrel drift and starts it from real throttle input', () => {
    const sim = new OpenWorldSimulation({
      vehicle: 'tc1',
      discovered: ['kestrel-drift'],
      weather: 'rain',
    });
    sim.command({ type: 'travel', event: 'kestrel-drift' });
    for (let i = 0; i < 240; i++) sim.step(1 / 120);
    expect(sim.status().mode).toBe('free');
    expect(sim.status().card).toBeNull();
    const start = { ...sim.player.body.position };
    sim.setInput({ ...controls(), throttle: 0.8 });
    for (let i = 0; i < 480 && sim.status().mode === 'free'; i++) sim.step(1 / 120);
    expect(sim.status().mode).toBe('running');
    expect(sim.status().event?.id).toBe('kestrel-drift');
    expect(sim.status().autopilot).toBe(false);
    expect(
      Math.hypot(sim.player.body.position.x - start.x, sim.player.body.position.z - start.z),
    ).toBeGreaterThan(1);
    sim.setInput({ ...controls(), brake: 1 });
    for (let i = 0; i < 480 && sim.player.speed > 0.2; i++) sim.step(1 / 120);
    expect(sim.player.speed).toBeLessThan(0.2);
    expect(sim.status().mode).toBe('running');
    sim.command({ type: 'cancel' });
    expect(sim.status().mode).toBe('free');
    expect(sim.status().event).toBeNull();
  });
});
