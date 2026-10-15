import { clamp } from '../core/math.ts';
import { AIDriver } from '../simulation/ai.ts';
import { controls as neutralControls, type Compound, type Controls } from '../simulation/config.ts';
import type { AuthoritativeWorld } from './authority.ts';
import { NetRandom } from './event-loop.ts';

export type PilotProfile = 'smooth' | 'humanized';

/** Test driver for headless online sessions. It runs its own AIDriver
 * against the authoritative car at the moment its client samples input and
 * returns the resulting controls without leaving any trace in the world:
 * every car field the AI writes is restored. The commands then cross the
 * simulated network like a human's, so the server applies them one input
 * lead (≈ RTT + margin) later; the bot therefore drives with more control
 * latency than a predicting human, never less. The harness privilege of
 * reading authoritative state is used only to generate plausible inputs; the
 * client code under test never sees it. A leak would break journal replay,
 * which the verified-record check in every slice run would expose. */
export class ShadowPilot {
  private readonly ai: AIDriver;
  private readonly random: NetRandom;
  private noise = 0;
  private lift = 0;
  private pitCooldown = 0;
  constructor(
    private readonly world: AuthoritativeWorld,
    readonly car: number,
    readonly profile: PilotProfile = 'smooth',
    seed = 1,
  ) {
    const own = world.drivers[car];
    this.ai = new AIDriver(own.car, own.skill, world.sim.options.seed);
    this.random = new NetRandom(seed * 7919 + car * 104729 + 1);
  }
  sample(dt: number): Controls {
    const sim = this.world.sim,
      c = sim.cars[this.car];
    const saved = {
      input: { ...c.input },
      drsRequest: c.drsRequest,
      pitYielding: c.pitYielding,
      aiTarget: c.aiTarget,
      aiOffset: c.aiOffset,
      pitPhase: c.pitPhase,
      pitRequested: c.pitRequested,
      nextCompound: c.nextCompound as Compound,
      overtakeClock: c.overtakeClock,
    };
    c.drsRequest = false;
    this.ai.update(dt, sim.track, sim.cars, sim.race);
    const out: Controls = {
      ...neutralControls(),
      throttle: c.input.throttle,
      brake: c.input.brake,
      clutch: c.input.clutch,
      manualClutch: c.input.manualClutch,
      steer: c.input.steer,
      shift: c.input.shift,
      ers: c.input.ers,
      reverse: c.input.reverse,
      drs: c.drsRequest,
      overtake: false,
      // The AI's own strategy asked for a stop: send it as a pit command once.
      pit: !saved.pitRequested && c.pitRequested && this.pitCooldown <= 0,
    };
    Object.assign(c.input, saved.input);
    c.drsRequest = saved.drsRequest;
    c.pitYielding = saved.pitYielding;
    c.aiTarget = saved.aiTarget;
    c.aiOffset = saved.aiOffset;
    c.pitPhase = saved.pitPhase;
    c.pitRequested = saved.pitRequested;
    c.nextCompound = saved.nextCompound;
    c.overtakeClock = saved.overtakeClock;
    this.pitCooldown = out.pit ? 3 : Math.max(0, this.pitCooldown - dt);
    if (this.profile === 'humanized') this.humanize(out, dt);
    return out;
  }
  /** Band-limited steering noise and occasional throttle lifts, so the
   * input stream has the abrupt, unpredictable changes a person makes. */
  private humanize(out: Controls, dt: number) {
    const r = this.random,
      decay = Math.exp(-dt / 0.5);
    this.noise = this.noise * decay + r.gaussian() * 0.05 * Math.sqrt(1 - decay * decay);
    out.steer = clamp(out.steer + this.noise, -1, 1);
    if (this.lift > 0) {
      this.lift -= dt;
      out.throttle *= 0.55;
    } else if (out.throttle > 0.9 && r.next() < 0.25 * dt) this.lift = 0.15 + r.next() * 0.25;
  }
}
