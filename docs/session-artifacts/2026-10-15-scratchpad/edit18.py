p='src/simulation/ai.ts'
s=open(p).read()
old="""      this.desiredOffset = plan.offset;"""
new="""      this.desiredOffset = this.laneOverride(track, c.s, plan.offset);"""
assert old in s; s=s.replace(old,new)
old="""    const reach = Math.max(1, this.target.width - RACING_LINE.edgeMargin);"""
new="""    const reach = this.laneReach(track, c.s + lookahead, Math.max(1, this.target.width - RACING_LINE.edgeMargin));"""
assert old in s; s=s.replace(old,new)
old="""  /** Lateral line target at lap distance `s` (m from the centreline); the"""
new="""  /** The traffic lane a venue driver insists on (a rallycross joker road
   * beyond the main road's width); the planner's lane by default. */
  protected laneOverride(track: Track, s: number, planned: number) {
    void track;
    void s;
    return planned;
  }
  /** Lateral reach of the path target at `s` (m); the road's own by default. */
  protected laneReach(track: Track, s: number, reach: number) {
    void track;
    void s;
    return reach;
  }
  /** Lateral line target at lap distance `s` (m from the centreline); the"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/simulation/offroad/ai.ts'
s=open(p).read()
old="""  private raceRef: RaceDirector | null = null;"""
new="""  /** On the joker road the car keeps its lane (the planner's lanes end at
   * the main road's edge), and the path target may reach the joker road. */
  protected override laneOverride(track: Track, s: number, planned: number) {
    const course = offroadCourse(track.circuit),
      centre = course?.jokerCentre(s) ?? null;
    if (centre === null || !this.raceRef) return planned;
    const on = course!.onJoker(s, this.car.lateral);
    return on || this.wantsJoker(track, this.raceRef) ? centre : planned;
  }
  protected override laneReach(track: Track, s: number, reach: number) {
    const course = offroadCourse(track.circuit),
      centre = course?.jokerCentre(s) ?? null;
    if (centre === null) return reach;
    return Math.max(reach, Math.abs(centre) + course!.spec.joker!.halfWidth - 1.2);
  }
  private raceRef: RaceDirector | null = null;"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
