import * as T from 'three';
import { batchBikeRigidMeshes } from './bike-rigid-batch.ts';
import { sampleProfile } from './profile-sampling.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';
import type { RiderDetail } from './rider.ts';

/** Metres in the existing ankle frame: +Y points down the shin, +Z to the toe.
 * A shaped forefoot, Achilles volume and calf cuff replace the rounded-box
 * shoe. The mesh changes no skeleton, peg, grip, collision or recovery anchor. */
type Section = readonly [number, number, number, number, number];
function loft(sections: readonly Section[], axis: 'y' | 'z', rows: number, sides: number) {
  const stations = sections.map((s) => s[0]);
  const p: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const along = T.MathUtils.lerp(stations[0], stations[stations.length - 1], i / rows);
    const [centre, width, up, down] = [1, 2, 3, 4].map((k) =>
      sampleProfile(
        stations,
        sections.map((s) => s[k]),
        along,
      ),
    );
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2,
        c = Math.cos(a),
        s = Math.sin(a);
      const x = c * width,
        depth = centre + s * (s >= 0 ? up : down);
      p.push(x, axis === 'y' ? along : depth, axis === 'y' ? depth : along);
      uv.push(j / sides, i / rows);
    }
  }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      if (axis === 'z') index.push(a, a + 1, b, a + 1, b + 1, b);
      else index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const FOOT: readonly Section[] = [
  [-0.094, -0.013, 0.002, 0.003, 0.003],
  [-0.076, -0.015, 0.032, 0.037, 0.04],
  [-0.041, -0.015, 0.041, 0.039, 0.051],
  [0.014, -0.014, 0.042, 0.039, 0.05],
  [0.075, -0.007, 0.046, 0.032, 0.043],
  [0.135, -0.001, 0.047, 0.026, 0.035],
  [0.178, 0.004, 0.035, 0.02, 0.023],
  [0.198, 0.006, 0.003, 0.003, 0.003],
];
const CUFF: readonly Section[] = [
  [-0.225, -0.035, 0.035, 0.032, 0.036],
  [-0.21, -0.035, 0.047, 0.039, 0.043],
  [-0.155, -0.032, 0.046, 0.037, 0.046],
  [-0.095, -0.026, 0.04, 0.035, 0.039],
  [-0.052, -0.024, 0.035, 0.04, 0.036],
  [-0.014, -0.018, 0.029, 0.05, 0.032],
];

export const GP_BOOT_ENVELOPE = Object.freeze({ width: 0.116, length: 0.3, height: 0.27 });
export function gpRacingBoot(
  detail: RiderDetail,
  side: -1 | 1,
  materials: {
    leather: T.Material;
    panel: T.Material;
    sole: T.Material;
    armour: T.Material;
    slider: T.Material;
  },
) {
  if (side !== -1 && side !== 1) throw new RangeError('Invalid racing boot side');
  const root = new T.Group();
  root.name = `GP ${side > 0 ? 'left' : 'right'} articulated racing boot`;
  const close = detail === 'high',
    sides = close ? 16 : detail === 'mid' ? 10 : 8;
  const add = (g: T.BufferGeometry, m: T.Material, name: string) => {
    const mesh = new T.Mesh(g, m);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  add(loft(FOOT, 'z', close ? 19 : 10, sides), materials.leather, 'Anatomical forefoot and heel');
  add(loft(CUFF, 'y', close ? 14 : 8, sides), materials.panel, 'Tapered calf and Achilles cuff');
  const sole = FOOT.map(([z, , w]) => [z, 0.028, w * 1.02, 0.0045, 0.005] as const);
  add(loft(sole, 'z', close ? 15 : 8, sides), materials.sole, 'Thin shaped traction sole');
  if (detail === 'far') {
    batchBikeRigidMeshes(root);
    return root;
  }
  // Conformal ankle protection is a shallow cap, never a spherical joint.
  const ankle = add(
    new T.SphereGeometry(0.022, close ? 12 : 8, 6),
    materials.armour,
    'External ankle protection',
  );
  ankle.scale.set(0.16, 1, 0.88);
  ankle.position.set(side * 0.044, -0.083, -0.037);
  const toe = add(
    new T.SphereGeometry(0.023, close ? 12 : 8, 6),
    materials.slider,
    'Replaceable toe slider',
  );
  toe.scale.set(0.22, 0.34, 1.4);
  toe.position.set(side * 0.046, -0.013, 0.144);
  const heel = add(
    loft(
      [
        [-0.091, -0.004, 0.001, 0.003, 0.003],
        [-0.078, -0.014, 0.035, 0.026, 0.027],
        [-0.06, -0.02, 0.038, 0.024, 0.032],
        [-0.044, -0.022, 0.027, 0.017, 0.025],
      ],
      'z',
      5,
      sides,
    ),
    materials.armour,
    'Moulded heel counter',
  );
  heel.position.z = -0.001;
  if (close) {
    // The instep folds span the foot, following its actual upper profile.
    for (let rib = 0; rib < 5; rib++) {
      const z = -0.01 + rib * 0.02,
        points: T.Vector3[] = [];
      for (let j = 0; j <= 6; j++) {
        const x = ((j / 6) * 2 - 1) * 0.036;
        points.push(new T.Vector3(x, -0.051 + (x / 0.041) ** 2 * 0.026 + rib * 0.004, z));
      }
      add(
        new T.TubeGeometry(new T.CatmullRomCurve3(points), 6, 0.0018, 4, false),
        materials.sole,
        'Moulded instep flex rib',
      );
    }
    const seam = new T.CatmullRomCurve3([
      new T.Vector3(-side * 0.039, -0.207, -0.035),
      new T.Vector3(-side * 0.044, -0.15, -0.035),
      new T.Vector3(-side * 0.038, -0.085, -0.03),
      new T.Vector3(-side * 0.032, -0.04, -0.016),
    ]);
    add(
      new T.TubeGeometry(seam, 10, 0.0013, 4, false),
      materials.sole,
      'Recessed inner boot closure',
    );
  }
  batchBikeRigidMeshes(root);
  return root;
}

/** Original object-space leather grain: actual millimetre scale rather than
 * large UV-stretched perforation dots. Derivative attenuation prevents crawl
 * and the normal gradient is bounded. Install after cloning suit materials;
 * the weather hook chains afterward without replacing this shader. */
export function installGpLeatherFinish(material: T.MeshPhysicalMaterial) {
  chainShaderHook(material, 'gp-leathers-metre-grain-v1', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec3 vGpLeatherBind;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vGpLeatherBind = position;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `
varying vec3 vGpLeatherBind;
float gpLeatherHeight;
float gpLeatherHash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
float gpLeatherNoise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(gpLeatherHash(i),gpLeatherHash(i+vec3(1,0,0)),f.x),
    mix(gpLeatherHash(i+vec3(0,1,0)),gpLeatherHash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(gpLeatherHash(i+vec3(0,0,1)),gpLeatherHash(i+vec3(1,0,1)),f.x),
    mix(gpLeatherHash(i+vec3(0,1,1)),gpLeatherHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `
{
  float px = length(fwidth(vGpLeatherBind));
  float fine = 1. - smoothstep(.0012,.005,px);
  float meso = 1. - smoothstep(.009,.035,px);
  float grain = gpLeatherNoise(vGpLeatherBind*510.);
  float drape = sin(vGpLeatherBind.y*180. + gpLeatherNoise(vGpLeatherBind*22.)*5.);
  gpLeatherHeight = (grain-.5)*.00007*fine + drape*.00032*meso;
  diffuseColor.rgb *= 1. + (grain-.5)*.045*fine;
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `
{
  vec3 dx=dFdx(-vViewPosition), dy=dFdy(-vViewPosition);
  vec3 r1=cross(dy,normal), r2=cross(normal,dx);
  float det=dot(dx,r1);
  vec3 gradient=sign(det)*(dFdx(gpLeatherHeight)*r1+dFdy(gpLeatherHeight)*r2);
  normal=normalize(max(abs(det),1.e-10)*normal-gradient);
}`,
      'fragment',
    );
  });
  return material;
}
