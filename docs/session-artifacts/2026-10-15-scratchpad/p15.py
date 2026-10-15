import sys, re
root = sys.argv[1]
p = root + '/src/simulation/surface-material.ts'
s = open(p).read()
a = """  readonly falloff: number;"""
b = """  readonly falloff: number;
  /** Combined-slip coupling scale: on deformable ground part of the lateral
   * resistance is ploughing of the rut wall, which wheelspin or locking does
   * not remove, so slip in one direction costs the other less (1 = rigid). */
  readonly coupling: number;"""
assert a in s
s = s.replace(a, b, 1)
couplings = [1, 1, 1, 0.35, 0.25, 1, 0.5, 0.3, 0.25, 0.5, 1]
idx = 0
def add(m):
    global idx
    value = couplings[idx]
    idx += 1
    return m.group(0) + f"\n    coupling: {value},"
s = re.sub(r"    falloff: [0-9.]+,", add, s)
assert idx == 11, idx
open(p, 'w').write(s)

p = root + '/src/simulation/tyre-force.ts'
s = open(p).read()
a = """  groundFalloff: number,
  out: SlipState,
) {"""
b = """  groundFalloff: number,
  out: SlipState,
  groundCoupling = 1,
) {"""
assert a in s
s = s.replace(a, b, 1)
a = """  out.by1 = c.combined.by1;
  out.by2 = c.combined.by2;
  out.bx1 = c.combined.bx1;
  out.bx2 = c.combined.bx2;"""
b = """  out.by1 = c.combined.by1 * groundCoupling;
  out.by2 = c.combined.by2;
  out.bx1 = c.combined.bx1 * groundCoupling;
  out.bx2 = c.combined.bx2;"""
assert a in s
s = s.replace(a, b, 1)
open(p, 'w').write(s)

p = root + '/src/simulation/tire.ts'
s = open(p).read()
a = """    material.falloff,
    SLIP,
  );"""
b = """    material.falloff,
    SLIP,
    material.coupling,
  );"""
assert a in s
s = s.replace(a, b, 1)
open(p, 'w').write(s)
print('ok')
