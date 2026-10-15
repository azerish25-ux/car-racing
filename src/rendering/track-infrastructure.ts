import type { TrackSignalHardwareKit } from './track-signal-hardware.ts';
import type { BroadcastCamerasKit } from './broadcast-cameras.ts';
import type { MarshalPostsKit } from './marshal-posts.ts';
import * as T from 'three';
import { clamp } from '../core/math.ts';
import { FLAG } from '../simulation/marshal.ts';
import { H } from '../simulation/protocol.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { drainSide, drainStations } from '../simulation/surface-drainage.ts';
import { box, mesh, rod } from './geometry.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { installVenueFinish } from './venue-materials.ts';
import { grassApronOffset } from './ground-profile.ts';
import { inStandFootprint } from './grandstand.ts';
import { tracksideRigs } from './trackside.ts';

export interface TrackDetailSite {
  kind: 'drain' | 'marshal' | 'utility' | 'camera';
  s: number;
  side: -1 | 1;
  lateral: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  rigId?: number;
  cameraY?: number;
  supported?: boolean;
}

export interface TrackInfrastructurePlan {
  drains: readonly TrackDetailSite[];
  marshalPosts: readonly TrackDetailSite[];
  utilities: readonly TrackDetailSite[];
  cameras: readonly TrackDetailSite[];
}

const MARSHAL_STATIONS = Object.freeze([
  365, 575, 870, 1165, 1415, 1635, 1875, 2075, 2305, 2485, 2675, 2850,
]);
const UTILITY_SPACING_M = 185;

function preferredSide(track: Track, s: number, ordinal: number): -1 | 1 {
  const p = track.at(s, trackPoint());
  return drainSide(p.bank, p.curvature, ordinal);
}

function groundHeight(track: Track, x: number, z: number) {
  const p = trackPoint(),
    lateral = track.nearest(x, z, p);
  return p.y + p.bank * clamp(lateral, -12, 12) + grassApronOffset(track, p.s, lateral);
}

function siteAt(
  track: Track,
  kind: TrackDetailSite['kind'],
  s: number,
  side: -1 | 1,
  lateral: number,
): TrackDetailSite {
  const p = track.at(s, trackPoint()),
    x = p.x + p.nx * lateral,
    z = p.z + p.nz * lateral;
  return {
    kind,
    s,
    side,
    lateral,
    x,
    y: groundHeight(track, x, z),
    z,
    yaw: Math.atan2(p.tx, p.tz),
  };
}

function clearMarshalSide(track: Track, s: number, preferred: -1 | 1): -1 | 1 {
  const alternatives: readonly (-1 | 1)[] = [preferred, preferred === 1 ? -1 : 1];
  for (const side of alternatives) {
    const p = track.at(s, trackPoint()),
      lateral = side * (track.boundary(s, side) + 4.4),
      x = p.x + p.nx * lateral,
      z = p.z + p.nz * lateral;
    if (!inStandFootprint(track, x, z, 1.5)) return side;
  }
  return preferred;
}

/** Deterministic authored/rule-based near-track detail. Nothing is randomly scattered:
 * drainage follows the low/outside edge, marshal shelters use fixed stations and avoid
 * grandstands, utility cabinets use a fixed service cadence, and physical camera towers
 * share the exact replay-camera positions. */
export function trackInfrastructurePlan(track: Track): TrackInfrastructurePlan {
  const drains = drainStations(track.length).map(({ s, ordinal }) => {
    const side = preferredSide(track, s, ordinal),
      p = track.at(s, trackPoint()),
      lateral = side * (p.width + 1.42);
    return siteAt(track, 'drain', s, side, lateral);
  });

  // Catalogue layouts (any length): a post about every 240 m of the lap.
  const stations = track.circuit.catalogue
    ? Array.from({ length: Math.floor((track.length - 425) / 240) }, (_, i) => 365 + i * 240)
    : MARSHAL_STATIONS;
  const marshalPosts = stations
    .filter((s) => s < track.length - 60)
    .map((s, i) => {
      const preferred = preferredSide(track, s, i),
        side = clearMarshalSide(track, s, preferred),
        lateral = side * (track.boundary(s, side) + 4.4);
      return siteAt(track, 'marshal', s, side, lateral);
    });

  const utilities: TrackDetailSite[] = [];
  for (let s = 395, i = 0; s < track.length - 260; s += UTILITY_SPACING_M, i++) {
    let side = preferredSide(track, s, i);
    const point = track.at(s, trackPoint());
    let lateral = side * (track.boundary(s, side) + 2.4);
    const x = point.x + point.nx * lateral,
      z = point.z + point.nz * lateral;
    if (inStandFootprint(track, x, z, 1)) {
      side = side === 1 ? -1 : 1;
      lateral = side * (track.boundary(s, side) + 2.4);
    }
    utilities.push(siteAt(track, 'utility', s, side, lateral));
  }

  const cameras = tracksideRigs(track).map((rig) => {
    const near = trackPoint(),
      lateral = track.nearest(rig.position.x, rig.position.z, near),
      side: -1 | 1 = lateral < 0 ? -1 : 1,
      ground = groundHeight(track, rig.position.x, rig.position.z);
    return {
      kind: 'camera' as const,
      s: near.s,
      side,
      lateral,
      x: rig.position.x,
      y: ground,
      z: rig.position.z,
      yaw: Math.atan2(near.tx, near.tz),
      rigId: rig.id,
      cameraY: rig.position.y,
      supported: !inStandFootprint(track, rig.position.x, rig.position.z, 0.7),
    };
  });
  return { drains, marshalPosts, utilities, cameras };
}

/** Real slotted grates, conformed vertex-by-vertex to both camber and grade.
 * Only the visible finish changes: the original drain stations and tyre-contact
 * surface are retained. The recessed bed sits just above the existing surface. */
export function drainGratingGeometry(track: Track, site: TrackDetailSite) {
  if (site.kind !== 'drain' || ![site.x, site.y, site.z, site.yaw].every(Number.isFinite))
    throw new Error('Invalid drain grating site');
  const parts: T.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(new T.BoxGeometry(0.035, 0.018, 1.65).translate(side * 0.1925, 0.013, 0));
    parts.push(new T.BoxGeometry(0.35, 0.018, 0.035).translate(0, 0.013, side * 0.8075));
  }
  for (let i = 0; i < 14; i++)
    parts.push(
      new T.BoxGeometry(0.35, 0.015, 0.037).translate(0, 0.0145, -0.742 + i * (1.484 / 13)),
    );
  const grate = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  const bed = new T.BoxGeometry(0.405, 0.008, 1.635).translate(0, 0.003, 0);
  for (const geometry of [grate, bed]) {
    const positions = geometry.getAttribute('position'),
      c = Math.cos(site.yaw),
      n = Math.sin(site.yaw);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        z = positions.getZ(i);
      const worldX = site.x + c * x + n * z,
        worldZ = site.z - n * x + c * z;
      // Aurel's painted runoff sits 32 mm above the grass datum. Keep the
      // drain above that finish with a shallow cosmetic relief, rather than
      // burying the bars beneath it or adding a new physical bump.
      const localHeight =
        track.circuit.id === 'aurel' ? 0.033 + positions.getY(i) * 0.2 : positions.getY(i);
      positions.setY(i, localHeight + groundHeight(track, worldX, worldZ) - site.y);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return { grate, bed };
}

export function safetyPanelAppearance(flag: number) {
  switch (flag) {
    case FLAG.YELLOW:
      return { color: 0xffb000, intensity: 3.6 };
    case FLAG.DOUBLE_YELLOW:
      return { color: 0xff8a00, intensity: 5.2 };
    case FLAG.BLUE:
      return { color: 0x2b7cff, intensity: 3.2 };
    case FLAG.CHEQUERED:
      return { color: 0xf2f2e9, intensity: 2.8 };
    default:
      return { color: 0x2a5636, intensity: 0.18 };
  }
}

export function updateSafetyPanel(material: T.MeshStandardMaterial, frame: Float32Array) {
  const state = safetyPanelAppearance(frame[H.FLAG]);
  material.color.setHex(state.color);
  material.emissive.setHex(state.color);
  material.emissiveIntensity = state.intensity;
}

function placeRoot(root: T.Object3D, site: TrackDetailSite) {
  root.position.set(site.x, site.y, site.z);
  root.rotation.y = site.yaw;
}

/** Adds static, spatially batchable circuit-life geometry. The only intentionally
 * dynamic material is the shared marshal LED panel, which consumes the real race flag. */
export function buildTrackInfrastructure(
  track: Track,
  parent: T.Group,
  safetyPanel: T.MeshStandardMaterial,
  plan: TrackInfrastructurePlan = trackInfrastructurePlan(track),
  marshalKit: MarshalPostsKit | null = null,
  signalKit: TrackSignalHardwareKit | null = null,
  cameraKit: BroadcastCamerasKit | null = null,
) {
  const concrete = new T.MeshStandardMaterial({ color: 0x777a75, roughness: 0.92 }),
    steel = new T.MeshStandardMaterial({ color: 0x4f5a5d, metalness: 0.72, roughness: 0.47 }),
    dark = new T.MeshStandardMaterial({ color: 0x1a2022, metalness: 0.35, roughness: 0.56 }),
    safety = new T.MeshStandardMaterial({ color: 0xdc6a2d, roughness: 0.73 }),
    lens = new T.MeshPhysicalMaterial({
      color: 0x1c262a,
      metalness: 0.12,
      roughness: 0.08,
      // A coated camera lens is opaque from the spectator viewpoint. Tiny
      // lens panes must not trigger a scene-wide transmission render pass.
      transmission: 0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.1,
    });

  installVenueFinish(concrete, 'stone');
  installVenueFinish(steel, 'metal');
  for (const site of plan.drains) {
    const { grate, bed } = drainGratingGeometry(track, site);
    for (const [geometry, material, name] of [
      [grate, steel, 'Slotted drainage grate'],
      [bed, dark, 'Recessed drain bed'],
    ] as const) {
      const drain = mesh(parent, geometry, material);
      placeRoot(drain, site);
      drain.name = `${name} ${Math.round(site.s)}m`;
      drain.castShadow = false;
    }
  }

  for (const [index, site] of plan.marshalPosts.entries()) {
    const g = new T.Group();
    g.name = `Marshal shelter ${index + 1}`;
    placeRoot(g, site);
    parent.add(g);
    // Level concrete pad, open track-facing shelter, equipment cabinet and a real-state LED board.
    if (marshalKit) marshalKit.buildPost(track, parent, site, index);
    else {
      box(g, concrete, 0, 0.09, 0, 3.1, 0.18, 2.5);
      box(g, safety, site.side * 1.35, 1.25, 0, 0.12, 2.35, 2.5);
      box(g, steel, 0, 2.42, 0, 3.2, 0.14, 2.65);
      for (const z of [-1.325, 1.325]) {
        box(g, steel, 0, 2.35, z, 3.25, 0.21, 0.055);
        rod(
          g,
          steel,
          new T.Vector3(site.side * 1.4, 2.34, z),
          new T.Vector3(site.side * 1.4, 0.19, z),
          0.027,
        );
      }
      for (let z = -0.9; z <= 0.9; z += 0.3)
        box(g, dark, site.side * 1.42, 2.04, z, 0.025, 0.085, 0.16);
      box(g, steel, -site.side * 1.16, 1.18, -1.02, 0.09, 2.25, 0.09);
      box(g, steel, -site.side * 1.16, 1.18, 1.02, 0.09, 2.25, 0.09);
      box(g, dark, site.side * 0.88, 0.72, -0.62, 0.48, 1.3, 0.58);
    }
    signalKit?.buildHardware(track, parent, site, 'flag_back');
    const panel = box(g, safetyPanel, -site.side * 1.42, 1.85, 0, 0.09, 0.72, 1.15);
    panel.name = `Recorded marshal LED ${index + 1}`;
    signalKit?.displays.bind(panel as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>, site.s);
    // Two compact extinguisher cylinders make the station read as safety infrastructure.
    for (const z of [-0.7, 0.7]) {
      const extinguisher = mesh(g, new T.CylinderGeometry(0.09, 0.09, 0.62, 10), safety);
      extinguisher.position.set(site.side * 0.63, 0.4, z);
    }
  }

  for (const [index, site] of plan.utilities.entries()) {
    const g = new T.Group();
    g.name = `Track utility cabinet ${index + 1}`;
    placeRoot(g, site);
    parent.add(g);
    if (signalKit) {
      signalKit.buildHardware(track, parent, site, 'utility');
      continue;
    }
    box(g, concrete, 0, 0.06, 0, 0.95, 0.12, 0.72);
    box(g, steel, 0, 0.68, 0, 0.72, 1.2, 0.52);
    box(g, dark, -0.37, 0.78, 0.08, 0.015, 0.42, 0.22);
    box(g, dark, 0, 0.69, -0.269, 0.62, 1.07, 0.016);
    box(g, steel, 0, 0.69, -0.282, 0.027, 1.07, 0.023);
    for (const y of [0.25, 0.72, 1.14]) {
      box(g, steel, -0.305, y, -0.291, 0.038, 0.065, 0.042);
      box(g, steel, 0.305, y, -0.291, 0.038, 0.065, 0.042);
    }
    for (let y = 0.96; y < 1.22; y += 0.065) box(g, steel, 0.15, y, -0.289, 0.22, 0.028, 0.023);
    rod(g, dark, new T.Vector3(0.23, 0.13, -0.33), new T.Vector3(0.23, 0.62, -0.33), 0.018);
    box(g, dark, 0.12, 0.71, -0.312, 0.035, 0.16, 0.038);
  }

  signalKit?.buildSensors(track, parent);

  for (const site of plan.cameras) {
    const g = new T.Group();
    g.name = `Replay camera infrastructure ${site.rigId}`;
    placeRoot(g, site);
    parent.add(g);
    if (cameraKit) {
      cameraKit.buildCamera(track, parent, site);
      continue;
    }
    const cameraHeight = Math.max(1.2, (site.cameraY ?? site.y + 3) - site.y);
    if (site.supported) {
      box(g, concrete, 0, 0.08, 0, 1.3, 0.16, 1.3);
      // Mount hardware sits outside/behind the actual optical viewpoint.
      // The old eye intersected both the body and platform handrail.
      box(g, steel, site.side * 0.7, cameraHeight * 0.5, 0, 0.12, cameraHeight, 0.12);
      box(g, steel, site.side * 0.7, cameraHeight - 0.5, 0, 1.15, 0.12, 1.0);
      for (const z of [-0.47, 0.47])
        box(g, steel, site.side * 0.95, cameraHeight - 0.25, z, 0.65, 0.35, 0.055);
    }
    const camera = new T.Group();
    camera.position.set(0, cameraHeight, 0);
    camera.rotation.y = site.side > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(camera);
    // Local -Z is the lens direction; all body/barrel geometry stays
    // behind the lens origin instead of covering its own recorded view.
    box(camera, dark, 0, 0, 0.58, 0.36, 0.26, 0.62);
    const barrel = mesh(camera, new T.CylinderGeometry(0.1, 0.13, 0.3, 12), lens, 0, 0, 0.18);
    barrel.rotation.x = Math.PI / 2;
  }

  return plan;
}
