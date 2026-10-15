import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';
import { useStudioUniforms } from './studio-frame.ts';

/**
 * Crowd colour and flags (D21 crowd-grandstands).
 *
 * Palette: a real grandstand is mostly dark and neutral everyday clothing
 * (black, navy, charcoal, denim, khaki; white tees about one in ten) with team
 * kit mixed in. `TEAM_SHARE` of the shirts are team kit, muted to dyed-cotton
 * values (`fanColour`: 40 % toward their luminance, no channel above 0.55
 * linear), so a stand reads as a dark speckled mass, not confetti. Cohorts
 * (friends sitting together) share a colour `COHORT_SHARE` of the time, small
 * patches rather than solid kit blocks.
 *
 * Flags: one waving team flag per `FLAG_EVERY` spectators, held 1.5 m above
 * the person, one instanced draw per stand, waving with `studioWind` and
 * presented time (deterministic), drawn only where the geometric crowd LODs
 * are (`FLAG_RANGE` m). Printed polyester keeps more of the kit colour.
 */
/** Authored team kit hues (sRGB). Shirts and flags derive from these. */
export const CROWD_TEAM_KITS = Object.freeze([
  0xc8102e, 0xff8000, 0x1e3a8a, 0xf2f2f2, 0x0b6e4f, 0xffd200, 0x111111, 0xe5007d,
] as const);
/** Linear albedo ceiling of dyed cloth (a white cotton tee is about 0.55). */
export const CLOTH_ALBEDO_MAX = 0.55;
/** Desaturate an sRGB kit colour by `desaturate` (toward its linear luminance)
 * and cap its brightest linear channel at `cap`. Returns sRGB hex. */
export function fanColour(hex: number, desaturate = 0.4, cap = CLOTH_ALBEDO_MAX) {
  const c = new T.Color().setHex(hex);
  const y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  let r = c.r + (y - c.r) * desaturate,
    g = c.g + (y - c.g) * desaturate,
    b = c.b + (y - c.b) * desaturate;
  const top = Math.max(r, g, b);
  if (top > cap) {
    const k = cap / top;
    r *= k;
    g *= k;
    b *= k;
  }
  return c.setRGB(r, g, b).getHex();
}
/** Fan shirts in team kit: muted dyed cotton. */
export const CROWD_TEAM_COLOURS = Object.freeze(CROWD_TEAM_KITS.map((c) => fanColour(c)));
/** Team flags: printed polyester, lightly muted. */
export const CROWD_FLAG_COLOURS = Object.freeze(CROWD_TEAM_KITS.map((c) => fanColour(c, 0.15, 0.7)));
/** Everyday clothing (sRGB) and its share of the neutral picks, weighted dark. */
export const CROWD_NEUTRAL_MIX = Object.freeze([
  [0x1c1c1e, 0.2], // black
  [0x1f2a40, 0.16], // navy
  [0x3a3c40, 0.14], // charcoal
  [0x3a4f6e, 0.12], // denim
  [0x6b6e72, 0.09], // heather grey
  [0x7d7258, 0.08], // khaki
  [0x4b5040, 0.06], // olive
  [0x5a3a30, 0.04], // brown
  [0xc4c2bc, 0.11], // white tee
] as const);
export const CROWD_NEUTRALS = Object.freeze(CROWD_NEUTRAL_MIX.map(([c]) => c));
/** Every shirt colour a spectator can wear. */
export const CROWD_PALETTE = Object.freeze([...CROWD_TEAM_COLOURS, ...CROWD_NEUTRALS]);
/** Share of spectators in team kit. */
export const TEAM_SHARE = 0.22;
export const COHORT_SHARE = 0.35;
export const MAIN_STAND_OCCUPANCY = 0.9;
export const FLAG_EVERY = 13;
export const FLAG_RANGE = 240;

/** Deterministic palette pick: `u`, `v` in [0, 1). Team kit `TEAM_SHARE` of
 * the time, otherwise a weighted everyday neutral. */
export function crowdColour(u: number, v: number) {
  if (u < TEAM_SHARE)
    return CROWD_TEAM_COLOURS[
      Math.min(CROWD_TEAM_COLOURS.length - 1, Math.floor(v * CROWD_TEAM_COLOURS.length))
    ];
  let total = 0;
  for (const [, w] of CROWD_NEUTRAL_MIX) total += w;
  let acc = 0;
  for (const [c, w] of CROWD_NEUTRAL_MIX) {
    acc += w / total;
    if (v < acc) return c;
  }
  return CROWD_NEUTRALS[CROWD_NEUTRALS.length - 1];
}

/** A 0.9 × 0.6 m flag on its own pole, origin at the hand. */
export function flagGeometry() {
  const cloth = new T.PlaneGeometry(0.9, 0.6, 6, 2).translate(0.45, 1.3, 0);
  const pole = new T.BoxGeometry(0.02, 1.62, 0.02).translate(0, 0.81, 0);
  // Pole vertices carry u = 0 (no wave); the cloth's u grows to the fly end.
  const parts = [pole, cloth];
  const position: number[] = [],
    normal: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (const g of parts) {
    const base = position.length / 3;
    position.push(...(g.getAttribute('position').array as Float32Array));
    normal.push(...(g.getAttribute('normal').array as Float32Array));
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++)
      uv.push(g === pole ? 0 : p.getX(i) / 0.9, g === pole ? 0 : (p.getY(i) - 1.0) / 0.6);
    for (const i of g.index!.array as ArrayLike<number> as number[]) index.push(base + i);
    g.dispose();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setAttribute(
    'flagFly',
    new T.Float32BufferAttribute(
      uv.filter((_, i) => i % 2 === 0),
      1,
    ),
  );
  g.setIndex(index);
  g.computeBoundingBox();
  g.boundingBox!.expandByScalar(0.25);
  g.computeBoundingSphere();
  g.boundingSphere!.radius += 0.25;
  return g;
}

const WAVE = /* glsl */ `
{
	// D21 flag wave: travelling ripples toward the fly end, in the wind.
	float fly = flagFly;
	float phase = studioTime * 5.3 + dot( instanceMatrix[ 3 ].xz, vec2( 0.71, 0.37 ) );
	float strength = 0.35 + 0.65 * clamp( length( studioWind.xy ) / 6.0, 0.0, 1.0 );
	transformed.z += fly * ( 0.09 * sin( phase - fly * 5.5 ) + 0.03 * sin( phase * 1.7 - fly * 9.0 ) ) * strength;
	transformed.y -= fly * fly * 0.08 * ( 1.0 - strength );
}`;

/** The shared flag material (double-sided cloth, instance colour). */
export function flagMaterial() {
  const material = new T.MeshStandardMaterial({ side: T.DoubleSide, roughness: 0.8, metalness: 0 });
  material.name = 'Spectator team flags';
  chainShaderHook(material, 'crowd-flag-v1', (shader) => {
    useStudioUniforms(shader, ['studioTime', 'studioWind'], 'vertex');
    injectAfter(shader, 'begin_vertex', WAVE, 'vertex');
    injectDeclarations(
      shader,
      'common',
      'attribute float flagFly;\nvarying float vFlagFly;',
      'vertex',
    );
    injectAfter(shader, 'uv_vertex', 'vFlagFly = flagFly;', 'vertex');
    // Only where the geometric crowd is drawn: collapse beyond FLAG_RANGE.
    injectAfter(
      shader,
      'project_vertex',
      `if ( length( mvPosition.xyz ) > ${FLAG_RANGE.toFixed(1)} ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );`,
      'vertex',
    );
    injectDeclarations(shader, 'common', 'varying float vFlagFly;', 'fragment');
    // A second colour band across the cloth; the pole stays dark.
    injectAfter(
      shader,
      'color_fragment',
      'diffuseColor.rgb = vFlagFly <= 0.0 ? vec3( 0.05 ) : mix( diffuseColor.rgb, vec3( 0.92 ), step( 0.42, fract( vFlagFly * 1.5 ) ) * step( fract( vFlagFly * 1.5 ), 0.58 ) );',
      'fragment',
    );
  });
  return material;
}

/** One instanced flag mesh for a stand's spectators (every `FLAG_EVERY`th). */
export function buildCrowdFlags(
  spectators: readonly T.Matrix4[],
  seed: number,
  material: T.Material,
) {
  const picks = spectators.filter((_, i) => (i * 7 + seed) % FLAG_EVERY === 0);
  if (!picks.length) return null;
  const mesh = new T.InstancedMesh(flagGeometry(), material, picks.length);
  mesh.name = 'Spectator team flags';
  const m = new T.Matrix4(),
    lift = new T.Matrix4(),
    colour = new T.Color();
  picks.forEach((matrix, i) => {
    const h = (Math.imul(i + 1, 0x9e3779b1) ^ seed) >>> 0;
    lift.makeRotationY(((h % 628) / 100) * 0.35 - 0.6).setPosition(0.12, 0.55, 0);
    m.multiplyMatrices(matrix, lift);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, colour.setHex(CROWD_FLAG_COLOURS[h % CROWD_FLAG_COLOURS.length]));
  });
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.userData.crowdFlags = true;
  return mesh;
}
