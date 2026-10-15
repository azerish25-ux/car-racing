p='src/simulation/offroad/ai.ts'
s=open(p).read()
old="""    const onFace = run < j.takeoff - j.start + 0.5,
      e = c.aiTarget - c.speed;
    if (onFace) {
      input.throttle = clamp(0.2 + 0.5 * Math.max(0, e), 0, 1);
      input.brake = 0;
    } else {
      input.throttle = clamp(0.25 + 0.9 * e, 0, 1);
      input.brake = clamp(-0.35 * e, 0, 1);
    }
  }"""
new="""    const face = j.takeoff - j.start,
      onFace = run < face + 0.5,
      e = c.aiTarget - c.speed;
    if (onFace) {
      input.throttle = clamp(0.2 + 0.5 * Math.max(0, e), 0, 1);
      input.brake = 0;
    } else {
      input.throttle = clamp(0.25 + 0.9 * e, 0, 1);
      input.brake = clamp(-0.35 * e, 0, 1);
    }
    // Square to the lip and upright: from a few metres out the lean intent
    // only aligns the heading with the face (the lateral is kept).
    if (run < face + 7) {
      track.at(c.s, squarePoint);
      const d = c.dynamics,
        error = mod(Math.atan2(squarePoint.tx, squarePoint.tz) - d.heading + Math.PI, Math.PI * 2) - Math.PI;
      input.steer = clamp(error * 1.6 - d.lean * 0.4, -0.3, 0.3);
    }
  }"""
assert old in s; s=s.replace(old,new)
s=s.replace("const previewPoint = trackPoint();","const previewPoint = trackPoint(),\n  squarePoint = trackPoint();")
open(p,'w').write(s)

p='src/simulation/offroad/course.ts'
s=open(p).read()
old="""  legalWidth(width: number, s: number, lateral: number) {
    const c = this.jokerCentre(s);
    if (c === null) return width;"""
new="""  legalWidth(width: number, s: number, lateral: number) {
    // A berm's face is track: riders use it to its lip.
    const at = mod(s, this.length);
    for (const b of this.spec.berms)
      if (inSpan(at, b.from, b.to, this.length) && (b.side ?? 0) * lateral > 0) {
        width += BERM_ALLOWANCE;
        break;
      }
    const c = this.jokerCentre(s);
    if (c === null) return width;"""
assert old in s; s=s.replace(old,new)
old="""export const BAND_MARGIN"""
new="""/** Legal width a berm adds on its outside (m). */
const BERM_ALLOWANCE = 1.6;
export const BAND_MARGIN"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
