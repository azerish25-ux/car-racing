import sys
root = sys.argv[1]
def patch(path, pairs):
    s = open(path).read()
    for a, b in pairs:
        assert a in s, (path, a[:90])
        s = s.replace(a, b)
    open(path, 'w').write(s)

patch(root + '/src/simulation/tire.ts', [
("""  /** Fraction of the contact lost to the water film (0 dry … 1 planing). */
  aquaplane: number;
}""", """  /** Fraction of the contact lost to the water film (0 dry … 1 planing). */
  aquaplane: number;
  /** Slip ratio at the force peak for the present load, grip and ground. */
  peakSlip: number;
  /** Combined friction-ellipse utilization (0 free … 1 sliding at the limit). */
  usage: number;
}
/** Peak slip ratio of the Formula slick at nominal load on dry asphalt: the
 * reference for slip thresholds expressed in the former fixed-slip units. */
export const REFERENCE_PEAK_SLIP = 0.25;
/** Scale for a slip threshold calibrated at REFERENCE_PEAK_SLIP. */
export function slipScale(t: Pick<Tire, 'peakSlip'>) {
  return clamp(t.peakSlip / REFERENCE_PEAK_SLIP, 0.35, 1.6);
}"""),
("""    groundDrag: 0,
    aquaplane: 0,
  };
}""", """    groundDrag: 0,
    aquaplane: 0,
    peakSlip: REFERENCE_PEAK_SLIP,
    usage: 0,
  };
}"""),
("""  combinedForces(SLIP, t.slip, t);
  t.energy = Math.abs(t.fx * (omega * r - vLong)) + Math.abs(t.fy * vLat);
  if (t.load < 1) {
    t.fx = 0;
    t.fy = 0;
    t.energy = 0;
  }""", """  combinedForces(SLIP, t.slip, t);
  t.energy = Math.abs(t.fx * (omega * r - vLong)) + Math.abs(t.fy * vLat);
  t.peakSlip = SLIP.kappaRef;
  t.usage = Math.hypot(t.fx / Math.max(1, SLIP.dx), t.fy / Math.max(1, SLIP.dy));
  if (t.load < 1) {
    t.fx = 0;
    t.fy = 0;
    t.energy = 0;
    t.usage = 0;
  }"""),
])
patch(root + '/src/simulation/vehicle.ts', [
("""import { brakeEfficiency, makeTire, solveTire, type Tire } from './tire.ts';""",
 """import { brakeEfficiency, makeTire, slipScale, solveTire, type Tire } from './tire.ts';"""),
("""    if (this.assist === 'sport') {
      const slip = Math.max(this.tires[2].slip, this.tires[3].slip);
      this.throttle /= 1 + Math.max(0, slip - 0.16) * 4.5;
    }""", """    if (this.assist === 'sport') {
      // Traction control acts relative to the driven tyres' current peak slip
      // (0.16 at the reference slick's 0.25), so it holds the same margin on a
      // wet or loose surface whose force peaks at a smaller slip.
      const a = this.tires[this.drivenLeft],
        b = this.tires[this.drivenRight],
        slip = Math.max(a.slip, b.slip),
        limit = 0.16 * Math.min(slipScale(a), slipScale(b));
      this.throttle /= 1 + Math.max(0, slip - limit) * 4.5;
    }"""),
("""      const release = this.assist === 'sport' ? 1 / (1 + Math.max(0, -t.slip - 0.14) * 9) : 1;""",
 """      const release =
        this.assist === 'sport' ? 1 / (1 + Math.max(0, -t.slip - 0.14 * slipScale(t)) * 9) : 1;"""),
])
patch(root + '/src/simulation/ai.ts', [
("""import { peakGrip } from './tire.ts';""", """import { peakGrip, slipScale } from './tire.ts';"""),
("""    const wheelspin = Math.max(c.tires[2].slip, c.tires[3].slip);
    if (wheelspin > 0.08) command.throttle *= clamp(1 - (wheelspin - 0.08) * 5, 0.05, 1);""",
 """    // Thresholds are relative to the tyre's present force peak (0.08 and 0.12
    // at the reference slick's 0.25): a wet or loose surface peaks earlier,
    // and drive slip there costs the rear its lateral grip sooner.
    const wheelspin = Math.max(c.tires[2].slip, c.tires[3].slip),
      spinLimit = 0.08 * Math.min(slipScale(c.tires[2]), slipScale(c.tires[3]));
    if (wheelspin > spinLimit)
      command.throttle *= clamp(1 - ((wheelspin - spinLimit) * 5) / slipScale(c.tires[2]), 0.05, 1);"""),
("""    let lock = 0;
    for (const tire of c.tires) lock = Math.min(lock, tire.slip);
    if (lock < -0.12) command.brake *= clamp(1 - (-lock - 0.12) * 4, 0.35, 1);""",
 """    let lock = 0,
      lockScale = 1.6;
    for (const tire of c.tires) {
      lock = Math.min(lock, tire.slip);
      lockScale = Math.min(lockScale, slipScale(tire));
    }
    if (lock < -0.12 * lockScale)
      command.brake *= clamp(1 - ((-lock - 0.12 * lockScale) * 4) / lockScale, 0.35, 1);"""),
])
print('ok')
