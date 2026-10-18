import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet } from '../vehicle-bodies/body-sheet.ts';
import { ClosedBodyModel } from '../vehicle-bodies/closed-body.ts';
import { festivalHeadlampFrames } from '../vehicle-bodies/festival-detail.ts';
import type { BuiltVehicleBody } from '../vehicle-bodies/index.ts';
import { tubeGeometry } from '../vehicle-bodies/loft.ts';
import { sharedMaterials } from '../vehicle-bodies/materials.ts';
import { glass as libraryGlass } from '../materials/library.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import {
  PLATE,
  plateGeometry,
  plateMaterial,
  plateSlot,
  disposePlates,
} from './festival-plates.ts';

/** Festival-only exterior finish for the shared catalogue bodies, installed by
 * FestivalCars when a body is built (the circuit renderer never calls it):
 * Japanese registration plates on road cars, an always-on LED running-light
 * signature on modern headlamps, and the lamp levels of an open-road car
 * (running tail bars by day, a hard brake flare). Measured from references
 * 005, 013, 018, 019, 037, 058, 059 and 074. Adds at most two draws per near
 * LOD (plates, running lights), both on shared materials. */
const PLATED = new Set(['road', 'street']);
export function festivalPlated(def: VehicleDefinition) {
  return PLATED.has(String(def.classId));
}
/** Lamp emission levels (emissive intensity) for an open-road car. Bloom
 * starts near luminance 1.8 (LENS_BLOOM threshold 3.6, knee 1.8) and a red
 * lens carries ~0.22 luminance per unit: running tail bars read lit but do
 * not glow by day (ref 018), glow faintly at night (ref 058) and flare under
 * braking; the cool-white LED signature glows a little even in daylight
 * (refs 019, 037, 091). */
export const FESTIVAL_LAMPS = Object.freeze({
  tailDay: 1.6,
  tailNight: 8,
  brake: 15,
  drlDay: 5.5,
  drlNight: 4.5,
  /** Dipped projectors: off-white by day, glowing at night. */
  headDay: 0.35,
  headNight: 6,
  plateLamp: 0.55,
});

let runningLight: T.MeshStandardMaterial | null = null;
/** Shared LED running-light emitter (cool white, intensity set per frame). */
export function runningLightMaterial() {
  if (!runningLight) {
    runningLight = new T.MeshStandardMaterial({
      name: 'Festival LED running lights',
      color: 0xf4f8ff,
      emissive: 0xe8f1ff,
      emissiveIntensity: FESTIVAL_LAMPS.drlDay,
      roughness: 0.3,
      metalness: 0,
    });
    runningLight.userData.apexSpecularIBL = true;
  }
  return runningLight;
}
/** Per-frame lamp levels shared by every festival car (DRL, plate lamp). */
export function setFestivalLampLevels(night: number) {
  if (runningLight)
    runningLight.emissiveIntensity =
      FESTIVAL_LAMPS.drlDay + (FESTIVAL_LAMPS.drlNight - FESTIVAL_LAMPS.drlDay) * night;
}
let roadGlass: T.MeshPhysicalMaterial | null = null;
/** Festival road glazing: the library's Fresnel glass with the dark tint of
 * Japanese road cars (refs 019, 023, 059, 097): about 58% of the cabin light
 * passes, so the interior reads faintly behind sharp sky reflections. */
export function festivalRoadGlass() {
  if (!roadGlass) {
    roadGlass = libraryGlass({ tint: 0x10171b, transmission: 0.58, roughness: 0.015 });
    roadGlass.name = 'Festival road glass';
    roadGlass.side = T.DoubleSide;
    roadGlass.forceSinglePass = true;
    roadGlass.userData.vehicleGlass = 'road';
  }
  return roadGlass;
}
/** Release the shared festival finishes (session exit). */
export function disposeFestivalFinish() {
  runningLight?.dispose();
  runningLight = null;
  roadGlass?.dispose();
  roadGlass = null;
  disposePlates();
}

/** Cross-drilled friction rings on the brake discs that read through the
 * spokes (refs 013, 058, 078): three staggered rows of 30 holes in object
 * space, dark and rough, converging to their mean once a hole is under a
 * couple of pixels. The disc's own heat glow is untouched. */
export function drillBrakeDisc(material: T.MeshStandardMaterial, radius: number) {
  const discRadius = { value: radius };
  return chainShaderHook(material, 'festival-disc-drill-v1', (shader) => {
    shader.uniforms.festivalDiscRadius = discRadius;
    injectDeclarations(
      shader,
      'common',
      'varying vec3 vDiscPosition; varying vec3 vDiscNormal;',
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      'vDiscPosition = position; vDiscNormal = normal;',
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      'uniform float festivalDiscRadius; varying vec3 vDiscPosition; varying vec3 vDiscNormal;',
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `float discHole = 0.0;
      {
        float R = festivalDiscRadius;
        float r = length(vDiscPosition.yz) / R;
        float a = atan(vDiscPosition.z, vDiscPosition.y) / 6.2831853;
        float ring = step(0.7, abs(vDiscNormal.x)) * step(0.6, r) * step(r, 0.97);
        for (int k = 0; k < 3; k++) {
          float rr = 0.68 + float(k) * 0.095;
          float u = fract(a * 30.0 + float(k) * 0.33) - 0.5;
          vec2 q = vec2(u * 6.2831853 * rr * R / 30.0, (r - rr) * R);
          discHole = max(discHole, 1.0 - smoothstep(0.0032, 0.0046, length(q)));
        }
        float fw = fwidth(r * R);
        discHole = mix(discHole, 0.1, smoothstep(0.0015, 0.005, fw)) * ring;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.01), discHole);
      }`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor = mix(roughnessFactor, 0.85, discHole);',
      'fragment',
    );
  });
}

/** Where a plate fits on a closed body's end face (car frame), or null. */
export function platePlacement(model: ClosedBodyModel, rear: boolean) {
  const { f, s } = model;
  const z = rear ? model.zRear : model.zFront;
  const half = model.ring(z, 0).half;
  const bottom = Math.min(...half.map((p) => p[1])),
    top = Math.max(...half.map((p) => p[1]));
  const h = PLATE.height / 2;
  let y: number;
  if (rear) {
    // Below the tail lamps (festival-detail), clear of the diffuser lip.
    const lamps = Math.min(f.y(s.tail) - 0.13, model.topY(model.zRear) - 0.06) - 0.06;
    const floor = Math.max(bottom, f.y(s.floor)) + 0.08 + h;
    y = Math.max(floor, Math.min(lamps - h, (floor + lamps - h) / 2 + 0.02));
    if (y + h > lamps + 0.015) return null;
  } else {
    // Lower bumper, as Japanese front plates are carried; a low supercar
    // nose takes it just above the splitter.
    y = Math.max(bottom, f.y(s.floor)) + 0.035 + h;
    if (y + h > top - 0.005) return null;
  }
  if (Math.min(model.sideX(z, y - h), model.sideX(z, y + h)) < PLATE.width / 2 + 0.04) return null;
  return { x: 0, y, z: z + (rear ? -0.011 : 0.011) };
}

/** The running-light guide of one swept headlamp, in its surface frame. */
function runningLightPath(
  kind: ClosedSheet['lamps']['front'],
  width: number,
  depth: number,
  side: number,
) {
  if (kind === 'bar')
    return [
      [-width * 0.47, 0.036, depth * 0.34],
      [0, 0.037, depth * 0.38],
      [width * 0.47, 0.036, depth * 0.34],
    ] as const;
  // A boomerang along the forward edge, turning down the outer corner.
  return [
    [-side * width * 0.47, 0.036, -depth * 0.12],
    [-side * width * 0.41, 0.036, depth * 0.33],
    [side * width * 0.27, 0.036, depth * 0.43],
    [side * width * 0.45, 0.036, depth * 0.06],
    [side * width * 0.4, 0.036, -depth * 0.3],
  ] as const;
}

/** Install the festival finish on a newly built body (LOD0 and LOD1). */
export function installFestivalFinish(body: BuiltVehicleBody, id: number) {
  const sheet = bodySheetFor(body.definition);
  if (!sheet || sheet.kind !== 'closed') return;
  const model = new ClosedBodyModel(body.frame, sheet, [
    sheet.wheels.width[0] / 2,
    sheet.wheels.width[1] / 2,
  ]);
  const plated = festivalPlated(body.definition);
  const placements = plated ? [platePlacement(model, false), platePlacement(model, true)] : [];
  const modern = sheet.lamps.front === 'slim' || sheet.lamps.front === 'bar';
  const slot = plateSlot(id * 131 + body.definition.id.length * 7 + body.definition.version);
  // Performance discs; a truck's and a wire-wheeled classic's stay plain.
  const discRadius =
    sheet.style === 'truck' || sheet.wheels.style === 'wire'
      ? 0
      : sheet.wheels.rimRadius * sheet.wheels.disc;
  // The shared circuit road glazing is swapped on this body only.
  const circuitGlass = sharedMaterials.roadGlass();
  for (const lod of body.lods)
    lod.group.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      if (Array.isArray(node.material)) {
        if (node.material.includes(circuitGlass))
          node.material = node.material.map((m) => (m === circuitGlass ? festivalRoadGlass() : m));
      } else if (node.material === circuitGlass) node.material = festivalRoadGlass();
    });
  for (const [detail, lod] of body.lods.entries()) {
    if (detail > 1) break;
    for (const wheel of body.wheels[detail])
      if (wheel.disc && discRadius > 0) drillBrakeDisc(wheel.disc, discRadius);
    const plates: T.BufferGeometry[] = [];
    placements.forEach((at, k) => {
      if (!at) return;
      const rear = k === 1;
      const g = plateGeometry(slot, rear);
      if (rear) g.rotateY(Math.PI);
      // Plates lean with the fascia a few degrees (bumper face draft).
      g.rotateX(rear ? 0.05 : -0.05);
      plates.push(g.translate(at.x, at.y, at.z));
    });
    if (plates.length) {
      const merged = mergeGeometries(plates, false);
      for (const g of plates) g.dispose();
      const mesh = new T.Mesh(merged, plateMaterial());
      mesh.name = 'Festival registration plates';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      lod.group.add(mesh);
    }
    if (modern && sheet.style !== 'rally') {
      const strips: T.BufferGeometry[] = [];
      for (const { side, base, width, depth } of festivalHeadlampFrames(model)) {
        const path = runningLightPath(sheet.lamps.front, width, depth, side);
        strips.push(tubeGeometry(path, 0.0052, detail === 0 ? 24 : 12, 6).applyMatrix4(base));
      }
      const merged = mergeGeometries(strips, false);
      for (const g of strips) g.dispose();
      const mesh = new T.Mesh(merged, runningLightMaterial());
      mesh.name = 'Festival LED running lights';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      lod.group.add(mesh);
    }
  }
}
