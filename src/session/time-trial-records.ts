import {
  GhostPlayer,
  GhostRecorder,
  ghostKey,
  ghostPose,
  validateGhost,
  type GhostLap,
  type GhostPose,
} from '../core/ghost-lap.ts';
import { recordCategory } from '../core/session-identity.ts';
import type { SessionOptions } from '../simulation/config.ts';
import { F, carBase } from '../simulation/protocol.ts';
import type { Track } from '../simulation/track.ts';
import { insertLeaderboard, leaderboardKey } from '../storage/leaderboard.ts';
import { lapTime } from '../ui/interface.ts';

/** What the records lifecycle needs from the application (WP13). */
export interface RecordsHost {
  store: { read(key: string): Promise<unknown>; write(key: string, value: unknown): Promise<void> };
  toast(message: string): void;
  playerName(): string;
}
/** Time-trial ghost and local leaderboard lifecycle, extracted from the
 * application coordinator: load the category's personal best, offer each
 * completed lap, save improvements and pose the ghost for presentation. */
export class TimeTrialRecords {
  private recorder: GhostRecorder | null = null;
  player: GhostPlayer | null = null;
  /** HUD state: personal best and live delta (null outside time trial). */
  trial: { best: number; delta: number | null } | null = null;
  private readonly pose = ghostPose();
  constructor(private readonly host: RecordsHost) {}
  clear() {
    this.recorder = null;
    this.player = null;
    this.trial = null;
  }
  /** Load the saved ghost; `current()` is false once a newer session began. */
  async prepare(options: SessionOptions, track: Track, current: () => boolean) {
    this.clear();
    if (options.mode !== 'time-trial') return;
    const circuit = track.circuit.id,
      length = track.length,
      category = recordCategory(options);
    this.recorder = new GhostRecorder({
      circuit,
      trackLength: length,
      assist: options.assist,
      compound: options.compound,
      weather: options.weather,
      vehicle: category.vehicle,
    });
    let saved: GhostLap | null = null;
    try {
      saved = validateGhost(
        await this.host.store.read(ghostKey(circuit, category.vehicle)),
        circuit,
        length,
        category,
      );
    } catch (error) {
      this.host.toast(`Saved ghost unavailable: ${String(error)}`);
    }
    if (!current()) return;
    this.player = saved ? new GhostPlayer(saved) : null;
    this.trial = { best: saved?.lapTime ?? 0, delta: null };
    this.host.toast(
      saved
        ? `TIME TRIAL · PERSONAL BEST ${lapTime(saved.lapTime)} · GHOST LOADED`
        : 'TIME TRIAL · SET A VALID LAP TO SAVE YOUR GHOST',
    );
  }
  /** Offer each accepted snapshot; keep a lap only if it beats the ghost. */
  observe(
    frame: Float32Array,
    driverControlled: boolean,
    options: SessionOptions,
    session: string,
  ) {
    if (!this.recorder) return;
    const lap = this.recorder.observe(frame, driverControlled);
    if (this.trial) {
      const o = carBase(0),
        running = frame[o + F.LAP_TIME] > 0 && frame[o + F.IN_PIT] === 0;
      this.trial.delta =
        this.player && running ? this.player.delta(frame[o + F.S], frame[o + F.LAP_TIME]) : null;
    }
    if (lap) this.recordLeaderboard(lap.circuit, lap.lapTime, options, session);
    if (!lap || (this.player && lap.lapTime >= this.player.lap.lapTime)) return;
    const improvement = this.player ? this.player.lap.lapTime - lap.lapTime : 0;
    this.player = new GhostPlayer(lap);
    if (this.trial) this.trial.best = lap.lapTime;
    void this.host.store
      .write(ghostKey(lap.circuit, lap.vehicle), lap)
      .then(() =>
        this.host.toast(
          `PERSONAL BEST ${lapTime(lap.lapTime)}${improvement > 0 ? ` · −${improvement.toFixed(3)} S` : ''} · GHOST SAVED`,
        ),
      )
      .catch((error) => this.host.toast(`Ghost not saved: ${String(error)}`));
  }
  /** D31: every valid time-trial lap enters its category's local top ten. */
  private recordLeaderboard(
    circuit: string,
    time: number,
    options: SessionOptions,
    session: string,
  ) {
    const category = recordCategory(options);
    const key = leaderboardKey(circuit, category.vehicle, category.physics);
    const entry = {
      lapTime: time,
      driver: this.host.playerName(),
      assist: options.assist,
      compound: options.compound,
      weather: options.weather,
      session,
    };
    void this.host.store
      .read(key)
      .then((stored) => {
        const { board, rank } = insertLeaderboard(stored, entry);
        if (!rank) return;
        return this.host.store
          .write(key, board)
          .then(() => this.host.toast(`P${rank} ON THE LOCAL LEADERBOARD · ${lapTime(time)}`));
      })
      .catch((error) => this.host.toast(`Leaderboard not saved: ${String(error)}`));
  }
  /** Ghost pose at the presented lap time (same interpolation as the car). */
  ghostAt(a: Float32Array, b: Float32Array, alpha: number): GhostPose | null {
    const player = this.player;
    if (!player) return null;
    const o = carBase(0),
      from = a[o + F.LAP_TIME],
      to = b[o + F.LAP_TIME];
    // A lap reset between snapshots starts the ghost again at the line.
    const time = to >= from ? from + (to - from) * alpha : to;
    return time > 0 && b[o + F.IN_PIT] === 0 && player.poseAt(time, this.pose) ? this.pose : null;
  }
}
