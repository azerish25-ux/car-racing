import re
def edit(p, pairs):
    s = open(p).read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old)
        s = s.replace(old, new)
    open(p, 'w').write(s)

edit('src/simulation/track.ts', [
("""  /** Terrain venues (offroad/): the authoritative deformable ground, which
   * contact, casts and the rendered terrain read; null on paved circuits. */
  readonly offroad: OffroadSurface | null;
  cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    if (this.offroad) return this.offroad.cast(origin, down, maximum, out);""",
"""  /** Terrain venues (offroad/): the authoritative deformable ground, which
   * contact, casts and the rendered terrain read; null on paved circuits. A
   * private field read through `Track.offroadOf`, so an adapter that stands
   * in for a Track (the festival world surface) carries no off-road member. */
  readonly #offroad: OffroadSurface | null;
  /** The deformable ground under a terrain venue's track, else null (paved
   * circuits, and any object that is not a Track). */
  static offroadOf(track: Track): OffroadSurface | null {
    return #offroad in track ? track.#offroad : null;
  }
  cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    if (this.#offroad) return this.#offroad.cast(origin, down, maximum, out);"""),
("""    this.offroad = circuit.offroad?.createSurface(this) ?? null;""",
"""    this.#offroad = circuit.offroad?.createSurface(this) ?? null;"""),
("""Number.isFinite(y) && !this.offroad;""", """Number.isFinite(y) && !this.#offroad;"""),
("""    if (this.offroad && !pit) {""", """    if (this.#offroad && !pit) {"""),
("""      if (this.offroad.sample(p, l, cell, out)) {""", """      if (this.#offroad.sample(p, l, cell, out)) {"""),
])

edit('src/rendering/offroad/index.ts', [
("""    if (!(track.offroad instanceof TrackTerrainSurface)) throw new Error('Not a terrain venue');
    const course = track.offroad.course;""",
"""    const surface = Track.offroadOf(track);
    if (!(surface instanceof TrackTerrainSurface)) throw new Error('Not a terrain venue');
    const course = surface.course;"""),
("""  return track.offroad instanceof TrackTerrainSurface""",
"""  return Track.offroadOf(track) instanceof TrackTerrainSurface"""),
])
edit('src/rendering/offroad/terrain-view.ts', [
("""    if (!(track.offroad instanceof TrackTerrainSurface)) throw new Error('Not a terrain venue');
    this.terrain = track.offroad.terrain;""",
"""    const surface = Track.offroadOf(track);
    if (!(surface instanceof TrackTerrainSurface)) throw new Error('Not a terrain venue');
    this.terrain = surface.terrain;"""),
])
edit('src/simulation/offroad/dirt-bike-vehicle.ts', [
("""    const surface = track.offroad;
    if (surface instanceof TrackTerrainSurface) {""",
"""    const surface = Track.offroadOf(track);
    if (surface instanceof TrackTerrainSurface) {"""),
])
edit('src/simulation/offroad/ai.ts', [
("""    const surface = track.offroad;
    if (!(surface instanceof TrackTerrainSurface)) return;""",
"""    const surface = Track.offroadOf(track);
    if (!(surface instanceof TrackTerrainSurface)) return;"""),
("""  if (track.offroad && !(car.definition.dynamicsKind === 'bike'))""",
"""  if (Track.offroadOf(track) && !(car.definition.dynamicsKind === 'bike'))"""),
])
edit('src/simulation/offroad/session.ts', [
("""    if (!(track.offroad instanceof TrackTerrainSurface)) throw new Error('Not a terrain venue');
    this.surface = track.offroad;""",
"""    const surface = Track.offroadOf(track);
    if (!(surface instanceof TrackTerrainSurface)) throw new Error('Not a terrain venue');
    this.surface = surface;"""),
("""    return track.offroad instanceof TrackTerrainSurface""",
"""    return Track.offroadOf(track) instanceof TrackTerrainSurface"""),
])
edit('tests/offroad.test.ts', [
("""      t = (track.offroad as TrackTerrainSurface).terrain;""",
"""      t = (Track.offroadOf(track) as TrackTerrainSurface).terrain;"""),
("""    const rx = (rigTrack('kestrel-rx').offroad as TrackTerrainSurface).terrain,""",
"""    const rx = (Track.offroadOf(rigTrack('kestrel-rx')) as TrackTerrainSurface).terrain,"""),
("""import { trackPoint } from '../src/simulation/track.ts';""",
"""import { Track, trackPoint } from '../src/simulation/track.ts';"""),
])
edit('src/rendering/offroad/index.ts', [("import type { Track } from '../../simulation/track.ts';", "import { Track } from '../../simulation/track.ts';")])
edit('src/rendering/offroad/terrain-view.ts', [("import { trackPoint, type Track } from '../../simulation/track.ts';", "import { Track, trackPoint } from '../../simulation/track.ts';")])
edit('src/simulation/offroad/dirt-bike-vehicle.ts', [("import { surfaceSample, type Track } from '../track.ts';", "import { surfaceSample, Track } from '../track.ts';")])
edit('src/simulation/offroad/ai.ts', [("import { surfaceSample, trackPoint, type Track } from '../track.ts';", "import { surfaceSample, Track, trackPoint } from '../track.ts';")])
edit('src/simulation/offroad/session.ts', [("import { trackPoint, type Track } from '../track.ts';", "import { Track, trackPoint } from '../track.ts';")])
