import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mod } from '../../core/math.ts';
import { trackPoint } from '../../simulation/track.ts';
import type { BarrierKind } from '../../simulation/circuit-catalogue/venue-data.ts';
import { barrierGeometry } from '../circuit-barriers.ts';
import { catchFenceMaterial } from '../circuit-finish.ts';
import { inSpan } from './plan.ts';
import { kitMesh, type VenueKitContext } from './context.ts';
import { chunks, sweep, venuePoint } from './sweep.ts';

/** Galvanised double W-beam (armco) rail section, outward u, height v. */
const W_BEAM: readonly (readonly [number, number])[] = [
  [-0.02, 0.38],
  [-0.09, 0.44],
  [-0.02, 0.5],
  [-0.09, 0.56],
  [-0.02, 0.62],
  [0.02, 0.62],
  [0.02, 0.38],
];
/** SAFER: steel tube skin over foam blocks, in front of a 1.2 m concrete wall. */
const SAFER_WALL: readonly (readonly [number, number])[] = [
  [0, -0.05],
  [0, 1.15],
  [0.12, 1.22],
  [0.55, 1.22],
  [0.55, -0.05],
];
const SAFER_SKIN: readonly (readonly [number, number])[] = [
  [-0.62, 0.05],
  [-0.62, 1.0],
  [-0.02, 1.05],
  [-0.02, 0.05],
];
/** Conveyor belt bolted across the front of a tyre wall. */
const BELT: readonly (readonly [number, number])[] = [
  [-1.33, 0.05],
  [-1.33, 0.95],
  [-1.31, 0.95],
  [-1.31, 0.05],
];
/** Canyon wall rising from the barrier line (heights jittered per row). */
const ROCK_WALL: readonly (readonly [number, number])[] = [
  [-0.2, -0.1],
  [0.3, 2.5],
  [1.1, 5.5],
  [1.4, 9],
  [2.8, 14],
  [4.5, 18],
];

/** Barrier spans by kind along the physical boundary (the line the collision
 * solver uses), in 60 m chunks so each draw is frustum-culled locally. The
 * pit-side wall is omitted beside the pit lane: the paddock stands there. */
export function buildBarrierChunk(kit: VenueKitContext, from: number, to: number) {
  const track = kit.track,
    m = kit.materials,
    p = trackPoint(),
    L = track.length;
  const solids = new Map<T.Material, T.BufferGeometry[]>();
  const push = (material: T.Material, g: T.BufferGeometry) => {
    const list = solids.get(material);
    if (list) list.push(g);
    else solids.set(material, [g]);
  };
  const posts: T.Matrix4[] = [],
    tyres: T.Matrix4[] = [],
    fencePosts: T.Matrix4[] = [];
  const fence: T.BufferGeometry[] = [];
  const mat = new T.Matrix4(),
    q = new T.Quaternion(),
    up = new T.Vector3(0, 1, 0);
  for (const span of kit.meta.dressing.barriers) {
    const [a0, b0] = [span.from, span.to];
    const a = Math.max(a0, from),
      b = Math.min(b0, to);
    if (b - a < 0.5) continue;
    const side = span.side;
    const pitWall = (s: number) =>
      side === track.pit.side && track.isPitSection(mod(s, L)) && Math.abs(track.pitOffset(s)) > 3;
    for (const [c0, c1] of chunks(a, b, 20)) {
      if (pitWall((c0 + c1) / 2)) continue;
      const kind: BarrierKind = span.kind;
      if (kind === 'concrete' || kind === 'tyre')
        push(m.concrete, barrierGeometry(track, c0, c1, side));
      if (kind === 'safer') {
        push(m.concrete, sweep(track, c0, c1, side, SAFER_WALL, { step: 5 }));
        push(m.saferFoam, sweep(track, c0, c1, side, SAFER_SKIN, { step: 5 }));
      }
      if (kind === 'armco') {
        for (const h of [0, 0.36]) {
          const rail = W_BEAM.map(([u, v]) => [u, v + h] as const);
          push(m.steel, sweep(track, c0, c1, side, rail, { step: 4 }));
        }
        for (let s = c0; s < c1; s += 2) {
          const pos = venuePoint(track, s, side * (track.boundary(s, side) + 0.08), 0.5, p);
          q.setFromAxisAngle(up, Math.atan2(p.tx, p.tz));
          posts.push(mat.compose(pos, q, new T.Vector3(1, 1, 1)).clone());
        }
      }
      if (kind === 'tyre') {
        // Two-deep wall of bolted tyre stacks (one instance per four-high
        // stack) in front of the concrete, faced with a conveyor belt.
        for (let s = c0; s < c1; s += 0.64)
          for (const depth of [-0.38, -1.0]) {
            track.at(mod(s, L), p);
            const l = side * (track.boundaryAt(p, side) + depth);
            const pos = venuePoint(track, s, l, 0.48, p);
            tyres.push(mat.compose(pos, q.identity(), new T.Vector3(1, 1, 1)).clone());
          }
        push(m.tyreBand, sweep(track, c0, c1, side, BELT, { step: 4 }));
      }
      if (kind === 'rock') push(m.rock, sweep(track, c0, c1, side, ROCK_WALL, { step: 3 }));
      // Catch fence over concrete, tyre and SAFER walls at speed and by stands.
      if (kind === 'concrete' || kind === 'safer' || kind === 'tyre') {
        const lean = kind === 'safer' ? 0.25 : 0.23;
        fence.push(
          sweep(
            track,
            c0,
            c1,
            side,
            [
              [lean, kind === 'safer' ? 1.22 : 0.96],
              [lean, 4],
              [lean - 0.45, 4.5],
            ],
            { step: 4 },
          ),
        );
        for (let s = c0; s < c1; s += 4) {
          const pos = venuePoint(track, s, side * (track.boundary(s, side) + lean), 2.6, p);
          fencePosts.push(mat.compose(pos, q.identity(), new T.Vector3(1, 1, 1)).clone());
        }
      }
    }
  }
  const group = new T.Group();
  group.name = `Venue kit barriers ${Math.round(from)}-${Math.round(to)} m`;
  for (const [material, list] of solids) {
    const g = mergeGeometries(list, false)!;
    list.forEach((x) => x.dispose());
    group.add(kitMesh(g, material, `${material.name || 'barrier'} ${Math.round(from)} m`));
  }
  if (fence.length) {
    const g = mergeGeometries(
      fence.map((f) => {
        // The filtered wire shader reads metres as uv * 5.
        const uv = f.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 5, uv.getY(i) / 5);
        return f;
      }),
      false,
    )!;
    const mesh = kitMesh(g, fenceMaterial(), 'Venue kit catch fence', false);
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  kit.add(group);
  const detail = new T.Group();
  detail.name = `Venue kit barrier detail ${Math.round(from)} m`;
  const instanced = (
    geometry: T.BufferGeometry,
    material: T.Material,
    list: T.Matrix4[],
    name: string,
  ) => {
    if (!list.length) return;
    const im = new T.InstancedMesh(geometry, material, list.length);
    list.forEach((x, i) => im.setMatrixAt(i, x));
    im.computeBoundingSphere();
    im.name = name;
    im.castShadow = true;
    im.receiveShadow = true;
    detail.add(im);
  };
  instanced(postGeometry(), m.steel, posts, 'Armco posts');
  instanced(tyreGeometry(), m.tyre, tyres, 'Tyre wall');
  instanced(fencePostGeometry(), m.darkSteel, fencePosts, 'Catch-fence posts');
  if (detail.children.length) kit.detail(detail, 520);
}
let fenceShared: T.Material | null = null;
function fenceMaterial() {
  return (fenceShared ??= catchFenceMaterial());
}
let posts: T.BufferGeometry | null = null,
  tyre: T.BufferGeometry | null = null,
  fencePost: T.BufferGeometry | null = null;
const postGeometry = () => (posts ??= new T.BoxGeometry(0.1, 1.05, 0.15));
/** A stack of four tyres: grooved cylinder, 40 triangles. */
const tyreGeometry = () => (tyre ??= new T.CylinderGeometry(0.31, 0.31, 0.96, 10, 4, false));
const fencePostGeometry = () => (fencePost ??= new T.CylinderGeometry(0.05, 0.05, 3.6, 6));

/** Barrier spans that cover lap distance `s` on `side` (diagnostics/tests). */
export function barrierKindAt(kit: VenueKitContext, s: number, side: 1 | -1) {
  for (const span of kit.meta.dressing.barriers)
    if (span.side === side && inSpan(span, s, kit.track.length)) return span.kind;
  return null;
}
