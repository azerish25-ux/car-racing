p='src/rendering/vehicle-bodies/index.ts'
s=open(p).read()
def rep(old,new):
    global s
    assert old in s, old[:70]
    s=s.replace(old,new,1)
rep("""import {
  F,
  R,
  RACE_BASE,""","""import {
  F,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,""")
rep("""import { WheelAssembly, type Detail } from './wheel.ts';""","""import { WheelAssembly, type Detail } from './wheel.ts';
import { installMudOn, mudUniforms, type MudUniforms } from '../offroad/mud.ts';""")
rep("""  frame: BodyFrame;
  level: number;
}
const LOD_NAMES""","""  frame: BodyFrame;
  level: number;
  /** Off-road mud coat (WP41), installed once the car first picks up mud. */
  mud?: MudUniforms;
}
const LOD_NAMES""")
rep("""      body.root.position.copy(host.position);
      body.root.quaternion.copy(host.quaternion);""","""      body.root.position.copy(host.position);
      body.root.quaternion.copy(host.quaternion);
      // Off-road (WP41): the mud and dust the car has picked up (O.MUD).
      const mud = b[o + OFFROAD_BASE + O.MUD];
      if (mud > 0.001 && !body.mud) installMudOn(body.root, (body.mud = mudUniforms()));
      if (body.mud) {
        body.mud.offroadMud.value = Math.min(1, Math.max(0, mud));
        body.mud.offroadMudWet.value = Math.min(1, Math.max(0, b[o + OFFROAD_BASE + O.MOISTURE] * 1.6));
      }""")
open(p,'w').write(s)
