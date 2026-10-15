import * as T from 'three';
import { clamp } from '../../core/math.ts';
import {
  TrackTerrainSurface,
  type TerrainRenderDelta,
} from '../../simulation/offroad/course-terrain.ts';
import { H } from '../../simulation/protocol.ts';
import { Track } from '../../simulation/track.ts';
import type { BuildQueue } from '../build-queue.ts';
import { installLightPools } from '../studio/light-pools.ts';
import { Roost } from './roost.ts';
import { Stadium } from './stadium.ts';
import { StartGate } from './start-gate.ts';
import { TerrainView } from './terrain-view.ts';

export { installMud, installMudOn, mudUniforms, type MudUniforms } from './mud.ts';
export { DirtBikeModel } from './dirt-bike-model.ts';
/**
 * Off-road venue presentation (WP41), owned by the CircuitScene of a terrain
 * venue: the deformable course terrain, the start gate (motocross and
 * supercross), the supercross stadium bowl, and roost from spinning wheels.
 * Fed by the snapshot (`update`) and by the worker's terrain keyframes
 * (`record`, `showAt` in replays); never written back to the simulation.
 */
export class OffroadScene {
  readonly group = new T.Group();
  terrain: TerrainView | null = null;
  gate: StartGate | null = null;
  stadium: Stadium | null = null;
  readonly roost = new Roost();
  private lastTime = NaN;
  private readonly pending: {
    delta: TerrainRenderDelta | undefined;
    time: number;
    live: boolean;
  }[] = [];
  constructor(
    readonly track: Track,
    construction: BuildQueue,
  ) {
    const surface = Track.offroadOf(track);
    if (!(surface instanceof TrackTerrainSurface)) throw new Error('Not a terrain venue');
    const course = surface.course;
    this.group.name = 'Off-road venue';
    this.group.add(this.roost.points);
    construction.add('Off-road course terrain', 3, () => {
      this.terrain = new TerrainView(track);
      // Night venues light the soil with the floodlight pools, like a ribbon.
      installLightPools(this.terrain.material);
      this.group.add(this.terrain.group);
      for (const p of this.pending.splice(0)) this.terrain.record(p.delta, p.time, p.live);
    });
    if (course.spec.gate)
      construction.add('Off-road start gate', 1, () => {
        this.gate = new StartGate(track, course);
        this.group.add(this.gate.root);
      });
    if (course.kind === 'supercross')
      construction.add('Supercross stadium', 2, () => {
        this.stadium = new Stadium(track);
        this.group.add(this.stadium.root);
      });
  }
  /** A worker surface keyframe's terrain export. */
  record(delta: TerrainRenderDelta | undefined, time: number, live: boolean) {
    if (!delta) return;
    if (this.terrain) this.terrain.record(delta, time, live);
    else this.pending.push({ delta, time, live });
  }
  /** Replay: show the terrain as it was at `time`; null returns to live. */
  showAt(time: number | null) {
    if (time === null) this.terrain?.showLive();
    else this.terrain?.showAt(time);
  }
  update(frame: Float32Array) {
    this.gate?.update(frame);
    const time = frame[H.TIME],
      dt = Number.isFinite(this.lastTime) ? clamp(time - this.lastTime, 0, 0.1) : 0;
    // A rewind or a new session restarts the clock: drop the old roost.
    if (time < this.lastTime - 0.5) this.roost.clear();
    this.lastTime = time;
    this.roost.update(frame, dt);
  }
  dispose() {
    this.terrain?.dispose();
    this.gate?.dispose();
    this.stadium?.dispose();
    this.roost.dispose();
  }
}
/** The off-road presentation for a terrain venue, else null. */
export function offroadSceneFor(track: Track, construction: BuildQueue) {
  return Track.offroadOf(track) instanceof TrackTerrainSurface
    ? new OffroadScene(track, construction)
    : null;
}
