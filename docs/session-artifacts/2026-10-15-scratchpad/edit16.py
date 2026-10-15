p='src/simulation/offroad/dirt-bike-vehicle.ts'
s=open(p).read()
old="""    // The yaw rate carried off the ground (angular momentum) decays slowly:
    // a hop out of a turn keeps turning instead of flying off at a tangent.
    d.heading += this.flightYaw * dt;
    this.flightYaw *= Math.exp(-0.8 * dt);
"""
assert old in s; s=s.replace(old,"")
s=s.replace("""        this.flightYaw = d.speed * d.curvature;\n""","")
s=s.replace("""  private flightYaw = 0;\n""","")
open(p,'w').write(s)

p='src/simulation/offroad/ai.ts'
s=open(p).read()
old="""    const L = track.length;
    for (const j of course.jumps) {
      const from = j.start - JUMP_LINE_LEAD,
        rel = mod(s - from, L),
        span = j.end + 2 - from;
      if (rel > span + JUMP_LINE_BLEND) continue;
      const frozen = racingLineFor(track).offsetAt(mod(from, L)),
        w = rel < JUMP_LINE_BLEND ? smooth(rel / JUMP_LINE_BLEND) : rel > span ? 1 - smooth((rel - span) / JUMP_LINE_BLEND) : 1;
      return base + (frozen - base) * w;
    }
    return base;"""
new="""    const L = track.length,
      line = racingLineFor(track);
    // Whoops and rollers are crossed straight too (a diagonal over bumps
    // drifts on every hop), on the line the rider wants at their exit.
    for (const r of course.rough) {
      const from = r.from - 8,
        rel = mod(s - from, L),
        span = mod(r.to - from, L);
      if (rel > span + JUMP_LINE_BLEND) continue;
      const frozen = clamp(line.offsetAt(mod(r.to, L)), -2.5, 2.5),
        w = rel < JUMP_LINE_BLEND ? smooth(rel / JUMP_LINE_BLEND) : rel > span ? 1 - smooth((rel - span) / JUMP_LINE_BLEND) : 1;
      return base + (frozen - base) * w;
    }
    for (const j of course.jumps) {
      const from = j.start - JUMP_LINE_LEAD,
        rel = mod(s - from, L),
        span = j.end + 2 - from;
      if (rel > span + JUMP_LINE_BLEND) continue;
      const frozen = clamp(line.offsetAt(mod(from, L)), -2.5, 2.5),
        w = rel < JUMP_LINE_BLEND ? smooth(rel / JUMP_LINE_BLEND) : rel > span ? 1 - smooth((rel - span) / JUMP_LINE_BLEND) : 1;
      return base + (frozen - base) * w;
    }
    return base;"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
