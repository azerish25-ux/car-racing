p='src/simulation/offroad/course-terrain.ts'
s=open(p).read()
old="""  /** FNV-1a fingerprint of the authoritative state (depth, compaction bits). */"""
new="""  /** Render-grid export for the presentation (worker -> renderer): the
   * blocks changed since the last export (or, `full`, every deformed block)
   * as (block, depth m, compaction 0..1) triples in ascending block order.
   * Read-only for the simulation: the change set is presentation state. */
  renderDelta(full = false): TerrainRenderDelta {
    let blocks: number[];
    if (full) {
      const all = new Set<number>();
      for (const i of this.dirty) {
        const row = Math.floor(i / this.columns),
          col = i % this.columns;
        all.add((row >> 1) * this.renderColumns + (col >> 1));
      }
      blocks = [...all];
    } else blocks = [...this.changed];
    blocks.sort((a, b) => a - b);
    this.changed.clear();
    const data = new Float32Array(blocks.length * 3),
      v = { depth: 0, compaction: 0 };
    blocks.forEach((block, k) => {
      this.renderBlock(block, v);
      data[k * 3] = block;
      data[k * 3 + 1] = v.depth;
      data[k * 3 + 2] = v.compaction / TERRAIN.maxCompaction;
    });
    return { blocks: data, wetness: this.wetness, reset: full };
  }
  /** FNV-1a fingerprint of the authoritative state (depth, compaction bits). */"""
assert old in s; s=s.replace(old,new)
old="""/** Session-scale deformable terrain (WP37/WP38)"""
new="""/** A terrain render export: (block, depth, compaction) triples, the session
 * wetness, and whether it replaces the whole field (session start, rewind). */
export interface TerrainRenderDelta {
  blocks: Float32Array;
  wetness: number;
  reset: boolean;
}
/** Session-scale deformable terrain (WP37/WP38)"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/simulation/protocol.ts'
s=open(p).read()
old="""      marbles: Float32Array;
      time: number;
    }"""
new="""      marbles: Float32Array;
      time: number;
      /** Terrain venues: the deformed soil since the last keyframe. */
      terrain?: TerrainRenderDelta;
    }"""
assert old in s; s=s.replace(old,new)
# import type
idx=s.index('import')
s=s[:idx]+"import type { TerrainRenderDelta } from './offroad/course-terrain.ts';\n"+s[idx:]
open(p,'w').write(s)

p='src/workers/physics.worker.ts'
s=open(p).read()
old="""  send({ type: 'flashback', tick: simulation.tick, time: simulation.race.time });
  const water = simulation.track.water.slice(),
    rubber = simulation.track.rubber.slice(),
    marbles = simulation.track.marbles.slice();
  send({ type: 'surface', water, rubber, marbles, time: simulation.race.time }, [
    water.buffer,
    rubber.buffer,
    marbles.buffer,
  ]);"""
new="""  send({ type: 'flashback', tick: simulation.tick, time: simulation.race.time });
  const water = simulation.track.water.slice(),
    rubber = simulation.track.rubber.slice(),
    marbles = simulation.track.marbles.slice(),
    terrain = simulation.offroad?.terrain.renderDelta(true);
  send({ type: 'surface', water, rubber, marbles, time: simulation.race.time, terrain }, [
    water.buffer,
    rubber.buffer,
    marbles.buffer,
    ...(terrain ? [terrain.blocks.buffer] : []),
  ]);"""
assert old in s; s=s.replace(old,new)
old="""      const water = simulation.track.water.slice(),
        rubber = simulation.track.rubber.slice(),
        marbles = simulation.track.marbles.slice();
      // Surface keyframes are independently timestamped. Flushing replay here
      // would send half-empty pages every 0.5 s and halve the configured stall reserve.
      // SessionReplay carries leading surface keyframes across pose-page boundaries.
      send({ type: 'surface', water, rubber, marbles, time: simulation.race.time }, [
        water.buffer,
        rubber.buffer,
        marbles.buffer,
      ]);"""
new="""      const water = simulation.track.water.slice(),
        rubber = simulation.track.rubber.slice(),
        marbles = simulation.track.marbles.slice(),
        // Terrain venues: the soil deformed since the last keyframe (the
        // whole field on a session's first keyframe).
        terrain = simulation.offroad?.terrain.renderDelta(lastSurface < 0);
      // Surface keyframes are independently timestamped. Flushing replay here
      // would send half-empty pages every 0.5 s and halve the configured stall reserve.
      // SessionReplay carries leading surface keyframes across pose-page boundaries.
      send({ type: 'surface', water, rubber, marbles, time: simulation.race.time, terrain }, [
        water.buffer,
        rubber.buffer,
        marbles.buffer,
        ...(terrain ? [terrain.blocks.buffer] : []),
      ]);"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
