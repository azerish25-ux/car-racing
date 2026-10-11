import {
  ellipsoid,
  roundBox,
  roundCone,
  smax,
  smin,
  smoothstep,
  sphere,
  ssub,
  surfaceNets,
  type Field,
} from './sdf-mesher.ts';
import { decimate } from './mesh-decimate.ts';

/** Procedural, anatomically proportioned people.
 *
 * Every body is sculpted as a signed-distance field around the shared crew
 * skeleton rest pose (pelvis 0.88 m, shoulders 1.43 m, head centre 1.61 m,
 * facing +Z) and polygonised with surface nets. Skin weights come from the
 * same anatomical volumes (four influences, smooth joint blending), so the
 * existing two-bone solver, authored actions and GPU instance skinning drive
 * them unchanged. The head is a separate rigid instance with a sculpted face. */

export type CrewKit = 'polo' | 'suit';
export const HUMAN_ANATOMY_VERSION = 2;

const BONE = {
  pelvis: 0,
  chest: 1,
  head: 2,
  upper: [3, 6],
  fore: [4, 7],
  hand: [5, 8],
  thigh: [9, 12],
  shin: [10, 13],
  boot: [11, 14],
} as const;

/** Bone-class distances written by the body field (side resolved later). */
const enum Part {
  Trunk,
  Neck,
  Upper,
  Fore,
  Thigh,
  Shin,
  Boot,
  Count,
}

/** Polo-shirt sleeve hem (bind-space height) and the collar line. */
export const POLO_SLEEVE_HEM = 1.235;
export const BELT_HEIGHT = 0.985;

function bodyField(
  kit: CrewKit,
  parts?: Float64Array,
  shell: 'all' | 'body' | 'arms' = 'all',
  fem = false,
) {
  const suit = kit === 'suit';
  return (x: number, y: number, z: number) => {
    const ax = Math.abs(x);
    // --- Trunk: pelvis, waist, ribcage, lats (V-taper), chest, back, shoulder girdle.
    let trunk = ellipsoid(
      ax,
      y,
      z,
      0,
      0.91,
      -0.008,
      fem ? 0.156 : 0.142,
      0.117,
      fem ? 0.108 : 0.104,
    );
    trunk = smin(
      trunk,
      ellipsoid(
        ax,
        y,
        z,
        fem ? 0.068 : 0.062,
        0.858,
        -0.048,
        fem ? 0.084 : 0.076,
        0.098,
        fem ? 0.08 : 0.072,
      ),
      0.035,
    );
    trunk = smin(
      trunk,
      ellipsoid(ax, y, z, 0, 1.035, 0.004, fem ? 0.116 : 0.127, 0.125, 0.094),
      0.06,
    );
    trunk = smin(
      trunk,
      ellipsoid(ax, y, z, 0, 1.215, -0.006, fem ? 0.136 : 0.15, 0.175, fem ? 0.1 : 0.106),
      0.06,
    );
    trunk = smin(
      trunk,
      ellipsoid(ax, y, z, fem ? 0.085 : 0.098, 1.205, -0.036, fem ? 0.055 : 0.068, 0.13, 0.064),
      0.04,
    );
    trunk = fem
      ? smin(trunk, ellipsoid(ax, y, z, 0.058, 1.27, 0.05, 0.064, 0.062, 0.058), 0.03)
      : smin(trunk, ellipsoid(ax, y, z, 0.066, 1.29, 0.04, 0.082, 0.064, 0.06), 0.035);
    trunk = smin(trunk, ellipsoid(ax, y, z, 0.07, 1.3, -0.05, 0.078, 0.105, 0.056), 0.04);
    trunk = smin(
      trunk,
      roundCone(ax, y, z, 0, 1.415, -0.02, fem ? 0.168 : 0.186, 1.407, -0.008, 0.064, 0.052),
      0.05,
    );
    trunk = smin(
      trunk,
      roundCone(ax, y, z, 0.045, 1.468, -0.028, fem ? 0.16 : 0.172, 1.44, -0.014, 0.033, 0.043),
      0.035,
    );
    // The shirt drapes a little fuller over the lower back.
    if (!suit) trunk = smin(trunk, ellipsoid(ax, y, z, 0, 1.06, -0.03, 0.12, 0.09, 0.085), 0.03);
    // Shirt blousing over the belt and a few soft horizontal folds.
    const angle = Math.atan2(x, z);
    trunk -=
      0.0035 *
      Math.sin(angle * 7 + y * 40) *
      smoothstep(0.99, 1.04, y) *
      (1 - smoothstep(1.08, 1.16, y));
    // Belt / waistband ridge.
    // Belt: a flat band (rounded box section) hugging the waist, not a rope.
    {
      const r = Math.hypot(x / 1.07, z / 0.78) - 0.128;
      const band =
        Math.hypot(Math.max(Math.abs(y - BELT_HEIGHT) - 0.012, 0), Math.max(r, 0)) +
        Math.min(Math.max(Math.abs(y - BELT_HEIGHT) - 0.012, r), 0) -
        0.006;
      trunk = smin(trunk, band, 0.006);
    }
    // --- Neck with a collar.
    let neck = roundCone(x, y, z, 0, 1.4, -0.018, 0, 1.565, 0.004, 0.058, 0.05);
    // Collar: a short folded band standing around the neck base, lower at
    // the front (the line tilts with depth like a real neckline).
    const collarY = y + 0.32 * z;
    const collar = roundCone(
      x,
      collarY,
      z,
      0,
      1.448,
      -0.008,
      0,
      1.474,
      -0.007,
      0.068,
      suit ? 0.064 : 0.061,
    );
    neck = smin(neck, collar, 0.008);
    // --- Arms (deltoid, upper arm, elbow, forearm to the wrist).
    const g = fem ? 0.88 : 1; // limb girth
    let upper = ellipsoid(ax, y, z, fem ? 0.195 : 0.205, 1.385, 0.0, 0.056 * g, 0.082, 0.06 * g);
    upper = smin(
      upper,
      roundCone(ax, y, z, 0.208, 1.39, 0, 0.21, 1.085, 0.004, 0.047 * g, 0.039 * g),
      0.03,
    );
    // Short polo sleeve (cut fuller than the arm), or a long overall sleeve.
    if (!suit) {
      let sleeve = smax(
        roundCone(ax, y, z, 0.202, 1.405, 0, 0.214, 1.23, 0.002, 0.061 * g, 0.056 * g),
        POLO_SLEEVE_HEM - y,
        0.004,
      );
      // Soft drag folds from the armpit down the sleeve.
      sleeve -=
        0.0025 *
        Math.sin(Math.atan2(z, x - Math.sign(x) * 0.21) * 3 + y * 60) *
        smoothstep(1.24, 1.3, y);
      upper = smin(upper, sleeve, 0.012);
    } else {
      upper = smin(
        upper,
        roundCone(ax, y, z, 0.203, 1.4, 0, 0.212, 1.08, 0.004, 0.056 * g, 0.047 * g),
        0.02,
      );
    }
    let fore = ellipsoid(ax, y, z, 0.21, 1.0, 0.006, 0.043 * g, 0.085, 0.042 * g);
    fore = smin(
      fore,
      roundCone(ax, y, z, 0.21, 1.085, 0.002, 0.21, 0.825, 0.012, 0.039 * g, 0.025 * g),
      0.03,
    );
    fore = smin(fore, ellipsoid(ax, y, z, 0.21, 0.835, 0.012, 0.02 * g, 0.028, 0.027 * g), 0.012);
    if (suit) {
      fore = smin(
        fore,
        roundCone(ax, y, z, 0.21, 1.08, 0.003, 0.21, 0.835, 0.01, 0.046, 0.034),
        0.02,
      );
      // Gathered cuff and elbow creases.
      fore -=
        0.0025 * Math.sin(y * 150) * smoothstep(0.99, 1.05, y) * (1 - smoothstep(1.09, 1.12, y));
    }
    // --- Legs in work trousers (loose) to the boot collar.
    const thigh = roundCone(
      ax,
      y,
      z,
      0.088,
      0.87,
      0.0,
      0.093,
      0.47,
      0.012,
      fem ? 0.083 : 0.079,
      0.058,
    );
    let shin = ellipsoid(ax, y, z, 0.093, 0.462, 0.018, 0.058, 0.068, 0.06);
    shin = smin(
      shin,
      roundCone(ax, y, z, 0.093, 0.45, 0.006, 0.093, 0.13, -0.008, 0.058, 0.05),
      0.03,
    );
    // Fabric bunching above the boot and behind the knee.
    shin -=
      0.0032 *
      Math.sin(y * 115 + Math.atan2(x - Math.sign(x) * 0.093, z) * 2) *
      smoothstep(0.13, 0.17, y) *
      (1 - smoothstep(0.23, 0.29, y));
    shin -=
      0.0028 *
      Math.sin(y * 140) *
      smoothstep(0.4, 0.43, y) *
      (1 - smoothstep(0.5, 0.53, y)) *
      smoothstep(0, -0.03, z);
    // --- Safety boots: heel, sole, toe cap and ankle collar; flat on the floor.
    let boot = roundBox(ax, y, z, 0.093, 0.05, 0.058, 0.05, 0.05, 0.125, 0.035);
    boot = smin(boot, ellipsoid(ax, y, z, 0.094, 0.048, 0.165, 0.052, 0.046, 0.07), 0.02);
    boot = smin(
      boot,
      roundCone(ax, y, z, 0.093, 0.05, 0.0, 0.093, 0.155, -0.006, 0.056, 0.053),
      0.02,
    );
    boot = smax(boot, -y + 0.004, 0.004);
    if (parts) {
      parts[Part.Trunk] = trunk;
      parts[Part.Neck] = neck;
      parts[Part.Upper] = upper;
      parts[Part.Fore] = fore;
      parts[Part.Thigh] = thigh;
      parts[Part.Shin] = shin;
      parts[Part.Boot] = boot;
    }
    const arm = smin(upper, fore, 0.025);
    // The lower arm is its own closed shell: a hand hanging beside the hip
    // can never be polygonised into the hip (a bridge that tears when the
    // arm moves). It overlaps a slightly smaller shoulder stub of the body
    // inside the sleeve, so the shoulder still blends into the torso.
    if (shell === 'arms') return smax(arm, y - 1.31, 0.03);
    let d = smin(trunk, neck, 0.03);
    const armBlend = 0.035 * smoothstep(1.26, 1.36, y);
    d = smin(d, shell === 'body' ? smax(arm + 0.002, 1.22 - y, 0.01) : arm, armBlend);
    const legs = smin(smin(thigh, shin, 0.03), boot, 0.02);
    d = smin(d, legs, 0.045 * smoothstep(0.66, 0.8, y));
    return d;
  };
}

function softWeights(distances: readonly number[], bones: readonly number[], sharp: number) {
  const best = Math.min(...distances);
  const raw = distances.map((d) => Math.exp(-(d - best) / sharp));
  const sum = raw.reduce((a, b) => a + b, 0);
  const acc = new Map<number, number>();
  raw.forEach((w, i) => acc.set(bones[i], (acc.get(bones[i]) ?? 0) + w / sum));
  return acc;
}

export interface SculptedMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  joints?: Uint8Array;
  weights?: Float32Array;
  cloth?: Float32Array;
  standing?: Float32Array;
  standingNormal?: Float32Array;
  tags?: Uint8Array;
  zone?: Uint8Array;
  /** Spectators: baked ambient occlusion, arm coordinate and build, 0..255. */
  surface?: Uint8Array;
}

/** Decimate to a budget, then put every vertex back on the zero set and use
 * the field gradient as its normal (smooth shading independent of facets). */
export function polygonise(
  field: Field,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  cell: number,
  triangles: number,
  importance?: (x: number, y: number, z: number) => number,
): SculptedMesh {
  const raw = surfaceNets(field, min, max, cell, 2);
  const reduced =
    raw.indices.length / 3 > triangles
      ? decimate(raw.positions, raw.indices, triangles, importance)
      : raw;
  const p = reduced.positions;
  const normals = new Float32Array(p.length);
  const e = cell * 0.3;
  for (let i = 0; i < p.length; i += 3) {
    let x = p[i],
      y = p[i + 1],
      z = p[i + 2];
    let gx = 0,
      gy = 1,
      gz = 0;
    for (let it = 0; it < 3; it++) {
      const d = field(x, y, z);
      gx = (field(x + e, y, z) - field(x - e, y, z)) / (2 * e);
      gy = (field(x, y + e, z) - field(x, y - e, z)) / (2 * e);
      gz = (field(x, y, z + e) - field(x, y, z - e)) / (2 * e);
      const g2 = gx * gx + gy * gy + gz * gz;
      if (it === 2 || g2 < 1e-6) break;
      const s = Math.max(-cell, Math.min(cell, d / g2)) * 0.8;
      x -= s * gx;
      y -= s * gy;
      z -= s * gz;
    }
    const l = Math.hypot(gx, gy, gz) || 1;
    p[i] = x;
    p[i + 1] = y;
    p[i + 2] = z;
    normals[i] = gx / l;
    normals[i + 1] = gy / l;
    normals[i + 2] = gz / l;
  }
  return { positions: p, normals, indices: reduced.indices };
}

/** Skinned crew body for the shared 15-bone instance skeleton. */
export function sculptCrewBody(
  kit: CrewKit,
  cell: number,
  triangles: number,
  fem = false,
): SculptedMesh {
  const parts = new Float64Array(Part.Count);
  const probe = bodyField(kit, parts, 'all', fem);
  // Keep detail where people look: face-adjacent neck/collar, hands, boots.
  const importance = (x: number, y: number) => (y > 1.36 ? 3 : y < 0.2 ? 1.6 : 1);
  const bodyMesh = polygonise(
    bodyField(kit, undefined, 'body', fem),
    [-0.36, -0.02, -0.2],
    [0.36, 1.6, 0.27],
    cell,
    Math.round(triangles * 0.8),
    importance,
  );
  const armMesh = polygonise(
    bodyField(kit, undefined, 'arms', fem),
    [-0.3, 0.74, -0.1],
    [0.3, 1.36, 0.1],
    cell,
    Math.round(triangles * 0.2),
  );
  const bodyCount = bodyMesh.positions.length / 3;
  const mesh: SculptedMesh = {
    positions: new Float32Array([...bodyMesh.positions, ...armMesh.positions]),
    normals: new Float32Array([...bodyMesh.normals, ...armMesh.normals]),
    indices: Uint32Array.from([
      ...bodyMesh.indices,
      ...Array.from(armMesh.indices, (i) => i + bodyCount),
    ]),
  };
  const n = mesh.positions.length / 3;
  const joints = new Uint8Array(n * 4),
    weights = new Float32Array(n * 4),
    cloth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = mesh.positions[i * 3],
      y = mesh.positions[i * 3 + 1],
      z = mesh.positions[i * 3 + 2];
    probe(x, y, z);
    const side = x < 0 ? 0 : 1;
    const chest = smoothstep(0.95, 1.16, y);
    const headShare = smoothstep(1.5, 1.58, y);
    const bones = [
      -1,
      -2,
      BONE.upper[side],
      BONE.fore[side],
      BONE.thigh[side],
      BONE.shin[side],
      BONE.boot[side],
    ];
    const d = Array.from(parts);
    if (y < 1.28) {
      // Below the shoulder an arm never shares weights with the hip or ribs
      // it hangs beside: the arm shell is all arm, the body all body.
      if (i >= bodyCount)
        for (const k of [Part.Trunk, Part.Neck, Part.Thigh, Part.Shin, Part.Boot]) d[k] = 1;
      else d[Part.Upper] = d[Part.Fore] = 1;
    }
    const soft = softWeights(d, bones, 0.012);
    const final = new Map<number, number>();
    const add = (bone: number, w: number) => final.set(bone, (final.get(bone) ?? 0) + w);
    for (const [bone, w] of soft) {
      if (bone === -1) {
        add(BONE.pelvis, w * (1 - chest));
        add(BONE.chest, w * chest);
      } else if (bone === -2) {
        add(BONE.chest, w * (1 - headShare));
        add(BONE.head, w * headShare);
      } else add(bone, w);
    }
    const top = [...final.entries()]
      .filter(([, w]) => w > 1e-3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const sum = top.reduce((a, [, w]) => a + w, 0);
    for (let k = 0; k < 4; k++) {
      joints[i * 4 + k] = top[k]?.[0] ?? top[0][0];
      weights[i * 4 + k] = top[k] ? top[k][1] / sum : 0;
    }
    // Material classes: 1 tinted kit, 0.5 skin, 0 neutral (boots, belt).
    const isBoot =
      y < 0.17 && parts[Part.Boot] < Math.min(parts[Part.Shin], parts[Part.Thigh]) + 0.002;
    // The belt colour is analytic in the kit shader (crisp at every LOD).
    const belt = false;
    const armVertex = i >= bodyCount;
    const skinForearm = kit === 'polo' && y < POLO_SLEEVE_HEM - 0.004 && y > 0.76 && armVertex;
    const skinNeck = Math.hypot(x, z + 0.008) < 0.066 && y > 1.476 - 0.32 * z;
    cloth[i] = skinForearm || skinNeck ? 0.5 : isBoot || belt ? 0 : 1;
  }
  return { ...mesh, joints, weights, cloth };
}

/** Head zones, stored per vertex for the head material. */
export const HEAD_ZONE = {
  skin: 0,
  hair: 1,
  eye: 2,
  lips: 3,
  cap: 4,
  headset: 5,
  brow: 6,
} as const;
export type HeadWear = 'bare' | 'cap' | 'headset' | 'cap-headset' | 'fem-bare' | 'fem-headset';

interface HeadParts {
  skin: number;
  hair: number;
  eye: number;
  lips: number;
  cap: number;
  headset: number;
  brow: number;
}

/** Mid-face shortening (metres): the face below the eyes is raised by this
 * much, blending back to zero at the eyes and down the neck. Mirrored by
 * HEAD_MIDFACE_GLSL in src/rendering/human-kit.ts. */
export const HEAD_MIDFACE_LIFT = 0.005;
export function midfaceLift(y: number) {
  return HEAD_MIDFACE_LIFT * smoothstep(0.012, -0.03, y) * smoothstep(-0.16, -0.12, y);
}

/** `soft`: hair thickness ramps in above the hairline instead of ending in a
 * ledge, so a low-budget (spectator) mesh has no stair-stepped hair edge; the
 * shader paints the hairline analytically on the continuous surface. */
function headField(wear: HeadWear, out?: HeadParts, soft = false) {
  const cap = wear === 'cap' || wear === 'cap-headset';
  const headset = wear === 'headset' || wear === 'cap-headset' || wear === 'fem-headset';
  const fem = wear.startsWith('fem');
  return (x: number, y0: number, z: number) => {
    const ax = Math.abs(x);
    // A shorter mid-face: everything below the eyes is raised (shared with
    // the shader's face frame, see HEAD_MIDFACE_GLSL in human-kit.ts).
    const y = y0 - midfaceLift(y0);
    // Cranium (a rounder skull), forehead, maxilla, cheekbones, full cheeks,
    // soft jaw and chin: adult proportions, face width ~0.78x its height.
    let s = ellipsoid(
      ax,
      y,
      z,
      0,
      0.03,
      -0.01,
      fem ? 0.075 : 0.079,
      fem ? 0.085 : 0.087,
      fem ? 0.091 : 0.094,
    );
    s = smin(s, ellipsoid(ax, y, z, 0, 0.034, 0.024, 0.066, 0.066, 0.066), 0.022);
    s = smin(s, ellipsoid(ax, y, z, 0, -0.034, 0.038, 0.054, 0.058, 0.058), 0.026);
    s = smin(s, ellipsoid(ax, y, z, fem ? 0.044 : 0.046, -0.006, 0.048, 0.027, 0.02, 0.03), 0.02);
    // Cheek soft tissue (buccal fat) fills the hollow under the cheekbone.
    s = smin(s, ellipsoid(ax, y, z, 0.036, -0.034, 0.052, 0.029, 0.028, 0.03), 0.024);
    s = smin(
      s,
      fem
        ? roundCone(ax, y, z, 0.045, -0.04, -0.016, 0.02, -0.088, 0.048, 0.017, 0.014)
        : roundCone(ax, y, z, 0.053, -0.043, -0.014, 0.025, -0.096, 0.052, 0.02, 0.017),
      0.026,
    );
    s = smin(
      s,
      fem
        ? ellipsoid(ax, y, z, 0, -0.098, 0.062, 0.018, 0.016, 0.018)
        : ellipsoid(ax, y, z, 0, -0.102, 0.066, 0.022, 0.018, 0.02),
      0.018,
    );
    // Neck into the collar, with the larynx.
    s = smin(s, roundCone(ax, y, z, 0, -0.07, -0.026, 0, -0.17, -0.03, 0.05, 0.054), 0.014);
    if (!fem) s = smin(s, ellipsoid(ax, y, z, 0, -0.118, 0.022, 0.012, 0.016, 0.012), 0.012);
    // Brow ridge, then eye sockets carved under it.
    // Soft orbital hollows (no separate brow-ridge volume: it reads as a crease).
    s = ssub(s, ellipsoid(ax, y, z, 0.031, 0.0105, 0.1, 0.018, 0.012, 0.013), 0.014);
    // Upper lids hood the eyeballs. A coarse (soft) mesh cannot resolve the
    // lid margins, so it keeps a smooth socket and the lids are painted.
    if (!soft) {
      // Relaxed upper lid: covers the top of the iris.
      s = smin(s, ellipsoid(ax, y, z, 0.031, 0.0192, 0.0828, 0.0152, 0.0066, 0.0105), 0.004);
      s = smin(s, ellipsoid(ax, y, z, 0.031, 0.0005, 0.0825, 0.014, 0.0035, 0.009), 0.004);
    } else s = smin(s, ellipsoid(ax, y, z, 0.031, 0.0145, 0.0785, 0.015, 0.0085, 0.009), 0.007);
    // Nose: bridge, tip, alae and nostrils.
    s = smin(
      s,
      roundCone(
        ax,
        y,
        z,
        0,
        0.022,
        0.09,
        0,
        -0.021,
        fem ? 0.104 : 0.108,
        0.0068,
        fem ? 0.0085 : 0.0098,
      ),
      0.008,
    );
    s = smin(s, sphere(ax, y, z, 0, -0.023, fem ? 0.1005 : 0.1045, fem ? 0.0105 : 0.0118), 0.006);
    s = smin(s, ellipsoid(ax, y, z, 0.0118, -0.029, 0.0965, 0.0088, 0.0074, 0.0088), 0.005);
    s = ssub(s, ellipsoid(ax, y, z, 0.0072, -0.0355, 0.1015, 0.0042, 0.0028, 0.0048), 0.002);
    // Ears with a carved concha.
    let ear = ellipsoid(ax, y, z, 0.075, 0.002, -0.01, 0.0095, fem ? 0.026 : 0.029, 0.018);
    ear = ssub(ear, ellipsoid(ax, y, z, 0.083, -0.002, -0.006, 0.0055, 0.016, 0.011), 0.003);
    s = smin(s, ear, 0.006);
    // Lips and the mouth line.
    const lips = Math.min(
      ellipsoid(ax, y, z, 0, -0.0505, 0.0862, 0.0185, fem ? 0.0048 : 0.004, 0.0076),
      ellipsoid(ax, y, z, 0, -0.0605, 0.084, 0.0165, fem ? 0.0056 : 0.0048, 0.008),
    );
    s = smin(s, lips, 0.006);
    s = ssub(s, roundBox(ax, y, z, 0, -0.0556, 0.098, 0.0195, 0.0008, 0.012, 0.0007), 0.002);
    const eye = sphere(ax, y, z, 0.031, 0.0105, soft ? 0.0756 : 0.0765, 0.0122);
    // Brows: a thin raised band on the brow ridge.
    const brow = roundCone(ax, y, z, 0.014, 0.029, 0.0955, 0.05, 0.031, 0.083, 0.0042, 0.003);
    // Hair: a close crop over the cranium above an irregular hairline.
    const hl = headHairline(x, y, z);
    // Hair conforms to the scalp: an offset of the skin surface, thicker on
    // the crown, clipped by the hairline (never a detached helmet shell).
    const thick =
      0.0028 +
      0.0045 * smoothstep(0.0, 0.1, y) +
      0.0015 * smoothstep(0.02, 0.09, z) * smoothstep(0.05, 0.1, y);
    let hair = soft
      ? s - thick * smoothstep(hl - 0.002, hl + 0.014, y)
      : smax(s - thick, hl - y, 0.002);
    if (fem) {
      // Longer hair swept back over the crown with volume at the sides and a
      // ponytail falling from a gathered tie at the back of the head.
      // Side-parted, falling over the ears to the jaw line at the sides.
      const front =
        0.06 - 0.02 * smoothstep(0.01, 0.06, x + 0.012) + 0.04 * smoothstep(0.045, 0.0, z);
      const sideDrop = -0.07 * smoothstep(0.045, 0.07, ax) * smoothstep(0.06, 0.02, z);
      const line = Math.min(front, front + sideDrop);
      const massThick = 0.008 + 0.006 * smoothstep(-0.07, 0.05, y);
      let mass = soft
        ? s - massThick * smoothstep(line - 0.003, line + 0.016, y)
        : smax(s - massThick, line - y, 0.004);
      // Soft outward fall below the ears.
      mass = smin(
        mass,
        smax(ellipsoid(ax, y, z, 0.068, -0.04, -0.02, 0.024, 0.05, 0.05), 0.04 - z, 0.01),
        0.012,
      );
      hair = smin(hair, mass, 0.006);
      hair = smin(hair, ellipsoid(ax, y, z, 0, 0.02, -0.105, 0.03, 0.028, 0.024), 0.012);
      hair = smin(hair, roundCone(x, y, z, 0, 0.005, -0.12, 0, -0.14, -0.112, 0.022, 0.012), 0.012);
    }
    let wearCap = 1;
    if (cap) {
      let crown = ellipsoid(ax, y, z, 0, 0.038, -0.012, 0.083, 0.092, 0.106);
      crown = smax(crown, 0.028 + 0.02 * smoothstep(0.0, -0.08, z) - y, 0.004);
      const brim = smax(
        ellipsoid(
          ax,
          y + ((0.06 * ax * ax) / 0.006) * 0.1,
          z,
          0,
          0.034 - 0.03 * (z - 0.09),
          0.105,
          0.08,
          0.004,
          0.08,
        ),
        0.06 - z,
        0.004,
      );
      wearCap = Math.min(crown, brim, ellipsoid(ax, y, z, 0, 0.128, -0.014, 0.008, 0.004, 0.008));
    }
    let set = 1;
    if (headset) {
      // Rigid kit is placed in the unlifted head frame (its paint uses it too).
      const cup = roundCone(ax, y0, z, 0.081, -0.0, -0.01, 0.098, -0.0, -0.01, 0.034, 0.032);
      // Band over the crown (or the cap) in the coronal plane.
      const r = Math.hypot(x, y0 + 0.0) - (cap ? 0.107 : 0.102);
      const band = Math.max(Math.hypot(r, z + 0.01) - 0.0075, -y0 - 0.0);
      const boom = Math.min(
        roundCone(x, y0, z, -0.095, -0.012, 0.012, -0.045, -0.058, 0.088, 0.0035, 0.003),
        sphere(x, y0, z, -0.043, -0.06, 0.09, 0.0075),
      );
      set = Math.min(cup, band, boom);
    }
    if (out) {
      out.skin = s;
      out.hair = hair;
      out.eye = eye;
      out.lips = lips;
      out.cap = wearCap;
      out.headset = set;
      out.brow = brow;
    }
    // Brows are painted (shader), not a raised band glued to the ridge.
    return Math.min(smin(s, hair, 0.004), eye, wearCap, set);
  };
}

/** Hairline height at a scalp point (shared with the head shader). */
export function headHairline(x: number, _y: number, z: number) {
  const ax = Math.abs(x);
  const front = 0.066 - 0.008 * Math.cos(x * 40) + 0.03 * smoothstep(0.03, -0.03, z);
  const back = smoothstep(-0.07, 0.04, z);
  let line = back * front + (1 - back) * -0.045;
  if (ax > 0.06) line += 0.032 * smoothstep(0.06, 0.08, ax) * smoothstep(0.03, -0.03, z);
  // Clear around the ears (an oval, not a notch).
  const ear = Math.hypot((_y - 0.0) / 0.042, (z + 0.008) / 0.03);
  if (ax > 0.06 && ear < 1) line = Math.max(line, _y + 0.004 * (1 - ear) + 0.002);
  return line;
}

/** Rigid head (with neck to the collar), centred on the crew head joint. */
export function sculptHead(wear: HeadWear, cell: number, triangles: number): SculptedMesh {
  // Faces keep their triangles; the back of the skull gives them up first.
  const importance = (x: number, y: number, z: number) => (z > 0.04 && y > -0.11 ? 4 : 1);
  return polygonise(
    headField(wear),
    [-0.13, -0.19, -0.135],
    [0.13, 0.15, 0.2],
    cell,
    triangles,
    importance,
  );
}

/** Gloved right hand in the crew glove frame: fingers along +Y, palm facing
 * +Z, thumb on -X, the cuff centre at (0, -0.067, -0.008). Relaxed grip with
 * individually curled, jointed fingers (mirrored at runtime for the left). */
function handField(x: number, y: number, z: number, bare = false) {
  // Cuff (slightly flared gauntlet) or a bare wrist, then the back of the hand / palm.
  let d = bare
    ? roundCone(x, y, z, 0, -0.078, -0.008, 0, -0.035, -0.004, 0.021, 0.024)
    : roundCone(x, y, z, 0, -0.085, -0.008, 0, -0.035, -0.004, 0.031, 0.027);
  d = smin(d, roundBox(x, y, z, 0.002, -0.004, 0.0, 0.034, 0.04, 0.0105, 0.012), 0.014);
  d = smin(d, ellipsoid(x, y, z, -0.022, -0.022, 0.012, 0.02, 0.026, 0.014), 0.01); // thenar
  // Fingers: index (thumb side) to little finger.
  const fingers: [number, number, number][] = [
    [-0.0255, 0.043, 0.0098],
    [-0.0085, 0.047, 0.0102],
    [0.0085, 0.045, 0.0098],
    [0.0255, 0.036, 0.0088],
  ];
  const lengths = [
    [0.04, 0.025, 0.021],
    [0.044, 0.028, 0.022],
    [0.041, 0.026, 0.021],
    [0.033, 0.02, 0.018],
  ];
  fingers.forEach(([fx, fy, r], f) => {
    let px = fx,
      py = fy - 0.004,
      pz = 0.0;
    let angle = 0.32 + f * 0.05;
    const spread = (f - 1.5) * 0.06;
    for (let k = 0; k < 3; k++) {
      const len = lengths[f][k];
      const nx = px + Math.sin(spread) * len * 0.3,
        ny = py + Math.cos(angle) * len,
        nz = pz + Math.sin(angle) * len;
      const rr = r * (1 - k * 0.1);
      d = smin(d, roundCone(x, y, z, px, py, pz, nx, ny, nz, rr, rr * 0.93), 0.003);
      px = nx;
      py = ny;
      pz = nz;
      angle += 0.5 + k * 0.08;
    }
  });
  // Knuckle ridge.
  d = smin(
    d,
    roundCone(x, y, z, -0.026, 0.036, -0.004, 0.026, 0.031, -0.004, 0.0085, 0.0075),
    0.008,
  );
  // Opposed thumb in two phalanges.
  d = smin(d, roundCone(x, y, z, -0.03, -0.03, 0.004, -0.048, -0.003, 0.022, 0.013, 0.011), 0.01);
  d = smin(
    d,
    roundCone(x, y, z, -0.048, -0.003, 0.022, -0.046, 0.02, 0.039, 0.0105, 0.0095),
    0.004,
  );
  return d;
}

export function sculptHand(cell: number, triangles: number, bare = false): SculptedMesh {
  return polygonise(
    (x, y, z) => handField(x, y, z, bare),
    [-0.075, -0.13, -0.05],
    [0.055, 0.12, 0.085],
    cell,
    triangles,
  );
}

/* ------------------------------------------------------------------------ */
/* Spectators: seated sculpt with an authored standing correspondence.      */
/* Designed facing +Z (like the crew), exported facing -X with lateral Z,   */
/* seat at the origin, matching the grandstand seat matrices.              */
/* ------------------------------------------------------------------------ */

type V3 = [number, number, number];
interface SpectatorBone {
  name: string;
  seat: V3;
  stand: V3;
  /** Direction used to orient the bone (seated / standing), or null for translation only. */
  dirSeat: V3 | null;
  dirStand: V3 | null;
}

export const SPECTATOR_RIG = {
  shoulder: [0.165, 0.5, -0.09] as V3,
  head: [0, 0.565, -0.08] as V3,
  standShift: [0.44, 0.5] as [number, number],
};

function spectatorBones(side: number): SpectatorBone[] {
  const s = side;
  return [
    {
      name: 'pelvis',
      seat: [0, 0.11, -0.06],
      stand: [0, 0.53, 0.35],
      dirSeat: null,
      dirStand: null,
    },
    {
      name: 'chest',
      seat: [0, 0.24, -0.07],
      stand: [0, 0.67, 0.35],
      dirSeat: [0, 0.29, -0.02],
      dirStand: [0, 0.33, 0],
    },
    {
      name: 'head',
      seat: [0, 0.565, -0.08],
      stand: [0, 1.065, 0.36],
      dirSeat: null,
      dirStand: null,
    },
    {
      name: 'thigh',
      seat: [s * 0.085, 0.1, -0.05],
      stand: [s * 0.085, 0.52, 0.36],
      dirSeat: [0.015 * s, 0.03, 0.41],
      dirStand: [0.015 * s, -0.41, 0.01],
    },
    {
      name: 'shin',
      seat: [s * 0.1, 0.13, 0.36],
      stand: [s * 0.1, 0.11, 0.37],
      dirSeat: [0.01 * s, -0.4, 0.04],
      dirStand: [0.01 * s, -0.42, 0.01],
    },
    {
      name: 'foot',
      seat: [s * 0.11, -0.23, 0.4],
      stand: [s * 0.11, -0.23, 0.38],
      dirSeat: null,
      dirStand: null,
    },
    {
      name: 'arm',
      seat: [s * 0.165, 0.5, -0.09],
      stand: [s * 0.165, 1.0, 0.35],
      dirSeat: [0, 0.29, -0.02],
      dirStand: [0, 0.33, 0],
    },
  ];
}

const enum SP {
  Torso,
  Head,
  Hair,
  Arm,
  Hand,
  Thigh,
  Shin,
  Foot,
  Cap,
  Phone,
  Count,
}

export type SpectatorArmPose = 'rest' | 'crossed' | 'drink';
/** Spectator heads are the crew head sculpt at this scale (shared with the
 * crowd shader's analytic face frame). */
export const SPECTATOR_HEAD_SCALE = 0.96;

/** Shoulder, elbow, wrist and fingertip of one side (s = -1 left, +1 right). */
function spectatorArmJoints(pose: SpectatorArmPose, s: number, sh: number): V3[] {
  const elbow: V3 =
    pose === 'crossed'
      ? [sh + 0.02, 0.29, -0.03]
      : [sh + 0.03, pose === 'drink' && s > 0 ? 0.27 : 0.26, -0.04];
  let wrist: V3, tip: V3;
  if (pose === 'crossed') {
    // Forearms folded across the stomach, the right one over the left.
    const over = s > 0 ? 0.022 : 0;
    wrist = [-0.075, 0.325 + over * 0.4, 0.085 + over];
    tip = [-0.135, 0.33 + over * 0.4, 0.06 + over];
  } else if (pose === 'drink' && s > 0) {
    // Right forearm raised, a cup held at chest height.
    wrist = [0.105, 0.37, 0.15];
    tip = [0.095, 0.405, 0.19];
  } else {
    wrist = [0.125, 0.198, 0.19];
    tip = [0.115, 0.19, 0.285];
  }
  // Mirrored into the side's frame (x * s).
  return [[sh + 0.01, 0.48, -0.09], elbow, wrist, tip].map(([x, y, z]) => [x * s, y, z] as V3);
}

/** Normalised position along an arm (0 shoulder, .5 elbow, .9 wrist, 1
 * fingertip) of a point, from its nearest point on either arm's bone
 * polyline (folded forearms cross the midline). */
function armCoordinate(arms: readonly (readonly V3[])[], x: number, y: number, z: number) {
  const marks = [0, 0.5, 0.9, 1];
  let best = Infinity,
    t = 0;
  for (let k = 0; k < 6; k++) {
    const joints = arms[k < 3 ? 0 : 1],
      j = k % 3;
    const [ax, ay, az] = joints[j],
      [bx, by, bz] = joints[j + 1];
    const dx = bx - ax,
      dy = by - ay,
      dz = bz - az;
    const u = Math.max(
      0,
      Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / (dx * dx + dy * dy + dz * dz)),
    );
    const d = Math.hypot(x - ax - dx * u, y - ay - dy * u, z - az - dz * u);
    if (d < best) {
      best = d;
      t = marks[j] + (marks[j + 1] - marks[j]) * u;
    }
  }
  return t;
}

/** Upper arm, forearm and hand of one side (s = -1 left, +1 right) in a pose. */
function spectatorArm(
  pose: SpectatorArmPose,
  s: number,
  sh: number,
  x: number,
  y: number,
  z: number,
): [number, number] {
  const [, elbow, wrist, tip] = spectatorArmJoints(pose, 1, sh);
  const px = x * s;
  // Deltoid, then a tapering upper arm with a slight biceps swell.
  let arm = ellipsoid(px, y, z, sh + 0.005, 0.475, -0.09, 0.05, 0.07, 0.055);
  arm = smin(
    arm,
    roundCone(px, y, z, sh + 0.01, 0.48, -0.09, elbow[0], elbow[1], elbow[2], 0.045, 0.036),
    0.02,
  );
  arm = smin(
    arm,
    roundCone(px, y, z, elbow[0], elbow[1], elbow[2], wrist[0], wrist[1], wrist[2], 0.037, 0.026),
    0.02,
  );
  // Hand: a flattened palm block from the wrist, a thumb and curled fingers,
  // instead of a single capsule (reads as a hand at close range).
  const ux = tip[0] - wrist[0],
    uy = tip[1] - wrist[1],
    uz = tip[2] - wrist[2];
  const at = (k: number): V3 => [wrist[0] + ux * k, wrist[1] + uy * k, wrist[2] + uz * k];
  const palmA = at(0.12),
    palmB = at(0.62),
    fingersA = at(0.62),
    fingersB = at(1.0);
  let hand = roundCone(px, y, z, ...palmA, ...palmB, 0.021, 0.022);
  hand = smin(hand, roundCone(px, y, z, ...wrist, ...palmA, 0.022, 0.021), 0.008);
  hand = smin(
    hand,
    roundCone(px, y, z, ...fingersA, fingersB[0], fingersB[1] - 0.008, fingersB[2], 0.018, 0.012),
    0.01,
  );
  // Thumb on the inner side (toward the body centre line).
  const thumbBase = at(0.3);
  hand = smin(
    hand,
    roundCone(
      px,
      y,
      z,
      ...thumbBase,
      thumbBase[0] - 0.03,
      thumbBase[1] + 0.006,
      thumbBase[2] + 0.03,
      0.011,
      0.0085,
    ),
    0.008,
  );
  return [arm, hand];
}

function spectatorField(
  variant: 'a' | 'b',
  out?: Float64Array,
  shell: 'body' | 'arms' = 'body',
  pose: SpectatorArmPose = 'rest',
) {
  const fem = variant === 'b';
  const sh = fem ? 0.152 : 0.168; // shoulder half-width
  const headParts: HeadParts = { skin: 1, hair: 1, eye: 1, lips: 1, cap: 1, headset: 1, brow: 1 };
  const headSample = headField(fem ? 'fem-bare' : 'bare', headParts, true);
  return (x: number, y: number, z: number) => {
    const ax = Math.abs(x);
    // Torso (reclined slightly against the seat back), hips on the seat.
    let torso = ellipsoid(ax, y, z, 0, 0.12, -0.055, fem ? 0.165 : 0.155, 0.1, 0.12);
    torso = smin(torso, ellipsoid(ax, y, z, 0, 0.25, -0.065, fem ? 0.13 : 0.14, 0.12, 0.1), 0.05);
    torso = smin(torso, ellipsoid(ax, y, z, 0, 0.4, -0.08, sh - 0.01, 0.13, 0.105), 0.05);
    if (fem) torso = smin(torso, ellipsoid(ax, y, z, 0.055, 0.39, -0.02, 0.06, 0.055, 0.05), 0.03);
    torso = smin(
      torso,
      roundCone(ax, y, z, 0, 0.49, -0.095, sh - 0.02, 0.485, -0.09, 0.055, 0.045),
      0.04,
    );
    torso = smin(torso, roundCone(x, y, z, 0, 0.47, -0.095, 0, 0.6, -0.085, 0.05, 0.045), 0.03); // neck
    // Head on the neck (centre 0.665): the crew head sculpt (skull, orbital
    // hollows, lidded eyes, nose, lips, jaw, carved ears) at spectator scale,
    // with ledge-free hair so the hairline is painted, never stair-stepped.
    const hy = y - 0.665,
      hz = z + 0.06;
    headSample(x / SPECTATOR_HEAD_SCALE, hy / SPECTATOR_HEAD_SCALE, hz / SPECTATOR_HEAD_SCALE);
    const head = Math.min(headParts.skin, headParts.eye) * SPECTATOR_HEAD_SCALE;
    const hair = headParts.hair * SPECTATOR_HEAD_SCALE;
    // Arms (separate shells per pose): shoulder, elbow, forearm, hand.
    const [armL, handL] = spectatorArm(pose, -1, sh, x, y, z);
    const [armR, handR] = spectatorArm(pose, 1, sh, x, y, z);
    const arm = Math.min(armL, armR),
      hand = Math.min(handL, handR);
    // Legs: thighs on the seat, shins down, shoes on the tread.
    const thigh = roundCone(
      ax,
      y,
      z,
      0.085,
      0.1,
      -0.03,
      0.1,
      0.12,
      0.36,
      fem ? 0.078 : 0.074,
      0.055,
    );
    let shin = roundCone(ax, y, z, 0.1, 0.12, 0.36, 0.11, -0.22, 0.4, 0.052, 0.038);
    shin = smin(shin, ellipsoid(ax, y, z, 0.1, 0.0, 0.34, 0.045, 0.08, 0.045), 0.03);
    let foot = roundBox(ax, y, z, 0.11, -0.265, 0.44, 0.045, 0.035, 0.11, 0.03);
    foot = smax(foot, -(y + 0.3), 0.004);
    let cap = 1;
    {
      let crown = ellipsoid(ax, hy, hz, 0, 0.038, -0.012, 0.083, 0.092, 0.106);
      crown = smax(crown, 0.028 + 0.02 * smoothstep(0.0, -0.08, hz) - hy, 0.004);
      const brim = smax(
        ellipsoid(ax, hy, hz, 0, 0.034 - 0.03 * (hz - 0.09), 0.105, 0.08, 0.005, 0.08),
        0.06 - hz,
        0.004,
      );
      cap = Math.min(crown, brim);
    }
    const phone = roundBox(x, y, z, 0.11, 0.226, 0.25, 0.034, 0.0045, 0.07, 0.004);
    if (out) {
      out[SP.Torso] = torso;
      out[SP.Head] = head;
      out[SP.Hair] = hair;
      out[SP.Arm] = arm;
      out[SP.Hand] = hand;
      out[SP.Thigh] = thigh;
      out[SP.Shin] = shin;
      out[SP.Foot] = foot;
      out[SP.Cap] = cap;
      out[SP.Phone] = phone;
    }
    // Arms are a separate closed shell (shoulder ball inside the torso), so a
    // hand resting on a thigh never fuses with it and gestures cannot tear.
    if (shell === 'arms') return smin(arm, hand, 0.012);
    let d = smin(torso, Math.min(head, hair), 0.02);
    d = smin(d, smin(smin(thigh, shin, 0.03), foot, 0.02), 0.04);
    return d;
  };
}

/** Separate accessory shells (shown per spectator by the crowd shader). */
function spectatorCapField(x: number, y: number, z: number, fem = false) {
  // Sized over the hair: a fuller crown over the longer (b) hair mass.
  const k = fem ? 1.08 : 1.02;
  const ax = Math.abs(x) / k,
    hy = (y - 0.665) / k,
    hz = (z + 0.06) / k;
  let crown = ellipsoid(ax, hy, hz, 0, 0.04, -0.012, 0.086, 0.095, 0.109);
  crown = smax(crown, 0.026 + 0.02 * smoothstep(0.0, -0.08, hz) - hy, 0.004);
  const brim = smax(
    ellipsoid(ax, hy, hz, 0, 0.034 - 0.03 * (hz - 0.09), 0.105, 0.08, 0.005, 0.08),
    0.06 - hz,
    0.004,
  );
  return Math.min(crown, brim) * k;
}
function spectatorCupField(x: number, y: number, z: number) {
  // A paper cup held upright in the resting right hand, on the thigh.
  const cup = roundCone(x, y, z, 0.105, 0.205, 0.255, 0.105, 0.31, 0.255, 0.029, 0.035);
  return smax(cup, y - 0.302, 0.003);
}
function spectatorPhoneField(x: number, y: number, z: number) {
  return roundBox(x, y, z, 0.11, 0.228, 0.25, 0.034, 0.0045, 0.07, 0.004);
}

/** Shell order in a spectator mesh; the index is the crowd accessory code. */
export const SPECTATOR_SHELLS = [
  'body',
  'cap',
  'phone',
  'arms-rest',
  'arms-crossed',
  'arms-drink',
  'cup',
] as const;

/** Seat pan, seat back and the tread under a seated spectator (design frame),
 * used only as an occluder when baking ambient occlusion. */
function spectatorSeatField(x: number, y: number, z: number) {
  const pan = roundBox(x, y, z, 0, -0.012, 0.0, 0.21, 0.014, 0.2, 0.01);
  const back = roundBox(x, y, z, 0, 0.2, -0.228, 0.2, 0.2, 0.02, 0.012);
  return Math.min(pan, back, y + 0.3);
}

/** Ambient occlusion from the signed-distance field (Quilez): the fraction of
 * a short normal ray that is closer to some surface than its own length. */
function fieldOcclusion(
  field: Field,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
) {
  let occ = 0;
  for (let i = 1; i <= 6; i++) {
    const h = 0.011 * i;
    const d = field(x + nx * h, y + ny * h, z + nz * h);
    occ += Math.max(0, h - d) / h / 6;
  }
  return Math.max(0.22, Math.min(1, 1 - 1.7 * occ));
}

export function sculptSpectator(
  variant: 'a' | 'b',
  cell: number,
  triangles: number,
  poses = true,
  faceWeight = 6,
): SculptedMesh {
  const field = spectatorField(variant);
  const parts = new Float64Array(SP.Count);
  const probes = (['rest', 'rest', 'rest', 'rest', 'crossed', 'drink', 'rest'] as const).map(
    (pose) => spectatorField(variant, parts, 'body', pose),
  );
  // Faces and hands keep detail; the seat-hidden back gives it up first.
  const importance = (_x: number, y: number, z: number) =>
    y > 0.55 && z > -0.04 ? faceWeight : y > 0.55 ? 2.5 : y > 0.15 && z > 0.15 ? 1.8 : 1;
  const bodyMesh = polygonise(
    field,
    [-0.3, -0.36, -0.22],
    [0.3, 0.81, 0.62],
    cell,
    Math.round(triangles * 0.74),
    importance,
  );
  const sh = variant === 'b' ? 0.152 : 0.168;
  const armShell = (pose: SpectatorArmPose, share: number) => {
    // Hands keep their triangles (fingers and thumb read at close range).
    const joints = [spectatorArmJoints(pose, -1, sh), spectatorArmJoints(pose, 1, sh)];
    const handImportance = (x: number, y: number, z: number) =>
      armCoordinate(joints, x, y, z) > 0.86 ? 3 : 1;
    return polygonise(
      spectatorField(variant, undefined, 'arms', pose),
      [-0.26, 0.14, -0.2],
      [0.26, 0.58, 0.34],
      Math.min(cell, 0.014),
      Math.round(triangles * share),
      handImportance,
    );
  };
  const empty: SculptedMesh = {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
  };
  const armRest = armShell('rest', 0.24);
  const armCrossed = poses ? armShell('crossed', 0.18) : empty;
  const armDrink = empty; // retained slot: the drink is held in the resting hand
  const cupMesh = poses
    ? polygonise(spectatorCupField, [0.05, 0.16, 0.2], [0.16, 0.33, 0.31], 0.006, 60)
    : empty;
  const capMesh = polygonise(
    (x, y, z) => spectatorCapField(x, y, z, variant === 'b'),
    [-0.12, 0.66, -0.2],
    [0.12, 0.83, 0.17],
    Math.min(cell, 0.012),
    Math.round(triangles * 0.08),
  );
  const phoneMesh = polygonise(
    spectatorPhoneField,
    [0.06, 0.2, 0.16],
    [0.16, 0.25, 0.34],
    0.004,
    48,
  );
  const parts3 = [bodyMesh, capMesh, phoneMesh, armRest, armCrossed, armDrink, cupMesh];
  const counts = parts3.map((m) => m.positions.length / 3);
  const mesh: SculptedMesh = {
    positions: new Float32Array(counts.reduce((a, b) => a + b, 0) * 3),
    normals: new Float32Array(counts.reduce((a, b) => a + b, 0) * 3),
    indices: new Uint32Array(parts3.reduce((a, m) => a + m.indices.length, 0)),
  };
  const origin = new Uint8Array(counts.reduce((a, b) => a + b, 0));
  {
    let v = 0,
      k = 0;
    parts3.forEach((m, which) => {
      mesh.positions.set(m.positions, v * 3);
      mesh.normals.set(m.normals, v * 3);
      for (let i = 0; i < m.indices.length; i++) mesh.indices[k + i] = m.indices[i] + v;
      origin.fill(which, v, v + counts[which]);
      v += counts[which];
      k += m.indices.length;
    });
  }
  const n = mesh.positions.length / 3;
  const standing = new Float32Array(n * 3);
  const tags = new Uint8Array(n * 3);
  const zone = new Uint8Array(n);
  const boneSets = [spectatorBones(-1), spectatorBones(1)];
  const q = (from: V3 | null, to: V3 | null) => {
    if (!from || !to) return [0, 0, 0, 1];
    // Quaternion rotating `from` onto `to`.
    const fl = Math.hypot(...from),
      tl = Math.hypot(...to);
    const f = from.map((v) => v / fl),
      t = to.map((v) => v / tl);
    const c = [f[1] * t[2] - f[2] * t[1], f[2] * t[0] - f[0] * t[2], f[0] * t[1] - f[1] * t[0]];
    const w = 1 + f[0] * t[0] + f[1] * t[1] + f[2] * t[2];
    const l = Math.hypot(c[0], c[1], c[2], w);
    return [c[0] / l, c[1] / l, c[2] / l, w / l];
  };
  const rotate = (r: number[], v: number[]) => {
    const [x, y, z, w] = r;
    const ix = w * v[0] + y * v[2] - z * v[1],
      iy = w * v[1] + z * v[0] - x * v[2],
      iz = w * v[2] + x * v[1] - y * v[0],
      iw = -x * v[0] - y * v[1] - z * v[2];
    return [
      ix * w + iw * -x + iy * -z - iz * -y,
      iy * w + iw * -y + iz * -x - ix * -z,
      iz * w + iw * -z + ix * -y - iy * -x,
    ];
  };
  const rotations = boneSets.map((set) => set.map((b) => q(b.dirSeat, b.dirStand)));
  for (let i = 0; i < n; i++) {
    const x = mesh.positions[i * 3],
      y = mesh.positions[i * 3 + 1],
      z = mesh.positions[i * 3 + 2];
    probes[origin[i]](x, y, z);
    const sideIndex = x < 0 ? 0 : 1;
    const bones = boneSets[sideIndex],
      rots = rotations[sideIndex];
    // Part -> bone index in spectatorBones.
    const torsoChest = smoothstep(0.17, 0.32, y);
    const cand: [number, number][] = [
      [parts[SP.Torso], -1],
      [origin[i] === 1 ? -1 : Math.min(parts[SP.Head], parts[SP.Hair]), 2],
      [origin[i] >= 2 ? -1 : origin[i] === 0 ? 1 : Math.min(parts[SP.Arm], parts[SP.Hand]), 6],
      [parts[SP.Thigh], 3],
      [parts[SP.Shin], 4],
      [parts[SP.Foot], 5],
    ];
    const best = Math.min(...cand.map((c) => c[0]));
    const w = new Map<number, number>();
    for (const [d, b] of cand) {
      const k = Math.exp(-(d - best) / 0.012);
      if (b === -1) {
        w.set(0, (w.get(0) ?? 0) + k * (1 - torsoChest));
        w.set(1, (w.get(1) ?? 0) + k * torsoChest);
      } else w.set(b, (w.get(b) ?? 0) + k);
    }
    let sum = 0;
    for (const v of w.values()) sum += v;
    const p = [0, 0, 0];
    for (const [b, k] of w) {
      const bone = bones[b];
      const local = [x - bone.seat[0], y - bone.seat[1], z - bone.seat[2]];
      const r = rotate(rots[b], local);
      p[0] += ((r[0] + bone.stand[0]) * k) / sum;
      p[1] += ((r[1] + bone.stand[1]) * k) / sum;
      p[2] += ((r[2] + bone.stand[2]) * k) / sum;
    }
    // Export frame: facing -X, lateral Z.
    standing.set([-p[2], p[1], p[0]], i * 3);
    // Tags: crowd joint (0 body, 1 left arm, 2 right arm, 3 head), skin mask
    // (0 cloth, 1 skin, 2 hair), accessory (0 none, 1 cap, 2 phone).
    const headPart = Math.min(parts[SP.Head], parts[SP.Hair]);
    // Shells: 0 body, 1 cap, 2 phone, 3-5 arm poses, 6 cup (= accessory code).
    const isArm = origin[i] >= 3 && origin[i] <= 5;
    const isHead = origin[i] === 1 || (origin[i] === 0 && headPart < parts[SP.Torso] && y > 0.56);
    const joint = isHead ? 3 : origin[i] === 2 || origin[i] === 6 ? 2 : isArm ? (x < 0 ? 1 : 2) : 0;
    const accessory = origin[i];
    const skin = isArm
      ? parts[SP.Hand] < parts[SP.Arm]
        ? 1
        : 0
      : accessory
        ? 0
        : isHead && parts[SP.Hair] < parts[SP.Head] - 0.0008
          ? 2
          : isHead ||
              (parts[SP.Hand] < parts[SP.Arm] && isArm) ||
              (y > 0.53 && parts[SP.Torso] < 0.02 && Math.abs(x) < 0.06 && z > -0.11)
            ? 1
            : 0;
    tags.set([joint, skin, accessory], i * 3);
    // Garment zones: 0 top, 1 trousers, 2 shoes, 3 forearm (sleeve or skin), 4 shin (trouser or skin).
    zone[i] = isArm
      ? y < 0.29
        ? 3
        : 0
      : isHead
        ? 0
        : parts[SP.Foot] < Math.min(parts[SP.Shin], parts[SP.Thigh])
          ? 2
          : parts[SP.Shin] < parts[SP.Thigh] && parts[SP.Shin] < parts[SP.Torso]
            ? 4
            : parts[SP.Thigh] < parts[SP.Torso] || y < 0.15
              ? 1
              : isArm && y < 0.29
                ? 3
                : 0;
  }
  // Baked surface data: SDF ambient occlusion against the body, the resting
  // (or folded) arms and the seat; the arm coordinate for sleeves and hands;
  // the build (for the painted hair line).
  const surface = new Uint8Array(n * 3);
  {
    const arms = (['rest', 'crossed'] as const).map((pose) =>
      spectatorField(variant, undefined, 'arms', pose),
    );
    const armJoints = (['rest', 'crossed'] as const).map((pose) => [
      spectatorArmJoints(pose, -1, sh),
      spectatorArmJoints(pose, 1, sh),
    ]);
    const occluders = arms.map(
      (armField) => (x: number, y: number, z: number) =>
        Math.min(field(x, y, z), armField(x, y, z), spectatorSeatField(x, y, z)),
    );
    const bodyOnly = (x: number, y: number, z: number) =>
      Math.min(field(x, y, z), spectatorSeatField(x, y, z));
    for (let i = 0; i < n; i++) {
      const x = mesh.positions[i * 3],
        y = mesh.positions[i * 3 + 1],
        z = mesh.positions[i * 3 + 2];
      const nx = mesh.normals[i * 3],
        ny = mesh.normals[i * 3 + 1],
        nz = mesh.normals[i * 3 + 2];
      const pose = origin[i] === 4 ? 1 : 0;
      // Resting arms shade the body only half as much: a third of the crowd
      // folds them instead.
      let ao = fieldOcclusion(occluders[pose], x, y, z, nx, ny, nz);
      if (origin[i] === 0) ao = (ao + fieldOcclusion(bodyOnly, x, y, z, nx, ny, nz)) / 2;
      const isArm = origin[i] >= 3 && origin[i] <= 5;
      const t = isArm ? armCoordinate(armJoints[pose], x, y, z) : 0;
      surface.set([Math.round(ao * 255), Math.round(t * 255), variant === 'b' ? 255 : 0], i * 3);
      // Soften the shoulder seam where the separate arm shell meets the body:
      // each side's normals lean toward the other surface's near the junction,
      // so shading is continuous across the crease.
      if (origin[i] === 0 || isArm) {
        const other = origin[i] === 0 ? arms[pose] : field;
        const d = other(x, y, z);
        const w = 0.5 * (1 - smoothstep(0.002, 0.02, Math.abs(d))) * smoothstep(0.36, 0.44, y);
        if (w > 0) {
          const e = 0.002;
          const g = [
            other(x + e, y, z) - other(x - e, y, z),
            other(x, y + e, z) - other(x, y - e, z),
            other(x, y, z + e) - other(x, y, z - e),
          ];
          const gl = Math.hypot(g[0], g[1], g[2]) || 1;
          const nn = [0, 1, 2].map((k) => mesh.normals[i * 3 + k] * (1 - w) + (g[k] / gl) * w);
          const nl = Math.hypot(nn[0], nn[1], nn[2]) || 1;
          for (let k = 0; k < 3; k++) mesh.normals[i * 3 + k] = nn[k] / nl;
        }
      }
    }
  }
  // Standing normals from the standing surface itself.
  const sn = new Float32Array(n * 3);
  const idx = mesh.indices;
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f] * 3,
      b = idx[f + 1] * 3,
      c = idx[f + 2] * 3;
    const ux = standing[b] - standing[a],
      uy = standing[b + 1] - standing[a + 1],
      uz = standing[b + 2] - standing[a + 2];
    const vx = standing[c] - standing[a],
      vy = standing[c + 1] - standing[a + 1],
      vz = standing[c + 2] - standing[a + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      sn[v] += nx;
      sn[v + 1] += ny;
      sn[v + 2] += nz;
    }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(sn[i * 3], sn[i * 3 + 1], sn[i * 3 + 2]) || 1;
    sn[i * 3] /= l;
    sn[i * 3 + 1] /= l;
    sn[i * 3 + 2] /= l;
  }
  // Seated geometry into the export frame.
  const positions = new Float32Array(n * 3),
    normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions.set(
      [-mesh.positions[i * 3 + 2], mesh.positions[i * 3 + 1], mesh.positions[i * 3]],
      i * 3,
    );
    normals.set([-mesh.normals[i * 3 + 2], mesh.normals[i * 3 + 1], mesh.normals[i * 3]], i * 3);
  }
  // The frame change is a proper rotation (det +1): winding is preserved.
  return {
    positions,
    normals,
    indices: mesh.indices,
    standing,
    standingNormal: sn,
    tags,
    zone,
    surface,
  };
}
