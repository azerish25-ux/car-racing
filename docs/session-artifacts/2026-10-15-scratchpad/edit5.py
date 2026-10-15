p='src/simulation/offroad/dirt-bike-vehicle.ts'
s=open(p).read()
old="""    // The rider's body damps pitch: strongly with a wheel down, a little in the air.
    this.pitchRate *= Math.exp(-(contact ? 1.5 : 0.3) * dt);"""
new="""    // The rider's body damps pitch: strongly with a wheel down (more when
    // standing over rough ground), a little in the air.
    this.pitchRate *= Math.exp(-(contact ? 1.5 + 2.5 * this.standing : 0.3 + 0.5 * this.standing) * dt);"""
assert old in s
s=s.replace(old,new)
old="""    if (r.outcome === 'clean' && r.airTime > 0.12) {
      if (r.pitchError < -a.noseDownLimit && r.normalSpeed > 1.5) {
        r.outcome = 'crash-front';
        d.fall('highside');
      } else if (r.pitchError > a.noseUpLimit && r.normalSpeed > 2) {"""
new="""    // Skimming whoops and rollers the rider expects the hops: wider limits.
    const course = this.lastTrack ? offroadCourse(this.lastTrack.circuit) : null,
      tolerance = course?.isRough(r.s) ? 1.5 : 1;
    if (r.outcome === 'clean' && r.airTime > 0.12) {
      if (r.pitchError < -a.noseDownLimit * tolerance && r.normalSpeed > 1.5) {
        r.outcome = 'crash-front';
        d.fall('highside');
      } else if (r.pitchError > a.noseUpLimit * tolerance && r.normalSpeed > 2) {"""
assert old in s
s=s.replace(old,new)
open(p,'w').write(s)
p='src/simulation/offroad/venues.ts'
s=open(p).read()
s=s.replace("p.whoops({ at: at(8, 14), count: 10, spacing: 4.6, height: 0.55 });","p.whoops({ at: at(8, 14), count: 9, spacing: 5, height: 0.45 });")
s=s.replace("p.whoops({ at: at(4, 12), count: 12, spacing: 3.8, height: 0.5 });","p.whoops({ at: at(4, 12), count: 11, spacing: 4.2, height: 0.4 });")
open(p,'w').write(s)
