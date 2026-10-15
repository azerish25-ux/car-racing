import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')


def rep(p, old, new, count=1):
    s = open(p).read()
    assert s.count(old) == count, (p, old, s.count(old))
    s = s.replace(old, new)
    open(p, 'w').write(s)


v = 'src/simulation/vehicle.ts'
rep(v, """        spec.wheelRadius,
        spec.wheelInertia,
        definition.tireGrip,
        this.looseGrip,
      ),
    );""", """        spec.wheelRadius,
        spec.wheelInertia,
        i < 2 ? definition.tireGrip : (definition.tireGripRear ?? definition.tireGrip),
        this.looseGrip,
      ),
    );""")
rep(v, """        this.spec.wheelRadius,
        this.spec.wheelInertia,
        this.definition.tireGrip,
        this.looseGrip,
      );""", """        this.spec.wheelRadius,
        this.spec.wheelInertia,
        i < 2
          ? this.definition.tireGrip
          : (this.definition.tireGripRear ?? this.definition.tireGrip),
        this.looseGrip,
      );""")
rep('src/simulation/vehicles.ts', """  tireFamily?: TireFamilyId;""", """  tireFamily?: TireFamilyId;
  /** Rear tyre grip when the car runs a staggered (wider) rear fitment;
   * absent: tireGrip on all four corners. */
  tireGripRear?: number;""")
b = 'src/simulation/vehicle-catalogue/builder.ts'
rep(b, """  tireFamily: TireFamilyId;
  tireGrip: number;""", """  tireFamily: TireFamilyId;
  tireGrip: number;
  /** Rear/front grip ratio of a staggered fitment (wider rears); 1 = square.
   * Load-proportional cornering stiffness makes a rear-heavy car oversteer
   * on a square fitment, exactly as wider rear tyres exist to prevent. */
  rearGrip?: number;""")
rep(b, """    tireGrip: sheet.tireGrip,
    hybrid: !!hybrid,""", """    tireGrip: sheet.tireGrip,
    ...(sheet.rearGrip !== undefined && sheet.rearGrip !== 1
      ? { tireGripRear: round(sheet.tireGrip * sheet.rearGrip, 4) }
      : {}),
    hybrid: !!hybrid,""")
