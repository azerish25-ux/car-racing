import sys
root = sys.argv[1]
p = root + '/src/simulation/differential.ts'
s = open(p).read()
s += """/** Driven layout and its differentials. Wheel order follows the vehicle:
 * 0 FR, 1 FL, 2 RR, 3 RL; an axle differential's first output is the right
 * wheel. For 'awd' the centre differential's first output (share `split`) is
 * the front axle. */
export type DrivenLayout = 'rwd' | 'fwd' | 'awd';
export interface Driveline {
  readonly layout: DrivenLayout;
  readonly front: DifferentialDefinition;
  readonly rear: DifferentialDefinition;
  readonly centre: DifferentialDefinition;
}
const AXLE = differentialOutput(),
  CENTRE = differentialOutput();
/** Wheel drive torques (N m) for gearbox output `input`: centre split for
 * all-wheel drive, then each driven axle's differential. `reaction` holds the
 * previous step's road reaction torque on each wheel (−Fx·r). */
export function drivelineTorques(
  line: Driveline,
  input: number,
  onPower: boolean,
  omega: ArrayLike<number>,
  inertia: ArrayLike<number>,
  reaction: ArrayLike<number>,
  dt: number,
  out: Float64Array,
) {
  out.fill(0);
  let front = 0,
    rear = 0;
  if (line.layout === 'awd') {
    differentialTorques(
      line.centre,
      input,
      onPower,
      (omega[0] + omega[1]) * 0.5,
      (omega[2] + omega[3]) * 0.5,
      inertia[0] + inertia[1],
      inertia[2] + inertia[3],
      dt,
      CENTRE,
      reaction[0] + reaction[1],
      reaction[2] + reaction[3],
    );
    front = CENTRE.first;
    rear = CENTRE.second;
  } else if (line.layout === 'fwd') front = input;
  else rear = input;
  for (const [axle, torque, def] of [
    [0, front, line.front],
    [2, rear, line.rear],
  ] as const) {
    if (torque === 0 && line.layout !== 'awd' && (axle === 0) !== (line.layout === 'fwd')) continue;
    differentialTorques(
      def,
      torque,
      onPower,
      omega[axle],
      omega[axle + 1],
      inertia[axle],
      inertia[axle + 1],
      dt,
      AXLE,
      reaction[axle],
      reaction[axle + 1],
    );
    out[axle] = AXLE.first;
    out[axle + 1] = AXLE.second;
  }
  return out;
}
"""
open(p, 'w').write(s)

p = root + '/src/simulation/vehicle.ts'
s = open(p).read()
a = """      this.tires[this.drivenLeft].inertia,
      this.tires[this.drivenRight].inertia,
      dt,
      this.diffOut,
    );"""
b = """      this.tires[this.drivenLeft].inertia,
      this.tires[this.drivenRight].inertia,
      dt,
      this.diffOut,
      // Road reactions of the last step predict the tyres' share (−Fx·r).
      -this.tires[this.drivenLeft].fx * this.tires[this.drivenLeft].radius,
      -this.tires[this.drivenRight].fx * this.tires[this.drivenRight].radius,
    );"""
assert a in s
s = s.replace(a, b)
open(p, 'w').write(s)

p = root + '/tests/differential.test.ts'
s = open(p).read()
s = s.replace("""  differential,
  differentialOutput,""", """  differential,
  drivelineTorques,
  differentialOutput,""", 1)
s = s.rstrip()
assert s.endswith('});')
s = s[:-3] + """  it('composes centre and axle differentials for rwd, fwd and awd layouts', () => {
    const wheels = new Float64Array(4),
      omega = [50, 52, 50, 52],
      inertia = [1.8, 1.8, 1.8, 1.8],
      reaction = [0, 0, 0, 0];
    const line = (layout: 'rwd' | 'fwd' | 'awd') => ({
      layout,
      front: OPEN,
      rear: OPEN,
      centre: differential({ kind: 'open', split: 0.4 }),
    });
    drivelineTorques(line('rwd'), 1000, true, omega, inertia, reaction, 1 / 240, wheels);
    expect([...wheels]).toEqual([0, 0, 500, 500]);
    drivelineTorques(line('fwd'), 1000, true, omega, inertia, reaction, 1 / 240, wheels);
    expect([...wheels]).toEqual([500, 500, 0, 0]);
    drivelineTorques(line('awd'), 1000, true, omega, inertia, reaction, 1 / 240, wheels);
    expect(wheels[0] + wheels[1]).toBeCloseTo(400, 9);
    expect(wheels[2] + wheels[3]).toBeCloseTo(600, 9);
    // A locked centre ties the axle speeds, moving torque to the slower axle.
    drivelineTorques(
      { ...line('awd'), centre: LOCKED },
      1000,
      true,
      [40, 40, 60, 60],
      inertia,
      reaction,
      1 / 240,
      wheels,
    );
    expect(wheels[0] + wheels[1]).toBeGreaterThan(wheels[2] + wheels[3]);
    expect(wheels.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 9);
  });
});
"""
open(p, 'w').write(s)
print('ok')
