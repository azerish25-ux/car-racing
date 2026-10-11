import * as T from 'three';

/** Procedural moulded stadium seat: a one-piece injection-moulded plastic
 * shell (dished pan with raised side bolsters and a rolled front lip, a
 * contoured backrest that wraps at the sides) with a real wall thickness and
 * rim, on a galvanised pedestal with a floor plate. Local frame of the
 * grandstand seat matrices: facing -X (backrest toward +X), lateral Z, the
 * seat reference at the origin and the tread 0.3 m below.
 *
 * Tier 0 is the close-up shell, tier 1 a coarser shell, tier 2 a far shell
 * on a bare stem. Vertex attribute `seatPart`: 0 plastic, 1 steel. */
export type SeatTier = 0 | 1 | 2;

const PROFILE: readonly [number, number][] = [
  [-0.216, -0.034],
  [-0.207, -0.006],
  [-0.178, 0.011],
  [-0.09, 0.012],
  [0.03, 0.004],
  [0.12, 0.004],
  [0.165, 0.03],
  [0.19, 0.1],
  [0.204, 0.22],
  [0.215, 0.35],
  [0.21, 0.418],
];
/** Profile parameter where the pan ends and the backrest begins. */
const PAN_END = 0.55;
const THICKNESS = 0.011;

function profile(v: number, out: T.Vector2) {
  const n = PROFILE.length - 1;
  const f = Math.min(n - 1e-6, Math.max(0, v * n));
  const i = Math.floor(f),
    t = f - i;
  const p0 = PROFILE[Math.max(0, i - 1)],
    p1 = PROFILE[i],
    p2 = PROFILE[i + 1],
    p3 = PROFILE[Math.min(n, i + 2)];
  // Centripetal-free uniform Catmull-Rom: smooth, passes through the points.
  const cr = (a: number, b: number, c: number, d: number) =>
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t * t +
      (-a + 3 * b - 3 * c + d) * t ** 3);
  return out.set(cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]));
}

/** Point on the moulded top (occupant-side) surface at (lateral s in -1..1, profile v). */
function shellPoint(s: number, v: number, out: T.Vector3) {
  const p = profile(v, new T.Vector2());
  const back = smoothRamp(PAN_END - 0.06, PAN_END + 0.08, v);
  const width = 0.205 - 0.014 * back - 0.012 * smoothRamp(0.9, 1, v);
  const s2 = s * s;
  // Pan: side bolsters rise; backrest: the sides wrap forward.
  const rise = (1 - back) * 0.026 * s2 * s2 * smoothRamp(0.1, 0.25, v);
  const wrap = back * 0.034 * s2;
  return out.set(p.x - wrap, p.y + rise, s * width);
}
function smoothRamp(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

interface Builder {
  position: number[];
  normal: number[];
  uv: number[];
  part: number[];
  index: number[];
}
function grid(
  b: Builder,
  nu: number,
  nv: number,
  at: (u: number, v: number, out: T.Vector3) => T.Vector3,
  flip: boolean,
  part: number,
) {
  const base = b.position.length / 3;
  const p = new T.Vector3();
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      at(i / nu, j / nv, p);
      b.position.push(p.x, p.y, p.z);
      b.normal.push(0, 0, 0);
      b.uv.push(i / nu, j / nv);
      b.part.push(part);
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i,
        c = a + nu + 1;
      if (flip) b.index.push(a, a + 1, c, a + 1, c + 1, c);
      else b.index.push(a, c, a + 1, a + 1, c, c + 1);
    }
}

/** Offset of the top surface toward the underside (approximate wall normal). */
function undersidePoint(s: number, v: number, out: T.Vector3) {
  const e = 1e-3;
  const a = shellPoint(s, v, new T.Vector3());
  const du = shellPoint(Math.min(1, s + e), v, new T.Vector3()).sub(
    shellPoint(Math.max(-1, s - e), v, new T.Vector3()),
  );
  const dv = shellPoint(s, Math.min(1, v + e), new T.Vector3()).sub(
    shellPoint(s, Math.max(0, v - e), new T.Vector3()),
  );
  // Occupant side normal is du x dv (points up on the pan, forward on the back).
  const n = new T.Vector3().crossVectors(dv, du).normalize();
  return out.copy(a).addScaledVector(n, -THICKNESS);
}

export function stadiumSeatGeometry(tier: SeatTier): T.BufferGeometry {
  if (![0, 1, 2].includes(tier)) throw new Error('Invalid seat tier');
  const [nu, nv] = tier === 0 ? [8, 12] : tier === 1 ? [5, 7] : [2, 3];
  const b: Builder = { position: [], normal: [], uv: [], part: [], index: [] };
  const s = (u: number) => u * 2 - 1;
  // Occupant surface, underside and the rolled rim around all four edges.
  grid(b, nu, nv, (u, v, o) => shellPoint(s(u), v, o), false, 0);
  grid(b, nu, nv, (u, v, o) => undersidePoint(s(u), v, o), true, 0);
  const rim = (along: (t: number) => [number, number], n: number, flip: boolean) =>
    grid(
      b,
      n,
      1,
      (t, w, o) => {
        const [su, sv] = along(t);
        return w === 0 ? shellPoint(su, sv, o) : undersidePoint(su, sv, o);
      },
      flip,
      0,
    );
  rim((t) => [-1, t], nv, false);
  rim((t) => [1, t], nv, true);
  rim((t) => [s(t), 0], nu, true);
  rim((t) => [s(t), 1], nu, false);
  {
    // Galvanised pedestal: a stem under the pan, a short cantilever arm to
    // the backrest and a floor plate on the tread (the far tier keeps a
    // three-sided stem so the shell never floats).
    const sides = tier === 0 ? 8 : tier === 1 ? 5 : 3;
    const tube = (a: T.Vector3, c: T.Vector3, r: number) => {
      const axis = new T.Vector3().subVectors(c, a);
      const q = new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        axis.clone().normalize(),
      );
      grid(
        b,
        sides,
        1,
        (u, w, o) => {
          const angle = u * Math.PI * 2;
          return o
            .set(Math.cos(angle) * r, w * axis.length(), Math.sin(angle) * r)
            .applyQuaternion(q)
            .add(a);
        },
        true,
        1,
      );
    };
    tube(new T.Vector3(0.02, -0.3, 0), new T.Vector3(0.02, -0.004, 0), 0.026);
    if (tier < 2) tube(new T.Vector3(0.02, -0.07, 0), new T.Vector3(0.13, -0.03, 0), 0.016);
    // Floor plate (top face only; it sits on the tread).
    if (tier < 2)
      grid(b, 1, 1, (u, v, o) => o.set(0.02 + (v - 0.5) * 0.16, -0.296, (u - 0.5) * 0.16), true, 1);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(b.position, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(b.normal, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('seatPart', new T.Float32BufferAttribute(b.part, 1));
  g.setIndex(b.index);
  g.computeVertexNormals();
  g.name = `Moulded stadium seat tier ${tier}`;
  g.userData.procedural = 'stadium-seat';
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Stadium plastic: a satin, slightly mottled moulding with sun-bleached
 * up-facing surfaces; steel parts read as galvanised metal. Instance colour
 * tints only the plastic. No textures, no extra draws. */
export function installStadiumSeat<M extends T.MeshStandardMaterial>(material: M): M {
  if (material.userData.stadiumSeat) return material;
  material.userData.stadiumSeat = true;
  const previous = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float seatPart;\nvarying float vSeatPart;\nvarying vec3 vSeatLocal;\nvarying float vSeatUp;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSeatPart = seatPart;\nvSeatLocal = position;',
      )
      .replace(
        '#include <defaultnormal_vertex>',
        '#include <defaultnormal_vertex>\nvSeatUp = inverseTransformDirection(transformedNormal, viewMatrix).y;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vSeatPart;
varying vec3 vSeatLocal;
varying float vSeatUp;
float seatNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  float n = dot(i, vec3(1., 57., 113.));
  vec4 a = fract(sin(vec4(n, n + 1., n + 57., n + 58.)) * 43758.5453);
  vec4 b = fract(sin(vec4(n + 113., n + 114., n + 170., n + 171.)) * 43758.5453);
  vec4 m = mix(a, b, f.z);
  vec2 e = mix(m.xz, m.yw, f.x);
  return mix(e.x, e.y, f.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float seatSteel = step(.5, vSeatPart);
float seatMottle = seatNoise(vSeatLocal * 38.) * .6 + seatNoise(vSeatLocal * 150.) * .4;
// Sun-bleached, chalky tops; a slightly deeper colour in the moulded hollows.
float seatSun = smoothstep(.2, .9, vSeatUp);
vec3 seatPlastic = diffuseColor.rgb * (.9 + .14 * seatMottle);
seatPlastic = mix(seatPlastic, vec3(dot(seatPlastic, vec3(.3, .59, .11))) * 1.15 + .012, seatSun * .16);
diffuseColor.rgb = mix(seatPlastic, vec3(.34, .36, .37) * (.85 + .25 * seatMottle), seatSteel);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(.36 + .1 * seatMottle + .1 * seatSun, .42 + .12 * seatMottle, seatSteel);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, .75, seatSteel);',
      );
  };
  material.customProgramCacheKey = () => `${key}|stadium-seat-v1`;
  material.needsUpdate = true;
  return material;
}
