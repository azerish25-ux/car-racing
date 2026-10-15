p='src/main.ts'
s=open(p).read()
def rep(old,new):
    global s
    assert s.count(old)==1, (s.count(old), old[:70])
    s=s.replace(old,new,1)
rep("""        this.replay?.recordSurface(message.water, message.rubber, message.time, message.marbles);
        if (this.state !== 'replay')
          this.renderer?.circuit.updateSurface(message.water, message.rubber, message.marbles);
        return;""","""        this.replay?.recordSurface(message.water, message.rubber, message.time, message.marbles);
        if (this.state !== 'replay')
          this.renderer?.circuit.updateSurface(message.water, message.rubber, message.marbles);
        // Terrain venues: rut keyframes, kept for replays (WP41).
        this.renderer?.circuit.offroad?.record(message.terrain, message.time, this.state !== 'replay');
        return;""")
rep("""      const surface = this.replay.surfaceState;
      if (surface.water.length && surface.time !== this.appliedReplaySurfaceTime) {
        this.renderer.circuit.updateSurface(surface.water, surface.rubber, surface.marbles);
        this.appliedReplaySurfaceTime = surface.time;
      }""","""      const surface = this.replay.surfaceState;
      if (surface.water.length && surface.time !== this.appliedReplaySurfaceTime) {
        this.renderer.circuit.updateSurface(surface.water, surface.rubber, surface.marbles);
        this.appliedReplaySurfaceTime = surface.time;
      }
      this.renderer.circuit.offroad?.showAt(targetTime);""")
rep("""    if (this.liveSurface)
      this.renderer?.circuit.updateSurface(
        this.liveSurface.water,
        this.liveSurface.rubber,
        this.liveSurface.marbles,
      );""","""    if (this.liveSurface)
      this.renderer?.circuit.updateSurface(
        this.liveSurface.water,
        this.liveSurface.rubber,
        this.liveSurface.marbles,
      );
    this.renderer?.circuit.offroad?.showAt(null);""")
open(p,'w').write(s)
