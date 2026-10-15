ROOT = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/'
def patch(path, pairs):
    p = ROOT + path
    s = open(p).read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit(f'missing in {path}: {old[:80]}')
        s = s.replace(old, new)
    open(p, 'w').write(s)

patch('src/rendering/open-world/roads.ts', [
    ("""import { ROAD_FLAG, type RoadEdge, type RoadNetwork } from '../../simulation/open-world/road-network.ts';""",
     """import { ROAD_FLAG, type RoadEdge, type RoadNetwork } from '../../simulation/open-world/road-network.ts';
import type { TrackPoint } from '../../simulation/track.ts';"""),
    ("""/** Chunk edge (m) for culling road geometry. */
const CHUNK = 512;""", """/** Chunk edge (m) for culling road geometry. */
const CHUNK = 512;
type SurfaceHeight = (point: TrackPoint, lateral: number) => number;
const roadPoint = (): TrackPoint => ({ s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, curvature: 0, width: 0, bank: 0, gradient: 0 });"""),
    ("""    const p = { s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, curvature: 0, width: 0, bank: 0, gradient: 0 };
    const q = { ...p };
    const posts: T.Matrix4[] = [],""", """    const p = roadPoint(),
      q = roadPoint();
    const posts: T.Matrix4[] = [],"""),
    ("""        height = (pt: typeof p, l: number) => net.surfaceHeight(pt, l, hw, crown);""",
     """        height: SurfaceHeight = (pt, l) => net.surfaceHeight(pt, l, hw, crown);"""),
    ("""        const row = (pt: typeof p, v: number) =>""", """        const row = (pt: TrackPoint, v: number) =>"""),
    ("""            const edge = (pt: typeof p, v: number) => {""", """            const edge = (pt: TrackPoint, v: number) => {"""),
    ("""      this.markings(e, builder, posts);""", """      this.markings(e, builder);"""),
    ("""  private markings(e: RoadEdge, builder: (x: number, z: number, layer: Layer) => Builder, _posts: T.Matrix4[]) {""",
     """  private markings(e: RoadEdge, builder: (x: number, z: number, layer: Layer) => Builder) {"""),
    ("""    const p = { s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, curvature: 0, width: 0, bank: 0, gradient: 0 };
    const step = 2;""", """    const p = roadPoint();
    const step = 2;"""),
    ("""        net.at(e.offset + s, p);
        const i = net.lastSegment;
        void i;
        // No lines through junction mouths.""", """        net.at(e.offset + s, p);
        // No lines through junction mouths."""),
    ("""        const corner = (pt: typeof p, l: number, v: number) =>
          builderAt.vertex""", """        const corner = (pt: TrackPoint, l: number, v: number) =>
          builderAt.vertex"""),
    ("""          const corner = (pt: typeof p, ll: number, v: number) =>""", """          const corner = (pt: TrackPoint, ll: number, v: number) =>"""),
    ("""  private railSegment(
    b: Builder,
    p: { x: number; y: number; z: number; nx: number; nz: number; s: number },
    q: { x: number; y: number; z: number; nx: number; nz: number; s: number },
    side: number,
    lateral: number,
    height: (pt: never, l: number) => number,
    posts: T.Matrix4[],
  ) {
    const h = height as unknown as (pt: typeof p, l: number) => number;
    const at = (pt: typeof p, dy: number) => [""", """  private railSegment(
    b: Builder,
    p: TrackPoint,
    q: TrackPoint,
    side: number,
    lateral: number,
    h: SurfaceHeight,
    posts: T.Matrix4[],
  ) {
    const at = (pt: TrackPoint, dy: number) => ["""),
    ("""  private bridgeSegment(
    b: Builder,
    p: { x: number; y: number; z: number; nx: number; nz: number; s: number },
    q: { x: number; y: number; z: number; nx: number; nz: number; s: number },
    half: number,
    height: (pt: never, l: number) => number,
  ) {
    const h = height as unknown as (pt: typeof p, l: number) => number;
    for""", """  private bridgeSegment(b: Builder, p: TrackPoint, q: TrackPoint, half: number, h: SurfaceHeight) {
    for"""),
    ("""    const net = this.network,
      p = { s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, curvature: 0, width: 0, bank: 0, gradient: 0 };
    let run = -1;""", """    const net = this.network,
      p = roadPoint();
    let run = -1;"""),
    ("""    const net = this.network,
      p = { s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, curvature: 0, width: 0, bank: 0, gradient: 0 };
    for (let s = 12;""", """    const net = this.network,
      p = roadPoint();
    for (let s = 12;"""),
    ("""        new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(-p.nz * -side, -p.nx * side) + Math.PI),""",
     """        new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(side * p.nz, -side * p.nx)),"""),
    ("""      rail: materials.metal({ kind: 'bare', metal: 'steel', roughness: 0.42 }),
      concrete: materials.concrete({ variant: 'rough', horizontal: 0 }),""", """      rail: Object.assign(materials.metal({ kind: 'bare', metal: 'steel', roughness: 0.42 }), { side: T.DoubleSide }),
      concrete: Object.assign(materials.concrete({ variant: 'rough', horizontal: 0 }), { side: T.DoubleSide }),"""),
    ("""    shader.vertexShader = shader.vertexShader;
  };""", """  };"""),
])
print('ok')
