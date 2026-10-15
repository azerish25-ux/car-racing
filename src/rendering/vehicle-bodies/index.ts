import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp } from '../../core/math.ts';
import {
  F,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import { vehicleAt, type VehicleDefinition } from '../../simulation/vehicles.ts';
import type { ShadowSubstitute } from '../shadow-proxies.ts';
import { wheelPhase, wheelTravel } from '../wheel-pose.ts';
import { bodySheetFor, type BodySheet } from './body-sheet.ts';
import { buildClosedBody, ClosedBodyModel } from './closed-body.ts';
import { carMaterials, emptyLod, type BuiltLod, type CarMaterials } from './common.ts';
import { bodyFrame, type BodyFrame } from './frame.ts';
import { buildKart, buildOpenWheel, type Link } from './open-wheel.ts';
import { buildBuggy } from './buggy.ts';
import { sharedMaterials } from './materials.ts';
import { WheelAssembly, type Detail } from './wheel.ts';
import { installMudOn, mudUniforms, type MudUniforms } from '../offroad/mud.ts';
import { cabinLayout } from './cabin.ts';
import { CABIN_DETAIL_DISTANCE, CABIN_GLASS_ORDER } from './interior.ts';

/** Who is looking: the followed entrant, whether the camera sits in its
 * cockpit, the camera position and the distance (m) within which a rival's
 * cabin detail is drawn (default CABIN_DETAIL_DISTANCE; 0: the followed car's
 * only, see cabinDetailDistance). */
export interface BodyView {
  follow: number;
  cockpit: boolean;
  camera: T.Vector3 | null;
  detailDistance?: number;
}

/** Procedural exteriors for every non-Formula definition (WP30), replacing
 * the TC-1 greybox shell. The snapshot's R.VEHICLE decides the body, so live
 * play, replay and results show the machine that was simulated; the body
 * follows the interpolated Formula representation's root (its pose and its
 * LOD choice), and every wheel follows the recorded wheel channels exactly as
 * car.ts does: suspension length, steer, camber, rolling phase, load,
 * pressure and disc temperature. Three LODs share one material set per car;
 * a cheap merged proxy casts the shadow while any detailed LOD is shown. */
export interface BodyHost {
  root: T.Object3D;
  lodLevel?: number;
}
interface Built {
  definition: VehicleDefinition;
  root: T.Group;
  fine: T.Group;
  proxy: T.Mesh;
  lods: BuiltLod[];
  wheels: WheelAssembly[][];
  links: { mesh: T.Mesh; link: Link }[][];
  materials: CarMaterials;
  frame: BodyFrame;
  level: number;
  /** The coarser LOD the last rear-view feed pass showed (null: none); its
   * wheels are posed too, so the feed never shows a stale wheel set. */
  feedLevel: number | null;
  /** The main view's cabin detail state (restored after a feed pass). */
  near: boolean;
  /** Off-road mud coat (WP41), installed once the car first picks up mud. */
  mud?: MudUniforms;
}
const LOD_NAMES = ['near', 'mid', 'far'];
export function buildVehicleBody(id: number, definition: VehicleDefinition, sheet: BodySheet) {
  const frame = bodyFrame(definition);
  const cabin = { layout: cabinLayout(definition, sheet), def: definition };
  const closed = sheet.kind === 'closed' ? sheet : null;
  const finish = sheet.paint;
  const model = closed
    ? new ClosedBodyModel(frame, closed, [sheet.wheels.width[0] / 2, sheet.wheels.width[1] / 2])
    : null;
  const materials = carMaterials(id, finish, model ? model.gaps() : []);
  const root = new T.Group();
  root.name = `${definition.name} ${id + 1} (procedural body)`;
  const fine = new T.Group();
  fine.name = 'Body LODs';
  root.add(fine);
  const lods: BuiltLod[] = [],
    wheels: WheelAssembly[][] = [],
    links: { mesh: T.Mesh; link: Link }[][] = [];
  const linkGeometry = new T.CylinderGeometry(0.011, 0.011, 1, 6, 1, true);
  for (const detail of [0, 1, 2] as Detail[]) {
    const lod = emptyLod(`LOD ${detail} (${LOD_NAMES[detail]})`);
    let lodLinks: Link[] = [];
    if (model && closed) buildClosedBody(model, materials, detail, lod, cabin);
    else if (sheet.kind === 'open-wheel')
      lodLinks = buildOpenWheel(frame, sheet, materials, detail, lod, cabin);
    else if (sheet.kind === 'kart') buildKart(frame, sheet, materials, detail, lod, cabin);
    else if (sheet.kind === 'buggy')
      lodLinks = buildBuggy(frame, sheet, materials, detail, lod, cabin);
    const corners = definition.wheelPositions.map((p, i) => {
      const assembly = new WheelAssembly(
        frame.radius,
        p[0] > 0 ? 1 : -1,
        i < 2,
        sheet.wheels,
        detail,
      );
      assembly.pivot.position.set(p[0], i < 2 ? frame.hubFront : frame.hubRear, p[2]);
      lod.group.add(assembly.pivot);
      return assembly;
    });
    const meshes = lodLinks.map((link) => {
      const mesh = new T.Mesh(
        linkGeometry,
        sheet.kind === 'buggy' ? sharedMaterials.steel() : sharedMaterials.carbon(),
      );
      mesh.castShadow = detail === 0;
      mesh.name = 'Suspension link';
      lod.group.add(mesh);
      return { mesh, link };
    });
    lod.group.visible = detail === 0;
    fine.add(lod.group);
    lods.push(lod);
    wheels.push(corners);
    links.push(meshes);
  }
  const proxy = shadowProxy(lods[2].group, wheels[2], definition);
  root.add(proxy);
  return {
    definition,
    root,
    fine,
    proxy,
    lods,
    wheels,
    links,
    materials,
    frame,
    level: 0,
    feedLevel: null,
    near: false,
  } satisfies Built;
}
/** Faces that let sunlight into the cabin: glazing and the dark lid under it
 * (sharedMaterials.cabinLid). Seats and trim in the interior finish are solid
 * and keep casting (a buggy's seats sit in an open frame). */
function admitsLight(material: T.Material | undefined) {
  return (
    !material ||
    material.transparent ||
    !!material.userData.cabinLid ||
    !!material.userData.vehicleGlass
  );
}
/** One depth-only mesh: the far body and four wheel cylinders at rest. The
 * glazing and the cabin lid are left out, so the sun reaches the near
 * cabin through the windows while the roof and body still shade it. */
function shadowProxy(far: T.Group, wheels: WheelAssembly[], def: VehicleDefinition) {
  const parts: T.BufferGeometry[] = [];
  far.updateMatrixWorld(true);
  far.traverse((o) => {
    if (!(o instanceof T.Mesh) || o.name === 'Suspension link') return;
    let inWheel = false;
    for (let p: T.Object3D | null = o; p && p !== far; p = p.parent)
      if (wheels.some((w) => w.pivot === p)) inWheel = true;
    if (inWheel) return;
    const source = o.geometry as T.BufferGeometry,
      materials = Array.isArray(o.material) ? o.material : null;
    if (!materials && admitsLight(o.material as T.Material)) return;
    let g = source.clone();
    if (materials && source.index) {
      // Keep only the triangles of shadow-casting groups.
      const index: number[] = [],
        from = source.index.array;
      for (const group of source.groups)
        if (!admitsLight(materials[group.materialIndex ?? 0]))
          for (let k = group.start; k < group.start + group.count; k++) index.push(from[k]);
      if (!index.length) return;
      g.setIndex(index);
      g.clearGroups();
      g = g.toNonIndexed();
    }
    g.applyMatrix4(o.matrixWorld.clone().premultiply(far.matrixWorld.clone().invert()));
    parts.push(g);
  });
  for (const w of wheels) {
    const g = new T.CylinderGeometry(w.radius, w.radius, 0.26, 12).rotateZ(Math.PI / 2);
    g.translate(w.pivot.position.x, w.pivot.position.y, w.pivot.position.z);
    parts.push(g);
  }
  const flat = parts.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(f.attributes)) if (name !== 'position') f.deleteAttribute(name);
    f.clearGroups();
    return f;
  });
  const merged = mergeGeometries(flat, false);
  for (const g of parts) g.dispose();
  for (const g of flat) if (!parts.includes(g)) g.dispose();
  const proxy = new T.Mesh(merged, new T.MeshBasicMaterial({ colorWrite: false }));
  proxy.name = `${def.name} shadow proxy (depth only)`;
  proxy.castShadow = true;
  proxy.receiveShadow = false;
  proxy.visible = false;
  return proxy;
}
export class VehicleBodies {
  readonly root = new T.Group();
  private readonly bodies = new Map<number, Built>();
  /** Called once per newly built body (renderer material installers). */
  onBuild: (root: T.Object3D) => void = () => {};
  private readonly hub = new T.Vector3();
  private readonly end = new T.Vector3();
  private readonly up = new T.Vector3(0, 1, 0);
  constructor() {
    this.root.name = 'Vehicle bodies (procedural catalogue exteriors)';
  }
  private build(id: number, definition: VehicleDefinition, sheet: BodySheet) {
    const built = buildVehicleBody(id, definition, sheet);
    this.root.add(built.root);
    this.onBuild(built.root);
    return built;
  }
  /** Pose bodies over their entrants and hide the Formula representation.
   * `a`, `b`, `alpha` are the interpolation endpoints; `headlights` lights
   * the lamps (night and dusk). */
  update(
    a: Float32Array,
    b: Float32Array,
    alpha: number,
    cars: readonly BodyHost[],
    headlights = false,
    view: BodyView = { follow: 0, cockpit: false, camera: null },
  ) {
    // Feeds refresh at 10-30 Hz; half a second without one (chase view,
    // mirrors off) stops posing the feed LODs' wheels.
    if (++this.framesSinceFeed > 30) for (const body of this.bodies.values()) body.feedLevel = null;
    for (let id = 0; id < cars.length; id++) {
      const o = carBase(id),
        definition = vehicleAt(Math.round(b[o + RACE_BASE + R.VEHICLE]));
      let body = this.bodies.get(id);
      const sheet = bodySheetFor(definition);
      if (!sheet) {
        if (body?.root.visible) {
          body.root.visible = false;
          cars[id].root.visible = true;
        }
        continue;
      }
      if (!body || body.definition !== definition) {
        if (body) this.dispose(body);
        body = this.build(id, definition, sheet);
        this.bodies.set(id, body);
      }
      const host = cars[id].root;
      host.visible = false;
      body.root.visible = true;
      body.root.position.copy(host.position);
      body.root.quaternion.copy(host.quaternion);
      // Off-road (WP41): the mud and dust the car has picked up (O.MUD).
      const mud = b[o + OFFROAD_BASE + O.MUD];
      if (mud > 0.001 && !body.mud) installMudOn(body.root, (body.mud = mudUniforms()));
      if (body.mud) {
        body.mud.offroadMud.value = Math.min(1, Math.max(0, mud));
        body.mud.offroadMudWet.value = Math.min(
          1,
          Math.max(0, b[o + OFFROAD_BASE + O.MOISTURE] * 1.6),
        );
      }
      const level = Math.max(0, Math.min(2, Math.round(cars[id].lodLevel ?? 0)));
      if (level !== body.level) {
        body.lods.forEach((lod, i) => (lod.group.visible = i === level));
        body.level = level;
      }
      const front = b[o + F.FRONT_HEALTH] > 0.08,
        rear = b[o + F.REAR_HEALTH] > 0.08;
      const brake = lerp(a[o + F.BRAKE], b[o + F.BRAKE], alpha);
      body.materials.tail.emissiveIntensity = brake > 0.05 ? 3.2 : headlights ? 1.1 : 0.55;
      body.materials.head.emissiveIntensity = headlights ? 2.6 : 0.35;
      const positions = body.definition.wheelPositions;
      // The main view's LOD, and the coarser one a rear-view feed shows.
      for (const shown of body.feedLevel !== null && body.feedLevel !== level
        ? [level, body.feedLevel]
        : [level]) {
        const lod = body.lods[shown];
        for (const e of lod.front) e.visible = front;
        for (const e of lod.rear) e.visible = rear;
        body.wheels[shown].forEach((wheel, i) => {
          const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
          wheel.update(
            positions[i][1] - wheelTravel(a, b, p, alpha),
            lerp(a[p + W.STEER], b[p + W.STEER], alpha),
            lerp(a[p + W.CAMBER], b[p + W.CAMBER], alpha),
            wheelPhase(a, b, o, p, alpha),
            lerp(a[p + W.LOAD], b[p + W.LOAD], alpha),
            lerp(a[p + W.PRESSURE], b[p + W.PRESSURE], alpha),
            b[p + W.DISC_TEMP],
          );
        });
        for (const { mesh, link } of body.links[shown]) {
          const wheel = body.wheels[shown][link.wheel].pivot;
          this.hub.copy(link.offset).applyEuler(wheel.rotation).add(wheel.position);
          this.end.copy(this.hub).sub(link.inboard);
          const length = this.end.length();
          mesh.position.copy(link.inboard).addScaledVector(this.end, 0.5);
          mesh.quaternion.setFromUnitVectors(this.up, this.end.normalize());
          mesh.scale.set(1, length, 1);
        }
      }
      this.poseCabin(body, id, level, a, b, o, alpha, view);
    }
  }
  /** The near cabin: detail only for the followed car and cars within
   * CABIN_DETAIL_DISTANCE, the helmet hidden in the own cockpit view, the
   * glazing sorted last there, the wheel turned by the recorded steering and
   * the followed car's instruments redrawn from the snapshot. */
  private poseCabin(
    body: Built,
    id: number,
    level: number,
    a: Float32Array,
    b: Float32Array,
    o: number,
    alpha: number,
    view: BodyView,
  ) {
    const cabin = body.lods[0].cabin;
    if (!cabin) return;
    const followed = id === view.follow,
      own = followed && view.cockpit,
      reach = view.detailDistance ?? CABIN_DETAIL_DISTANCE;
    const near =
      level === 0 &&
      (followed ||
        (!!view.camera &&
          reach > 0 &&
          view.camera.distanceToSquared(body.root.position) < reach * reach));
    body.near = near;
    cabin.detail.visible = near;
    for (const part of cabin.wheelDetail) part.visible = near;
    cabin.head.visible = !own;
    for (const glass of cabin.glass) glass.renderOrder = own ? CABIN_GLASS_ORDER : 0;
    if (level !== 0) return;
    cabin.steering.rotation.z =
      -lerp(a[o + F.STEER], b[o + F.STEER], alpha) * cabin.layout.wheel.ratio;
    // Only the followed car redraws its instruments (a canvas upload each tick).
    if (followed) cabin.display?.update(b, o);
  }
  private readonly feedShown: Built[] = [];
  private framesSinceFeed = 0;
  /** One rear-view feed pass (renderer mirror detail): every shown body at
   * the coarser of its main-view LOD and `choose(position, previous)` (its
   * size in that feed, with the feed's own hysteresis), and no cabin detail
   * (instruments, cages and harnesses are sub-pixel in a feed). The host
   * Formula representation is hidden for these bodies, so the renderer's own
   * feed LOD never reached them. `restoreFeedDetail` returns the main view. */
  showFeedDetail(choose: (position: T.Vector3, previous: number) => number) {
    this.restoreFeedDetail();
    this.framesSinceFeed = 0;
    for (const body of this.bodies.values()) {
      if (!body.root.visible) continue;
      const level = Math.max(
        body.level,
        Math.max(
          0,
          Math.min(2, Math.round(choose(body.root.position, body.feedLevel ?? body.level))),
        ),
      );
      body.feedLevel = level;
      const cabin = body.lods[0].cabin;
      if (level === body.level && !(level === 0 && cabin?.detail.visible)) continue;
      body.lods.forEach((lod, i) => (lod.group.visible = i === level));
      if (cabin) {
        cabin.detail.visible = false;
        for (const part of cabin.wheelDetail) part.visible = false;
      }
      this.feedShown.push(body);
    }
  }
  restoreFeedDetail() {
    for (const body of this.feedShown) {
      body.lods.forEach((lod, i) => (lod.group.visible = i === body.level));
      const cabin = body.lods[0].cabin;
      if (cabin) {
        cabin.detail.visible = body.near;
        for (const part of cabin.wheelDetail) part.visible = body.near;
      }
    }
    this.feedShown.length = 0;
  }
  /** The followed body's rear-view feed surfaces and the root that orients
   * them, while it is drawn near (null: none, or not a catalogue body). */
  mirrorsFor(id: number) {
    const body = this.bodies.get(id);
    const cabin = body?.lods[0].cabin;
    if (!body || !cabin || !body.root.visible || body.level !== 0 || cabin.mirrors.length !== 2)
      return null;
    return { root: body.root as T.Object3D, surfaces: cabin.mirrors };
  }
  /** The cabin layout of the body drawn for an entrant (diagnostics). */
  cabinOf(id: number) {
    return this.bodies.get(id)?.lods[0].cabin ?? null;
  }
  /** Shadow-pass substitution pairs (renderer ShadowProxies). */
  shadowSubstitutes(): ShadowSubstitute[] {
    const out: ShadowSubstitute[] = [];
    for (const body of this.bodies.values())
      if (body.root.visible) out.push({ fine: body.fine, coarse: body.proxy });
    return out;
  }
  private dispose(body: Built) {
    this.root.remove(body.root);
    body.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    body.lods[0].cabin?.display?.dispose();
  }
  /** Bodies currently shown (diagnostics). */
  get count() {
    let n = 0;
    for (const body of this.bodies.values()) if (body.root.visible) n++;
    return n;
  }
}
