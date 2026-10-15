import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')


def rep(p, old, new, count=1):
    s = open(p).read()
    assert s.count(old) == count, (p, old, s.count(old))
    s = s.replace(old, new)
    open(p, 'w').write(s)


L = 'src/rendering/vehicle-bodies/loft.ts'
rep(L, """  capEnd?: boolean;""", """  capEnd?: boolean;
  /** Material index of the end caps (default: the face material at j = 0). */
  capMaterial?: number;""")
rep(L, """      if (forward) push(options.material?.(ring.z, 0, ringIndex) ?? 0, centre, a, b);
      else push(options.material?.(ring.z, 0, ringIndex) ?? 0, centre, b, a);""",
    """      const m = options.capMaterial ?? options.material?.(ring.z, 0, ringIndex) ?? 0;
      if (forward) push(m, centre, a, b);
      else push(m, centre, b, a);""")
C = 'src/rendering/vehicle-bodies/closed-body.ts'
rep(C, """    this.top = new Track([
      [zR, y(s.tail * 0.96)],
      [zR + 0.14, y(s.tail)],""", """    this.top = new Track([
      [zR, y(s.tail - 0.07)],
      [zR + 0.05, y(s.tail - 0.018)],
      [zR + 0.16, y(s.tail)],""")
rep(C, """      [zF - 0.08, y(s.nose + 0.03)],
      [zF, y(s.nose - 0.02)],""", """      [zF - 0.08, y(s.nose + 0.02)],
      [zF - 0.02, y(s.nose - 0.02)],
      [zF, y(s.nose - 0.06)],""")
rep(C, """    this.taper = new Track([
      [zR, 0.86],
      [zR + 0.3, 0.97],""", """    this.taper = new Track([
      [zR, 0.8],
      [zR + 0.05, 0.9],
      [zR + 0.3, 0.97],""")
rep(C, """      [zF - 0.1, 0.84],
      [zF, 0.72],""", """      [zF - 0.1, 0.84],
      [zF - 0.03, 0.78],
      [zF, 0.7],""")
rep(C, """  const lower = loftRings(rings, {
    capStart: true,
    capEnd: true,
    material: (zMid, j) => model.slot(zMid, j, detail),
  });""", """  const lower = loftRings(rings, {
    capStart: true,
    capEnd: true,
    capMaterial: M.paint,
    material: (zMid, j) => model.slot(zMid, j, detail),
  });""")
