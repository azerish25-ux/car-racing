"""Build the single differential module: the catalogue driveline API first
(unchanged), then the stick-torque differential model with renamed presets."""
import sys
scratch, out = sys.argv[1], sys.argv[2]
theirs = open(scratch + '/diff-theirs.ts').read()
mine = open(scratch + '/diff-mine.ts').read()

# Mine without its imports (theirs already imports clamp; add Setup type).
assert mine.startswith("import { clamp } from '../core/math.ts';\nimport type { Setup } from './config.ts';\n")
body = mine.split('\n', 2)[2]

def rep(text, a, b, count=1):
    assert text.count(a) >= count, a
    return text.replace(a, b)

body = rep(body, """/** Differential models (docs/production/PHYSICS_MODEL.md §3.3), usable for an
 * axle or, with `split`, a centre differential feeding two axles.""",
"""/** Stick-torque differential model (docs/production/PHYSICS_MODEL.md §3.3),
 * usable for an axle or, with `split`, a centre differential feeding two
 * axles. It runs the APX-01 and TC-1 axle (LEGACY_AXLE: the former viscous
 * coupling, exact) and any `dynamics.differential` override; a catalogue
 * `driveline` above can be evaluated with it through `fromSpec`.""")
body = rep(body, "export const OPEN = differential({ kind: 'open' });\nexport const LOCKED = differential({ kind: 'locked', stickFraction: 0.8 });",
           "export const OPEN_AXLE = differential({ kind: 'open' });\n/** A spool: the outputs locked together (under-relaxed stick torque). */\nexport const SPOOL = differential({ kind: 'locked', stickFraction: 0.8 });")
body = rep(body, """        ? OPEN
        : name === 'locked' || name === 'spool'
          ? LOCKED""", """        ? OPEN_AXLE
        : name === 'locked' || name === 'spool'
          ? SPOOL""")
body = rep(body, """  } else if (value && typeof value === 'object')
    def = differential({ ...fallback, ...(value as Partial<DifferentialDefinition>) });""",
"""  } else if (value && typeof value === 'object')
    def =
      'type' in value
        ? fromSpec(value as DifferentialSpec)
        : differential({ ...fallback, ...(value as Partial<DifferentialDefinition>) });""")
body = rep(body, """/** Accepts a definition object or a model name""", """/** The stick-torque model of a catalogue DifferentialSpec: open, locked (a
 * spool at LOCKED_CAPACITY) or a clutch pack with the same preload and ramps,
 * scaled by the setup like `lockingCapacity`. */
export function fromSpec(spec: DifferentialSpec): DifferentialDefinition {
  return spec.type === 'open'
    ? OPEN_AXLE
    : spec.type === 'locked'
      ? differential({ ...SPOOL, maxLocking: LOCKED_CAPACITY })
      : differential({
          kind: 'clutch',
          preload: spec.preload,
          powerLock: spec.power,
          coastLock: spec.coast,
          setupScaled: true,
        });
}
/** Accepts a definition object, a catalogue DifferentialSpec or a model name""")

theirs = rep(theirs, "import { clamp } from '../core/math.ts';\n", "import { clamp } from '../core/math.ts';\nimport type { Setup } from './config.ts';\n")
open(out, 'w').write(theirs.rstrip('\n') + '\n\n' + body)
print('ok')
