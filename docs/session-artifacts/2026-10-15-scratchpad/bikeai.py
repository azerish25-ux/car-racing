p = 'src/simulation/bike-definitions.ts'
s = open(p).read()


def rep(old, new):
    global s
    assert s.count(old) == 1, old
    s = s.replace(old, new)


rep("""  topSpeed: number,
): CapabilityEnvelope {""", """  topSpeed: number,
  /** Margins for a machine the rider must treat more gently (absent: the
   * road-racing defaults below). */
  margins: Partial<
    Pick<CapabilityEnvelope, 'lateralMargin' | 'slowLateralMargin' | 'brakingMargin'>
  > = {},
): CapabilityEnvelope {""")
rep("""    lateralMargin: 0.86,
    slowLateralMargin: 0.8,
    brakingMargin: 0.78,""", """    lateralMargin: margins.lateralMargin ?? 0.86,
    slowLateralMargin: margins.slowLateralMargin ?? 0.8,
    brakingMargin: margins.brakingMargin ?? 0.78,""")
rep("""  halfExtents: readonly [number, number, number];
  topSpeed: number;
}): VehicleDefinition {""", """  halfExtents: readonly [number, number, number];
  topSpeed: number;
  aiMargins?: Parameters<typeof bikeEnvelope>[4];
}): VehicleDefinition {""")
rep("""    ai: bikeEnvelope(b, wheelbase, mass + b.fuel, sheet.topSpeed),""",
    """    ai: bikeEnvelope(b, wheelbase, mass + b.fuel, sheet.topSpeed, sheet.aiMargins),""")
rep("""  halfExtents: [0.34, 0.55, 1.0],
  topSpeed: 66,
});""", """  halfExtents: [0.34, 0.55, 1.0],
  topSpeed: 66,
  // Narrow tyres and drum-era brakes: the rider brakes earlier and leans less.
  aiMargins: { lateralMargin: 0.8, slowLateralMargin: 0.74, brakingMargin: 0.66 },
});""")
open(p, 'w').write(s)
print('ok')
