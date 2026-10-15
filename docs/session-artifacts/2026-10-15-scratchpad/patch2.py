ROOT = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/'
def patch(path, pairs):
    p = ROOT + path
    s = open(p).read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit(f'missing in {path}: {old[:80]}')
        s = s.replace(old, new)
    open(p, 'w').write(s)

patch('src/simulation/open-world/session.ts', [
    ("""  assisted: boolean;
  progressClock: number;
}""", """  assisted: boolean;
  progressClock: number;
  /** Seconds the player has been off the legal route (resets on return). */
  lost: number;
}"""),
    ("""        const back = event.path.at(Math.min(30, event.path.length / 2), this.pp);
        const fresh = this.makeCar(0, this.player.definition.id);
        this.cars[0] = fresh;
        // Arrive a little short of the marker on the road behind it.
        this.placeOnPath(fresh, event.path, 0, 0);
        void back;""", """        const fresh = this.makeCar(0, this.player.definition.id);
        this.cars[0] = fresh;
        this.placeOnPath(fresh, event.path, 0, 0);"""),
    ("""      assisted: this.autopilot,
      progressClock: 0,
    };""", """      assisted: this.autopilot,
      progressClock: 0,
      lost: 0,
    };"""),
    ("""  /** Remove rivals and return to free roam. */
  private endRun(announce = true) {
    if (this.run) this.cars = [this.player];
    this.run = null;
    if (this.mode !== 'free' && announce) this.mode = 'free';
    this.mode = 'free';
  }""", """  /** Remove rivals and return to free roam. */
  private endRun() {
    if (this.run) this.cars = [this.player];
    this.run = null;
    this.mode = 'free';
  }"""),
    ("""    this.endRun(false);
    this.cardEvent = null;""", """    this.endRun();
    this.cardEvent = null;"""),
    ("""      at: this.time,
      ...(run.assisted ? { assisted: true } : {}),
    };""", """      at: this.time,
      assisted: run.assisted,
    };"""),
    ("""    run.progressClock += dt;
    if (run.progressClock < 1 / 30 && this.mode === 'running') {
      run.drift?.update(this.player, this.time, dt, !this.track.query.onRoad, this.player.impact > 0.25);
      return;
    }
    const step = run.progressClock;
    run.progressClock = 0;
    run.drift?.update(this.player, this.time, step, !this.track.query.onRoad, this.player.impact > 0.25);
    if (this.mode !== 'running') return;""", """    if (this.mode !== 'running') return;
    // The player's ground was sampled last in step(): drift validity reads it.
    run.drift?.update(this.player, this.time, dt, !this.track.query.onRoad, this.player.impact > 0.25);
    run.progressClock += dt;
    if (run.progressClock < 1 / 30) return;
    const step = run.progressClock;
    run.progressClock = 0;"""),
    ("""    if (player.progress.offRoute) {
      const lost = (run as Run & { lost?: number }).lost ?? 0;
      (run as Run & { lost?: number }).lost = lost + step;
      if (lost + step > limit) this.abandon();
    } else (run as Run & { lost?: number }).lost = 0;""", """    run.lost = player.progress.offRoute ? run.lost + step : 0;
    if (run.lost > limit) this.abandon();"""),
    ("""      const path = run.event.path,
        p = run.participants[0],
        lapDistance = p.progress.distance % path.length;
      const ranking""", """      const p = run.participants[0];
      const ranking"""),
    ("""        gate: gatePoint,
      };
      void lapDistance;
    }""", """        gate: gatePoint,
      };
    }"""),
])
patch('src/simulation/open-world/festival-events.ts', [
    ("""  standings: { car: number; name: string; vehicleId: string; time: number | null; progress: number }[];
  /** Simulation time the result was produced (s). */
  at: number;
}""", """  standings: { car: number; name: string; vehicleId: string; time: number | null; progress: number }[];
  /** Simulation time the result was produced (s). */
  at: number;
  /** The AI drove the player's car for part of the event (not a record). */
  assisted: boolean;
}"""),
    ("""/** Progress metric for ordering (laps, then legal distance). */
export function raceProgress(p: Participant, path: RoutePath) {
  return p.progress.laps * path.length + p.progress.distance - p.progress.laps * path.length * 0 + (p.finishTime !== null ? 1e9 - p.finishTime : 0);
}
""", ""),
])
print('ok')
