p='src/simulation/offroad/dirt-bike-vehicle.ts'
s=open(p).read()
old="""    d.x += Math.sin(d.heading) * this.flightSpeed * dt;
    d.z += Math.cos(d.heading) * this.flightSpeed * dt;"""
new="""    // The yaw rate carried off the ground (angular momentum) decays slowly:
    // a hop out of a turn keeps turning instead of flying off at a tangent.
    d.heading += this.flightYaw * dt;
    this.flightYaw *= Math.exp(-0.8 * dt);
    d.x += Math.sin(d.heading) * this.flightSpeed * dt;
    d.z += Math.cos(d.heading) * this.flightSpeed * dt;"""
assert old in s; s=s.replace(old,new)
old="""        this.flightSpeed = d.speed * Math.cos(Math.atan(this.faceSlope));"""
new="""        this.flightSpeed = d.speed * Math.cos(Math.atan(this.faceSlope));
        this.flightYaw = d.speed * d.curvature;"""
assert old in s; s=s.replace(old,new)
s=s.replace("""  private flightSpeed = 0;""","""  private flightSpeed = 0;
  private flightYaw = 0;""",1)
open(p,'w').write(s)

p='src/simulation/offroad/ai.ts'
s=open(p).read()
old="""    if (run < face + 7) {
      track.at(c.s, squarePoint);
      const d = c.dynamics,
        error = mod(Math.atan2(squarePoint.tx, squarePoint.tz) - d.heading + Math.PI, Math.PI * 2) - Math.PI;
      input.steer = clamp(error * 1.6 - d.lean * 0.4, -0.3, 0.3);
    }"""
new="""    if (run < face + 10) {
      track.at(c.s, squarePoint);
      const d = c.dynamics,
        error = mod(Math.atan2(squarePoint.tx, squarePoint.tz) - d.heading + Math.PI, Math.PI * 2) - Math.PI;
      input.steer = clamp(error * 2.2 - d.lean * 0.4, -0.5, 0.5);
    }"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
