import * as T from 'three';
import { stadiumSeatGeometry, type SeatTier } from './stadium-seat.ts';
import { StaticInstanceShadowBounds } from './static-instance-shadow-bounds.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../simulation/protocol.ts';
import { clamp } from '../core/math.ts';
import { detailDistance } from './view-detail.ts';
import { grassApronOffset } from './ground-profile.ts';
import { box, label } from './geometry.ts';
import { installVenueFinish } from './venue-materials.ts';
import type { StandSpec } from './venue-plan.ts';
import type { BroadcastSightlines } from './broadcast-sightlines.ts';
import {
  START_FINISH_ASSET,
  venueGeometry,
  type VenueTier,
  type VenueMesh,
} from './start-finish-assets.ts';

type GroundFrame = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  ground(x: number, z: number): number;
};
interface DetailGroup {
  root: T.Group;
  levels: T.Group[];
  centre: T.Vector3;
  level: number;
  radius: number;
  kind: string;
}
const TIERS: readonly VenueTier[] = ['near', 'mid', 'far'];
export function venueDetail(distance: number, previous = 0) {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid venue distance');
  if (previous === 0 && distance < 155) return 0;
  if (previous === 1 && distance > 130 && distance < 350) return 1;
  if (previous === 2 && distance > 300) return 2;
  return distance < 140 ? 0 : distance < 325 ? 1 : 2;
}
/** Display real rank, completed laps and speed, never guessed intervals or video. */
export function raceBoardRows(frame: Float32Array) {
  const count = frame[H.CARS];
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12 ||
    frame.length < HEADER + count * CAR_STRIDE
  )
    throw new Error('Invalid board frame');
  const rows = Array.from({ length: count }, (_, i) => {
    const b = carBase(i),
      rank = frame[b + F.RANK],
      laps = frame[b + F.LAPS],
      speed = frame[b + F.SPEED];
    if (![rank, laps, speed].every(Number.isFinite)) throw new Error('Invalid board readings');
    return {
      car: i + 1,
      rank: Math.round(rank),
      laps: Math.floor(laps),
      kmh: Math.round(Math.abs(speed) * 3.6),
      pit: frame[b + F.IN_PIT] === 1,
    };
  });
  return rows.sort((a, b) => a.rank - b.rank || a.car - b.car);
}
/** Two retained Aurel stand sites. All geometry is behind the existing barrier,
 * at the unchanged seat/aisle coordinates. No collision or simulation edits. */
/** Within this range of the camera the race board repaints even when out of
 * the main view: rear mirrors (far plane 280 m), the reflection probe and the
 * wet-road reflection can all show it. */
const BOARD_ALWAYS_REFRESH_M = 300;
export class StartFinishVenue {
  readonly roots: T.Group[] = [];
  readonly shadowBounds: StaticInstanceShadowBounds[] = [];
  private readonly details: DetailGroup[] = [];
  private readonly materials = {
    stone: new T.MeshStandardMaterial({ color: 0x969b95, roughness: 0.87 }),
    steel: new T.MeshStandardMaterial({ color: 0x334b52, roughness: 0.43, metalness: 0.65 }),
    roof: new T.MeshStandardMaterial({ color: 0xbfc6c5, roughness: 0.52, metalness: 0.4 }),
    trim: new T.MeshStandardMaterial({ color: 0x12606b, roughness: 0.5, metalness: 0.15 }),
    glass: new T.MeshStandardMaterial({ color: 0x23383e, roughness: 0.23, metalness: 0.35 }),
  };
  private board: {
    context: CanvasRenderingContext2D;
    texture: T.CanvasTexture;
    material: T.MeshStandardMaterial;
    face: T.Mesh;
    last: number;
    updates: number;
  } | null = null;
  private readonly boardSphere = new T.Sphere();
  private readonly boardFrustum = new T.Frustum();
  private readonly boardProjection = new T.Matrix4();
  constructor(readonly track: Track) {
    installVenueFinish(this.materials.stone, 'stone');
    for (const material of [this.materials.steel, this.materials.roof, this.materials.trim])
      installVenueFinish(material, 'metal');
  }
  accepts(site: StandSpec) {
    return this.track.circuit.id === 'aurel' && (site.s === -72 || site.s === 55);
  }
  private batch(
    root: T.Group,
    name: VenueMesh,
    mat: T.Material,
    matrices: readonly T.Matrix4[],
    mirror = false,
    geometry = venueGeometry(name, mirror),
  ) {
    const mesh = new T.InstancedMesh(geometry, mat, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.name = name;
    this.shadowBounds.push(new StaticInstanceShadowBounds(mesh));
    root.add(mesh);
    return mesh;
  }
  private register(root: T.Group, levels: T.Group[], radius: number, kind: string) {
    root.updateWorldMatrix(true, false);
    this.details.push({
      root,
      levels,
      centre: root.getWorldPosition(new T.Vector3()),
      radius,
      kind,
      level: 0,
    });
    levels.forEach((g, i) => (g.visible = i === 0));
    this.roots.push(root);
  }
  architecture(
    root: T.Group,
    site: StandSpec,
    frame: GroundFrame,
    sightlines?: BroadcastSightlines,
  ) {
    const count = Math.round(site.length / 8),
      matrices = Array.from({ length: count }, (_, i) =>
        new T.Matrix4().makeTranslation(0, 0, (i - (count - 1) / 2) * 8),
      );
    const levels = TIERS.map((tier) => {
      const group = new T.Group();
      group.name = `A11 ${tier}`;
      root.add(group);
      for (const [material, value] of Object.entries(this.materials)) {
        const batch = this.batch(
          group,
          `bay_${tier}_${material}` as VenueMesh,
          value,
          matrices,
          site.side < 0,
        );
        // Sightlines accept non-instanced solids; register each actual roof bay
        // transform instead of treating all the open seating as an opaque box.
        if (tier === 'near' && material === 'roof' && sightlines)
          for (const matrix of matrices) {
            const solid = new T.Mesh(batch.geometry, value);
            solid.matrixAutoUpdate = false;
            solid.matrix.copy(matrix);
            root.add(solid);
            sightlines.add(solid);
            root.remove(solid);
          }
      }
      this.batch(
        group,
        `stairs_${tier}`,
        this.materials.stone,
        [-0.25, 0.25].map((a) => new T.Matrix4().makeTranslation(0, 0, site.length * a)),
        site.side < 0,
      );
      return group;
    });
    // Footings extend to the actual apron. All world/local transforms stay positive determinant.
    for (let bay = 0; bay <= count; bay++)
      for (const u of [2.1, 9.8]) {
        const z = -site.length / 2 + bay * 8,
          x = site.side * u;
        const wx = frame.x + Math.cos(frame.yaw) * x + Math.sin(frame.yaw) * z,
          wz = frame.z - Math.sin(frame.yaw) * x + Math.cos(frame.yaw) * z;
        const low = frame.ground(wx, wz) - frame.y - 0.12;
        box(root, this.materials.stone, x, low / 2, z, 0.5, Math.max(0.12, -low), 0.5).name =
          'Ground-fitted foundation';
      }
    const sign = new T.Mesh(
      new T.PlaneGeometry(Math.min(26, site.length * 0.65), 0.5),
      new T.MeshStandardMaterial({
        map: label('AUREL  /  GRAND CIRCUIT', '#115866', '#f2ede2', 1024, 64),
        roughness: 0.7,
      }),
    );
    sign.position.set(site.side * -1.9, 5.66, 0);
    sign.rotation.y = (-site.side * Math.PI) / 2;
    root.add(sign);
    root.userData.startFinish = {
      revision: 1,
      asset: START_FINISH_ASSET.runtimeSHA256,
      bays: count,
      finalArtApproved: false,
    };
    this.register(root, levels, site.length / 2, 'grandstand');
  }
  seats(
    root: T.Group,
    site: StandSpec,
    matrices: readonly T.Matrix4[],
    colors: readonly T.Color[],
    material: T.Material,
  ) {
    const owner = new T.Group();
    owner.name = `A13 seats ${site.s}m`;
    root.add(owner);
    // Moulded plastic stadium shells on pedestals replace the authored
    // stool-like seat; same tiers, transforms, colours and shadow bounds.
    const levels = TIERS.map((tier, i) => {
      const group = new T.Group();
      owner.add(group);
      const seats = this.batch(
        group,
        `seat_${tier}`,
        material,
        matrices,
        false,
        stadiumSeatGeometry(i as SeatTier),
      );
      colors.forEach((c, i) => seats.setColorAt(i, c));
      return group;
    });
    this.register(owner, levels, site.length / 2, 'seats');
  }
  buildScreen(parent: T.Group, sightlines: BroadcastSightlines) {
    if (this.track.circuit.id !== 'aurel') return;
    const p = this.track.at(this.track.length - 12, trackPoint()),
      l = -(this.track.boundary(p.s, -1) + 10);
    const root = new T.Group();
    root.name = 'A18 start-finish race-information screen';
    root.position.set(
      p.x + p.nx * l,
      p.y + p.bank * clamp(l, -12, 12) + grassApronOffset(this.track, p.s, l),
      p.z + p.nz * l,
    );
    // Front (-Z) faces the track; broad screen sits entirely in the gap between stands.
    root.rotation.y = Math.atan2(p.nx, p.nz) + Math.PI;
    parent.add(root);
    const levels = TIERS.map((tier) => {
      const g = new T.Group();
      root.add(g);
      this.batch(g, `screen_${tier}`, this.materials.steel, [new T.Matrix4()]);
      return g;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Race board canvas unavailable');
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.name = 'A18 live race-information canvas';
    // The generic texture budget copies immutable canvases. This display must
    // keep the same painted canvas through quality changes and replay seeks.
    texture.userData.dynamic = true;
    texture.anisotropy = 4;
    const material = new T.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0xffffff,
      emissiveIntensity: 0.7,
      roughness: 0.55,
      toneMapped: true,
    });
    const face = new T.Mesh(new T.PlaneGeometry(8.2, 4.24), material);
    face.name = 'A18 live race-information face';
    face.position.set(0, 6.2, -0.29);
    face.rotation.y = Math.PI;
    root.add(face);
    sightlines.add(face);
    this.board = { context, texture, material, face, last: NaN, updates: 0 };
    this.register(root, levels, 7, 'screen');
    root.userData.startFinish = {
      revision: 1,
      liveRaceInformation: true,
      liveVideo: false,
      finalArtApproved: false,
    };
  }
  reset() {
    // A new session may begin at the same timestamp as the previous paused grid.
    if (this.board) this.board.last = NaN;
  }
  update(frame: Float32Array, camera?: T.PerspectiveCamera, night = false) {
    if (camera)
      for (const item of this.details) {
        const d = detailDistance(
          Math.max(0, item.centre.distanceTo(camera.position) - item.radius),
          camera.fov,
          camera.aspect,
        );
        item.level = venueDetail(d, item.level);
        item.levels.forEach((g, i) => (g.visible = i === item.level));
      }
    if (!this.board) return;
    if (!Number.isFinite(frame[H.TIME]) || !Number.isFinite(frame[H.RAIN]))
      throw new Error('Invalid board clock or weather');
    const key = Math.floor(frame[H.TIME] * 4);
    this.board.material.emissiveIntensity = night ? 0.45 : 0.7;
    if (key === this.board.last) return;
    // Repainting is a 1024x512 canvas draw plus a 2 MB texture upload with
    // mipmaps. Skip it while no view can show the face: outside the main
    // frustum and beyond the mirror/probe range around the camera. The next
    // frame that can show it repaints at once (its key is stale by then).
    if (camera && !this.boardViewable(camera)) return;
    const rows = raceBoardRows(frame),
      c = this.board.context;
    c.fillStyle = '#0b151c';
    c.fillRect(0, 0, 1024, 512);
    c.fillStyle = '#126370';
    c.fillRect(0, 0, 1024, 98);
    c.fillStyle = '#f1eddf';
    c.font = 'bold 36px sans-serif';
    c.textAlign = 'left';
    c.fillText('AUREL  /  RACE CONTROL', 35, 60);
    c.font = '22px monospace';
    c.fillText('POS     CAR        LAPS       KM/H', 35, 138);
    rows.slice(0, 6).forEach((row, i) => {
      const y = 188 + i * 51;
      c.fillStyle = i % 2 ? '#183039' : '#102229';
      c.fillRect(24, y - 33, 976, 47);
      c.fillStyle = '#e4e7dd';
      c.font = 'bold 28px monospace';
      c.fillText(
        `${String(row.rank).padStart(2)}      ${String(row.car).padStart(2, '0')}          ${String(row.laps).padStart(2)}        ${row.pit ? 'PIT' : String(row.kmh).padStart(3)}`,
        36,
        y,
      );
    });
    c.font = '18px monospace';
    c.fillStyle = '#b6c7c7';
    c.fillText(
      `SESSION ${frame[H.TIME].toFixed(1)}s  /  RAIN ${frame[H.RAIN].toFixed(1)} mm/h`,
      35,
      501,
    );
    this.board.texture.needsUpdate = true;
    this.board.last = key;
    this.board.updates++;
  }
  private boardViewable(camera: T.PerspectiveCamera) {
    const face = this.board!.face;
    face.updateWorldMatrix(true, false);
    this.boardSphere.center.setFromMatrixPosition(face.matrixWorld);
    // Half the 8.2 x 4.24 m face diagonal, with margin.
    this.boardSphere.radius = 5;
    if (this.boardSphere.center.distanceTo(camera.position) < BOARD_ALWAYS_REFRESH_M) return true;
    camera.updateMatrixWorld();
    this.boardFrustum.setFromProjectionMatrix(
      this.boardProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    return this.boardFrustum.intersectsSphere(this.boardSphere);
  }
  diagnostics() {
    return {
      revision: 1,
      stands: this.details.filter((g) => g.kind === 'grandstand').length,
      boards: this.board ? 1 : 0,
      boardUpdates: this.board?.updates ?? 0,
      detailLevels: this.details.map((g) => ({ kind: g.kind, level: g.level })),
      sourceSHA256: START_FINISH_ASSET.runtimeSHA256,
      finalArtApproved: false,
    };
  }
}
