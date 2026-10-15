ROOT = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/'
def patch(path, pairs):
    p = ROOT + path
    s = open(p).read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit(f'missing in {path}: {old[:80]}')
        s = s.replace(old, new)
    open(p, 'w').write(s)

patch('src/rendering/open-world/buildings.ts', [
    # tower shaft winding
    ("""        m.quad(
          [
            [p0[0], base, p0[1]],
            [p1[0], base, p1[1]],
            [t1[0], top, t1[1]],
            [t0[0], top, t0[1]],
          ],""", """        m.quad(
          [
            [p1[0], base, p1[1]],
            [p0[0], base, p0[1]],
            [t0[0], top, t0[1]],
            [t1[0], top, t1[1]],
          ],"""),
    ("""          m.quad(
            [
              [g0[0], top, g0[1]],
              [g1[0], top, g1[1]],
              [g1[0], top + 3.4, g1[1]],
              [g0[0], top + 3.4, g0[1]],
            ],""", """          m.quad(
            [
              [g1[0], top, g1[1]],
              [g0[0], top, g0[1]],
              [g0[0], top + 3.4, g0[1]],
              [g1[0], top + 3.4, g1[1]],
            ],"""),
    # walls
    ("""      m.quad([a, b, d, e], [c * nx - n * nz, 0, n * nx + c * nz], [[0, 0], [len, 0], [len, eave - base], [0, eave - base]], wall, facade);""",
     """      // Counter-clockwise seen from outside.
      m.quad([b, a, e, d], [c * nx - n * nz, 0, n * nx + c * nz], [[0, 0], [len, 0], [len, eave - base], [0, eave - base]], wall, facade);"""),
    # hangar vault
    ("""          slope = Math.atan2(y1 - y0, z1 - z0);
        const normal = [-n * -Math.sin(slope) * 0 + -n * 0, Math.cos(slope), 0] as [number, number, number];
        const nzw = -Math.sin(slope);
        normal[0] = -n * nzw;
        normal[2] = c * nzw;
        m.quad(
          [local(-hx, y0, z0), local(hx, y0, z0), local(hx, y1, z1), local(-hx, y1, z1)].map((p) => p) as [number, number, number][],
          normal,""", """          slope = Math.atan2(y1 - y0, z1 - z0);
        // Local normal (0, cos, -sin) rotated into the world.
        const normal: [number, number, number] = [n * Math.sin(slope), Math.cos(slope), -c * Math.sin(slope)];
        m.quad(
          [local(hx, y0, z0), local(-hx, y0, z0), local(-hx, y1, z1), local(hx, y1, z1)],
          normal,"""),
    # chapel tower walls
    ("""          m.quad(
            [local(x0, base, z0), local(x1, base, z1), local(x1, towerTop, z1), local(x0, towerTop, z0)],""",
     """          m.quad(
            [local(x1, base, z1), local(x0, base, z0), local(x0, towerTop, z0), local(x1, towerTop, z1)],"""),
    ("""          m.tri([local(x0, towerTop, z0), local(x1, towerTop, z1), local(tx, towerTop + 5, 0)], [0, 1, 0], 0x45484c, roofFacade);""",
     """          m.tri([local(x1, towerTop, z1), local(x0, towerTop, z0), local(tx, towerTop + 5, 0)], [0, 1, 0], 0x45484c, roofFacade);"""),
])
patch('src/rendering/open-world/vegetation.ts', [
    ("""    conifer: T.BufferGeometry;
    coniferFar: T.BufferGeometry;""", """    conifer: T.BufferGeometry;
    coniferTrunk: T.BufferGeometry;
    coniferFar: T.BufferGeometry;"""),
    ("""      conifer: coniferGeometry(9, 4),""", """      conifer: coniferGeometry(9, 4),
      coniferTrunk: new T.CylinderGeometry(0.014, 0.03, 0.3, 6).translate(0, 0.15, 0),"""),
    ("""      add(conifer, this.geometry.conifer, this.needles, TREE_SPECIES.CONIFER, true);""",
     """      add(conifer, this.geometry.conifer, this.needles, TREE_SPECIES.CONIFER, true);
      add(conifer, this.geometry.coniferTrunk, this.bark, TREE_SPECIES.CONIFER, true);"""),
])
print('ok')
