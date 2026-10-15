p='src/rendering/offroad/terrain-view.ts'
s=open(p).read()
old="""        uv[k * 2] = x;
        uv[k * 2 + 1] = z;"""
new="""        // Track-frame UV (lateral, lap metres / 5): the soil detail runs
        // along the lap and the night light pools read the same frame.
        uv[k * 2] = lateral / 5;
        uv[k * 2 + 1] = s / 5;"""
assert old in s; s=s.replace(old,new)
s=s.replace("    this.material = materials.soil();","    this.material = materials.soil({ tile: 0.28 });")
open(p,'w').write(s)

p='src/rendering/circuit.ts'
s=open(p).read()
def rep(old,new):
    global s
    assert old in s, old[:70]
    s=s.replace(old,new,1)
rep("""import { batchScene, box, canvasTexture, label, mesh, unprintedBack } from './geometry.ts';""","""import { batchScene, box, canvasTexture, label, mesh, unprintedBack } from './geometry.ts';
import { offroadSceneFor, type OffroadScene } from './offroad/index.ts';""")
rep("""  /** Procedural dressing for catalogue venues (WP30); null for Aurel/Vellamar. */
  readonly venueKit: VenueKit | null;""","""  /** Procedural dressing for catalogue venues (WP30); null for Aurel/Vellamar. */
  readonly venueKit: VenueKit | null;
  /** Terrain venues (WP41): deformable soil, start gate, stadium, roost. */
  readonly offroad: OffroadScene | null;""")
rep("""    this.venueKit = venueKitFor(track);
    this.group.add(this.props, this.crowd, this.vegetationGroup, this.surfaces);
    if (this.venueKit) this.group.add(this.venueKit.root);""","""    this.venueKit = venueKitFor(track);
    this.group.add(this.props, this.crowd, this.vegetationGroup, this.surfaces);
    if (this.venueKit) this.group.add(this.venueKit.root);
    // A terrain venue's course is soil, not a paved ribbon with kerbs.
    this.offroad = offroadSceneFor(track, this.construction);
    const paved = !this.offroad;
    if (this.offroad) this.group.add(this.offroad.group);""")
rep("""    this.queueRibbon(runOff, {
      offset: (s, t) => {
        track.at(s, this.temp);
        return (t * 2 - 1) * (this.temp.width + 4);
      },
      height: () => -0.008,
      columns: 4,
      runoff: true,
    });
    this.queueRibbon(this.roadMaterial, {""","""    if (paved)
      this.queueRibbon(runOff, {
        offset: (s, t) => {
          track.at(s, this.temp);
          return (t * 2 - 1) * (this.temp.width + 4);
        },
        height: () => -0.008,
        columns: 4,
        runoff: true,
      });
    if (paved)
      this.queueRibbon(this.roadMaterial, {""")
rep("""    for (const side of [-1, 1]) {
      this.queueRibbon(kerb, {""","""    for (const side of paved ? [-1, 1] : []) {
      this.queueRibbon(kerb, {""")
rep("""  update(frame: Float32Array) {
    for (let i = 0; i < 5; i++)""","""  update(frame: Float32Array) {
    this.offroad?.update(frame);
    for (let i = 0; i < 5; i++)""")
open(p,'w').write(s)
