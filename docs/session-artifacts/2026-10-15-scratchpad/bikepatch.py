p = 'src/rendering/bike.ts'
s = open(p).read()


def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (s.count(old), old[:120])
    s = s.replace(old, new)


rep("""import { Rider, type RiderDetail } from './rider.ts';""",
    """import { Rider, type RiderDetail } from './rider.ts';
import { bikeSheetFor } from './bike-sheet.ts';""")
rep("""      sides = detail === 'high' ? 40 : detail === 'mid' ? 20 : 10,
      wings = b.downforce > 0;""", """      sides = detail === 'high' ? 40 : detail === 'mid' ? 20 : 10,
      // The body sheet (bike-sheet.ts): GP-R1 and SBK-1000 keep the original
      // design; the catalogue's other bikes vary fairing, aero, lamps, exhaust,
      // tail, bars, frame, wheels and shocks.
      look = bikeSheetFor(definition),
      wings = look.wings !== 'none',
      full = look.fairing === 'full',
      naked = look.fairing === 'naked',
      classic = look.fairing === 'classic';""")
# Wheels: spoked option
rep("""        // Rim barrel and five forged spokes.
        add(
          spin,
          new T.CylinderGeometry(rim, rim, halfWidth * 1.5, sides, 1, true),
          m.wheel,
        ).rotation.z = Math.PI / 2;
        for (let k = 0; k < 5; k++) {
          const spoke = add(spin, new T.BoxGeometry(0.022, rim - 0.05, 0.034), m.wheel);
          const a = (k / 5) * Math.PI * 2;
          spoke.position.set(0, Math.cos(a) * (rim / 2 + 0.02), Math.sin(a) * (rim / 2 + 0.02));
          spoke.rotation.x = a;
        }""", """        // Rim barrel and five forged spokes (or a laced wire wheel).
        add(
          spin,
          new T.CylinderGeometry(rim, rim, halfWidth * 1.5, sides, 1, true),
          look.wheels === 'spoked' ? m.steel : m.wheel,
        ).rotation.z = Math.PI / 2;
        if (look.wheels === 'spoked')
          for (let k = 0; k < (detail === 'high' ? 36 : 18); k++) {
            const count = detail === 'high' ? 36 : 18,
              a = (k / count) * Math.PI * 2,
              lean = k % 2 ? 0.08 : -0.08;
            const spoke = add(spin, new T.CylinderGeometry(0.0025, 0.0025, rim - 0.05, 4), m.steel);
            spoke.position.set(lean * 0.3, Math.cos(a) * (rim / 2 + 0.02), Math.sin(a) * (rim / 2 + 0.02));
            spoke.rotation.set(a, 0, lean);
          }
        else
          for (let k = 0; k < 5; k++) {
            const spoke = add(spin, new T.BoxGeometry(0.022, rim - 0.05, 0.034), m.wheel);
            const a = (k / 5) * Math.PI * 2;
            spoke.position.set(0, Math.cos(a) * (rim / 2 + 0.02), Math.sin(a) * (rim / 2 + 0.02));
            spoke.rotation.x = a;
          }""")
rep("""      if (front) {
        // Twin carbon discs on floating carriers.
        for (const side of [1, -1]) {""", """      if (front) {
        // Twin carbon discs on floating carriers (one steel disc on a
        // classic machine).
        for (const side of look.wheels === 'spoked' ? [1] : [1, -1]) {""")
# Bars: upright option
rep("""    // Clip-on bars, grips and levers; the grips are the rider's hand targets.
    for (const side of [1, -1]) {""", """    // Clip-on bars, grips and levers; the grips are the rider's hand targets.
    // An upright roadster bar rises and reaches wider.
    const upright = look.bars === 'upright',
      barY = upright ? 0.1 : 0,
      barX = upright ? 0.07 : 0;
    if (upright)
      add(
        this.steer,
        new T.CylinderGeometry(0.012, 0.012, 0.74, 10),
        m.dark,
        0,
        0.04,
        -0.02,
      ).rotation.z = Math.PI / 2;
    for (const side of [1, -1]) {""")
rep("""      const grip = add(
        this.steer,
        new T.CylinderGeometry(0.017, 0.017, 0.12, 12),
        m.dark,
        side * 0.3,
        -0.06,
        -0.05,
      );
      grip.rotation.z = Math.PI / 2 - side * 0.18;
      grip.rotation.y = side * 0.22;
      this.gripLocal[side > 0 ? 0 : 1].set(side * 0.3, -0.06, -0.05);""", """      const grip = add(
        this.steer,
        new T.CylinderGeometry(0.017, 0.017, 0.12, 12),
        m.dark,
        side * (0.3 + barX),
        -0.06 + barY,
        -0.05,
      );
      grip.rotation.z = Math.PI / 2 - side * 0.18;
      grip.rotation.y = side * 0.22;
      this.gripLocal[side > 0 ? 0 : 1].set(side * (0.3 + barX), -0.06 + barY, -0.05);""")
# Mudguard material
rep("""    const guardMaterial = (wings ? m.carbon : m.secondary).clone();""",
    """    const guardMaterial = (wings ? m.carbon : classic ? m.steel : m.secondary).clone();""")
# Frame
rep("""    for (const side of [1, -1])
      add(this.sprung, beam(spar(side), 0.045, 0.1, detail === 'high' ? 24 : 10), m.aluminium);""",
    """    if (look.frame === 'spar')
      for (const side of [1, -1])
        add(this.sprung, beam(spar(side), 0.045, 0.1, detail === 'high' ? 24 : 10), m.aluminium);
    else
      // Steel trellis (triangulated thin tubes) or a tubular double cradle
      // that loops under the engine.
      for (const side of [1, -1]) {
        const s = spar(side);
        add(this.sprung, tube(s, look.frame === 'trellis' ? 0.014 : 0.018, 24, 6), m.caliper);
        if (look.frame === 'trellis') {
          const lower: [number, number, number][] = s.map(([x, y, z]) => [x * 0.95, y - 0.16, z + 0.02]);
          add(this.sprung, tube(lower, 0.012, 24, 6), m.caliper);
          for (let k = 0; k < s.length - 1; k++)
            add(this.sprung, tube([s[k], lower[k + 1]], 0.01, 2, 5), m.caliper);
        } else
          add(
            this.sprung,
            tube(
              [
                [side * 0.06, head.y - 0.08, head.z - 0.02],
                [side * 0.12, -0.15, 0.36],
                [side * 0.13, -0.4, 0.22],
                [side * 0.13, -0.42, -0.12],
                [side * 0.12, -0.13, -0.2],
              ],
              0.018,
              24,
              6,
            ),
            m.caliper,
          );
      }""")
# Exhaust variants
rep("""    // Exhaust: headers under the engine to a high titanium silencer.
    const pipe: [number, number, number][] = [""", """    // Exhaust: headers under the engine to a high titanium silencer.
    if (look.exhaust === 'expansion') {
      // Three two-stroke expansion chambers: two exit low on the right, one
      // on the left, each a swelling cone with a thin tail pipe.
      for (const [x, side] of [
        [0.07, 1],
        [0.0, 1],
        [-0.07, -1],
      ] as const) {
        const chamber = add(
          this.sprung,
          new T.CylinderGeometry(0.025, 0.06, 0.42, sides / 2),
          m.steel,
          x + side * 0.06,
          -0.36,
          0.0,
        );
        chamber.rotation.x = Math.PI / 2 + 0.1;
        const tail = add(
          this.sprung,
          new T.CylinderGeometry(0.018, 0.022, 0.38, 10),
          m.titanium,
          side * 0.15,
          -0.24,
          -0.42,
        );
        tail.rotation.x = Math.PI / 2 - 0.3;
      }
    } else {
    const pipe: [number, number, number][] = [""")
rep("""    const can = add(
      this.sprung,
      new T.CylinderGeometry(0.05, 0.057, 0.3, sides / 2),
      m.titanium,
      -0.165,
      -0.08,
      -0.74,
    );
    can.rotation.x = Math.PI / 2 - 0.35;
    add(
      this.sprung,
      new T.CylinderGeometry(0.058, 0.058, 0.04, sides / 2),
      m.carbon,
      -0.165,
      -0.03,
      -0.88,
    ).rotation.x = Math.PI / 2 - 0.35;""", """    if (look.exhaust === 'side-high') {
      const can = add(
        this.sprung,
        new T.CylinderGeometry(0.05, 0.057, 0.3, sides / 2),
        m.titanium,
        -0.165,
        -0.08,
        -0.74,
      );
      can.rotation.x = Math.PI / 2 - 0.35;
      add(
        this.sprung,
        new T.CylinderGeometry(0.058, 0.058, 0.04, sides / 2),
        m.carbon,
        -0.165,
        -0.03,
        -0.88,
      ).rotation.x = Math.PI / 2 - 0.35;
    } else if (look.exhaust === 'stubby')
      // Short low can just behind the footpeg.
      add(
        this.sprung,
        new T.CylinderGeometry(0.065, 0.07, 0.24, sides / 2),
        m.titanium,
        -0.17,
        -0.2,
        -0.48,
      ).rotation.x = Math.PI / 2 - 0.2;
    else
      // Under-belly silencer box, exits ahead of the rear tyre.
      add(this.sprung, new T.BoxGeometry(0.2, 0.1, 0.3), m.titanium, 0, -0.42, -0.08);
    }""")
# Bodywork: wrap full fairing parts
rep("""    // Upper fairing: a wedge nose over the front wheel, clear of fork travel,
    // whose cheeks drop behind the wheel to meet the lower fairing.
    add(""", """    // Upper fairing: a wedge nose over the front wheel, clear of fork travel,
    // whose cheeks drop behind the wheel to meet the lower fairing.
    if (full)
    add(""")
rep("""    // Lower fairing and belly pan: behind the wheel, its rear edge rising
    // toward the footpegs; the frame beams stay exposed above it.
    add(""", """    // Lower fairing and belly pan: behind the wheel, its rear edge rising
    // toward the footpegs; the frame beams stay exposed above it.
    if (full)
    add(""")
rep("""    // Accent stripe along the lower fairing.
    if (detail !== 'far')""", """    // Accent stripe along the lower fairing.
    if (full && detail !== 'far')""")
rep("""    // Number plates on the nose and the flanks.
    if (detail !== 'far') {""", """    // Number plates on the nose and the flanks.
    if (full && detail !== 'far') {""")
rep("""    // Wings: stacked carbon aerofoils with end plates on the prototype class.
    if (wings && detail !== 'far')""", """    // Classic round-nosed fairing: one bulbous shell over the forks with a
    // round number plate; no belly pan, so the engine and chambers show.
    if (classic) {
      add(
        this.sprung,
        superLoft(
          [
            section(0.3, 0.0, 0.2, 0.24, 0.2),
            section(0.45, 0.08, 0.25, 0.22, 0.2),
            section(0.6, 0.13, 0.25, 0.18, 0.16),
            section(0.75, 0.15, 0.2, 0.13, 0.12),
            section(0.86, 0.14, 0.12, 0.08, 0.08),
            section(0.9, 0.13, 0.04, 0.03, 0.03),
          ],
          sides,
          2.2,
        ),
        m.paint,
      );
      if (detail !== 'far') {
        const plate = add(this.sprung, new T.CircleGeometry(0.09, 24), m.plate, 0, 0.17, 0.85, false);
        plate.rotation.x = -0.75;
      }
    }
    // Naked roadster: radiator and engine on show, a round lamp on the fork
    // and a small flyscreen.
    if (naked && detail !== 'far')
      add(this.sprung, new T.BoxGeometry(0.34, 0.26, 0.05), m.dark, 0, -0.06, 0.36).rotation.x =
        -0.2;
    if (look.headlamp === 'round') {
      add(
        this.steer,
        new T.CylinderGeometry(0.085, 0.09, 0.12, sides / 2),
        m.dark,
        0,
        -0.22,
        FORK_OFFSET + 0.12,
      ).rotation.x = Math.PI / 2;
      add(this.steer, new T.CircleGeometry(0.075, sides), m.screenLight, 0, -0.22, FORK_OFFSET + 0.181, false);
    } else if (look.headlamp === 'twin-slit' && detail !== 'far')
      for (const side of [1, -1]) {
        const lamp = add(this.sprung, new T.BoxGeometry(0.07, 0.02, 0.04), m.screenLight, side * 0.08, 0.13, 0.88, false);
        lamp.rotation.set(-0.9, side * 0.3, 0);
      }
    // Box wing (biplane with joined end plates) low on the fairing flanks.
    if (look.wings === 'box' && detail !== 'far')
      for (const side of [1, -1]) {
        for (const y of [0.02, -0.08]) {
          const foil = add(this.sprung, new T.BoxGeometry(0.1, 0.012, 0.16), m.carbon, side * 0.27, y, 0.6);
          foil.rotation.z = side * -0.12;
        }
        add(this.sprung, new T.BoxGeometry(0.006, 0.13, 0.17), m.carbon, side * 0.32, -0.03, 0.6);
      }
    // Wings: stacked carbon aerofoils with end plates on the prototype class.
    if (look.wings === 'stacked' && detail !== 'far')""")
# Windscreen: scale and skip when 0
rep("""    // Windscreen bubble: transmissive near, cheap tinted beyond.
    add(
      this.sprung,
      arcSheet(
        [
          section(0.4, 0.3, 0.17, 0.11, 0),
          section(0.52, 0.28, 0.2, 0.1, 0),
          section(0.64, 0.25, 0.19, 0.075, 0),
          section(0.73, 0.22, 0.15, 0.04, 0),
        ],
        0.2,
        Math.PI - 0.2,
        sides / 2,
      ),
      transmissive ? m.screen : m.screenLight,
      0,
      0,
      0,
      false,
    );""", """    // Windscreen bubble: transmissive near, cheap tinted beyond; its height
    // follows the sheet (a classic screen is low, a naked bike has none).
    const sh = look.screen;
    if (sh > 0)
      add(
        this.sprung,
        arcSheet(
          [
            section(0.4, 0.3 * (classic ? 0.75 : 1), 0.17, 0.11 * sh, 0),
            section(0.52, 0.28 * (classic ? 0.75 : 1), 0.2, 0.1 * sh, 0),
            section(0.64, 0.25 * (classic ? 0.75 : 1), 0.19, 0.075 * sh, 0),
            section(0.73, 0.22 * (classic ? 0.75 : 1), 0.15, 0.04 * sh, 0),
          ],
          0.2,
          Math.PI - 0.2,
          sides / 2,
        ),
        transmissive ? m.screen : m.screenLight,
        0,
        0,
        0,
        false,
      );""")
# Tank: classic bigger, naked sculpted
rep("""    // Tank cover (carbon on the prototype) between the exposed spars.
    add(
      this.sprung,
      superLoft(
        [
          section(-0.14, 0.22, 0.12, 0.07, 0.06),
          section(0.0, 0.26, 0.165, 0.09, 0.08),
          section(0.16, 0.26, 0.17, 0.08, 0.08),
          section(0.3, 0.24, 0.15, 0.07, 0.07),
          section(0.41, 0.22, 0.11, 0.06, 0.06),
        ],
        sides,
      ),
      wings ? m.carbon : m.paint,
    );""", """    // Tank cover (carbon on the prototype) between the exposed spars; a
    // classic machine has a big rounded steel tank, a naked bike a sculpted
    // tank with knee scallops that reaches further forward.
    const tankScale = classic ? 1.18 : naked ? 1.08 : 1;
    add(
      this.sprung,
      superLoft(
        [
          section(-0.14, 0.22, 0.12 * tankScale, 0.07 * tankScale, 0.06),
          section(0.0, 0.26, 0.165 * tankScale, 0.09 * tankScale, 0.08),
          section(0.16, 0.26, 0.17 * tankScale, 0.08 * tankScale, 0.08),
          section(0.3, 0.24, 0.15 * tankScale, 0.07 * tankScale, 0.07),
          section(naked ? 0.46 : 0.41, naked ? 0.25 : 0.22, 0.11, 0.06, 0.06),
        ],
        sides,
        classic ? 2.1 : 2.6,
      ),
      wings ? m.carbon : m.paint,
    );""")
# Tail variants
rep("""    // Seat unit and tail hump with the rain/brake light.
    add(
      this.sprung,
      superLoft(
        [
          section(-0.84, 0.33, 0.035, 0.03, 0.03, 0.7),
          section(-0.76, 0.32, 0.075, 0.07, 0.08, 0.7),
          section(-0.6, 0.28, 0.11, 0.1, 0.12, 0.75),
          section(-0.44, 0.2, 0.13, 0.07, 0.1, 0.85),
          section(-0.22, 0.17, 0.14, 0.05, 0.08),
          section(-0.1, 0.17, 0.13, 0.04, 0.06),
        ],
        sides,
      ),
      m.paint,
    );
    add(this.sprung, new T.BoxGeometry(0.2, 0.025, 0.26), m.seat, 0, 0.232, -0.3);
    add(this.sprung, new T.BoxGeometry(0.05, 0.025, 0.012), m.lamp, 0, 0.32, -0.845, false);""",
    """    // Seat unit and tail hump with the rain/brake light: the race tail, a
    // short roadster tail with a pillion pad, or a classic flat seat ending in
    // a rounded hump.
    if (look.tail === 'race') {
      add(
        this.sprung,
        superLoft(
          [
            section(-0.84, 0.33, 0.035, 0.03, 0.03, 0.7),
            section(-0.76, 0.32, 0.075, 0.07, 0.08, 0.7),
            section(-0.6, 0.28, 0.11, 0.1, 0.12, 0.75),
            section(-0.44, 0.2, 0.13, 0.07, 0.1, 0.85),
            section(-0.22, 0.17, 0.14, 0.05, 0.08),
            section(-0.1, 0.17, 0.13, 0.04, 0.06),
          ],
          sides,
        ),
        m.paint,
      );
      add(this.sprung, new T.BoxGeometry(0.2, 0.025, 0.26), m.seat, 0, 0.232, -0.3);
      add(this.sprung, new T.BoxGeometry(0.05, 0.025, 0.012), m.lamp, 0, 0.32, -0.845, false);
    } else if (look.tail === 'stubby') {
      add(
        this.sprung,
        superLoft(
          [
            section(-0.66, 0.3, 0.04, 0.03, 0.04, 0.7),
            section(-0.56, 0.28, 0.1, 0.06, 0.08, 0.75),
            section(-0.36, 0.22, 0.14, 0.05, 0.1),
            section(-0.12, 0.18, 0.14, 0.04, 0.07),
          ],
          sides,
        ),
        m.paint,
      );
      add(this.sprung, new T.BoxGeometry(0.24, 0.04, 0.42), m.seat, 0, 0.245, -0.36);
      add(this.sprung, new T.BoxGeometry(0.1, 0.035, 0.014), m.lamp, 0, 0.3, -0.67, false);
    } else {
      add(
        this.sprung,
        superLoft(
          [
            section(-0.72, 0.36, 0.05, 0.05, 0.05),
            section(-0.62, 0.36, 0.12, 0.09, 0.08),
            section(-0.5, 0.3, 0.14, 0.06, 0.1),
            section(-0.3, 0.2, 0.14, 0.04, 0.08),
            section(-0.1, 0.18, 0.12, 0.03, 0.06),
          ],
          sides,
          2.2,
        ),
        m.paint,
      );
      add(this.sprung, new T.BoxGeometry(0.22, 0.03, 0.38), m.seat, 0, 0.235, -0.28);
      add(this.sprung, new T.BoxGeometry(0.08, 0.04, 0.012), m.lamp, 0, 0.3, -0.73, false);
    }""")
# Shocks: twin
rep("""    this.root.add(this.swingarm);""", """    if (look.shocks === 'twin' && detail !== 'far')
      // Twin shocks from the swingarm ends up to the subframe.
      for (const side of [1, -1]) {
        const shock = add(
          this.swingarm,
          new T.CylinderGeometry(0.022, 0.022, 0.32, 10),
          m.band,
          side * 0.13,
          0.15,
          -arm * 0.9,
        );
        shock.rotation.x = -0.35;
      }
    this.root.add(this.swingarm);""")
open(p, 'w').write(s)
print('ok')
