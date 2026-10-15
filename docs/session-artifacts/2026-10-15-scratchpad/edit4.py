p='src/simulation/offroad/dirt-bike-vehicle.ts'
s=open(p).read()
s=s.replace("""  /** Adapter clock (s), independent of the race clock. */
  clock = 0;""","""  /** Adapter clock (s), independent of the race clock. */
  clock = 0;
  /** Why each crash happened (landing outcomes, grip, contact), with its lap distance. */
  readonly crashCauses: { cause: string; s: number; time: number }[] = [];""")
old="""    if (was === 'riding' && d.state !== 'riding') this.separate();"""
new="""    if (was === 'riding' && d.state !== 'riding') {
      const landing = this.lastLanding,
        fromLanding = landing && landing.outcome.startsWith('crash') && this.clock - landing.time < 0.5;
      this.crashCauses.push({
        cause: fromLanding ? landing.outcome : this.crashReason || `grip-${d.state}`,
        s: this.s,
        time: this.clock,
      });
      if (this.crashCauses.length > 32) this.crashCauses.shift();
      this.crashReason = '';
      this.separate();
    }"""
assert old in s
s=s.replace(old,new,1)
old="""    if (this.contactCrash) {
      this.contactCrash = false;"""
new="""    if (this.contactCrash) {
      this.contactCrash = false;
      this.crashReason = 'contact';"""
assert old in s
s=s.replace(old,new,1)
s=s.replace("""  private airTorque = 0;""","""  private airTorque = 0;
  private crashReason = '';""")
open(p,'w').write(s)
p='scratch-moto.ts'
s=open(p).read()
s=s.replace("""  console.log(c.id, 'finish', c.finishTime.toFixed(1), 'best', sim.race.laps[c.id].best.toFixed(1), 'crashes', b.dynamics?.crashes, 'last landing', JSON.stringify(b.lastLanding));""","""  console.log(c.id, 'finish', c.finishTime.toFixed(1), 'best', sim.race.laps[c.id].best.toFixed(1), 'crashes', b.dynamics?.crashes, JSON.stringify(b.crashCauses?.map((x) => `${x.cause}@${x.s.toFixed(0)}`)));""")
s=s.replace("console.log(sim.race.control.events.slice(-10));","")
open(p,'w').write(s)
