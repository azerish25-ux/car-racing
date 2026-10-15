p='src/simulation/offroad/ai.ts'
s=open(p).read()
old="""  protected override lineOffset(track: Track, s: number, racing: number) {
    void track;
    void s;
    return racing + this.rutBias;
  }"""
new="""  /** The rut-biased racing line, held straight over a jump (from the run-up
   * to the end of the landing): a bike leaves a lip upright and square to it,
   * so the line's own swing across a straight for the next corner waits. */
  protected override lineOffset(track: Track, s: number, racing: number) {
    const base = racing + this.rutBias,
      course = offroadCourse(track.circuit);
    if (!course) return base;
    const L = track.length;
    for (const j of course.jumps) {
      const from = j.start - JUMP_LINE_LEAD,
        rel = mod(s - from, L),
        span = j.end + 2 - from;
      if (rel > span + JUMP_LINE_BLEND) continue;
      const frozen = racingLineFor(track).offsetAt(mod(from, L)),
        w = rel < JUMP_LINE_BLEND ? smooth(rel / JUMP_LINE_BLEND) : rel > span ? 1 - smooth((rel - span) / JUMP_LINE_BLEND) : 1;
      return base + (frozen - base) * w;
    }
    return base;
  }"""
assert old in s; s=s.replace(old,new)
old="""/** Lip speed (m/s) a rider rolls a feature at"""
new="""/** The line is held straight from this far before a jump's face (m) and
 * blended in and out over JUMP_LINE_BLEND metres. */
const JUMP_LINE_LEAD = 18,
  JUMP_LINE_BLEND = 10;
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
/** Lip speed (m/s) a rider rolls a feature at"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
