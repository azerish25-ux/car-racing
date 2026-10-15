import sys
root = sys.argv[1]
def patch(path, pairs):
    s = open(path).read()
    for a, b in pairs:
        assert a in s, (path, a[:90])
        s = s.replace(a, b)
    open(path, 'w').write(s)

patch(root + '/src/simulation/differential.ts', [
(""" *   torsen   L = clamp(β·L_stick, ±|T|·(TBR−1)/(TBR+1))     (torque bias ratio)
 * where L_stick is the locking torque that would cancel the output speed
 * difference Δω = ω_second − ω_first within this step (including the split's
 * own relative acceleration), and β < 1 under-relaxes it against the
 * explicitly coupled tyre torques so a locked or stuck clutch pack is stable
 * at any timestep instead of chattering. */""",
""" *   torsen   L = clamp(β·L_stick, ±½|T|·(TBR−1)/(TBR+1))    (torque bias ratio)
 * where L_stick is the locking torque that would cancel the output speed
 * difference Δω = ω_second − ω_first within this step, including the split's
 * own relative acceleration and a prediction of the road reaction torques on
 * each output (their previous-step values, since the tyres are solved after
 * the differential), and β < 1 under-relaxes it so a locked or stuck clutch
 * pack is stable at any timestep instead of chattering. */"""),
("""  dt: number,
  out: DifferentialOutput,
) {
  if (![input, omegaFirst, omegaSecond, dt].every(Number.isFinite) || dt <= 0)
    throw new Error('Invalid differential state');""",
"""  dt: number,
  out: DifferentialOutput,
  /** Predicted road reaction torques on each output (N m, previous step). */
  reactionFirst = 0,
  reactionSecond = 0,
) {
  if (![input, omegaFirst, omegaSecond, dt, reactionFirst, reactionSecond].every(Number.isFinite) || dt <= 0)
    throw new Error('Invalid differential state');"""),
("""      drift = ((1 - s) * input) / inertiaSecond - (s * input) / inertiaFirst,""",
"""      drift =
        ((1 - s) * input + reactionSecond) / inertiaSecond - (s * input + reactionFirst) / inertiaFirst,"""),
("""          ? (Math.abs(input) * (def.biasRatio - 1)) / (def.biasRatio + 1)""",
"""          ? (0.5 * Math.abs(input) * (def.biasRatio - 1)) / (def.biasRatio + 1)"""),
])
patch(root + '/tests/differential.test.ts', [
("""        differentialTorques(LOCKED, 800, true, a, b, inertia, inertia, dt, out);""",
"""        differentialTorques(LOCKED, 800, true, a, b, inertia, inertia, dt, out, -900, -300);"""),
("""      expect(Math.abs(b - a)).toBeLessThan(0.5);""",
"""      expect(Math.abs(b - a)).toBeLessThan(0.01);"""),
])
print('ok')
