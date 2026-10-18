import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet } from '../vehicle-bodies/body-sheet.ts';
import { ClosedBodyModel } from '../vehicle-bodies/closed-body.ts';
import { festivalHeadlampFrames, festivalRearBumper } from '../vehicle-bodies/festival-detail.ts';
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
 * clear-coated paint, darker road glazing, lacquered rims and drilled discs,
 * Japanese registration plates on road cars, an always-on LED running-light
 * signature on modern headlamps, night lamp halos and the lamp levels of an
 * open-road car. Measured from references 001-098 (docs/production/fh6-r4/
 * vehicles.md). Adds at most three draws per near LOD (plates, running
 * lights, halos at night or braking); every finish but the halo is shared. */
const PLATED = new Set(['road', 'street']);
export function festivalPlated(def: VehicleDefinition) {
  return PLATED.has(String(def.classId));
}
/** Lamp emission levels (emissive intensity) for an open-road car. A red
 * lens carries ~0.22 luminance per unit and ACES turns one brighter than ~5
 * orange-white, so lenses stay at red-safe levels: running tail bars read lit
 * by day (ref 018), brighter at night and under braking; the glow itself is
 * the additive halo (`setLampHalos`, refs 058, 086). The cool-white LED
 * signature crosses the bloom knee (~1.8) even in daylight (refs 019, 037). */
export const FESTIVAL_LAMPS = Object.freeze({
  tailDay: 1.6,
  tailNight: 4,
  brake: 7,
  drlDay: 5.5,
  drlNight: 4.5,
  /** Dipped projectors: off-white by day, bright at night. */
  headDay: 0.35,
  headNight: 4,
  /** Additive halo levels (lens colour, linear radiance at the centre). */
  haloTail: 0.55,
  haloBrake: 0.7,
  haloHead: 0.35,
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
const rims = new Map<string, T.MeshPhysicalMaterial>();
/** Festival wheel finish (refs 019, 025, 078, 098): lacquered alloy under a
 * clear coat, or gloss-black paint on a dark wheel, so rims carry crisp
 * reflections; deep-dish spoked designs get a polished outer lip (object
 * space: the outboard-facing band beyond 90% of the bead radius). */
export function festivalRimMaterial(color: number, rimRadius: number, lip: boolean) {
  const key = `${color}|${lip ? rimRadius.toFixed(4) : '-'}`;
  let material = rims.get(key);
  if (material) return material;
  const linear = new T.Color(color),
    dark = linear.r * 0.2126 + linear.g * 0.7152 + linear.b * 0.0722 < 0.05;
  material = new T.MeshPhysicalMaterial({
    name: `Festival lacquered rim ${color.toString(16)}`,
    color,
    metalness: dark ? 0.3 : 0.9,
    roughness: dark ? 0.34 : 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
  });
  if (lip) {
    const radius = { value: rimRadius };
    chainShaderHook(material, 'festival-rim-lip-v1', (shader) => {
      shader.uniforms.festivalRimRadius = radius;
      injectDeclarations(
        shader,
        'common',
        'varying vec3 vRimPosition; varying vec3 vRimNormal;',
        'vertex',
      );
      injectAfter(
        shader,
        'begin_vertex',
        'vRimPosition = position; vRimNormal = normal;',
        'vertex',
      );
      injectDeclarations(
        shader,
        'common',
        'uniform float festivalRimRadius; varying vec3 vRimPosition; varying vec3 vRimNormal;',
        'fragment',
      );
      injectAfter(
        shader,
        'color_fragment',
        `float rimLip = smoothstep(0.895, 0.91, length(vRimPosition.yz) / festivalRimRadius)
          * smoothstep(0.35, 0.6, abs(vRimNormal.x));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.87, 0.88), rimLip);`,
        'fragment',
      );
      injectAfter(
        shader,
        'roughnessmap_fragment',
        'roughnessFactor = mix(roughnessFactor, 0.12, rimLip);',
        'fragment',
      );
      injectAfter(
        shader,
        'metalnessmap_fragment',
        'metalnessFactor = mix(metalnessFactor, 1.0, rimLip);',
        'fragment',
      );
    });
  }
  rims.set(key, material);
  return material;
}

/** Release the shared festival finishes (session exit). */
export function disposeFestivalFinish() {
  runningLight?.dispose();
  runningLight = null;
  for (const material of rims.values()) material.dispose();
  rims.clear();
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

/** Festival paint (refs 002, 010, 018, 019, 091, 097): the base coat sits
 * under the clear coat, so its own white dielectric sheen is mostly hidden
 * (specularIntensity 0.15) and the saturated pigment shows through a sharp
 * coat (roughness 0.03). Solid colours keep a diffuse base; metallic ones a
 * broader coloured flake lobe (the "flop"). Satin and matte wraps keep the
 * library finish. Per-car materials only. */
export const FESTIVAL_PAINT = Object.freeze({
  gloss: Object.freeze({ metalness: 0, roughness: 0.5, specularIntensity: 0.15 }),
  metallic: Object.freeze({ metalness: 0.45, roughness: 0.42, specularIntensity: 0.15 }),
  clearcoatRoughness: 0.03,
  /** Image-based reflection carried by the coat. The sky dome and probe are
   * displayed radiance, lower than the sunlit sky and clouds a real coat
   * mirrors: sampled on refs 019/074/091, bonnet reflections of sky reach
   * 0.4-0.6 sRGB above the base colour at 45-60 degree views, which the
   * unscaled coat (F0 0.04) cannot reach. Diffuse and sun light unchanged. */
  coatReflection: 1.6,
});
export function tuneFestivalPaint(material: T.MeshPhysicalMaterial) {
  const finish = material.userData.paintFinish as string | undefined;
  if (finish !== 'gloss' && finish !== 'metallic') return false;
  Object.assign(material, FESTIVAL_PAINT[finish]);
  material.clearcoat = 1;
  material.clearcoatRoughness = FESTIVAL_PAINT.clearcoatRoughness;
  material.userData.festivalPaint = true;
  chainShaderHook(material, 'festival-coat-reflection-v1', (shader) => {
    injectAfter(
      shader,
      'lights_fragment_maps',
      `#if defined( USE_CLEARCOAT ) && defined( RE_IndirectSpecular )
        clearcoatRadiance *= ${FESTIVAL_PAINT.coatReflection.toFixed(3)};
      #endif`,
      'fragment',
    );
  });
  return true;
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
  // A festival form's proud rear bumper carries the plate below its crease
  // (or, when it is too low for one, the plate stays above it).
  const bumper = rear ? festivalRearBumper(model) : null;
  let proud = 0;
  if (bumper && y - h < bumper.hi + 0.015) {
    const onBumper = Math.min(y, bumper.hi - h - 0.018);
    if (onBumper - h > bumper.lo + 0.03) {
      y = onBumper;
      proud = bumper.depth;
    } else y = bumper.hi + h + 0.02;
  }
  if (Math.min(model.sideX(z, y - h), model.sideX(z, y + h)) < PLATE.width / 2 + 0.04) return null;
  return { x: 0, y, z: z + (rear ? -0.011 - proud : 0.011) };
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

/** Night lamp halos (refs 058, 086): ACES tone mapping turns a red lens
 * bright enough to cross the bloom threshold orange-white, so lit lamps stay
 * at a red-safe level and a soft additive halo in the lens colour carries the
 * glow. One quad per lamp site, camera-facing, faded by how squarely the lamp
 * faces the camera; drawn only at night or under braking. */
export interface HaloSite {
  at: readonly [number, number, number];
  /** Lamp axis (car frame): -Z tail, +Z head. */
  axis: 1 | -1;
  size: number;
}
export function lampHaloSites(model: ClosedBodyModel): HaloSite[] {
  const { f, s } = model;
  const sites: HaloSite[] = [];
  const y = Math.min(f.y(s.tail) - 0.13, model.topY(model.zRear) - 0.06),
    z = model.zRear - 0.03,
    half = model.halfWidth(model.zRear) * 0.8;
  const tail = (x: number, size: number) => sites.push({ at: [x, y, z], axis: -1, size });
  if (s.lamps.rear === 'round')
    for (const side of [-1, 1]) {
      tail(side * half * 0.74, 0.2);
      tail(side * (half * 0.74 - 0.15), 0.17);
    }
  else if (s.lamps.rear === 'twin') for (const side of [-1, 1]) tail(side * half * 0.74, 0.26);
  else {
    const width = half * (s.lamps.rear === 'strip' ? 1.8 : 1.7);
    for (const t of [-0.42, -0.14, 0.14, 0.42]) tail(t * width, 0.24);
  }
  for (const { base } of festivalHeadlampFrames(model)) {
    const p = new T.Vector3().setFromMatrixPosition(base);
    sites.push({ at: [p.x, p.y + 0.03, p.z + 0.06], axis: 1, size: 0.24 });
  }
  return sites;
}
function haloGeometry(sites: readonly HaloSite[]) {
  const position: number[] = [],
    normal: number[] = [],
    corner: number[] = [],
    size: number[] = [],
    index: number[] = [];
  sites.forEach((site, k) => {
    for (const [cx, cy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      position.push(...site.at);
      normal.push(0, 0, site.axis);
      corner.push(cx, cy);
      size.push(site.size);
    }
    index.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
  });
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  g.setAttribute('haloCorner', new T.Float32BufferAttribute(corner, 2));
  g.setAttribute('haloSize', new T.Float32BufferAttribute(size, 1));
  g.setIndex(index);
  return g;
}
/** One car's halo finish (glow levels set by `setLampHalos`). */
export function lampHaloMaterial() {
  const material = new T.ShaderMaterial({
    name: 'Festival lamp halos',
    uniforms: { haloTail: { value: 0 }, haloHead: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    vertexShader: `attribute vec2 haloCorner; attribute float haloSize;
      uniform float haloTail; uniform float haloHead;
      varying vec2 vCorner; varying vec3 vGlow;
      void main() {
        vec4 c = modelViewMatrix * vec4(position, 1.0);
        vec3 axis = normalize(normalMatrix * normal);
        float facing = max(0.0, dot(axis, normalize(-c.xyz)));
        vGlow = (normal.z < 0.0 ? vec3(1.0, 0.035, 0.015) * haloTail
          : vec3(1.0, 0.92, 0.8) * haloHead) * pow(facing, 0.6);
        vCorner = haloCorner;
        // Camera-facing, and drawn just in front of the lens it surrounds.
        c.xyz += normalize(-c.xyz) * 0.12;
        c.xy += haloCorner * haloSize;
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: `varying vec2 vCorner; varying vec3 vGlow;
      void main() {
        float r2 = dot(vCorner, vCorner);
        float a = exp(-r2 * 4.5) * (1.0 - smoothstep(0.6, 1.0, r2));
        gl_FragColor = vec4(vGlow * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  material.visible = false;
  return material;
}
/** Halo levels for night amount `night` (0..1) and braking. */
export function setLampHalos(material: T.ShaderMaterial, night: number, braking: boolean) {
  const tail =
    night * FESTIVAL_LAMPS.haloTail +
    (braking ? FESTIVAL_LAMPS.haloBrake * Math.max(night, 0.35) : 0);
  const head = night * FESTIVAL_LAMPS.haloHead;
  material.uniforms.haloTail.value = tail;
  material.uniforms.haloHead.value = head;
  material.visible = tail > 0.01 || head > 0.01;
}

/** Install the festival finish on a newly built body (LOD0 and LOD1). */
export function installFestivalFinish(body: BuiltVehicleBody, id: number) {
  tuneFestivalPaint(body.materials.paint);
  tuneFestivalPaint(body.materials.accent);
  const sheet = bodySheetFor(body.definition);
  if (!sheet || sheet.kind !== 'closed') return null;
  const halo = lampHaloMaterial();
  // The body's own surface model (a festival form curves the end faces).
  const model =
    body.model ??
    new ClosedBodyModel(body.frame, sheet, [sheet.wheels.width[0] / 2, sheet.wheels.width[1] / 2]);
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
  const lipped = sheet.wheels.style === 'straight' || sheet.wheels.style === 'split';
  const rim = festivalRimMaterial(sheet.wheels.rimColor, sheet.wheels.rimRadius, lipped);
  for (const corners of body.wheels)
    for (const wheel of corners)
      for (const node of wheel.spin.children)
        if (node instanceof T.Mesh && node.name === 'Rim') node.material = rim;
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
      const merged = model.warpGeometry(mergeGeometries(plates, false));
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
      const merged = model.warpGeometry(mergeGeometries(strips, false));
      for (const g of strips) g.dispose();
      const mesh = new T.Mesh(merged, runningLightMaterial());
      mesh.name = 'Festival LED running lights';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      lod.group.add(mesh);
    }
    const halos = new T.Mesh(model.warpGeometry(haloGeometry(lampHaloSites(model))), halo);
    halos.name = 'Festival lamp halos';
    halos.frustumCulled = false;
    halos.castShadow = halos.receiveShadow = false;
    halos.renderOrder = 2;
    lod.group.add(halos);
  }
  return { halo };
}
