import sys
root = sys.argv[1]
threshold = sys.argv[2] if len(sys.argv) > 2 else '0.9'
gain = sys.argv[3] if len(sys.argv) > 3 else '5'
p = root + '/src/simulation/ai.ts'
s = open(p).read()
a = """    if (wheelspin > spinLimit)
      command.throttle *= clamp(1 - ((wheelspin - spinLimit) * 5) / slipScale(c.tires[2]), 0.05, 1);"""
b = """    if (wheelspin > spinLimit)
      command.throttle *= clamp(1 - ((wheelspin - spinLimit) * 5) / slipScale(c.tires[2]), 0.05, 1);
    // The driven axle's combined friction use (tyre-model output): drive slip
    // costs lateral grip, so power is fed in only while the driven tyres keep
    // a margin on their friction ellipse (power oversteer / understeer).
    const driven = c.definition.drivetrain === 'fwd' ? 0 : 2,
      drivenUse = Math.max(c.tires[driven].usage, c.tires[driven + 1].usage);
    if (drivenUse > THRESHOLD)
      command.throttle *= clamp(1 - (drivenUse - THRESHOLD) * GAIN, 0.25, 1);""".replace('THRESHOLD', threshold).replace('GAIN', gain)
if a in s:
    s = s.replace(a, b)
else:
    import re
    start = s.index("    // The driven axle's combined friction use")
    end = s.index("0.25, 1);", start) + len("0.25, 1);")
    s = s[:start] + b.split('\n', 2)[2] + s[end:]
open(p, 'w').write(s)
print('ok')
