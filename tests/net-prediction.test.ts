import { describe, expect, it } from 'vitest';
import { controls, type Controls } from '../src/simulation/config.ts';
import { COLLISION_AUTHORITY } from '../src/net/constants.ts';
import { RemoteCarTrack, ServerClock, JitterBuffer } from '../src/net/interpolation.ts';
import { LocalCarPredictor, poseDistance } from '../src/net/prediction.ts';
import { runOnlineSlice } from '../src/net/slice.ts';
import { CAR_FLAG, emptyCarState, type CarNetState } from '../src/net/snapshot.ts';
import { TARGET_LINK } from '../src/net/transport.ts';

const DT = 1 / 120;
/** Analytic car on a circle: speed v, yaw rate w (left turn), from heading 0 (+Z). */
function circle(tick: number, v = 60, w = 0.4, flags: number = CAR_FLAG.FULL): CarNetState {
  const t = tick * DT,
    yaw = w * t,
    r = v / w;
  return {
    ...emptyCarState(0),
    flags,
    // Heading +Z rotated by yaw about +Y: forward = (sin yaw, 0, cos yaw).
    x: r * (1 - Math.cos(yaw)),
    y: 0,
    z: r * Math.sin(yaw),
    qx: 0,
    qy: Math.sin(yaw / 2),
    qz: 0,
    qw: Math.cos(yaw / 2),
    vx: v * Math.sin(yaw),
    vy: 0,
    vz: v * Math.cos(yaw),
    wy: w,
    ax: v * w * Math.cos(yaw),
    ay: 0,
    az: -v * w * Math.sin(yaw),
  };
}
const steady: (t: number) => Controls = () => ({ ...controls(), throttle: 0.6, steer: 0.1 });

describe('local-car prediction and smoothing (WP50)', () => {
  it('predicts a constant turn 150 ms ahead to millimetres', () => {
    const p = new LocalCarPredictor();
    for (let tick = 0; tick <= 600; tick += 6)
      p.reconcile(circle(tick), tick, steady, tick + 18, tick * 8.33);
    const errors = p.stats.positionError;
    expect(errors.length).toBeGreaterThan(90);
    expect(Math.max(...errors.slice(5))).toBeLessThan(0.01);
    expect(p.stats.snaps).toBe(0);
  });
  it('blends a correction away over ~100 ms and snaps large ones', () => {
    const p = new LocalCarPredictor();
    p.reconcile(circle(0), 0, steady, 12, 0);
    p.render(0);
    p.render(50);
    // The authority says the car is 1 m to the side of where we predicted.
    const moved = { ...circle(6), x: circle(6).x + 1 };
    p.reconcile(moved, 6, steady, 18, 50);
    const before = poseDistance(p.render(50), p.predictedAt(18) ?? circle(18));
    expect(before).toBeGreaterThan(0.9);
    const after = poseDistance(p.render(150), p.predictedAt(18) ?? circle(18));
    expect(after / before).toBeLessThan(0.4);
    expect(after / before).toBeGreaterThan(0.3);
    // Frame-to-frame visual motion stays small while blending.
    expect(Math.max(...p.stats.visualStep)).toBeLessThan(0.7);
    const far = { ...circle(12), z: circle(12).z + 20 };
    p.reconcile(far, 12, steady, 24, 200);
    expect(p.stats.snaps).toBe(1);
    expect(poseDistance(p.render(201), p.predictedAt(24) ?? far)).toBeLessThan(1e-9);
  });
  it("contacts are the server's: a CONTACT flag only makes the blend faster", () => {
    const run = (flags: number) => {
      const p = new LocalCarPredictor();
      p.reconcile(circle(0), 0, steady, 12, 0);
      p.render(0);
      p.reconcile({ ...circle(6), flags, x: circle(6).x + 1 }, 6, steady, 18, 50);
      p.render(50);
      return poseDistance(p.render(100), p.predictedAt(18) ?? circle(18));
    };
    const normal = run(CAR_FLAG.FULL),
      contact = run(CAR_FLAG.FULL | CAR_FLAG.CONTACT);
    expect(normal).toBeCloseTo(Math.exp(-0.05 / COLLISION_AUTHORITY.smoothingSeconds), 2);
    expect(contact).toBeCloseTo(Math.exp(-0.05 / COLLISION_AUTHORITY.contactSmoothingSeconds), 2);
    expect(COLLISION_AUTHORITY).toMatchObject({
      resolver: 'server',
      clientPredictsContacts: false,
    });
  });
  it('learns the input response so a brake application is predicted before it shows', () => {
    // Synthetic car: acceleration follows the pedals 6 ticks later (40 ms
    // response); 1.5 s on the throttle (+13.3 m/s²), 0.5 s braking (−40).
    const brakeAt = (tick: number) => (((tick % 240) + 240) % 240 >= 180 ? 1 : 0);
    const input = (tick: number): Controls => ({
      ...controls(),
      throttle: 1 - brakeAt(tick),
      brake: brakeAt(tick),
    });
    const states: CarNetState[] = [];
    let z = 0,
      v = 40,
      a = 0;
    for (let tick = 0; tick <= 2400; tick++) {
      const target = brakeAt(tick - 6) ? -40 : 13.33;
      a += (target - a) * Math.min(1, DT / 0.04);
      z += (v + 0.5 * a * DT) * DT;
      v += a * DT;
      states.push({
        ...emptyCarState(0),
        flags: CAR_FLAG.FULL,
        z,
        vz: v,
        az: a,
        throttle: 1 - brakeAt(tick),
        brake: brakeAt(tick),
      });
    }
    const aware = new LocalCarPredictor(),
      blind = new LocalCarPredictor({ responseLagTicks: 6 });
    // The blind predictor never learns (no inputs known to it).
    for (let tick = 6; tick + 18 <= 2400; tick += 6) {
      aware.reconcile(states[tick], tick, input, tick + 18, tick * 8.33);
      blind.reconcile(states[tick], tick, () => undefined, tick + 18, tick * 8.33);
    }
    expect(aware.model.observations).toBeGreaterThan(300);
    const tail = (xs: number[]) => xs.slice(Math.floor(xs.length / 2));
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(tail(aware.stats.positionError))).toBeLessThan(
      mean(tail(blind.stats.positionError)) * 0.7,
    );
  });
});

describe('remote interpolation and jitter buffer (WP50)', () => {
  it('interpolates with Hermite tangents, buffers before data, extrapolates then holds', () => {
    const track = new RemoteCarTrack();
    for (let tick = 6; tick <= 60; tick += 6) track.push(tick, circle(tick, 70, 0.3, 0));
    expect(track.push(30, circle(30, 70, 0.3, 0))).toBe(false);
    expect(track.sample(3)).toBeNull();
    let worst = 0;
    for (let t = 6; t <= 60; t += 0.5) {
      const s = track.sample(t);
      expect(s?.kind).toBe('interpolated');
      worst = Math.max(worst, poseDistance(s!.pose, circle(t, 70, 0.3, 0)));
    }
    expect(worst).toBeLessThan(0.005);
    expect(track.sample(66)?.kind).toBe('extrapolated');
    expect(track.sample(80)?.kind).toBe('held');
    // A lost snapshot is bridged: interpolation across a 12-tick gap.
    const gappy = new RemoteCarTrack();
    for (const tick of [6, 12, 24, 30]) gappy.push(tick, circle(tick, 70, 0.3, 0));
    expect(poseDistance(gappy.sample(18)!.pose, circle(18, 70, 0.3, 0))).toBeLessThan(0.05);
  });
  it('estimates arrival jitter and grows the interpolation delay with it', () => {
    const calm = new ServerClock(),
      rough = new ServerClock(),
      calmBuffer = new JitterBuffer(),
      roughBuffer = new JitterBuffer();
    for (let i = 0; i < 400; i++) {
      calm.observe(i * 6, i * 50 + 50);
      rough.observe(i * 6, i * 50 + 50 + ((i * 7919) % 13) * 3);
      calmBuffer.update(calm);
      roughBuffer.update(rough);
    }
    expect(calm.jitterTicks).toBeLessThan(0.01);
    expect(rough.jitterTicks).toBeGreaterThan(1);
    expect(calmBuffer.delayTicks).toBeCloseTo(12, 1);
    expect(roughBuffer.delayTicks).toBeGreaterThan(14);
    expect(calm.arrivalTick(1000)).toBeCloseTo(114, 5);
  });
});

describe('online race under 100 ms RTT and 2% loss (WP50 measurement)', () => {
  it('measures prediction corrections, interpolation error and input delivery', () => {
    const { report } = runOnlineSlice({
      clients: 4,
      seed: 404,
      raceSeconds: 10,
      link: TARGET_LINK,
      verify: false,
    });
    const p = report.prediction,
      i = report.interpolation;
    console.log(
      'online slice (4 clients, 10 s racing, 100 ms RTT, 2% loss):',
      JSON.stringify({
        rttMs: report.network.rttMs.mean,
        clean: p.positionErrorCleanM,
        correction: p.correctionM,
        headingDeg: p.headingErrorDeg.p95,
        remote: i.positionErrorM,
        downKbit: report.bandwidth.perClientDownWireKbit.mean,
        upKbit: report.bandwidth.perClientUpWireKbit.mean,
        missingTicks: report.inputs.missingTicks,
      }),
    );
    expect(report.network.rttMs.mean).toBeGreaterThan(95);
    expect(report.network.rttMs.mean).toBeLessThan(110);
    const lossRate =
      (report.network.upDropped + report.network.downDropped) /
      (report.inputs.packetsSent +
        report.network.snapshotsLost +
        report.inputs.packetsSent * 0 +
        1);
    expect(lossRate).toBeGreaterThan(0.005);
    expect(report.network.snapshotsLost).toBeGreaterThan(0);
    // Corrections the player would see without smoothing.
    expect(p.positionErrorCleanM.samples).toBeGreaterThan(500);
    expect(p.positionErrorCleanM.p95).toBeLessThan(0.3);
    expect(p.correctionM.p95).toBeLessThan(0.3);
    expect(p.correctionM.max).toBeLessThan(3);
    expect(p.snaps).toBe(0);
    expect(p.visualStepM.p95).toBeLessThan(0.05);
    // Remote cars, ~120 ms in the past, against server ground truth.
    expect(i.delayMs.mean).toBeGreaterThan(100);
    expect(i.delayMs.mean).toBeLessThan(140);
    expect(i.positionErrorM.p95).toBeLessThan(0.05);
    // Redundant commands: almost every tick is supplied by the driver.
    expect(report.inputs.missingTicks).toBeLessThan(report.inputs.appliedTicks * 0.005);
    expect(report.inputs.copiesPerCommand).toBeGreaterThan(3);
    expect(report.bandwidth.perClientDownWireKbit.mean).toBeLessThan(45);
  });
});
