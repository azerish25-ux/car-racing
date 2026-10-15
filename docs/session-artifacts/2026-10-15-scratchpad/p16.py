import sys
root = sys.argv[1]
def patch(path, pairs):
    s = open(path).read()
    for a, b in pairs:
        assert a in s, (path, a[:90])
        s = s.replace(a, b, 1)
    open(path, 'w').write(s)

patch(root + '/src/simulation/tyre-force.ts', [
("""  /** Slip stiffness ∝ Fz·(Fz/Fz0)^-q: the peak slip angle grows with load. */
  readonly stiffnessLoadExponent: number;""",
"""  /** Cornering stiffness ∝ Fz·(Fz/Fz0)^-q: the peak slip angle grows with
   * load. Longitudinal slip stiffness has its own (MF: close to ∝ Fz). */
  readonly stiffnessLoadExponent: number;
  readonly longitudinalLoadExponent: number;
  /** Rolling-resistance scale of this carcass on the ground's rigid
   * coefficient, and its pressure exponent: c_rr ∝ (p_nominal/p)^n. */
  readonly rollingResistance: number;
  readonly rollingPressureExponent: number;"""),
("""  nominalLoad: 2200,
  loadSensitivity: 0.105,
  stiffnessLoadExponent: 0.12,""", """  nominalLoad: 2200,
  loadSensitivity: 0.105,
  stiffnessLoadExponent: 0.12,
  longitudinalLoadExponent: 0,
  rollingResistance: 0.93,
  rollingPressureExponent: 0.3,"""),
("""    common =
      fz *
      ratio ** -c.stiffnessLoadExponent *
      (friction / c.referenceFriction) ** c.frictionStiffnessCoupling *
      stiffnessFactor *
      groundStiffness;""", """    common =
      fz *
      (friction / c.referenceFriction) ** c.frictionStiffnessCoupling *
      stiffnessFactor *
      groundStiffness;"""),
("""  out.corneringStiffness = c.lateral.stiffness * common;
  out.slipStiffness = c.longitudinal.stiffness * common;""", """  out.corneringStiffness = c.lateral.stiffness * common * ratio ** -c.stiffnessLoadExponent;
  out.slipStiffness = c.longitudinal.stiffness * common * ratio ** -c.longitudinalLoadExponent;"""),
])
patch(root + '/src/simulation/tire.ts', [
("""  t.rolling =
    surface.resistance - material.rolling + rollingCoefficient(material, t.sinkage, t.patchLength);""",
"""  // Rigid rolling loss of this carcass (hysteresis falls as pressure rises)
  // plus the compaction work of deformable ground.
  t.rolling =
    surface.resistance *
      k.rollingResistance *
      (k.nominalPressure / Math.max(60, t.pressure)) ** k.rollingPressureExponent +
    rollingCoefficient(material, t.sinkage, t.patchLength) -
    material.rolling;"""),
])
print('ok')
