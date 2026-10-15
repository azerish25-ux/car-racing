import { describe, expect, it } from 'vitest';
import { surfaceSample } from '../src/simulation/track.ts';
import { magic, makeTire, peakGrip, solveTire, aquaplaning } from '../src/simulation/tire.ts';
import {
  camberGrip,
  camberShift,
  carcassStiffness,
  combinedForces,
  FORMULA_SLICK,
  prepareSlip,
  pressureGrip,
  relaxationLength,
  relaxSlip,
  slipState,
  type TyreConstruction,
} from '../src/simulation/tyre-force.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';

/** A construction whose slip stiffness scales with μ and does not saturate
 * with load: the former pure-slip law exactly. */
const LINEAR: TyreConstruction = {
  ...FORMULA_SLICK,
  stiffnessLoadExponent: 0,
  frictionStiffnessCoupling: 1,
};
const forces = () => ({ fx: 0, fy: 0 });

describe('combined-slip tyre force law', () => {
  it('reproduces the Magic-Formula pure-slip curves of the former model', () => {
    const state = slipState(),
      out = forces();
    for (const mu of [1.2, 1.84, 2.1])
      for (const load of [900, 2200, 6000]) {
        prepareSlip(LINEAR, load, mu, 1, 1, 1, state);
        for (const kappa of [-0.6, -0.1, 0.02, 0.15, 0.4]) {
          state.alpha = 0;
          combinedForces(state, kappa, out);
          expect(out.fx).toBeCloseTo(mu * load * magic(kappa, 10.5, 1.3), 6);
        }
        for (const alpha of [-0.5, -0.05, 0.01, 0.2]) {
          state.alpha = alpha;
          combinedForces(state, 0, out);
          expect(out.fy).toBeCloseTo(-mu * load * magic(alpha, 7.2, 1.28), 6);
        }
      }
  });
  it('keeps every combined force inside the friction ellipse', () => {
    const state = slipState(),
      out = forces();
    prepareSlip(FORMULA_SLICK, 3000, 1.8, 1, 1, 1, state);
    for (let kappa = -1; kappa <= 1; kappa += 0.05)
      for (let alpha = -0.8; alpha <= 0.8; alpha += 0.04) {
        state.alpha = alpha;
        combinedForces(state, kappa, out);
        expect((out.fx / state.dx) ** 2 + (out.fy / state.dy) ** 2).toBeLessThanOrEqual(1 + 1e-12);
      }
  });
  it('trades lateral force for longitudinal slip (and the reverse) monotonically', () => {
    const state = slipState(),
      out = forces();
    prepareSlip(FORMULA_SLICK, 3000, 1.8, 1, 1, 1, state);
    state.alpha = 0.12;
    let previous = Infinity;
    for (const kappa of [0, 0.03, 0.08, 0.15, 0.3, 0.6]) {
      combinedForces(state, kappa, out);
      expect(Math.abs(out.fy)).toBeLessThan(previous + 1e-9);
      previous = Math.abs(out.fy);
    }
    state.alpha = 0;
    combinedForces(state, 0.12, out);
    const pure = out.fx;
    state.alpha = 0.2;
    combinedForces(state, 0.12, out);
    expect(out.fx).toBeLessThan(pure * 0.8);
  });
  it('takes the cornering force of a spinning or locked tyre, a modest share at small slip', () => {
    const state = slipState(),
      out = forces();
    prepareSlip(FORMULA_SLICK, 3000, 1.8, 1, 1, 1, state);
    state.alpha = 0.08;
    combinedForces(state, 0, out);
    const pure = Math.abs(out.fy);
    combinedForces(state, 0.3 * state.kappaRef, out);
    expect(Math.abs(out.fy)).toBeGreaterThan(0.9 * pure);
    expect(Math.abs(out.fy)).toBeLessThan(pure);
    // Wheelspin at κ = 5 and a locked wheel (κ = −1) slide almost along the
    // rolling direction, so little lateral force remains.
    for (const [kappa, share] of [
      [5, 0.15],
      [-1, 0.4],
    ] as const) {
      combinedForces(state, kappa, out);
      expect(Math.abs(out.fy)).toBeLessThan(share * pure);
    }
    // Symmetric in the sign of either slip.
    combinedForces(state, -0.1, out);
    const braking = out.fy;
    combinedForces(state, 0.1, out);
    expect(out.fy).toBeCloseTo(braking, 6);
  });
  it('has load-sensitive friction and sub-linear, saturating slip stiffness', () => {
    const a = slipState(),
      b = slipState();
    prepareSlip(FORMULA_SLICK, 2200, 1.8, 1, 1, 1, a);
    prepareSlip(FORMULA_SLICK, 4400, 1.8, 1, 1, 1, b);
    expect(b.corneringStiffness).toBeLessThan(2 * a.corneringStiffness);
    expect(b.corneringStiffness).toBeGreaterThan(a.corneringStiffness);
    // The peak slip angle grows with load (brush/MF behaviour).
    expect(b.alphaRef).toBeGreaterThan(a.alphaRef);
    const t = makeTire('medium'),
      s = surfaceSample();
    expect(peakGrip(t, 6000, s, 40)).toBeLessThan(peakGrip(t, 2000, s, 40));
  });
  it('reaches a smaller peak slip on low-friction ground, as a brush tyre does', () => {
    const dry = slipState(),
      ice = slipState();
    prepareSlip(FORMULA_SLICK, 3000, 1.8, 1, 1, 1, dry);
    prepareSlip(FORMULA_SLICK, 3000, 0.2, 1, 1, 1, ice);
    expect(ice.alphaRef).toBeLessThan(dry.alphaRef * 0.5);
    expect(ice.kappaRef).toBeLessThan(dry.kappaRef * 0.5);
  });
  it('makes camber thrust toward the inclination only while rolling, saturating with slip', () => {
    const state = slipState(),
      out = forces();
    prepareSlip(FORMULA_SLICK, 3000, 1.8, 1, 1, 1, state);
    expect(camberShift(FORMULA_SLICK, 3000, state, 0.04, 0)).toBe(0);
    state.alpha = -camberShift(FORMULA_SLICK, 3000, state, 0.04, 30);
    combinedForces(state, 0, out);
    expect(out.fy).toBeCloseTo(FORMULA_SLICK.camberStiffness * 3000 * 0.04, -1);
    // At the friction limit the camber thrust cannot add beyond the ellipse.
    state.alpha = -0.6 - camberShift(FORMULA_SLICK, 3000, state, -0.04, 30);
    combinedForces(state, 0, out);
    expect(Math.abs(out.fy)).toBeLessThanOrEqual(state.dy);
  });
  it('has a contact-patch camber optimum that leans into the lateral force', () => {
    const into = camberGrip(FORMULA_SLICK, FORMULA_SLICK.camberOptimum, -1);
    expect(into).toBeCloseTo(1, 2);
    expect(camberGrip(FORMULA_SLICK, -FORMULA_SLICK.camberOptimum, -1)).toBeLessThan(into);
    expect(camberGrip(FORMULA_SLICK, 0, 0)).toBe(1);
    expect(camberGrip(FORMULA_SLICK, 0.05, 0)).toBeLessThan(1);
  });
  it('applies pressure to the contact patch, slip stiffness and relaxation', () => {
    const k = FORMULA_SLICK;
    expect(pressureGrip(k, k.pressureOptimum)).toBe(1);
    expect(pressureGrip(k, k.pressureOptimum + 40)).toBeLessThan(1);
    expect(pressureGrip(k, k.pressureOptimum - 40)).toBeLessThan(1);
    expect(carcassStiffness(k, 190, 0, 92, 92)).toBeGreaterThan(
      carcassStiffness(k, 140, 0, 92, 92),
    );
    expect(relaxationLength(k, 2200, 190, 0, 40)).toBeLessThan(
      relaxationLength(k, 2200, 140, 0, 40),
    );
  });
  it('loses grip and gains stiffness with wear', () => {
    const fresh = makeTire('soft'),
      worn = makeTire('soft'),
      s = surfaceSample();
    worn.wear = 0.6;
    expect(peakGrip(worn, 2500, s, 50)).toBeLessThan(peakGrip(fresh, 2500, s, 50) * 0.75);
    expect(carcassStiffness(FORMULA_SLICK, 160, 0.6, 92, 92)).toBeGreaterThan(
      carcassStiffness(FORMULA_SLICK, 160, 0, 92, 92),
    );
  });
});

describe('transient slip (relaxation length)', () => {
  it('integrates the lag exactly and never overshoots at any step', () => {
    for (const dt of [1 / 960, 1 / 240, 1 / 60, 0.5]) {
      let alpha = 0;
      for (let i = 0; i < 50; i++) {
        alpha = relaxSlip(alpha, 0.1, 40, 0.3, dt);
        expect(alpha).toBeLessThanOrEqual(0.1);
        expect(alpha).toBeGreaterThanOrEqual(0);
      }
    }
    // After rolling one relaxation length the deflection reaches 1 - 1/e.
    expect(relaxSlip(0, 1, 30, 0.3, 0.01)).toBeCloseTo(1 - Math.exp(-1), 12);
  });
  it('builds lateral force over distance in the production tyre and is instant at walking pace', () => {
    const fast = makeTire('medium'),
      s = surfaceSample();
    fast.omega = 40 / fast.radius;
    solveTire(fast, 40, 4, 3000, 0, 0, s, 0, 1 / 240);
    const first = Math.abs(fast.fy);
    for (let i = 0; i < 60; i++) solveTire(fast, 40, 4, 3000, 0, 0, s, 0, 1 / 240);
    expect(first).toBeLessThan(Math.abs(fast.fy) * 0.7);
    expect(fast.relaxedAngle).toBeCloseTo(fast.angle, 6);
    const slow = makeTire('medium');
    solveTire(slow, 1, 0.1, 3000, 0, 0, s, 0, 1 / 240);
    expect(slow.relaxedAngle).toBe(slow.angle);
  });
});

describe('surface-aware contact', () => {
  it('needs more slip on loose gravel and keeps its ploughing force at large slip', () => {
    const asphalt = slipState(),
      gravel = slipState(),
      out = forces();
    prepareSlip(FORMULA_SLICK, 3000, 0.75, 1, 1, 1, asphalt);
    prepareSlip(FORMULA_SLICK, 3000, 0.75, 1, 0.45, 0, gravel);
    expect(gravel.alphaRef).toBeGreaterThan(asphalt.alphaRef * 1.5);
    gravel.alpha = asphalt.alpha = 0.9;
    combinedForces(gravel, 0, out);
    const gravelSlide = Math.abs(out.fy) / gravel.dy;
    combinedForces(asphalt, 0, out);
    expect(gravelSlide).toBeGreaterThan(Math.abs(out.fy) / asphalt.dy);
  });
  it('sinks into gravel, adds compaction rolling resistance and bulldozing drag', () => {
    const t = makeTire('medium'),
      s = surfaceSample();
    s.surface = MATERIAL.GRAVEL;
    s.grip = 0.4;
    s.resistance = 0.115;
    t.omega = 30 / t.radius;
    for (let i = 0; i < 240; i++) solveTire(t, 30, 0, 2500, 0, 0, s, 0, 1 / 240);
    expect(t.sinkage).toBeGreaterThan(0.01);
    expect(t.rolling).toBeGreaterThan(0.12);
    expect(t.groundDrag).toBeGreaterThan(50);
  });
  it('aquaplanes earlier on worn grooved tyres, later at higher pressure, earlier on paint', () => {
    const base = aquaplaning('intermediate', 3000, 3, 60);
    expect(aquaplaning('intermediate', 3000, 3, 60, 0.8)).toBeGreaterThan(base);
    expect(aquaplaning('intermediate', 3000, 3, 60, 0, 190)).toBeLessThan(base);
    expect(aquaplaning('intermediate', 3000, 3, 60, 0, 160, 0.25)).toBeGreaterThan(base);
    // Slicks have no grooves: wear does not change their drainage.
    expect(aquaplaning('soft', 3000, 1, 60, 0.8)).toBe(aquaplaning('soft', 3000, 1, 60, 0));
  });
});
