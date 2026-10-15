import { LIVERIES } from '../simulation/config.ts';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { helmetShell, helmetPatch } from './helmet-shell.ts';

/** Team kit tones shared by pit and grid crews (instance colours over the
 * authored people asset's white kit vertex colours). */
export const CREW_KIT_COLOURS: readonly T.Color[] = [
  0x244553, 0x315963, 0x334950, 0x455961, 0x304c62,
].map((c) => new T.Color(c));

/** D23: the player's crew wears the supplied car's navy; rivals their livery. */
export const PLAYER_CREW_COLOUR = 0x1b2a5e;
const teamKits = new Map<number, T.Color>();
/** A team's crew kit (shared Color, do not mutate): LIVERIES[car % 12]. */
export function crewTeamColour(car: number) {
  const id = Number.isInteger(car) && car >= 0 ? car : 0;
  let colour = teamKits.get(id);
  if (!colour)
    teamKits.set(
      id,
      (colour = new T.Color(id === 0 ? PLAYER_CREW_COLOUR : LIVERIES[id % LIVERIES.length])),
    );
  return colour;
}

/** Role-coded kit over the team colour, so a pit crew does not read as one
 * mannequin army: wheel gunners in the full team colour, tyre carriers a
 * shade lower, jack operators in the team's dark shade, the release controller toward
 * a light grey, with a small per-person fabric variation (`actor`). Helmets
 * follow the role a little less. Shared cached Colors; do not mutate. */
export type CrewKitRole = 'gun' | 'remove' | 'install' | 'front-jack' | 'rear-jack' | 'release';
const ROLE_KIT: Readonly<Record<CrewKitRole, readonly [number, number, number]>> = Object.freeze({
  gun: [0x000000, 0, 1],
  remove: [0x000000, 0.14, 1],
  install: [0x000000, 0.08, 0.97],
  'front-jack': [0x000000, 0.4, 1],
  'rear-jack': [0x000000, 0.4, 1],
  release: [0x9aa0a6, 0.32, 1],
});
const roleKits = new Map<string, T.Color>();
export function crewRoleColour(car: number, role: CrewKitRole, actor = 0, helmet = false) {
  const id = Number.isInteger(car) && car >= 0 ? car : 0,
    person = Number.isInteger(actor) && actor >= 0 ? actor % 8 : 0;
  const key = `${id}:${role}:${person}:${helmet}`;
  let colour = roleKits.get(key);
  if (!colour) {
    const [mixHex, amount, gain] = ROLE_KIT[role];
    colour = crewTeamColour(id).clone();
    if (mixHex || amount) {
      const share = helmet ? amount * 0.6 : amount;
      if (mixHex) colour.lerp(new T.Color(mixHex), share);
      else colour.multiplyScalar(1 - share);
    }
    // Fabric lots and wear: +-5 % per person, deterministic.
    const jitter = helmet ? 1 : 0.95 + 0.1 * (((person * 37 + id * 11) % 8) / 7);
    colour.multiplyScalar(gain * jitter);
    roleKits.set(key, colour);
  }
  return colour;
}

/** Closed tailored limb and chest shapes with identical topology. Instanced
 * morph weights select a real shoulder/waist silhouette for torsos, without
 * turning every forearm into a torso or adding a draw call for every person. */
export function tailoredCrewGeometry() {
  const profile = [new T.Vector2(0, -0.5)];
  for (let row = 0; row <= 12; row++) {
    const t = row / 12,
      round = Math.sqrt(Math.max(0, 1 - ((t - 0.5) / 0.58) ** 2));
    profile.push(new T.Vector2((0.7 + 0.25 * Math.sin(Math.PI * t)) * round, t - 0.5));
  }
  profile.push(new T.Vector2(0, 0.5));
  const g = new T.LatheGeometry(profile, 12),
    torso = g.clone();
  const p = torso.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i),
      t = y + 0.5;
    // Hips, waist, ribcage, clavicles and a tapered neck seat.
    const shoulder = 1.0 + 0.52 * Math.exp(-(((t - 0.79) / 0.15) ** 2)),
      waist = 1 - 0.16 * Math.exp(-(((t - 0.32) / 0.16) ** 2));
    p.setX(i, p.getX(i) * shoulder * waist);
    p.setZ(i, p.getZ(i) * 0.76 * (1 + 0.13 * Math.sin(Math.PI * t)));
  }
  torso.computeVertexNormals();
  g.morphAttributes.position = [torso.getAttribute('position').clone()];
  g.morphAttributes.normal = [torso.getAttribute('normal').clone()];
  torso.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Solid shell and physically raised visor share a single vertex-colour batch.
 * Unit dimensions allow the existing actor placements to preserve body height. */
export function crewHelmetGeometry() {
  const shell = helmetShell(),
    visor = helmetPatch(-0.033, 0.043, 0.095, Math.PI - 0.095, 0.003, 5, 24);
  for (const [g, color] of [
    [shell, 0xe1ded0],
    [visor, 0x162a32],
  ] as const) {
    const p = g.getAttribute('position'),
      c = new T.Color(color),
      colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new T.BufferAttribute(colors, 3));
  }
  const g = mergeGeometries([shell, visor], false)!;
  shell.dispose();
  visor.dispose();
  g.scale(1 / 0.148, 1 / 0.15, 1 / 0.16);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** A closed glove with four individual curved digits and an opposed thumb.
 * Kept in one small shared buffer instead of dozens of meshes per mechanic. */
export function crewGloveGeometry() {
  const parts: T.BufferGeometry[] = [new T.SphereGeometry(1, 12, 8).scale(0.68, 0.66, 0.48)];
  for (let f = 0; f < 4; f++) {
    const x = (f - 1.5) * 0.31,
      length = f === 0 || f === 3 ? 0.65 : 0.82;
    const curve = new T.CatmullRomCurve3([
      new T.Vector3(x, 0.36, 0),
      new T.Vector3(x, 0.73, 0.12),
      new T.Vector3(x, length, 0.45),
      new T.Vector3(x, 0.52, 0.59),
    ]);
    const finger = new T.TubeGeometry(curve, 8, 0.14, 6, false);
    parts.push(finger, new T.SphereGeometry(0.14, 6, 4).translate(x, 0.52, 0.59));
  }
  const thumb = new T.CapsuleGeometry(0.2, 0.46, 3, 8);
  thumb.rotateZ(-0.7);
  thumb.translate(-0.68, 0.1, 0.23);
  parts.push(thumb);
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Shared low-cost garment finish: filtered warp detail and shoulder stitching,
 * not painted illumination. Colour is selected per actual actor, not per frame. */
export function installCrewFabric(material: T.MeshStandardMaterial) {
  material.userData.weatherSurface = 'fabric';
  const previous = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCrewLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrewLocal=position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCrewLocal;')
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
      vec2 weavePhase=vCrewLocal.xy*vec2(310.,270.);
      vec2 resolved=1.-smoothstep(vec2(.5),vec2(2.),fwidth(weavePhase));
      float weave=sin(weavePhase.x)*sin(weavePhase.y)*resolved.x*resolved.y;
      roughnessFactor=clamp(roughnessFactor+weave*.025,.8,1.);`,
      );
  };
  material.customProgramCacheKey = () => `${key}|aurel-tailored-crew-v2-filtered-weave`;
  return material;
}

/** The authored lens vertices have a dedicated blue-black pigment. Read that
 * immutable attribute before instance tint; shell, headset and visor can then
 * retain separate roughness in the same existing head submission. */
export function installCrewHelmetFinish(material: T.MeshStandardMaterial) {
  if (material.userData.authoredHelmetFinish) return material;
  material.userData.authoredHelmetFinish = true;
  const previous = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCrewLens;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vCrewLens=(1.-step(.021,color.r))*step(.030,color.g)*step(.039,color.b);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCrewLens;')
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,.17,clamp(vCrewLens,0.,1.));`,
      );
  };
  material.customProgramCacheKey = () => `${key}|aurel-authored-helmet-lens-v1`;
  return material;
}
