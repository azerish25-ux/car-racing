import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')
p = 'src/rendering/vehicle-bodies/closed-body.ts'
s = open(p).read()
a = s.index('  // Lamps: lenses follow the nose and tail surfaces.')
b = s.index('  // Exhausts.')
new = open('/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/cat-agent/lamps.ts.part').read()
s = s[:a] + new + s[b:]
open(p, 'w').write(s)
o = 'src/rendering/vehicle-bodies/open-wheel.ts'
s = open(o).read()
old = """    parts.add(roundedBox(0.36, 0.26, 0.03, 0.03, 2), mats.board, placed(0, y(0.32), zF + 0.05, -0.45));"""
assert old in s
s = s.replace(old, """    parts.add(roundedBox(0.4, 0.3, 0.02, 0.03, 2), mats.paint, placed(0, y(0.32), zF + 0.04, -0.45));
    parts.add(new T.PlaneGeometry(0.3, 0.24), mats.board, placed(0, y(0.325), zF + 0.055, -0.45));""")
# Historic exhausts: tidy pipes along the tail with flared tips.
old2 = """    for (const side of [-1, 1])
      for (let k = 0; k < 4; k++) {
        const z0 = ze + 0.2 - k * 0.14;
        parts.add(
          tubeGeometry([[side * 0.2, y(0.42), z0], [side * 0.26, y(0.5), z0 - 0.05], [side * 0.28, y(0.56), f.rearAxle - 0.25 - k * 0.02], [side * 0.27, y(0.6), f.rearAxle - 0.55]], 0.018, 16, 6),
          sharedMaterials.exhaust(),
        );
      }"""
assert old2 in s
s = s.replace(old2, """    for (const side of [-1, 1])
      for (let k = 0; k < 4; k++) {
        const z0 = ze + 0.22 - k * 0.12;
        parts.add(
          tubeGeometry([[side * 0.12, y(0.46), z0], [side * (0.2 + k * 0.012), y(0.5), z0 - 0.08], [side * 0.24, y(0.48), f.rearAxle - 0.1], [side * 0.22, y(0.44), zTail - 0.05]], 0.016, 16, 6),
          sharedMaterials.exhaust(),
        );
      }
    for (const side of [-1, 1])
      parts.add(new T.CylinderGeometry(0.045, 0.03, 0.14, 12).rotateX(Math.PI / 2), sharedMaterials.exhaust(), placed(side * 0.22, y(0.44), zTail - 0.1));""")
open(o, 'w').write(s)
