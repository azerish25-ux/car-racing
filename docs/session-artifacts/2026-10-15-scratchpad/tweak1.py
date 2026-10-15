p = 'src/rendering/vehicle-bodies/body-sheet.ts'
s = open(p).read()


def block(id_):
    start = s.index(f"\n  {id_}: {{\n")
    end = s.index("\n  },\n", start) + len("\n  },\n")
    return start, end


def patch(id_, pairs):
    global s
    a, b = block(id_)
    text = s[a:b]
    for old, new in pairs:
        assert text.count(old) == 1, (id_, old, text.count(old))
        text = text.replace(old, new)
    s = s[:a] + text + s[b:]


patch('hh2', [
    ("    roof: 1.36,\n    deck: 1.18,", "    roof: 1.34,\n    deck: 1.2,"),
    ("    wing: { kind: 'roof', at: 1.02, height: 1.38, chord: 0.3, span: 0.94, flap: true },",
     "    wing: { kind: 'pedestal', at: 1.16, height: 1.3, chord: 0.28, span: 0.9, flap: true },"),
])
patch('hy11', [
    ("    nose: 0.38,\n    bonnet: 0.66,", "    nose: 0.44,\n    bonnet: 0.7,"),
    ("    roof: 1.06,\n    deck: 0.9,", "    roof: 1.08,\n    deck: 0.98,"),
    ("    cabin: [0.14, 0.32, 0.52, 0.76],", "    cabin: [0.18, 0.36, 0.56, 0.8],"),
    ("    wing: { kind: 'swan-neck', at: 1.2, height: 0.98, chord: 0.34, span: 0.94, flap: true },",
     "    wing: { kind: 'swan-neck', at: 1.2, height: 1.08, chord: 0.34, span: 0.94, flap: true },"),
])
patch('tc3', [
    ("    bonnet: 0.84,", "    bonnet: 0.8,"),
    ("    roof: 1.32,\n    deck: 1.04,", "    roof: 1.3,\n    deck: 1.06,"),
    ("    cabin: [0.2, 0.42, 0.9, 1.12],", "    cabin: [0.24, 0.44, 0.86, 1.08],"),
    ("    flare: [0.12, 0.12],", "    flare: [0.14, 0.14],"),
    ("    wing: { kind: 'full-width', at: 1.2, height: 1.18, chord: 0.24, span: 0.96, flap: false },",
     "    wing: { kind: 'full-width', at: 1.2, height: 1.26, chord: 0.24, span: 0.96, flap: false },"),
])
patch('rr4', [
    ("    deck: 1.08,", "    deck: 1.1,"),
    ("    wing: { kind: 'pedestal', at: 1.26, height: 1.26, chord: 0.24, span: 0.84, flap: false },",
     "    wing: { kind: 'pedestal', at: 1.26, height: 1.32, chord: 0.24, span: 0.84, flap: false },"),
])
patch('xh3', [
    ("    roof: 1.12,\n    deck: 0.86,\n    tail: 0.86,", "    roof: 1.18,\n    deck: 0.84,\n    tail: 0.8,"),
    ("    cabin: [0.16, 0.34, 0.56, 0.84],", "    cabin: [0.2, 0.38, 0.62, 0.9],"),
    ("    wing: { kind: 'full-width', at: 1.2, height: 0.9, chord: 0.28, span: 0.96, flap: false },",
     "    wing: { kind: 'lip', at: 1.3, height: 0.86, chord: 0.2, span: 0.9, flap: false },"),
])
open(p, 'w').write(s)
print('ok')
