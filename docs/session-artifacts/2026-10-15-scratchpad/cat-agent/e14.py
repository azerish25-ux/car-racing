import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')
p = 'src/rendering/vehicle-bodies/closed-body.ts'
s = open(p).read()
a = s.index("  if (s.extras.includes('spare') && detail < 2) {")
b = s.index("  if (s.extras.includes('cage') && detail === 0 && s.style !== 'roadster') {")
s = s[:a] + """  if (s.extras.includes('spare') && detail < 2) {
    // Spare wheel strapped flat in the bed: tyre, rim and hub.
    const zs = model.zRear + 0.62,
      ys = model.topY(zs) + f.radius * 0.26;
    const tyre = new T.TorusGeometry(f.radius * 0.76, f.radius * 0.25, 14, detail === 0 ? 40 : 16);
    parts.add(tyre.rotateX(Math.PI / 2), sharedMaterials.plastic(), placed(0, ys, zs));
    const rim = new T.CylinderGeometry(f.radius * 0.56, f.radius * 0.56, f.radius * 0.36, 24);
    parts.add(rim, sharedMaterials.rim(0x1a1b1d), placed(0, ys, zs));
    for (const side of [-1, 1])
      parts.add(roundedBox(0.04, 0.012, f.radius * 2.1, 0.004, 1), sharedMaterials.plastic(), placed(side * 0.12, ys + f.radius * 0.26, zs));
  }
  if (s.extras.includes('cage') && s.style === 'truck' && detail < 2) {
    // Exposed bed cage: tubes from the cab roof to the tail, shock towers.
    const steel = sharedMaterials.steel(),
      y1 = f.y(s.roof) - 0.04,
      zt = model.zRear + 0.12,
      yt = model.topY(zt) + 0.32;
    for (const side of [-1, 1]) {
      const x1 = side * hw(zRR) * s.roofWidth * 0.85,
        xt = side * hw(zt) * 0.72;
      parts.add(tubeGeometry([[x1, y1, zRR + 0.06], [x1 * 1.05, y1 - 0.08, zRR - 0.4], [xt, yt, zt]], 0.026, 20, 8), steel);
      parts.add(rodGeometry(new T.Vector3(xt, yt, zt), new T.Vector3(xt, model.topY(zt) - 0.02, zt - 0.05), 0.024, 8), steel);
      const zr = f.rearAxle;
      parts.add(rodGeometry(new T.Vector3(side * hw(zr) * 0.55, model.topY(zr) - 0.05, zr + 0.08), new T.Vector3(side * hw(zr) * 0.68, model.topY(zr) + 0.42, zr + 0.18), 0.045, 12), sharedMaterials.chrome());
    }
    parts.add(rodGeometry(new T.Vector3(-hw(zt) * 0.72, yt, zt), new T.Vector3(hw(zt) * 0.72, yt, zt), 0.026, 8), steel);
    for (const x of [-0.35, 0, 0.35])
      parts.add(roundedBox(0.09, 0.07, 0.05, 0.015, 2), mats.tail, placed(x * hw(zt), yt + 0.02, zt - 0.03));
  }
""" + s[b:].replace("  if (s.extras.includes('cage') && detail === 0 && s.style !== 'roadster') {",
                    "  if (s.extras.includes('cage') && detail === 0 && s.style !== 'roadster' && s.style !== 'truck') {", 1)
open(p, 'w').write(s)
q = 'src/rendering/vehicle-bodies/body-sheet.ts'
s = open(q).read()
i = s.index('  dx8: {')
j = s.index('\n  },', i)
block = s[i:j]
block = block.replace('    deck: 1.5,', '    deck: 1.3,').replace('    tail: 1.46,', '    tail: 1.24,').replace('    cabin: [0.32, 0.46, 0.7, 0.78],', '    cabin: [0.3, 0.44, 0.68, 0.76],')
s = s[:i] + block + s[j:]
open(q, 'w').write(s)
