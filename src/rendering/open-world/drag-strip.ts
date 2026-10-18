import * as T from 'three';
import { DRAG, treeLamps, type DragTree } from '../../simulation/open-world/drag.ts';
import type { FestivalEvent } from '../../simulation/open-world/festival-events.ts';
import { pathPoint } from '../../simulation/open-world/route-path.ts';

type Height = (x: number, z: number, y?: number) => number;
/** What the drag strip needs of the running event (FestivalStatus.event.drag). */
export interface DragView {
  tree: DragTree;
  lanes: readonly { lane: number; leftAt: number | null }[];
}
/** Lamp colours by tree row (ref 078): incandescent pre-stage and stage,
 * amber, green and red lenses; unlit lenses keep a dark tint of their dye. */
const LIT = Object.freeze([0xffe7b0, 0xffe7b0, 0xffa416, 0xffa416, 0xffa416, 0x2bff5c, 0xff2020]);
const GLOW = 1.8;
const UNLIT = 0.07;
/** Distance (m) within which the strip's details draw. */
const RANGE = 1500;

/**
 * The Kestrel drag strip, sequenced (FH6 ref 077/078/079): every lamp of the
 * hub's two shoulder trees (event-dressing.ts places their housings) and of
 * a portable centre tree 9 m past the line between the middle lanes — wheeled
 * out only while a drag run is on, nothing stands on the runway otherwise —
 * lit from the presented frame's simulation clock with the HUD's rule
 * (drag.ts `treeLamps`): pre-stage and stage per lane, the ambers one at a
 * time down the tree, green, red for a lane that left early. One instanced
 * draw for the lamps, one for the centre tree, one for the painted start
 * bars and finish line, one for the chequered finish boards.
 */
export class DragStrip {
  readonly root = new T.Group();
  private readonly lamps: T.InstancedMesh;
  private readonly lampLane: Int8Array;
  private readonly lampRow: Int8Array;
  private readonly fixed: number;
  private readonly centreTree: T.Mesh;
  private readonly centre = new T.Vector3();
  private readonly colour = new T.Color();
  private readonly geometries: T.BufferGeometry[] = [];
  private readonly materials: T.Material[] = [];
  private readonly board: T.CanvasTexture | null;
  /** Lamp-state signature last written (skip unchanged frames). */
  private signature = '';
  constructor(
    event: FestivalEvent | null,
    sockets: readonly { matrix: T.Matrix4; row: number; lane: number }[],
    height: Height,
  ) {
    this.root.name = 'Kestrel drag strip';
    const sphere = new T.SphereGeometry(1, 10, 6),
      box = new T.BoxGeometry(1, 1, 1),
      cylinder = new T.CylinderGeometry(1, 1, 1, 8);
    this.geometries.push(sphere);
    const all = [...sockets.map((s) => ({ ...s }))];
    this.fixed = all.length;
    // Portable centre tree, facing the staged cars (lanes 1 and 2).
    let tree: T.BufferGeometry | null = null;
    if (event) {
      const p = event.path.at(0, pathPoint());
      const left = new T.Vector3(p.tz, 0, -p.tx),
        forward = new T.Vector3(p.tx, 0, p.tz),
        y = height(p.x, p.z, p.y),
        basis = new T.Matrix4().makeBasis(left, new T.Vector3(0, 1, 0), forward);
      basis.setPosition(p.x, y, p.z);
      const local = (x: number, ly: number, z: number, sx: number, sy: number, sz: number) =>
        new T.Matrix4().multiplyMatrices(
          basis,
          new T.Matrix4().compose(
            new T.Vector3(x, ly, z),
            new T.Quaternion(),
            new T.Vector3(sx, sy, sz),
          ),
        );
      const z = 9;
      const parts = [
        cylinder.clone().applyMatrix4(local(0, 1.3, z, 0.07, 2.6, 0.07)),
        box.clone().applyMatrix4(local(0, 2.75, z, 0.42, 1.9, 0.22)),
        box.clone().applyMatrix4(local(0, 0.04, z, 0.9, 0.08, 0.6)),
      ];
      tree = mergeGeometries(parts);
      for (let row = 0; row < 7; row++)
        for (const dx of [-0.11, 0.11])
          all.push({
            matrix: local(dx, 3.55 - row * 0.26, z - 0.13, 0.075, 0.075, 0.03),
            row,
            lane: dx > 0 ? 1 : 2,
          });
      this.centre.set(p.x, y + 2, p.z);
      // Painted start bars per lane at the line, a finish line at the
      // quarter mile (slightly raised over the runway, offset in depth).
      const paint: T.BufferGeometry[] = [];
      const bar = (d: number, lateral: number, width: number, depth: number) => {
        const q = event.path.at(d, pathPoint()),
          x = q.x + q.nx * lateral,
          zz = q.z + q.nz * lateral,
          g = new T.PlaneGeometry(width, depth).rotateX(-Math.PI / 2);
        g.rotateY(Math.atan2(q.tx, q.tz));
        g.translate(x, height(x, zz, q.y) + 0.03, zz);
        paint.push(g);
      };
      for (let lane = 0; lane < DRAG.lanes; lane++)
        bar(0, ((DRAG.lanes - 1) / 2 - lane) * DRAG.lane, DRAG.lane - 0.8, 0.4);
      const finish = event.path.finishDistance;
      bar(finish, 0, DRAG.lanes * DRAG.lane, 0.5);
      const lines = mergeGeometries(paint);
      const paintMaterial = new T.MeshStandardMaterial({
        color: 0xeeeeea,
        roughness: 0.8,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      this.materials.push(paintMaterial);
      this.geometries.push(lines);
      const linesMesh = new T.Mesh(lines, paintMaterial);
      linesMesh.name = 'Drag strip start bars and finish line';
      linesMesh.receiveShadow = true;
      this.root.add(linesMesh);
      // Chequered timing boards on both shoulders at the finish.
      this.board = chequer();
      const boardMaterial = new T.MeshStandardMaterial({
        map: this.board,
        roughness: 0.6,
        emissive: 0xffffff,
        emissiveMap: this.board,
        emissiveIntensity: 0.08,
      });
      const postMaterial = new T.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5 });
      this.materials.push(boardMaterial, postMaterial);
      const q = event.path.at(finish, pathPoint()),
        boards: T.BufferGeometry[] = [],
        posts: T.BufferGeometry[] = [];
      for (const side of [1, -1]) {
        const lateral = side * (q.halfWidth + 2.2),
          x = q.x + q.nx * lateral,
          zz = q.z + q.nz * lateral,
          gy = height(x, zz, q.y),
          yaw = Math.atan2(q.tx, q.tz);
        boards.push(new T.BoxGeometry(2.4, 1.6, 0.12).rotateY(yaw).translate(x, gy + 3.2, zz));
        for (const o of [-1, 1])
          posts.push(
            new T.CylinderGeometry(0.07, 0.07, 2.6, 8)
              .translate(o * 1.0, 1.3, 0)
              .rotateY(yaw)
              .translate(x, gy, zz),
          );
      }
      const boardGeometry = mergeGeometries(boards),
        postGeometry = mergeGeometries(posts);
      this.geometries.push(boardGeometry, postGeometry);
      const boardMesh = new T.Mesh(boardGeometry, boardMaterial),
        postMesh = new T.Mesh(postGeometry, postMaterial);
      boardMesh.name = 'Drag strip finish boards';
      postMesh.name = 'Drag strip finish posts';
      boardMesh.castShadow = postMesh.castShadow = true;
      this.root.add(boardMesh, postMesh);
    } else this.board = null;
    const housing = new T.MeshStandardMaterial({ color: 0x17181b, roughness: 0.5, metalness: 0.4 });
    this.materials.push(housing);
    this.centreTree = new T.Mesh(tree ?? new T.BufferGeometry(), housing);
    this.geometries.push(this.centreTree.geometry);
    this.centreTree.name = 'Drag strip centre tree';
    this.centreTree.castShadow = true;
    this.centreTree.visible = false;
    const lampMaterial = new T.MeshBasicMaterial({ color: 0xffffff });
    this.materials.push(lampMaterial);
    this.lamps = new T.InstancedMesh(sphere, lampMaterial, Math.max(1, all.length));
    this.lamps.name = 'Drag strip start lamps';
    this.lampLane = new Int8Array(all.length);
    this.lampRow = new Int8Array(all.length);
    all.forEach((s, i) => {
      this.lamps.setMatrixAt(i, s.matrix);
      this.lampLane[i] = s.lane;
      this.lampRow[i] = s.row;
      this.lamps.setColorAt(i, this.colour.setHex(LIT[s.row]).multiplyScalar(UNLIT));
    });
    this.lamps.count = this.fixed;
    this.lamps.computeBoundingSphere();
    if (!event && sockets.length) {
      const m = sockets[0].matrix;
      this.centre.setFromMatrixPosition(m);
    }
    this.root.add(this.lamps, this.centreTree);
    box.dispose();
    cylinder.dispose();
  }
  /** Light the trees for the running drag (or dark when none) at the
   * presented simulation time; show the centre tree while a run is on. */
  update(time: number, drag: DragView | null, camera: T.Camera) {
    this.root.visible = camera.position.distanceTo(this.centre) < RANGE;
    if (!this.root.visible) return;
    const active = !!drag;
    this.centreTree.visible = active;
    this.lamps.count = active ? this.lampLane.length : this.fixed;
    let signature = '';
    const states = new Map<number, boolean[]>();
    if (drag)
      for (const l of drag.lanes) {
        const lit = treeLamps(drag.tree, time, l.leftAt);
        states.set(l.lane, lit);
        signature += lit.map(Number).join('');
      }
    if (signature === this.signature && this.lamps.instanceColor) return;
    this.signature = signature;
    for (let i = 0; i < this.lampLane.length; i++) {
      const lit = states.get(this.lampLane[i])?.[this.lampRow[i]] ?? false;
      this.colour.setHex(LIT[this.lampRow[i]]).multiplyScalar(lit ? GLOW : UNLIT);
      this.lamps.setColorAt(i, this.colour);
    }
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
  /** Lamp states (lit flags in instance order) for tests. */
  litLamps() {
    const out: { lane: number; row: number; lit: boolean }[] = [];
    const c = new T.Color();
    for (let i = 0; i < this.lamps.count; i++) {
      this.lamps.getColorAt(i, c);
      out.push({ lane: this.lampLane[i], row: this.lampRow[i], lit: c.r + c.g + c.b > 1.5 });
    }
    return out;
  }
  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.board?.dispose();
    this.lamps.dispose();
    this.root.clear();
  }
}
/** Merge non-indexed or indexed geometries with position/normal (and uv)
 * into one indexed geometry. */
function mergeGeometries(parts: T.BufferGeometry[]) {
  const position: number[] = [],
    normal: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (const g of parts) {
    const p = g.getAttribute('position'),
      n = g.getAttribute('normal'),
      t = g.getAttribute('uv'),
      offset = position.length / 3;
    for (let i = 0; i < p.count; i++) {
      position.push(p.getX(i), p.getY(i), p.getZ(i));
      normal.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) index.push(offset + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) index.push(offset + i);
    g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  out.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  out.setIndex(index);
  out.computeBoundingSphere();
  return out;
}
/** A chequered finish board face (black and white, 8 x 5). */
function chequer() {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) return null;
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  for (let j = 0; j < 5; j++)
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = (i + j) % 2 ? '#111214' : '#f2f2ee';
      ctx.fillRect(i * 32, j * 32, 32, 32);
    }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}
