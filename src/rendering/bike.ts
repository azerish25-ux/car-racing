import {
  bindGpBareMetal,
  calibrateGpMaterials,
  gpFrontFender,
  gpSilencer,
} from './gp-appearance.ts';
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { batchBikeRigidMeshes } from './bike-rigid-batch.ts';
import { addGPIdentity } from './bike-livery.ts';
import { gpBodywork, gpUpperCowl } from './gp-bodywork.ts';
import { gpRadialBrakeCaliper } from './gp-radial-caliper.ts';
import { gpDiscGlow } from './gp-disc-glow.ts';
import { gpForgedWheel, gpTyreCompoundMarkings } from './gp-forged-wheel.ts';
import { bindGpTyre, installGpTyreFinish, type GpTyreAppearance } from './gp-tyre-finish.ts';
import { gpCoolingLouvers } from './gp-cooling-louvers.ts';
import { GPChainDrive } from './gp-chain-drive.ts';
import { bikeSurfaceMaps } from './bike-surface-detail.ts';
import { BikeCockpit } from './bike-cockpit.ts';
import { tcamFov } from './cockpit-framing.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import { carbonMaterial } from './materials.ts';
import { sampleProfile } from './profile-sampling.ts';
import {
  carBase,
  B,
  BIKE_BASE,
  F,
  H,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
} from '../simulation/protocol.ts';
import { BIKE_STATES } from '../simulation/bike.ts';
import { chassisLean } from '../simulation/bike-definitions.ts';
import { vehicleAt, type VehicleDefinition } from '../simulation/vehicles.ts';
import { COMPOUNDS } from '../simulation/config.ts';
import { liveryScheme } from './car-livery.ts';
import { canvasTexture } from './geometry.ts';
import { detailDistance } from './view-detail.ts';
import { Rider, type RiderDetail } from './rider.ts';
import { bikeSheetFor } from './bike-sheet.ts';
import { isDirtBike } from '../simulation/offroad/dirt-bikes.ts';
import { DirtBikeModel } from './offroad/dirt-bike-model.ts';
import { mudUniforms } from './offroad/mud.ts';
import {
  BikeServicePose,
  BikeServiceRig,
  BikeWheelTask,
  bikeServiceGeometry,
  forkLocalOffset,
} from './bike-pit-service.ts';
import { pitServiceActive } from './pit-presentation.ts';

/** Procedural road-racing motorcycle (WP34 presentation, masterplan §17).
 * Original design, no real manufacturer or team: a lofted fairing in
 * clear-coated paint, carbon wings and tank cover, a transmissive windscreen,
 * an exposed twin-spar frame and swingarm, upside-down fork whose lower legs
 * slide with the recorded compression, carbon front discs with radial
 * calipers, a chain drive, a titanium exhaust and profiled tyres that roll on
 * their crowns. The bike is posed only from the snapshot (chassis pose, lean,
 * steer, fork/shock, rider block), so live play and replays agree. Three LODs:
 * near, mid (simplified parts, fewer segments) and far (silhouette). */
type Detail = RiderDetail;
const RAKE = 0.42,
  FORK_OFFSET = 0.03,
  FORK_LENGTH = 0.7;
export interface Section {
  z: number;
  y: number;
  w: number;
  top: number;
  bottom: number;
  /** Width of the upper half relative to `w` (a wedge-like fairing section). */
  topWidth?: number;
}
/** Closed superelliptic loft along +Z; distinct top/bottom radii shape a fairing. */
export function superLoft(input: readonly Section[], sides: number, exponent = 2.6, caps = true) {
  // Ascending z keeps the winding (and so the normals) outward.
  const stations = [...input].sort((a, b) => a.z - b.z);
  const zs = stations.map((s) => s.z);
  const steps = sides >= 32 ? 5 : sides >= 16 ? 3 : 1;
  const sections: Section[] = [];
  for (let i = 0; i < stations.length - 1; i++)
    for (let j = 0; j < steps; j++) {
      const z = T.MathUtils.lerp(zs[i], zs[i + 1], j / steps);
      const at = (key: 'y' | 'w' | 'top' | 'bottom' | 'topWidth') =>
        sampleProfile(
          zs,
          stations.map((s) => s[key] ?? 1),
          z,
        );
      sections.push({
        z,
        y: at('y'),
        w: at('w'),
        top: at('top'),
        bottom: at('bottom'),
        topWidth: at('topWidth'),
      });
    }
  sections.push(stations[stations.length - 1]);
  const p: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const e = 2 / exponent;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2,
        c = Math.cos(a),
        si = Math.sin(a);
      const x =
          Math.sign(c) * Math.abs(c) ** e * s.w * (si > 0 ? 1 - (1 - (s.topWidth ?? 1)) * si : 1),
        y = s.y + Math.sign(si) * Math.abs(si) ** e * (si > 0 ? s.top : s.bottom);
      p.push(x, y, s.z);
      uv.push(j / sides, i / (sections.length - 1));
    }
  }
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  if (caps)
    for (const end of [0, sections.length - 1]) {
      const centre = p.length / 3,
        s = sections[end];
      p.push(0, s.y, s.z);
      uv.push(0.5, end ? 1 : 0);
      for (let j = 0; j < sides; j++) {
        const a = end * (sides + 1) + j;
        if (end) indices.push(centre, a, a + 1);
        else indices.push(centre, a + 1, a);
      }
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
/** Open sheet over the upper arc of each section (windscreen bubble). */
function arcSheet(input: readonly Section[], from: number, to: number, columns: number) {
  const stations = [...input].sort((a, b) => a.z - b.z);
  const zs = stations.map((s) => s.z);
  const steps = columns >= 16 ? 5 : columns >= 8 ? 3 : 1;
  const sections: Section[] = [];
  for (let i = 0; i < stations.length - 1; i++)
    for (let j = 0; j < steps; j++) {
      const z = T.MathUtils.lerp(zs[i], zs[i + 1], j / steps);
      const at = (key: 'y' | 'w' | 'top') =>
        sampleProfile(
          zs,
          stations.map((s) => s[key]),
          z,
        );
      sections.push({ z, y: at('y'), w: at('w'), top: at('top'), bottom: 0 });
    }
  sections.push(stations[stations.length - 1]);
  const p: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    for (let j = 0; j <= columns; j++) {
      const a = T.MathUtils.lerp(from, to, j / columns);
      p.push(Math.cos(a) * s.w, s.y + Math.sin(a) * s.top, s.z);
      uv.push(j / columns, i / (sections.length - 1));
    }
  }
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < columns; j++) {
      const a = i * (columns + 1) + j,
        b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
/** Tyre: tread arc of `crown` radius over `halfWidth`, rounded sidewalls to the
 * rim bead; lathed about the axle (local X). */
export function tyreGeometry(
  radius: number,
  halfWidth: number,
  crown: number,
  rim: number,
  sides: number,
) {
  const points: T.Vector2[] = [];
  const reach = Math.min(1.25, Math.asin(Math.min(0.98, halfWidth / crown)));
  const centre = radius - crown;
  // Bead (rim) on one side, sidewall bulge, tread arc, sidewall, bead.
  const wall = (t: number, sign: number) =>
    new T.Vector2(
      T.MathUtils.lerp(rim, centre + crown * Math.cos(reach), t) + Math.sin(t * Math.PI) * 0.012,
      sign * (halfWidth * (0.82 + 0.18 * Math.sin(t * Math.PI * 0.5)) - (1 - t) * 0.012),
    );
  for (let i = 0; i <= 4; i++) points.push(wall(i / 4, -1));
  for (let i = 1; i < 12; i++) {
    const a = -reach + (i / 12) * 2 * reach;
    points.push(new T.Vector2(centre + crown * Math.cos(a), crown * Math.sin(a)));
  }
  for (let i = 4; i >= 0; i--) points.push(wall(i / 4, 1));
  const g = new T.LatheGeometry(points, sides);
  g.rotateZ(Math.PI / 2);
  return bindGpTyre(g, halfWidth);
}
export function ringGeometry(outer: number, inner: number, thickness: number, sides: number) {
  const shape = new T.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new T.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new T.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: sides,
  });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(Math.PI / 2);
  return g;
}
/** Machined fork bridge in the steering frame. The two bores share the exact
 * fork centres; a relieved centre leaves visible daylight around the stem.
 * REF_017/022: the top yoke is a shaped casting, not a rectangular bar. */
export function tripleClampGeometry(thickness = 0.025, segments = 10) {
  const shape = new T.Shape();
  shape.moveTo(-0.146, 0.03);
  shape.bezierCurveTo(-0.146, 0.071, -0.082, 0.091, -0.06, 0.043);
  shape.quadraticCurveTo(-0.042, 0.005, 0, 0.008);
  shape.quadraticCurveTo(0.042, 0.005, 0.06, 0.043);
  shape.bezierCurveTo(0.082, 0.091, 0.146, 0.071, 0.146, 0.03);
  shape.quadraticCurveTo(0.145, -0.009, 0.11, -0.016);
  shape.lineTo(0.042, -0.054);
  shape.quadraticCurveTo(0, -0.069, -0.042, -0.054);
  shape.lineTo(-0.11, -0.016);
  shape.quadraticCurveTo(-0.145, -0.009, -0.146, 0.03);
  for (const [x, z, radius] of [
    [-0.105, FORK_OFFSET, 0.032],
    [0.105, FORK_OFFSET, 0.032],
    [0, -0.031, 0.0135],
    [-0.055, -0.014, 0.009],
    [0.055, -0.014, 0.009],
  ]) {
    const hole = new T.Path();
    hole.absarc(x, z, radius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelSize: 0.0012,
    bevelThickness: 0.0012,
    bevelSegments: 1,
    curveSegments: segments,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, thickness / 2, 0);
  return geometry;
}
/** Vent slots are cut from the carbon rotor annulus, not painted black dots. */
function ventedRotor(sides: number) {
  const shape = new T.Shape();
  shape.absarc(0, 0, 0.17, 0, Math.PI * 2, false);
  const centre = new T.Path();
  centre.absarc(0, 0, 0.115, 0, Math.PI * 2, true);
  shape.holes.push(centre);
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2,
      hole = new T.Path();
    for (let j = 0; j <= 8; j++) {
      const a = (-j / 8) * Math.PI * 2;
      const x =
        Math.cos(angle) * (0.145 + Math.cos(a) * 0.007) - Math.sin(angle) * Math.sin(a) * 0.0028;
      const y =
        Math.sin(angle) * (0.145 + Math.cos(a) * 0.007) + Math.cos(angle) * Math.sin(a) * 0.0028;
      if (j === 0) hole.moveTo(x, y);
      else hole.lineTo(x, y);
    }
    shape.holes.push(hole);
  }
  const g = new T.ExtrudeGeometry(shape, {
    depth: 0.022,
    bevelEnabled: false,
    curveSegments: sides,
  });
  g.translate(0, 0, -0.011);
  g.rotateY(Math.PI / 2);
  return g;
}
/** Rectangular-section beam swept along a curve (frame spars, swingarm). */
export function beam(
  points: readonly [number, number, number][],
  width: number,
  height: number,
  segments: number,
  profileSegments = 12,
) {
  const shape = new T.Shape();
  const r = Math.min(width, height) * 0.3,
    w = width / 2,
    h = height / 2;
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  const path = new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p)));
  return new T.ExtrudeGeometry(shape, {
    steps: segments,
    curveSegments: profileSegments,
    bevelEnabled: false,
    extrudePath: path,
  });
}
export function tube(
  points: readonly [number, number, number][],
  radius: number,
  segments: number,
  sides: number,
) {
  return new T.TubeGeometry(
    new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p))),
    segments,
    radius,
    sides,
    false,
  );
}
/** Exhaust tube with a heat-tint vertex gradient (blued headers to straw). */
export function exhaustGeometry(
  points: readonly [number, number, number][],
  radius: number,
  segments: number,
  sides: number,
) {
  const g = tube(points, radius, segments, sides);
  const count = g.getAttribute('position').count,
    colours = new Float32Array(count * 3),
    hot = new T.Color(0x3c4a8a),
    warm = new T.Color(0xb7955a),
    cool = new T.Color(0xc8c6c2),
    c = new T.Color();
  for (let i = 0; i < count; i++) {
    const t = Math.floor(i / (sides + 1)) / segments;
    if (t < 0.35) c.copy(hot).lerp(warm, t / 0.35);
    else c.copy(warm).lerp(cool, Math.min(1, (t - 0.35) / 0.4));
    colours.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new T.BufferAttribute(colours, 3));
  return g;
}
export function numberTexture(number: number, paint: string, ink: string) {
  return canvasTexture(512, 512, (c) => {
    c.clearRect(0, 0, 512, 512);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'italic 900 360px "Saira Variable", sans-serif';
    c.lineJoin = 'round';
    c.lineWidth = 20;
    c.strokeStyle = '#15191c';
    c.strokeText(String(number).padStart(2, '0'), 244, 267, 470);
    c.fillStyle = ink;
    c.fillText(String(number).padStart(2, '0'), 244, 267, 470);
    c.fillStyle = paint;
    c.fillRect(105, 454, 300, 8);
  });
}
/** Materials of one entrant (paint per livery; mechanical finishes shared in spirit). */
export class BikeMaterials {
  readonly list: T.Material[] = [];
  readonly paint: T.MeshPhysicalMaterial;
  readonly secondary: T.MeshPhysicalMaterial;
  readonly accent: T.MeshPhysicalMaterial;
  readonly carbon: T.MeshPhysicalMaterial;
  readonly aluminium: T.MeshStandardMaterial;
  readonly titanium: T.MeshStandardMaterial;
  readonly rubber: T.MeshStandardMaterial;
  readonly tyreFinish: ReturnType<typeof installGpTyreFinish>;
  readonly wheel: T.MeshPhysicalMaterial;
  readonly forkUpper: T.MeshStandardMaterial;
  readonly forkLower: T.MeshStandardMaterial;
  readonly disc: T.MeshStandardMaterial;
  readonly caliper: T.MeshStandardMaterial;
  readonly dark: T.MeshStandardMaterial;
  readonly steel: T.MeshStandardMaterial;
  readonly seat: T.MeshStandardMaterial;
  readonly screen: T.MeshPhysicalMaterial;
  readonly screenLight: T.MeshPhysicalMaterial;
  readonly reservoir: T.MeshStandardMaterial;
  readonly lamp: T.MeshStandardMaterial;
  readonly band: T.MeshStandardMaterial;
  readonly plate: T.MeshPhysicalMaterial;
  constructor(id: number) {
    const scheme = liveryScheme(id);
    const add = <M extends T.Material>(m: M) => (this.list.push(m), m);
    this.paint = add(
      new T.MeshPhysicalMaterial({
        color: scheme.primary,
        metalness: 0.025,
        roughness: 0.4,
        clearcoat: 0.72,
        clearcoatRoughness: 0.18,
        ...bikeSurfaceMaps('paint'),
        normalScale: new T.Vector2(0.065, 0.065),
        name: 'Bike fairing paint (clear coat)',
      }),
    );
    this.secondary = add(
      new T.MeshPhysicalMaterial({
        color: scheme.secondary,
        metalness: 0.2,
        roughness: 0.36,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        ...bikeSurfaceMaps('paint'),
        normalScale: new T.Vector2(0.065, 0.065),
        name: 'Bike secondary paint',
      }),
    );
    this.accent = add(
      new T.MeshPhysicalMaterial({
        color: scheme.accent,
        metalness: 0.1,
        roughness: 0.38,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        ...bikeSurfaceMaps('paint'),
        normalScale: new T.Vector2(0.065, 0.065),
      }),
    );
    this.carbon = add(carbonMaterial('lacquered'));
    this.carbon.name = 'GP carbon: metre-scale filtered twill';
    this.aluminium = add(
      new T.MeshStandardMaterial({
        color: 0xb9bcc0,
        metalness: 0.92,
        roughness: 0.34,
        ...bikeSurfaceMaps('brushed'),
        normalScale: new T.Vector2(0.07, 0.07),
        name: 'Frame aluminium',
      }),
    );
    this.titanium = add(
      new T.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        metalness: 0.95,
        roughness: 0.3,
        name: 'Titanium exhaust (heat tint)',
      }),
    );
    this.rubber = add(
      new T.MeshStandardMaterial({
        color: 0x18191a,
        roughness: 0.89,
        ...bikeSurfaceMaps('rubber'),
        normalScale: new T.Vector2(0.16, 0.16),
        name: 'Slick tyre: fine grain',
      }),
    );
    this.tyreFinish = installGpTyreFinish(this.rubber);
    this.wheel = add(
      new T.MeshPhysicalMaterial({
        side: T.DoubleSide,
        color: 0x1d1e21,
        metalness: 0.6,
        roughness: 0.3,
        clearcoat: 0.6,
        clearcoatRoughness: 0.1,
        name: 'Forged wheel',
      }),
    );
    this.forkUpper = add(
      new T.MeshStandardMaterial({
        color: 0x8c6a2c,
        metalness: 0.85,
        roughness: 0.28,
        name: 'Fork outer tube (anodised)',
      }),
    );
    this.forkLower = add(
      new T.MeshStandardMaterial({
        color: 0x2d2b29,
        metalness: 0.9,
        roughness: 0.14,
        name: 'Fork stanchion (low-friction coating)',
      }),
    );
    this.disc = add(
      new T.MeshStandardMaterial({
        color: 0x2b2b2d,
        metalness: 0.15,
        roughness: 0.62,
        emissive: 0xff4a10,
        emissiveIntensity: 0,
        name: 'Carbon brake disc',
      }),
    );
    this.caliper = add(
      new T.MeshStandardMaterial({
        color: 0x9a9da3,
        metalness: 0.8,
        roughness: 0.3,
        name: 'Radial caliper',
      }),
    );
    this.dark = add(
      new T.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.4, roughness: 0.55 }),
    );
    this.steel = add(
      new T.MeshStandardMaterial({ color: 0x6d7076, metalness: 0.9, roughness: 0.4 }),
    );
    this.seat = add(
      new T.MeshStandardMaterial({
        color: 0x18191b,
        roughness: 0.92,
        ...bikeSurfaceMaps('seat'),
        normalScale: new T.Vector2(0.22, 0.22),
        name: 'Textured seat pad',
      }),
    );
    this.screen = add(
      new T.MeshPhysicalMaterial({
        color: 0xc9d4da,
        metalness: 0,
        roughness: 0.04,
        transmission: 0.92,
        thickness: 0.003,
        ior: 1.49,
        transparent: true,
        side: T.DoubleSide,
        name: 'Windscreen (transmissive polycarbonate)',
      }),
    );
    this.screenLight = add(
      new T.MeshPhysicalMaterial({
        color: 0x9fb2bc,
        metalness: 0.1,
        roughness: 0.06,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    );
    this.reservoir = add(
      new T.MeshStandardMaterial({
        color: 0xdbd7bb,
        roughness: 0.47,
        name: 'Brake reservoir nylon',
      }),
    );
    this.lamp = add(
      new T.MeshStandardMaterial({ color: 0x400606, emissive: 0xff1810, emissiveIntensity: 0.2 }),
    );
    this.band = add(new T.MeshStandardMaterial({ color: 0xf5c400, roughness: 0.6 }));
    this.plate = add(
      new T.MeshPhysicalMaterial({
        map: numberTexture((id % 98) + 2, scheme.primary, scheme.accent),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        roughness: 0.34,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
    );
    for (const material of [
      this.paint,
      this.secondary,
      this.accent,
      this.carbon,
      this.wheel,
      this.plate,
    ])
      tagWeatherSurface(material, 'paint');
    for (const material of [
      this.aluminium,
      this.steel,
      this.titanium,
      this.forkUpper,
      this.forkLower,
    ])
      tagWeatherSurface(material, 'metal', 0.75);
    tagWeatherSurface(this.rubber, 'rubber');
    tagWeatherSurface(this.seat, 'leather', 0.7);
    tagWeatherSurface(this.reservoir, 'paint', 0.7);
  }
  dispose() {
    for (const m of this.list) {
      for (const value of Object.values(m)) if (value instanceof T.Texture) value.dispose();
      m.dispose();
    }
  }
}
export function add(
  parent: T.Object3D,
  g: T.BufferGeometry,
  m: T.Material,
  x = 0,
  y = 0,
  z = 0,
  shadow = true,
) {
  bindGpBareMetal(g, m);
  const mesh = new T.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
/** Static compressions under the bike's own weight (m). */
export function staticSag(def: VehicleDefinition) {
  const b = def.bike!,
    m = def.spec.dryMass + b.fuel,
    L = def.spec.wheelbase;
  return {
    fork: (m * 9.81 * b.cgToRear) / L / b.forkRate,
    shock: (m * 9.81 * b.cgToFront) / L / b.shockRate,
  };
}
export class BikeModel {
  readonly root = new T.Group();
  readonly sprung = new T.Group();
  readonly rider: Rider;
  private readonly steerMount = new T.Group();
  private readonly steer = new T.Group();
  private readonly forkLower = new T.Group();
  private readonly frontSpin = new T.Group();
  private readonly rearWheel = new T.Group();
  private readonly rearSpin = new T.Group();
  private readonly swingarm = new T.Group();
  private readonly spring = new T.Group();
  private readonly pivot: T.Vector3;
  private armLength = 1;
  private readonly rearAxle: T.Vector3;
  private readonly sag: { fork: number; shock: number };
  private readonly gripLocal = [new T.Vector3(), new T.Vector3()];
  private readonly scratch = new T.Vector3();
  private readonly matrix = new T.Matrix4();
  private readonly rings: T.Mesh[] = [];
  private readonly gpChain?: GPChainDrive;
  private readonly cockpit?: BikeCockpit;
  private disposed = false;
  constructor(
    readonly definition: VehicleDefinition,
    readonly id: number,
    readonly detail: Detail,
    private readonly m: BikeMaterials,
    transmissive: boolean,
  ) {
    const b = definition.bike!,
      h = b.cgHeight,
      L = definition.spec.wheelbase,
      sides = detail === 'high' ? 40 : detail === 'mid' ? 20 : 10,
      // The body sheet (bike-sheet.ts): GP-R1 and SBK-1000 keep the original
      // design; the catalogue's other bikes vary fairing, aero, lamps, exhaust,
      // tail, bars, frame, wheels and shocks.
      look = bikeSheetFor(definition),
      wings = look.wings !== 'none',
      full = look.fairing === 'full',
      naked = look.fairing === 'naked',
      classic = look.fairing === 'classic',
      authored = definition.id === 'gpr1';
    calibrateGpMaterials(m, definition.id);
    const gpPrototype = authored || definition.id === 'gpr2';
    this.sag = staticSag(definition);
    this.root.name = `${definition.name} ${id + 1} (${detail})`;
    this.root.add(this.sprung);
    // ---- Wheels, tyres and brakes (front lives on the sliding fork lowers).
    const frontR = b.frontWheelRadius,
      rearR = b.rearWheelRadius,
      rim = 0.2159;
    const wheel = (
      spin: T.Group,
      radius: number,
      halfWidth: number,
      crown: number,
      front: boolean,
    ) => {
      const tyre = tyreGeometry(radius, halfWidth, crown, rim + 0.004, sides);
      add(spin, tyre, m.rubber);
      if (detail !== 'far') {
        // GP sidewall markings follow the actual tyre facets as thin paint.
        const ring = add(
          spin,
          gpPrototype
            ? gpTyreCompoundMarkings(tyre)
            : ringGeometry(rim + 0.05, rim + 0.042, halfWidth * 1.66 + 0.004, sides),
          m.band,
          0,
          0,
          0,
          false,
        );
        this.rings.push(ring);
        if (gpPrototype) {
          add(spin, gpForgedWheel(rim, halfWidth, detail), m.wheel);
        } else {
          // Catalogue bikes retain their original cast or laced wheel identity.
          add(
            spin,
            new T.CylinderGeometry(rim, rim, halfWidth * 1.5, sides, 1, true),
            look.wheels === 'spoked' ? m.steel : m.wheel,
          ).rotation.z = Math.PI / 2;
          if (look.wheels === 'spoked')
            for (let k = 0; k < (detail === 'high' ? 36 : 18); k++) {
              const count = detail === 'high' ? 36 : 18,
                a = (k / count) * Math.PI * 2,
                lean = k % 2 ? 0.08 : -0.08;
              const spoke = add(
                spin,
                new T.CylinderGeometry(0.0025, 0.0025, rim - 0.05, 4),
                m.steel,
              );
              spoke.position.set(
                lean * 0.3,
                Math.cos(a) * (rim / 2 + 0.02),
                Math.sin(a) * (rim / 2 + 0.02),
              );
              spoke.rotation.set(a, 0, lean);
            }
          else
            for (let k = 0; k < 5; k++) {
              const a = (k / 5) * Math.PI * 2;
              const spoke = add(
                spin,
                detail === 'high'
                  ? beam(
                      [
                        [0, 0.042, -0.005],
                        [0, 0.095, 0.01],
                        [0, 0.16, 0.02],
                        [0, rim - 0.002, 0.012],
                      ],
                      0.018,
                      0.025,
                      7,
                      2,
                    )
                  : new RoundedBoxGeometry(0.022, rim - 0.05, 0.029, 1, 0.005),
                m.wheel,
              );
              if (detail !== 'high')
                spoke.position.set(
                  0,
                  Math.cos(a) * (rim / 2 + 0.02),
                  Math.sin(a) * (rim / 2 + 0.02),
                );
              spoke.rotation.x = a;
            }
          add(spin, new T.CylinderGeometry(0.05, 0.05, halfWidth * 1.4, 16), m.wheel).rotation.z =
            Math.PI / 2;
        }
      } else
        add(spin, new T.CylinderGeometry(rim, rim, halfWidth * 1.4, 10), m.wheel).rotation.z =
          Math.PI / 2;
      if (front) {
        // Twin carbon discs on floating carriers (one steel disc on a
        // classic machine).
        for (const side of look.wheels === 'spoked' ? [1] : [1, -1]) {
          add(
            spin,
            detail === 'high' ? ventedRotor(sides) : ringGeometry(0.17, 0.115, 0.022, sides),
            m.disc,
            side * 0.066,
            0,
            0,
          );
          if (detail === 'high')
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * Math.PI * 2;
              add(
                spin,
                new T.CylinderGeometry(0.008, 0.008, 0.026, 8),
                m.steel,
                side * 0.066,
                Math.cos(a) * 0.113,
                Math.sin(a) * 0.113,
              ).rotation.z = Math.PI / 2;
            }
        }
      } else add(spin, ringGeometry(0.11, 0.07, 0.006, sides), m.steel, -0.085, 0, 0);
    };
    // ---- Steering: mount on the steering axis, local Y up the fork.
    const front = new T.Vector3(0, frontR - h, b.cgToFront);
    const up = new T.Vector3(0, Math.cos(RAKE), -Math.sin(RAKE)),
      forward = new T.Vector3(0, Math.sin(RAKE), Math.cos(RAKE));
    const clamp = front.clone().addScaledVector(up, FORK_LENGTH);
    const head = clamp.clone().addScaledVector(forward, -FORK_OFFSET);
    this.steerMount.position.copy(head);
    this.steerMount.rotation.x = -RAKE;
    this.sprung.add(this.steerMount);
    this.steerMount.add(this.steer);
    // Upper (outer) fork tubes and triple clamps.
    for (const side of [1, -1]) {
      add(
        this.steer,
        new T.CylinderGeometry(0.029, 0.029, 0.4, sides / 2),
        m.forkUpper,
        side * 0.105,
        -0.15,
        FORK_OFFSET,
      );
      if (detail !== 'far')
        add(
          this.steer,
          new T.CylinderGeometry(0.031, 0.031, 0.03, sides / 2),
          m.dark,
          side * 0.105,
          0.06,
          FORK_OFFSET,
        );
    }
    if (detail !== 'far' && full) {
      add(
        this.steer,
        tripleClampGeometry(0.024, detail === 'high' ? 9 : 5),
        m.aluminium,
        0,
        0.01,
      ).name = 'Relieved upper triple clamp';
      add(
        this.steer,
        tripleClampGeometry(0.028, detail === 'high' ? 7 : 4),
        m.dark,
        0,
        -0.14,
      ).name = 'Relieved lower triple clamp';
      if (detail === 'high') {
        // Nested anodised cap, hex adjuster and slotted screw, all attached to
        // the same steering group. Fork travel and the grip targets are intact.
        for (const side of [-1, 1]) {
          add(
            this.steer,
            new T.CylinderGeometry(0.027, 0.027, 0.006, 20),
            m.forkUpper,
            side * 0.105,
            0.035,
            FORK_OFFSET,
          );
          add(
            this.steer,
            new T.CylinderGeometry(0.0165, 0.0165, 0.007, 6),
            m.aluminium,
            side * 0.105,
            0.0415,
            FORK_OFFSET,
          );
          add(
            this.steer,
            new T.CylinderGeometry(0.0065, 0.0065, 0.004, 12),
            m.forkLower,
            side * 0.105,
            0.047,
            FORK_OFFSET,
          );
          add(
            this.steer,
            new T.BoxGeometry(0.009, 0.0008, 0.0013),
            m.aluminium,
            side * 0.105,
            0.0494,
            FORK_OFFSET,
          );
          add(
            this.steer,
            new T.CylinderGeometry(0.006, 0.006, 0.007, 6),
            m.steel,
            side * 0.137,
            0.013,
            -0.004,
          ).rotation.x = Math.PI / 2;
        }
        add(
          this.steer,
          new T.CylinderGeometry(0.0205, 0.0205, 0.008, 6),
          m.forkLower,
          0,
          0.028,
          -0.031,
        );
        add(this.steer, new T.CylinderGeometry(0.009, 0.009, 0.009, 16), m.steel, 0, 0.032, -0.031);
      }
    } else {
      add(
        this.steer,
        new T.BoxGeometry(0.27, 0.025, 0.07),
        m.aluminium,
        0,
        0.01,
        FORK_OFFSET * 0.5,
      );
      add(
        this.steer,
        new T.BoxGeometry(0.25, 0.03, 0.08),
        m.aluminium,
        0,
        -0.14,
        FORK_OFFSET * 0.5,
      );
    }
    // Clip-on bars, grips and levers; the grips are the rider's hand targets.
    // An upright roadster bar rises and reaches wider.
    const upright = look.bars === 'upright',
      barY = upright ? 0.1 : 0,
      barX = upright ? 0.07 : 0;
    if (upright)
      add(
        this.steer,
        new T.CylinderGeometry(0.012, 0.012, 0.74, 10),
        m.dark,
        0,
        0.04,
        -0.02,
      ).rotation.z = Math.PI / 2;
    for (const side of [1, -1]) {
      const bar = add(
        this.steer,
        new T.CylinderGeometry(0.011, 0.011, 0.24, 10),
        m.steel,
        side * 0.21,
        -0.04,
        0.0,
      );
      bar.rotation.z = Math.PI / 2 - side * 0.18;
      bar.rotation.y = side * 0.22;
      const grip = add(
        this.steer,
        new T.CylinderGeometry(0.017, 0.017, 0.12, 12),
        m.dark,
        side * (0.3 + barX),
        -0.06 + barY,
        -0.05,
      );
      grip.rotation.z = Math.PI / 2 - side * 0.18;
      grip.rotation.y = side * 0.22;
      this.gripLocal[side > 0 ? 0 : 1].set(side * (0.3 + barX), -0.06 + barY, -0.05);
      if (detail === 'high') {
        const lever = add(
          this.steer,
          new RoundedBoxGeometry(0.15, 0.008, 0.016, 2, 0.003),
          m.aluminium,
          side * 0.28,
          -0.04,
          0.05,
        );
        lever.rotation.y = side * 0.3;
        // Compact switch housing, lever pivot and bar end. REF_022/030 show
        // these mechanical layers even when the rider is fully tucked.
        add(
          this.steer,
          new RoundedBoxGeometry(0.033, 0.041, 0.041, 2, 0.008),
          m.dark,
          side * (0.227 + barX),
          -0.053 + barY,
          -0.041,
        );
        for (let button = 0; button < 3; button++)
          add(
            this.steer,
            new T.CylinderGeometry(0.0045, 0.0045, 0.003, 8),
            button === 0 ? m.accent : button === 1 ? m.secondary : m.aluminium,
            side * (0.227 + barX),
            -0.03 + barY,
            -0.052 + button * 0.011,
          );
        add(
          this.steer,
          new T.CylinderGeometry(0.019, 0.019, 0.009, 12),
          m.forkLower,
          side * (0.36 + barX),
          -0.071 + barY,
          -0.06,
        ).rotation.z = Math.PI / 2;
        add(
          this.steer,
          new T.CylinderGeometry(0.008, 0.008, 0.009, 10),
          m.forkLower,
          side * 0.211,
          -0.034,
          0.03,
        );
      }
    }
    // Lower legs slide on the stanchions with the recorded compression.
    this.steer.add(this.forkLower);
    for (const side of [1, -1]) {
      add(
        this.forkLower,
        new T.CylinderGeometry(0.0245, 0.0245, 0.36, sides / 2),
        m.forkLower,
        side * 0.105,
        0.2,
        FORK_OFFSET,
      );
      add(
        this.forkLower,
        new T.BoxGeometry(0.045, 0.11, 0.07),
        m.dark,
        side * 0.105,
        0.0,
        FORK_OFFSET,
      );
      if (detail !== 'far') {
        if (detail === 'high' && (authored || definition.id === 'gpr2')) {
          // The four-piston forged monobloc moves with the fork lower; the
          // carbon rotor remains free to spin inside its open jaw.
          const caliper = gpRadialBrakeCaliper(side as -1 | 1, m);
          caliper.position.set(side * 0.066, -0.02, FORK_OFFSET - 0.135);
          this.forkLower.add(caliper);
        } else {
          // Radial monobloc caliper straddling the disc behind the axle.
          const caliper = add(
            this.forkLower,
            detail === 'high'
              ? new RoundedBoxGeometry(0.04, 0.12, 0.055, 2, 0.01)
              : new T.BoxGeometry(0.04, 0.12, 0.055),
            m.caliper,
            side * 0.066,
            -0.02,
            FORK_OFFSET - 0.135,
          );
          caliper.rotation.x = 0.35;
          if (detail === 'high') {
            for (const y of [-0.049, 0.031])
              add(
                this.forkLower,
                new T.CylinderGeometry(0.008, 0.008, 0.004, 10),
                m.forkLower,
                side * 0.087,
                y,
                FORK_OFFSET - 0.134,
              ).rotation.z = Math.PI / 2;
            add(
              this.forkLower,
              tube(
                [
                  [side * 0.071, 0.035, FORK_OFFSET - 0.13],
                  [side * 0.125, 0.11, FORK_OFFSET - 0.11],
                  [side * 0.132, 0.23, FORK_OFFSET - 0.035],
                ],
                0.0026,
                12,
                5,
              ),
              m.dark,
            );
          }
        }
      }
    }
    add(
      this.forkLower,
      new T.CylinderGeometry(0.012, 0.012, 0.25, 8),
      m.steel,
      0,
      0,
      FORK_OFFSET,
    ).rotation.z = Math.PI / 2;
    // Front mudguard over the tyre.
    const guardMaterial = (wings ? m.carbon : classic ? m.steel : m.secondary).clone();
    guardMaterial.side = T.DoubleSide;
    m.list.push(guardMaterial);
    const guard = add(
      this.forkLower,
      gpPrototype && detail !== 'far'
        ? gpFrontFender(frontR, detail)
        : new T.CylinderGeometry(frontR + 0.03, frontR + 0.03, 0.13, sides, 1, true, 0.87, 1.75),
      guardMaterial,
      0,
      0,
      FORK_OFFSET,
    );
    // Undo the rake so the guard arcs over the top of the tyre.
    guard.rotation.set(RAKE, 0, gpPrototype && detail !== 'far' ? 0 : Math.PI / 2);
    if (gpPrototype && detail !== 'far') guard.name = 'Crowned carbon front fender';
    this.forkLower.add(this.frontSpin);
    this.frontSpin.position.set(0, 0, FORK_OFFSET);
    wheel(this.frontSpin, frontR, 0.06, b.crownRadius, true);
    // ---- Frame, engine, exhaust (sprung).
    const spar = (side: number): [number, number, number][] => [
      [side * 0.07, head.y - 0.02, head.z - 0.04],
      [side * 0.15, head.y - 0.09, head.z - 0.22],
      [side * 0.165, 0.08, 0.02],
      [side * 0.14, -0.06, -0.15],
      [side * 0.12, -0.13, -0.2],
    ];
    if (look.frame === 'spar')
      for (const side of [1, -1])
        add(this.sprung, beam(spar(side), 0.045, 0.1, detail === 'high' ? 24 : 10), m.aluminium);
    else
      // Steel trellis (triangulated thin tubes) or a tubular double cradle
      // that loops under the engine.
      for (const side of [1, -1]) {
        const s = spar(side);
        add(this.sprung, tube(s, look.frame === 'trellis' ? 0.014 : 0.018, 24, 6), m.caliper);
        if (look.frame === 'trellis') {
          const lower: [number, number, number][] = s.map(([x, y, z]) => [
            x * 0.95,
            y - 0.16,
            z + 0.02,
          ]);
          add(this.sprung, tube(lower, 0.012, 24, 6), m.caliper);
          for (let k = 0; k < s.length - 1; k++)
            add(this.sprung, tube([s[k], lower[k + 1]], 0.01, 2, 5), m.caliper);
        } else
          add(
            this.sprung,
            tube(
              [
                [side * 0.06, head.y - 0.08, head.z - 0.02],
                [side * 0.12, -0.15, 0.36],
                [side * 0.13, -0.4, 0.22],
                [side * 0.13, -0.42, -0.12],
                [side * 0.12, -0.13, -0.2],
              ],
              0.018,
              24,
              6,
            ),
            m.caliper,
          );
      }
    add(
      this.sprung,
      new T.CylinderGeometry(0.04, 0.04, 0.2, sides / 2),
      m.aluminium,
      0,
      head.y - 0.06,
      head.z - 0.02,
    ).rotation.x = -RAKE;
    // Engine (mostly behind the fairing): crankcase, V cylinder bank, clutch
    // cover and the radiator seen between the front wheel and the fairing.
    if (detail !== 'far') {
      add(this.sprung, new T.BoxGeometry(0.27, 0.22, 0.38), m.dark, 0, -0.27, 0.06);
      const bank = add(this.sprung, new T.BoxGeometry(0.25, 0.18, 0.15), m.steel, 0, -0.1, 0.22);
      bank.rotation.x = -0.6;
      add(
        this.sprung,
        new T.CylinderGeometry(0.09, 0.09, 0.03, sides),
        m.aluminium,
        -0.14,
        -0.26,
        0.02,
      ).rotation.z = Math.PI / 2;
      add(this.sprung, new T.BoxGeometry(0.36, 0.26, 0.04), m.dark, 0, -0.1, 0.37).rotation.x =
        -0.25;
    }
    // Exhaust: headers under the engine to a high titanium silencer.
    if (look.exhaust === 'expansion') {
      // Three two-stroke expansion chambers: two exit low on the right, one
      // on the left, each a swelling cone with a thin tail pipe.
      for (const [x, side] of [
        [0.07, 1],
        [0.0, 1],
        [-0.07, -1],
      ] as const) {
        const chamber = add(
          this.sprung,
          new T.CylinderGeometry(0.025, 0.06, 0.42, sides / 2),
          m.steel,
          x + side * 0.06,
          -0.36,
          0.0,
        );
        chamber.rotation.x = Math.PI / 2 + 0.1;
        const tail = add(
          this.sprung,
          new T.CylinderGeometry(0.018, 0.022, 0.38, 10),
          m.titanium,
          side * 0.15,
          -0.24,
          -0.42,
        );
        tail.rotation.x = Math.PI / 2 - 0.3;
      }
    } else {
      const pipe: [number, number, number][] = [
        [0.06, -0.14, 0.33],
        [0.08, -0.36, 0.27],
        [0.09, -0.43, 0.04],
        [-0.08, -0.42, -0.2],
        [-0.14, -0.3, -0.42],
        [-0.16, -0.14, -0.6],
      ];
      add(
        this.sprung,
        exhaustGeometry(pipe, 0.03, detail === 'high' ? 40 : 14, detail === 'far' ? 5 : 10),
        m.titanium,
      );
      if (gpPrototype && detail !== 'far' && look.exhaust === 'side-high') {
        const silencer = gpSilencer(detail, m);
        silencer.position.set(-0.165, -0.08, -0.74);
        silencer.rotation.x = Math.PI / 2 - 0.35;
        this.sprung.add(silencer);
      } else if (look.exhaust === 'side-high') {
        const can = add(
          this.sprung,
          new T.CylinderGeometry(0.05, 0.057, 0.3, sides / 2),
          m.titanium,
          -0.165,
          -0.08,
          -0.74,
        );
        can.rotation.x = Math.PI / 2 - 0.35;
        add(
          this.sprung,
          new T.CylinderGeometry(0.058, 0.058, 0.04, sides / 2),
          m.carbon,
          -0.165,
          -0.03,
          -0.88,
        ).rotation.x = Math.PI / 2 - 0.35;
      } else if (look.exhaust === 'stubby')
        // Short low can just behind the footpeg.
        add(
          this.sprung,
          new T.CylinderGeometry(0.065, 0.07, 0.24, sides / 2),
          m.titanium,
          -0.17,
          -0.2,
          -0.48,
        ).rotation.x = Math.PI / 2 - 0.2;
      else
        // Under-belly silencer box, exits ahead of the rear tyre.
        add(this.sprung, new T.BoxGeometry(0.2, 0.1, 0.3), m.titanium, 0, -0.42, -0.08);
    }
    // ---- Bodywork, all lofted along +Z from measured side and plan profiles
    // (CG frame: ground at y = -cgHeight, front axle near z = +0.70).
    const section = (
      z: number,
      y: number,
      w: number,
      top: number,
      bottom: number,
      topWidth = 1,
    ): Section => ({ z, y, w, top, bottom, topWidth });
    // Upper fairing: a wedge nose over the front wheel, clear of fork travel,
    // whose cheeks drop behind the wheel to meet the lower fairing.
    if (full && !authored) this.sprung.add(gpUpperCowl(m, detail));
    // Lower fairing and belly pan: behind the wheel, its rear edge rising
    // toward the footpegs; the frame beams stay exposed above it.
    if (full && !authored)
      add(
        this.sprung,
        superLoft(
          [
            section(-0.24, -0.37, 0.12, 0.06, 0.08),
            section(-0.08, -0.23, 0.17, 0.18, 0.22),
            section(0.1, -0.18, 0.21, 0.24, 0.28),
            section(0.26, -0.15, 0.235, 0.24, 0.29),
            section(0.36, -0.13, 0.24, 0.2, 0.24),
            section(0.395, -0.12, 0.235, 0.16, 0.2),
          ],
          sides,
          3.2,
        ),
        m.secondary,
      );
    // Accent stripe along the lower fairing.
    if (full && !authored && detail !== 'far')
      add(
        this.sprung,
        superLoft(
          [
            section(-0.02, -0.12, 0.185, 0.02, 0.02),
            section(0.2, -0.06, 0.232, 0.02, 0.02),
            section(0.36, -0.02, 0.24, 0.02, 0.02),
          ],
          sides,
          3.2,
        ),
        m.accent,
      );
    // Number plates on the nose and the flanks.
    if (full && !authored && detail !== 'far') {
      const plate = add(
        this.sprung,
        new T.CircleGeometry(0.062, 24),
        m.plate,
        0,
        0.226,
        0.865,
        false,
      );
      plate.rotation.x = -1.05;
      for (const side of [1, -1]) {
        const flank = add(
          this.sprung,
          new T.CircleGeometry(0.075, 24),
          m.plate,
          side * 0.242,
          -0.08,
          0.2,
          false,
        );
        flank.rotation.y = side * (Math.PI / 2 - 0.08);
      }
      // Ram-air intake at the nose tip.
      if (!authored)
        add(this.sprung, new T.CircleGeometry(0.03, 16), m.dark, 0, 0.15, 0.957, false);
    }
    // Classic round-nosed fairing: one bulbous shell over the forks with a
    // round number plate; no belly pan, so the engine and chambers show.
    if (classic) {
      add(
        this.sprung,
        superLoft(
          [
            section(0.3, 0.0, 0.2, 0.24, 0.2),
            section(0.45, 0.08, 0.25, 0.22, 0.2),
            section(0.6, 0.13, 0.25, 0.18, 0.16),
            section(0.75, 0.15, 0.2, 0.13, 0.12),
            section(0.86, 0.14, 0.12, 0.08, 0.08),
            section(0.9, 0.13, 0.04, 0.03, 0.03),
          ],
          sides,
          2.2,
        ),
        m.paint,
      );
      if (detail !== 'far') {
        const plate = add(
          this.sprung,
          new T.CircleGeometry(0.09, 24),
          m.plate,
          0,
          0.17,
          0.85,
          false,
        );
        plate.rotation.x = -0.75;
      }
    }
    // Naked roadster: radiator and engine on show, a round lamp on the fork
    // and a small flyscreen.
    if (naked && detail !== 'far')
      add(this.sprung, new T.BoxGeometry(0.34, 0.26, 0.05), m.dark, 0, -0.06, 0.36).rotation.x =
        -0.2;
    if (look.headlamp === 'round') {
      add(
        this.steer,
        new T.CylinderGeometry(0.085, 0.09, 0.12, sides / 2),
        m.dark,
        0,
        -0.22,
        FORK_OFFSET + 0.12,
      ).rotation.x = Math.PI / 2;
      add(
        this.steer,
        new T.CircleGeometry(0.075, sides),
        m.screenLight,
        0,
        -0.22,
        FORK_OFFSET + 0.181,
        false,
      );
    } else if (look.headlamp === 'twin-slit' && detail !== 'far')
      for (const side of [1, -1]) {
        const lamp = add(
          this.sprung,
          new T.BoxGeometry(0.07, 0.02, 0.04),
          m.screenLight,
          side * 0.08,
          0.13,
          0.88,
          false,
        );
        lamp.rotation.set(-0.9, side * 0.3, 0);
      }
    // Box wing (biplane with joined end plates) low on the fairing flanks.
    if (look.wings === 'box' && detail !== 'far')
      for (const side of [1, -1]) {
        for (const y of [0.02, -0.08]) {
          const foil = add(
            this.sprung,
            new RoundedBoxGeometry(0.1, 0.012, 0.16, 2, 0.004),
            m.carbon,
            side * 0.27,
            y,
            0.6,
          );
          foil.rotation.z = side * -0.12;
        }
        add(
          this.sprung,
          new RoundedBoxGeometry(0.006, 0.13, 0.17, 2, 0.002),
          m.carbon,
          side * 0.32,
          -0.03,
          0.6,
        );
      }
    // Wings: stacked carbon aerofoils with end plates on the prototype class.
    if (look.wings === 'stacked' && !authored && detail !== 'far')
      for (const side of [1, -1]) {
        const foil = new T.Shape();
        foil.moveTo(0, 0);
        foil.bezierCurveTo(0.03, 0.02, 0.09, 0.018, 0.14, 0.003);
        foil.bezierCurveTo(0.09, -0.004, 0.03, -0.007, 0, 0);
        for (const [y, z] of [
          [0.2, 0.72],
          [0.14, 0.69],
        ]) {
          const g = new T.ExtrudeGeometry(foil, {
            depth: 0.09,
            bevelEnabled: false,
            curveSegments: 8,
          });
          g.rotateY(Math.PI / 2);
          const w = add(this.sprung, g, m.carbon, side > 0 ? 0.2 : -0.29, y, z);
          w.rotation.z = side * -0.1;
          w.rotation.x = 0.1;
        }
        const end = add(
          this.sprung,
          new T.BoxGeometry(0.005, 0.1, 0.15),
          m.carbon,
          side * 0.29,
          0.17,
          0.645,
        );
        end.rotation.y = side * 0.08;
      }
    // Windscreen bubble: transmissive near, cheap tinted beyond; its height
    // follows the sheet (a classic screen is low, a naked bike has none).
    const sh = look.screen;
    if (sh > 0)
      add(
        this.sprung,
        arcSheet(
          [
            section(0.4, 0.3 * (classic ? 0.75 : 1), 0.17, 0.11 * sh, 0),
            section(0.52, 0.28 * (classic ? 0.75 : 1), 0.2, 0.1 * sh, 0),
            section(0.64, 0.25 * (classic ? 0.75 : 1), 0.19, 0.075 * sh, 0),
            section(0.73, 0.22 * (classic ? 0.75 : 1), 0.15, 0.04 * sh, 0),
          ],
          0.2,
          Math.PI - 0.2,
          sides / 2,
        ),
        transmissive ? m.screen : m.screenLight,
        0,
        0,
        0,
        false,
      );
    // Instrument display behind the screen.
    if (detail === 'high' && full) {
      this.cockpit = new BikeCockpit(definition.spec.limiterRPM);
      this.sprung.add(this.cockpit.root);
      // Wiring and reservoir give onboard views mechanical depth without
      // changing the grip/steering anchors or obscuring the rider's sightline.
      for (const side of [-1, 1]) {
        add(
          this.steer,
          tube(
            [
              [side * 0.24, -0.04, 0.03],
              [side * 0.16, -0.12, 0.09],
              [side * 0.07, -0.22, 0.02],
            ],
            0.0035,
            12,
            5,
          ),
          m.dark,
        );
      }
      // Brake fluid pot, lid and moulded volume window. The assembly stays
      // beside the bar, below the established display-to-lens ray bundle.
      add(
        this.steer,
        new T.CylinderGeometry(0.022, 0.019, 0.035, 16),
        m.reservoir,
        -0.207,
        0.003,
        0.065,
      );
      add(
        this.steer,
        new T.CylinderGeometry(0.024, 0.024, 0.009, 16),
        m.dark,
        -0.207,
        0.025,
        0.065,
      );
      add(
        this.steer,
        new RoundedBoxGeometry(0.009, 0.019, 0.003, 1, 0.002),
        m.forkUpper,
        -0.207,
        0.002,
        0.044,
      );
      add(
        this.steer,
        tube(
          [
            [-0.204, -0.014, 0.063],
            [-0.19, -0.032, 0.064],
            [-0.21, -0.041, 0.029],
          ],
          0.003,
          9,
          5,
        ),
        m.dark,
      );
    }
    // Tank cover (carbon on the prototype) between the exposed spars; a
    // classic machine has a big rounded steel tank, a naked bike a sculpted
    // tank with knee scallops that reaches further forward.
    const tankScale = classic ? 1.18 : naked ? 1.08 : 1;
    if (!authored)
      add(
        this.sprung,
        superLoft(
          [
            section(-0.14, 0.22, 0.12 * tankScale, 0.07 * tankScale, 0.06),
            section(0.0, 0.26, 0.165 * tankScale, 0.09 * tankScale, 0.08),
            section(0.16, 0.26, 0.17 * tankScale, 0.08 * tankScale, 0.08),
            section(0.3, 0.24, 0.15 * tankScale, 0.07 * tankScale, 0.07),
            section(naked ? 0.46 : 0.41, naked ? 0.25 : 0.22, 0.11, 0.06, 0.06),
          ],
          sides,
          classic ? 2.1 : 2.6,
        ),
        wings ? m.carbon : m.paint,
      );
    // Seat unit and tail hump with the rain/brake light: the race tail, a
    // short roadster tail with a pillion pad, or a classic flat seat ending in
    // a rounded hump.
    if (authored) {
      const shell = gpBodywork(m, detail);
      if (detail !== 'far') addGPIdentity(shell, m, id);
      this.sprung.add(shell);
      if (detail !== 'far') this.sprung.add(gpCoolingLouvers(detail, m.carbon, m.steel));
      add(this.sprung, new T.BoxGeometry(0.05, 0.025, 0.012), m.lamp, 0, 0.302, -0.83, false);
    } else if (look.tail === 'race') {
      add(
        this.sprung,
        superLoft(
          [
            section(-0.84, 0.33, 0.035, 0.03, 0.03, 0.7),
            section(-0.76, 0.32, 0.075, 0.07, 0.08, 0.7),
            section(-0.6, 0.28, 0.11, 0.1, 0.12, 0.75),
            section(-0.44, 0.2, 0.13, 0.07, 0.1, 0.85),
            section(-0.22, 0.17, 0.14, 0.05, 0.08),
            section(-0.1, 0.17, 0.13, 0.04, 0.06),
          ],
          sides,
        ),
        m.paint,
      );
      add(this.sprung, new T.BoxGeometry(0.2, 0.025, 0.26), m.seat, 0, 0.232, -0.3);
      add(this.sprung, new T.BoxGeometry(0.05, 0.025, 0.012), m.lamp, 0, 0.302, -0.83, false);
    } else if (look.tail === 'stubby') {
      add(
        this.sprung,
        superLoft(
          [
            section(-0.66, 0.3, 0.04, 0.03, 0.04, 0.7),
            section(-0.56, 0.28, 0.1, 0.06, 0.08, 0.75),
            section(-0.36, 0.22, 0.14, 0.05, 0.1),
            section(-0.12, 0.18, 0.14, 0.04, 0.07),
          ],
          sides,
        ),
        m.paint,
      );
      add(this.sprung, new T.BoxGeometry(0.24, 0.04, 0.42), m.seat, 0, 0.245, -0.36);
      add(this.sprung, new T.BoxGeometry(0.1, 0.035, 0.014), m.lamp, 0, 0.3, -0.67, false);
    } else {
      add(
        this.sprung,
        superLoft(
          [
            section(-0.72, 0.36, 0.05, 0.05, 0.05),
            section(-0.62, 0.36, 0.12, 0.09, 0.08),
            section(-0.5, 0.3, 0.14, 0.06, 0.1),
            section(-0.3, 0.2, 0.14, 0.04, 0.08),
            section(-0.1, 0.18, 0.12, 0.03, 0.06),
          ],
          sides,
          2.2,
        ),
        m.paint,
      );
      add(this.sprung, new T.BoxGeometry(0.22, 0.03, 0.38), m.seat, 0, 0.235, -0.28);
      add(this.sprung, new T.BoxGeometry(0.08, 0.04, 0.012), m.lamp, 0, 0.3, -0.73, false);
    }
    // Footpegs (rearsets).
    for (const side of [1, -1]) {
      add(
        this.sprung,
        new T.CylinderGeometry(0.012, 0.012, 0.08, 8),
        m.aluminium,
        side * 0.17,
        -0.2,
        -0.3,
      ).rotation.z = Math.PI / 2;
      if (detail === 'high')
        add(
          this.sprung,
          new T.BoxGeometry(0.03, 0.09, 0.07),
          m.aluminium,
          side * 0.13,
          -0.17,
          -0.28,
        );
    }
    // Rear shock spring (visible behind the engine, compresses with the shock).
    if (detail !== 'far') {
      const coil: [number, number, number][] = [];
      for (let k = 0; k <= 64; k++) {
        const t = k / 64;
        coil.push([
          Math.cos(t * Math.PI * 14) * 0.032,
          -0.09 + t * 0.18,
          Math.sin(t * Math.PI * 14) * 0.032,
        ]);
      }
      add(this.spring, tube(coil, 0.006, 128, 6), m.band);
      add(this.spring, new T.CylinderGeometry(0.012, 0.012, 0.2, 8), m.steel);
      this.spring.position.set(0, -0.06, -0.24);
      this.spring.rotation.x = 0.35;
      this.sprung.add(this.spring);
    }
    // ---- Swingarm (root frame: it pivots to keep the rear tyre on the road).
    this.pivot = new T.Vector3(0, -0.13, -0.2);
    this.rearAxle = new T.Vector3(0, rearR - h, -b.cgToRear);
    const arm = (this.armLength = this.rearAxle.clone().sub(this.pivot).length());
    for (const side of [1, -1]) {
      add(
        this.swingarm,
        beam(
          [
            [side * 0.1, 0, 0],
            [side * 0.13, 0.015, -arm * 0.45],
            [side * 0.12, 0, -arm],
          ],
          0.035,
          0.085,
          detail === 'high' ? 16 : 6,
        ),
        m.aluminium,
      );
    }
    add(this.swingarm, new T.CylinderGeometry(0.02, 0.02, 0.3, 10), m.steel).rotation.z =
      Math.PI / 2;
    if (detail !== 'far') {
      if ((authored || definition.id === 'gpr2') && detail === 'high') {
        // Both GP prototypes' close-ups: articulated chain and a toothed,
        // wheel-driven sprocket, not stationary boxes and a plain annulus.
        this.gpChain = new GPChainDrive(arm, m.steel, m.dark, m.aluminium);
        this.swingarm.add(this.gpChain.root);
        this.rearSpin.add(this.gpChain.sprocket);
      } else {
        // Mid-distance and non-GP machines retain the inexpensive original.
        for (const y of [0.045, -0.045]) {
          const run = add(
            this.swingarm,
            new T.BoxGeometry(0.012, 0.012, arm),
            m.steel,
            0.115,
            y + (y > 0 ? 0.04 : -0.04) * 0.5,
            -arm / 2,
          );
          run.rotation.x = y > 0 ? 0.035 : -0.035;
        }
        add(this.swingarm, ringGeometry(0.105, 0.05, 0.008, sides), m.aluminium, 0.115, 0, -arm);
      }
      // Chain guard (carbon) and rear caliper hanger on the right.
      add(this.swingarm, new T.BoxGeometry(0.004, 0.05, 0.22), m.carbon, 0.13, 0.07, -arm * 0.75);
      add(this.swingarm, new T.BoxGeometry(0.03, 0.06, 0.05), m.caliper, -0.09, 0.06, -arm + 0.07);
    }
    if (look.shocks === 'twin' && detail !== 'far')
      // Twin shocks from the swingarm ends up to the subframe.
      for (const side of [1, -1]) {
        const shock = add(
          this.swingarm,
          new T.CylinderGeometry(0.022, 0.022, 0.32, 10),
          m.band,
          side * 0.13,
          0.15,
          -arm * 0.9,
        );
        shock.rotation.x = -0.35;
      }
    if (full && detail !== 'far') {
      const pos: number[] = [],
        uv: number[] = [],
        ix: number[] = [];
      const segments = detail === 'high' ? 32 : 16;
      for (let i = 0; i <= segments; i++) {
        const a = T.MathUtils.lerp(0.65, 2.6, i / segments),
          r = rearR + 0.018;
        for (const side of [-1, 1]) {
          pos.push(
            side * (0.11 - (0.015 * i) / segments),
            r * Math.sin(a),
            -this.armLength + r * Math.cos(a),
          );
          uv.push(side > 0 ? 1 : 0, i / segments);
        }
        if (i < segments) {
          const k = i * 2;
          ix.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      const hugger = new T.BufferGeometry();
      hugger.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      hugger.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      hugger.setIndex(ix);
      hugger.computeVertexNormals();
      add(this.swingarm, hugger, m.carbon).name = 'Swingarm-mounted carbon tyre hugger';
    }
    this.root.add(this.swingarm);
    this.rearWheel.position.copy(this.rearAxle);
    this.rearWheel.add(this.rearSpin);
    this.root.add(this.rearWheel);
    wheel(this.rearSpin, rearR, 0.1, Math.max(b.crownRadius, 0.11), false);
    // ---- Rider.
    const scheme = liveryScheme(id);
    this.rider = new Rider(
      {
        primary: new T.Color(scheme.primary).getHex(),
        secondary: new T.Color(scheme.secondary).getHex(),
        accent: new T.Color(scheme.accent).getHex(),
      },
      detail,
    );
    this.rider.seat.set(0, 0.3, -0.32);
    this.rider.pegs[0].set(0.17, -0.2, -0.3);
    this.rider.pegs[1].set(-0.17, -0.2, -0.3);
    this.sprung.add(this.rider.root);
    for (const group of [
      this.sprung,
      this.steer,
      this.forkLower,
      this.frontSpin,
      this.rearSpin,
      this.swingarm,
      this.spring,
    ])
      batchBikeRigidMeshes(group);
    void L;
  }
  /** Pose from interpolated snapshot values (bike frame = chassis pose). */
  pose(v: BikePoseValues) {
    const b = this.definition.bike!,
      L = this.definition.spec.wheelbase;
    this.cockpit?.update(v);
    this.m.tyreFinish.update(v, this.definition.id === 'gpr1' || this.definition.id === 'gpr2');
    // Sprung mass dips and pitches on the springs; the tyres stay on the road.
    const df = (v.fork - this.sag.fork) * Math.cos(RAKE),
      dr = v.shock - this.sag.shock;
    this.sprung.rotation.x = Math.atan2(df - dr, L);
    this.sprung.position.y = -(dr + ((df - dr) * b.cgToRear) / L);
    this.steer.rotation.y = v.steer;
    this.forkLower.position.y = -(FORK_LENGTH + this.sag.fork - v.fork);
    this.frontSpin.rotation.x = v.frontRotation;
    this.rearSpin.rotation.x = v.rearRotation;
    this.gpChain?.update(v.rearRotation);
    // Pit service: the rear wheel rolls back out of the swingarm and the
    // front drops out of the fork while the axles are drawn (bike-pit-service).
    this.rearWheel.position.copy(this.rearAxle);
    this.rearWheel.position.z -= v.rearWheelOut ?? 0;
    forkLocalOffset(
      this.scratch.set(0, -(v.frontWheelDrop ?? 0), 0),
      RAKE,
      v.steer,
      this.frontSpin.position,
    ).z += FORK_OFFSET;
    this.spring.scale.y = T.MathUtils.clamp(1 - (v.shock - this.sag.shock) * 3, 0.6, 1.2);
    // Swingarm from the (moving) pivot to the rear axle on the road.
    this.sprung.updateMatrix();
    const p = this.scratch.copy(this.pivot).applyMatrix4(this.sprung.matrix);
    this.swingarm.position.copy(p);
    const dy = this.rearAxle.y - p.y,
      dz = this.rearAxle.z - p.z;
    this.swingarm.rotation.x = Math.atan2(dy, -dz);
    this.swingarm.scale.z = Math.hypot(dy, dz) / this.armLength;
    if (this.definition.id === 'gpr1' || this.definition.id === 'gpr2') {
      // Carbon-carbon rotors dark at moderate temperatures; only extreme heat
      // emits a restrained red glow instead of a neon-orange disc.
      this.m.disc.emissive.setHex(0xb9210a);
      this.m.disc.emissiveIntensity = gpDiscGlow(v.discTemp);
    } else {
      this.m.disc.emissive.setHex(0xff4a10);
      this.m.disc.emissiveIntensity = T.MathUtils.clamp((v.discTemp - 450) / 350, 0, 1) * 1.6;
    }
    this.m.lamp.emissiveIntensity = v.brake > 0.05 || v.rearBrake > 0.05 ? 3 : 0.2;
    for (const ring of this.rings)
      (ring.material as T.MeshStandardMaterial).color.setHex(v.compoundColour);
    if (v.riding) {
      // Grips in the sprung frame after steering.
      this.steerMount.updateMatrix();
      this.steer.updateMatrix();
      this.matrix.multiplyMatrices(this.steerMount.matrix, this.steer.matrix);
      for (let i = 0; i < 2; i++)
        this.rider.grips[i].copy(this.gripLocal[i]).applyMatrix4(this.matrix);
      this.rider.ride({
        lean: v.chassisLean,
        offset: v.riderOffset,
        tuck: v.tuck,
        braking: v.brake,
        steer: v.steer,
      });
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cockpit?.dispose();
    this.rider.root.removeFromParent();
    this.rider.dispose();
    this.root.traverse((o) => {
      // Instance matrices are owned by the mesh, separately from its geometry.
      if (o instanceof T.InstancedMesh) o.dispose();
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
  }
}
export interface BikePoseValues extends GpTyreAppearance {
  /** Snapshot values for the near cockpit; metres/second and protocol gear index. */
  speed?: number;
  rpm?: number;
  gear?: number;
  fork: number;
  shock: number;
  steer: number;
  frontRotation: number;
  rearRotation: number;
  chassisLean: number;
  riderOffset: number;
  tuck: number;
  brake: number;
  rearBrake: number;
  discTemp: number;
  compoundColour: number;
  riding: boolean;
  /** Off-road (WP41, snapshot O block): standing 0..1, foot dab -1..1, body
   * fore/aft, mud coat 0..1 and the soil wetness it came from. */
  standing?: number;
  dab?: number;
  body?: number;
  mud?: number;
  mudWet?: number;
  /** Pit service (bike frame, m): rear wheel out of the swingarm (backwards)
   * and front wheel out of the fork (down), from the shared service pose. */
  rearWheelOut?: number;
  frontWheelDrop?: number;
}
interface Entry {
  definition: VehicleDefinition;
  materials: BikeMaterials;
  levels: (BikeModel | DirtBikeModel)[];
  level: number;
  /** Paddock stands and carried wheels, shown only during a pit service. */
  rig: BikeServiceRig;
}
const COMPOUND_COLOURS = Object.values(COMPOUNDS).map((c) => c.color);
/** Chase-camera roll as a fraction of the followed bike's lean. */
export const BIKE_CHASE_ROLL = 0.35;
/** First-person lens inside the screen bubble, behind the instrument well. */
export const BIKE_ONBOARD = Object.freeze({
  eye: [0, 0.435, 0.34] as const,
  pitch: -0.14,
  tail: [0, 0.78, -0.95] as const,
  tailPitch: -0.12,
});
/** Helmet-height motocross eye above the raised bars and number board. The
 * GP windscreen socket sits directly behind the MX plate, obscuring the road. */
export const MOTOCROSS_ONBOARD = Object.freeze({
  eye: [0, 1.05, -0.4] as const,
  pitch: -0.4,
  fovExtra: 10,
});
/** Dirt and supermoto bars need their own lens; road and tail views are unchanged. */
export function bikeOnboardFov(speed: number, definition?: VehicleDefinition, tail = false) {
  return tcamFov(speed) + (!tail && definition?.bike?.offroad ? MOTOCROSS_ONBOARD.fovExtra : 0);
}
/** Per-entrant bike presentation over the snapshot pose (WP34). Formula and
 * touring representations are hidden for bike entrants; LODs follow lens-
 * corrected distance like the cars. */
export class BikeShells {
  readonly root = new T.Group();
  /** Renderer hook: install weather/atmosphere/IBL on newly built bikes. */
  install: (root: T.Object3D) => void = () => undefined;
  private readonly entries = new Map<number, Entry>();
  private readonly values: BikePoseValues = {
    fork: 0,
    shock: 0,
    steer: 0,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: 0,
    riderOffset: 0,
    tuck: 0,
    brake: 0,
    rearBrake: 0,
    discTemp: 0,
    compoundColour: 0xffffff,
    riding: true,
  };
  private readonly position = new T.Vector3();
  private readonly service = new BikeServicePose();
  private readonly serviceTask = new BikeWheelTask();
  private readonly lift = new T.Vector3();
  constructor() {
    this.root.name = 'Motorcycles (procedural)';
  }
  /** Is entrant `id` a motorcycle in this snapshot? */
  static isBike(frame: Float32Array, id: number) {
    return (
      vehicleAt(Math.round(frame[carBase(id) + RACE_BASE + R.VEHICLE])).dynamicsKind === 'bike'
    );
  }
  /** Chassis lean (rad, + left) of entrant `id`, interpolated. */
  static lean(a: Float32Array, b: Float32Array, alpha: number, id: number) {
    const o = carBase(id) + BIKE_BASE,
      def = vehicleAt(Math.round(b[carBase(id) + RACE_BASE + R.VEHICLE]));
    if (!def.bike) return 0;
    return chassisLean(T.MathUtils.lerp(a[o + B.LEAN], b[o + B.LEAN], alpha), def.bike);
  }
  private build(id: number, definition: VehicleDefinition): Entry {
    const materials = new BikeMaterials(id);
    // Off-road machines (WP41) have their own model; one mud coat per entrant.
    const mud = mudUniforms();
    const levels = (['high', 'mid', 'far'] as const).map((detail) =>
      isDirtBike(definition)
        ? new DirtBikeModel(definition, id, detail, materials, mud)
        : new BikeModel(definition, id, detail, materials, detail === 'high'),
    );
    for (const level of levels) {
      this.root.add(level.root);
      level.root.visible = false;
    }
    for (const level of levels) this.install(level.root);
    const rig = new BikeServiceRig(bikeServiceGeometry(definition));
    this.root.add(rig.root);
    this.install(rig.root);
    return { definition, materials, levels, level: -1, rig };
  }
  private dispose(entry: Entry) {
    for (const level of entry.levels) {
      this.root.remove(level.root);
      if (level.rider.root.parent) level.rider.root.parent.remove(level.rider.root);
      level.dispose();
    }
    this.root.remove(entry.rig.root);
    entry.rig.dispose();
    entry.materials.dispose();
  }
  /** Exclude the followed rider's first-person self geometry. Restore every
   * rider for tail, chase, replay and photo views. */
  setFirstPerson(follow: number) {
    for (const [id, entry] of this.entries)
      for (const model of entry.levels)
        model.rider.setFirstPerson(id === follow, !!entry.definition.bike?.offroad);
  }
  /** The service rig of entrant `id` (diagnostics and tests), if it is a bike. */
  serviceRig(id: number) {
    return this.entries.get(id)?.rig ?? null;
  }
  /** Shared service pose of a stopped bike from the discrete snapshot fields
   * the crew presentation reads (phase, service clock, stand lift); null when
   * the entrant is not in an active service. */
  private servicePose(frame: Float32Array, id: number, definition: VehicleDefinition) {
    const o = carBase(id),
      phase = frame[o + F.PIT_PHASE],
      clock = frame[o + F.PIT_CLOCK];
    if (!frame[o + F.IN_PIT] || !pitServiceActive(phase, clock, frame[o + F.SPEED])) return null;
    return this.service.set(
      bikeServiceGeometry(definition),
      phase,
      clock,
      frame[o + F.JACK_HEIGHT],
    );
  }
  /** Dispose every bike built so far (an owner that outlives its renderer's
   * use of them, such as a festival session). */
  disposeAll() {
    for (const entry of this.entries.values()) this.dispose(entry);
    this.entries.clear();
  }
  update(
    a: Float32Array,
    b: Float32Array,
    alpha: number,
    cars: readonly { root: T.Object3D }[],
    camera: T.PerspectiveCamera,
    quality: 'low' | 'medium' | 'high',
    follow: number,
  ) {
    for (let id = 0; id < cars.length; id++) {
      const o = carBase(id),
        definition = vehicleAt(Math.round(b[o + RACE_BASE + R.VEHICLE]));
      let entry = this.entries.get(id);
      if (definition.dynamicsKind !== 'bike' || !definition.bike) {
        if (entry) {
          this.dispose(entry);
          this.entries.delete(id);
        }
        continue;
      }
      if (!entry || entry.definition !== definition) {
        if (entry) this.dispose(entry);
        entry = this.build(id, definition);
        this.entries.set(id, entry);
      }
      const car = cars[id].root;
      car.visible = false;
      if (id >= b[H.CARS]) {
        for (const level of entry.levels) level.root.visible = false;
        entry.rig.update(null, this.serviceTask, car.position, car.quaternion);
        continue;
      }
      // Discrete service fields as the presented frame carries them.
      const service = this.servicePose(alpha < 1 ? a : b, id, definition);
      entry.rig.update(service, this.serviceTask, car.position, car.quaternion);
      this.values.rearWheelOut = service ? service.hubs[1].z - service.mounted[1].z : 0;
      this.values.frontWheelDrop = service ? service.hubs[0].y - service.mounted[0].y : 0;
      // LOD by lens-corrected distance; the followed bike is always near.
      const scale = quality === 'high' ? 1.25 : quality === 'low' ? 0.7 : 1;
      const distance =
        id === follow
          ? 0
          : detailDistance(car.position.distanceTo(camera.position), camera.fov, camera.aspect) /
            scale;
      const previous = entry.level;
      let level = distance < 30 ? 0 : distance < 100 ? 1 : 2;
      // Hysteresis band of 6 m.
      if (previous === 0 && level === 1 && distance < 36) level = 0;
      if (previous === 1 && level === 2 && distance < 106) level = 1;
      if (previous === 2 && level === 1 && distance > 94) level = 2;
      entry.level = level;
      entry.levels.forEach((model, i) => (model.root.visible = i === level));
      const model = entry.levels[level];
      model.root.position.copy(car.position);
      model.root.quaternion.copy(car.quaternion);
      // On the stands the whole machine (and its seated rider) rises by the
      // recorded lift along its own up axis; the stands stay on the floor.
      if (service)
        model.root.position.add(this.lift.set(0, service.lift, 0).applyQuaternion(car.quaternion));
      this.pose(model, a, b, alpha, id);
    }
  }
  private pose(
    model: BikeModel | DirtBikeModel,
    a: Float32Array,
    b: Float32Array,
    t: number,
    id: number,
  ) {
    const o = carBase(id),
      k = o + BIKE_BASE,
      bike = model.definition.bike!,
      v = this.values,
      lerp = (index: number) => T.MathUtils.lerp(a[index], b[index], t);
    const wheel = (i: number) => o + WHEEL_BASE + i * WHEEL_STRIDE;
    v.speed = lerp(o + F.SPEED);
    v.rpm = lerp(o + F.RPM);
    v.gear = b[o + F.GEAR];
    v.fork = lerp(k + B.FORK);
    v.shock = lerp(k + B.SHOCK);
    v.steer = lerp(k + B.STEER);
    v.frontRotation = b[wheel(0) + W.ROTATION];
    v.rearRotation = b[wheel(2) + W.ROTATION];
    v.chassisLean = chassisLean(lerp(k + B.LEAN), bike);
    v.riderOffset = lerp(k + B.RIDER_OFFSET);
    v.tuck = lerp(k + B.TUCK);
    v.brake = lerp(o + F.BRAKE);
    v.rearBrake = lerp(k + B.REAR_BRAKE);
    v.discTemp = b[wheel(0) + W.DISC_TEMP];
    v.compound = Math.round(b[o + F.COMPOUND]);
    v.frontWear = lerp(wheel(0) + W.WEAR);
    v.rearWear = lerp(wheel(2) + W.WEAR);
    v.frontSurfaceTemp = lerp(wheel(0) + W.SURFACE_TEMP);
    v.rearSurfaceTemp = lerp(wheel(2) + W.SURFACE_TEMP);
    v.frontWater = lerp(wheel(0) + W.WATER);
    v.rearWater = lerp(wheel(2) + W.WATER);
    v.compoundColour = COMPOUND_COLOURS[Math.round(b[o + F.COMPOUND])] ?? 0xffffff;
    const state = BIKE_STATES[Math.round(b[k + B.STATE])] ?? 'riding';
    v.riding = state === 'riding';
    const ob = o + OFFROAD_BASE;
    v.standing = lerp(ob + O.STANDING);
    v.dab = lerp(ob + O.DAB);
    v.body = lerp(ob + O.BODY);
    v.mud = b[ob + O.MUD];
    v.mudWet = b[ob + O.MOISTURE];
    model.pose(v);
    const rider = model.rider;
    if (v.riding) {
      if (rider.root.parent !== model.sprung) {
        model.sprung.add(rider.root);
        rider.root.position.set(0, 0, 0);
        rider.root.quaternion.identity();
      }
      return;
    }
    // Separated: the rider is a body of its own in the world.
    if (rider.root.parent !== this.root) this.root.add(rider.root);
    rider.root.visible = model.root.visible;
    this.position.set(lerp(k + B.RIDER_X), lerp(k + B.RIDER_Y), lerp(k + B.RIDER_Z));
    const ground = model.root.position.y - 0.09;
    const phase = state === 'remount' ? 2 : this.position.y - ground > 0.5 ? 1 : 0;
    rider.root.position.copy(this.position);
    if (phase !== 0) rider.root.position.y -= 0.95;
    rider.root.rotation.set(0, b[k + B.RIDER_HEADING], 0);
    rider.separated(phase, b[k + B.RIDER_TUMBLE], b[H.TIME]);
  }
  /** Onboard camera for a followed bike in world space. Motocross uses the
   * raised bar layout; road bikes retain their windscreen socket. */
  onboard(
    root: T.Object3D,
    eye: T.Vector3,
    direction: T.Vector3,
    tail = false,
    definition?: VehicleDefinition,
  ) {
    const mx = !!definition?.bike?.offroad,
      profile = mx ? MOTOCROSS_ONBOARD : BIKE_ONBOARD,
      mount = tail ? BIKE_ONBOARD.tail : profile.eye,
      pitch = tail ? BIKE_ONBOARD.tailPitch : profile.pitch;
    eye.set(mount[0], mount[1], mount[2]).applyQuaternion(root.quaternion).add(root.position);
    direction.set(0, Math.sin(pitch), Math.cos(pitch)).applyQuaternion(root.quaternion);
  }
  /** Bikes currently drawn (diagnostics). */
  get count() {
    let n = 0;
    for (const entry of this.entries.values()) if (entry.levels.some((l) => l.root.visible)) n++;
    return n;
  }
}
