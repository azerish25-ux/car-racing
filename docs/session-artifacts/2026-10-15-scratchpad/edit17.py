p='src/simulation/offroad/session.ts'
s=open(p).read()
def rep(old,new,count=1):
    global s
    assert old in s, old[:60]
    s=s.replace(old,new,count)
rep("""  jokerJudged: boolean;
  progress: RouteProgress | null;""","""  jokerJudged: boolean;
  /** Lap distance at the last step (joker timing line crossings). */
  lastS: number;""")
rep("""      jokerJudged: false,
      progress: null,""","""      jokerJudged: false,
      lastS: 0,""")
rep(""" * jump-start detection and the holeshot, rallycross joker laps counted on a
 * RouteGraph and enforced at the flag, rally stages with staggered starts,
 * splits and a stop control — on top of the shared RaceDirector. */""",""" * jump-start detection and the holeshot, rallycross joker laps counted at
 * the joker road's timing line and enforced at the flag, rally stages with
 * staggered starts, splits and a stop control on a RouteGraph — on top of
 * the shared RaceDirector. */""")
rep("""  /** Joker route (rallycross) and the stage route (rally). */""","""  /** The stage route (rally): start, split checkpoints, finish. */""")
rep("""    if (this.route && this.format?.kind === 'rallycross')
      for (const [id, c] of cars.entries()) {
        const progress = new RouteProgress(this.route, 9, (this.course.spec.joker?.ramp ?? 20) + 14);
        const at = this.route.project('lap-b', c.body.position);
        progress.s = at ? at.s : 0;
        this.entrants[id].progress = progress;
      }
""","""    for (const [id, c] of cars.entries()) this.entrants[id].lastS = c.s;
""")
start=s.index("    const joker = course.spec.joker;\n    if (joker && this.format?.kind === 'rallycross') {")
end=s.index("    const stage = course.spec.stage;")
s=s[:start]+s[end:]
rep("""  private jokers() {
    const f = this.format!,
      race = this.race;
    for (const [id, c] of this.cars.entries()) {
      const e = this.entrants[id];
      if (!e.progress || c.retired) continue;
      const before = e.progress.edge;
      e.progress.update(c.body.position);
      if (e.progress.edge === 'joker' && before !== 'joker' && race.phase === PHASE.RACING) {
        e.jokers++;
        this.note(id, 'JOKER', `JOKER LAP ${e.jokers}/${f.joker!.required}`);
      }""","""  /** Joker laps: a crossing of the joker road's timing line (half way
   * along it, where the two roads are fully apart) on the joker road. */
  private jokers() {
    const f = this.format!,
      race = this.race,
      joker = this.course.spec.joker!,
      L = this.track.length,
      line = mod(joker.from + mod(joker.to - joker.from, L) / 2, L);
    for (const [id, c] of this.cars.entries()) {
      const e = this.entrants[id];
      if (c.retired) continue;
      const delta = mod(c.s - e.lastS + L / 2, L) - L / 2;
      if (
        race.phase === PHASE.RACING &&
        delta > 0 &&
        delta < 15 &&
        mod(line - e.lastS, L) <= delta &&
        this.course.onJoker(line, c.lateral)
      ) {
        e.jokers++;
        this.note(id, 'JOKER', `JOKER LAP ${e.jokers}/${f.joker!.required}`);
      }
      e.lastS = c.s;""")
open(p,'w').write(s)

p='src/simulation/offroad/ai.ts'
s=open(p).read()
old="""      // On the joker road already (it started early): stay on it.
      const e = session?.entrants[this.car.id];
      return e?.progress?.edge === 'joker' ? centre : racing;"""
new="""      // On the joker road already (it started early): stay on it.
      return course.onJoker(this.car.s, this.car.lateral) ? centre : racing;"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
