import sys
root = sys.argv[1]
def patch(path, pairs):
    s = open(path).read()
    for a, b in pairs:
        assert a in s, (path, a[:90])
        s = s.replace(a, b)
    open(path, 'w').write(s)

patch(root + '/src/simulation/world.ts', [
("""      c.wake = 0;
      // Exact cull (§23.4): wakeOverlap is zero beyond 100 m behind, and at
      // more than 101 m apart the lateral offset exceeds the wake radius.
      for (const other of this.cars)
        if (other !== c && c.body.position.distanceSq(other.body.position) < 101 * 101)
          c.wake = Math.max(
            c.wake,
            wakeOverlap(
              c.body.position,
              other.body.position,
              other.forward,
              other.speed,
              c.forward,
            ),
          );
    }""", """      // Dirty air (downforce) and slipstream (drag) behind every leader.
      wakeFields(c, this.cars);
    }"""),
("""import { wakeOverlap } from './aero.ts';""", """import { wakeFields } from './aero.ts';"""),
])
patch(root + '/scripts/physics-cost.ts', [
("""      c.wake = 0;
      for (const other of cars)
        if (other !== c && c.body.position.distanceSq(other.body.position) < 101 * 101)
          c.wake = Math.max(
            c.wake,
            wakeOverlap(c.body.position, other.body.position, other.forward, other.speed, c.forward),
          );""", """      wakeFields(c, cars);"""),
("""import { wakeOverlap } from '../src/simulation/aero.ts';""", """import { wakeFields } from '../src/simulation/aero.ts';"""),
])
patch(root + '/src/simulation/aero.ts', [
("""import { DRS } from './drs.ts';""", """import { DRS } from './drs.ts';
import type { Vehicle } from './vehicle.ts';"""),
])
s = open(root + '/src/simulation/aero.ts').read()
s += """/** Dirty-air and slipstream fractions of `follower` behind every other car,
 * scaled by each leader's wake and tow strength. Exact cull (§23.4): both
 * volumes are zero beyond 100 m behind, and at more than 101 m apart the
 * lateral offset exceeds their radii. */
export function wakeFields(
  follower: Pick<Vehicle, 'wake' | 'slipstream' | 'body' | 'forward'>,
  cars: readonly Pick<Vehicle, 'body' | 'forward' | 'speed' | 'dynamics'>[],
) {
  let wake = 0,
    tow = 0;
  const position = follower.body.position;
  for (const other of cars)
    if (other !== follower && position.distanceSq(other.body.position) < 101 * 101) {
      const leader = other.dynamics.aero,
        at = other.body.position;
      wake = Math.max(
        wake,
        wakeOverlap(position, at, other.forward, other.speed, follower.forward) * leader.wakeStrength,
      );
      tow = Math.max(
        tow,
        slipstreamOverlap(position, at, other.forward, other.speed, follower.forward) *
          leader.towStrength,
      );
    }
  follower.wake = Math.min(1, wake);
  follower.slipstream = Math.min(1, tow);
}
"""
open(root + '/src/simulation/aero.ts', 'w').write(s)
print('ok')
