import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')
p = 'src/rendering/vehicle-bodies/loft.ts'
s = open(p).read()
a = s.index('export function roundedBox(')
b = s.index('/** Wing element: a cambered aerofoil')
s = s[:a] + '''export function roundedBox(w: number, h: number, d: number, r: number, segments = 3) {
  // The bevel grows the outline by 0.6 r on every side: shrink the profile so
  // the finished part measures exactly w x h x d.
  const grow = r * 0.6,
    pw = Math.max(0.002, w - 2 * grow),
    ph = Math.max(0.002, h - 2 * grow),
    rr = Math.min(r, pw / 2 - 0.0005, ph / 2 - 0.0005);
  const x = pw / 2 - rr,
    y = ph / 2 - rr;
  const shape = new T.Shape();
  shape.moveTo(-x, -ph / 2);
  shape.lineTo(x, -ph / 2);
  shape.absarc(x, -y, rr, -Math.PI / 2, 0, false);
  shape.lineTo(pw / 2, y);
  shape.absarc(x, y, rr, 0, Math.PI / 2, false);
  shape.lineTo(-x, ph / 2);
  shape.absarc(-x, y, rr, Math.PI / 2, Math.PI, false);
  shape.lineTo(-pw / 2, -y);
  shape.absarc(-x, -y, rr, Math.PI, Math.PI * 1.5, false);
  const depth = Math.max(0.001, d - 2 * r);
  const g = new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: Math.min(r, d / 2),
    bevelSize: grow,
    bevelSegments: segments,
    curveSegments: segments * 2,
  });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}
''' + s[b:]
open(p, 'w').write(s)
c = 'src/rendering/vehicle-bodies/closed-body.ts'
s = open(c).read()
old = """  if (s.diffuser > 0 && detail < 2) {
    const h = 0.04 + s.diffuser * 0.45;"""
assert old in s
s = s.replace(old, """  if (detail < 2) {
    // Lower rear valance across the tail, and the diffuser ramp behind it.
    const zv = model.zRear - 0.004,
      half = hw(model.zRear) * 0.8;
    parts.add(roundedBox(half * 1.9, 0.1, 0.03, 0.012, 1), sharedMaterials.plastic(), placed(0, f.y(s.floor) + 0.17, zv + 0.01));
    if (s.diffuser > 0) {
      const ramp = roundedBox(half * 1.6, 0.012, 0.6, 0.004, 1);
      parts.add(ramp, sharedMaterials.carbonSatin(), placed(0, f.y(s.floor) + 0.07, model.zRear + 0.3, 0.2));
    }
  }
  if (s.diffuser > 0 && detail < 2) {
    const h = 0.04 + s.diffuser * 0.45;""")
open(c, 'w').write(s)
