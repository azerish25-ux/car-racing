import * as T from 'three';
import kit from './human-kit.json' with { type: 'json' };

/** Procedural people kit: SDF-sculpted, QEM-decimated bodies, heads and
 * gloved hands baked by scripts/author-humans.ts. Bodies are skinned to the
 * shared 15-bone crew skeleton (four normalised influences); heads and hands
 * are rigid instances on the head and wrist joints. Decoding is synchronous
 * and buffers are owned by each returned geometry. */
export const HUMAN_KIT = Object.freeze({
  source: kit.source,
  sha256: kit.sha256,
  procedural: true,
});
export type CrewKitStyle = 'polo' | 'suit' | 'polof';
export type HeadWear = 'bare' | 'cap' | 'headset' | 'cap-headset' | 'fem-bare' | 'fem-headset';
export type HumanLod = 0 | 1 | 2;
export type HumanKitMesh = keyof typeof kit.meshes;

interface PackedMesh {
  vertices: number;
  triangles: number;
  min: number[];
  max: number[];
  position: string;
  normal: string;
  index: string;
  joints?: string;
  weights?: string;
  cloth?: string;
  standing?: string;
  standingNormal?: string;
  standingMin?: number[];
  standingMax?: number[];
  tags?: string;
  zone?: string;
}

function bytes(text: string) {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function dequantise(text: string, min: readonly number[], max: readonly number[], n: number) {
  const q = new Uint16Array(bytes(text).buffer);
  if (q.length !== n * 3) throw new Error('Invalid human kit positions');
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const a = i % 3;
    out[i] = min[a] + (q[i] / 65535) * (max[a] - min[a]);
  }
  return out;
}

/** Decode one baked mesh into an owned, validated geometry. */
export function humanKitGeometry(name: HumanKitMesh): T.BufferGeometry {
  const data = (kit.meshes as Record<string, PackedMesh>)[name];
  if (!data) throw new Error(`Unknown human kit mesh: ${name}`);
  const n = data.vertices;
  const g = new T.BufferGeometry();
  g.setAttribute(
    'position',
    new T.BufferAttribute(dequantise(data.position, data.min, data.max, n), 3),
  );
  const normal = new Int8Array(bytes(data.normal).buffer);
  if (normal.length !== n * 3) throw new Error('Invalid human kit normals');
  g.setAttribute('normal', new T.BufferAttribute(normal, 3, true));
  const index = new Uint16Array(bytes(data.index).buffer);
  if (index.length !== data.triangles * 3 || index.some((i) => i >= n))
    throw new Error('Invalid human kit index');
  g.setIndex(new T.BufferAttribute(index, 1));
  if (data.joints && data.weights) {
    const joints = bytes(data.joints),
      weights = bytes(data.weights);
    if (joints.length !== n * 4 || weights.length !== n * 4 || joints.some((j) => j >= 15))
      throw new Error('Invalid human kit skin');
    g.setAttribute('crewJoint', new T.BufferAttribute(joints, 4));
    g.setAttribute('crewWeight', new T.BufferAttribute(weights, 4, true));
  }
  if (data.cloth) {
    const cloth = bytes(data.cloth);
    g.setAttribute(
      'crewCloth',
      new T.BufferAttribute(
        Float32Array.from(cloth, (c) => c / 255),
        1,
      ),
    );
  }
  if (data.standing && data.standingMin && data.standingMax && data.standingNormal) {
    g.setAttribute(
      'standingPosition',
      new T.BufferAttribute(dequantise(data.standing, data.standingMin, data.standingMax, n), 3),
    );
    g.setAttribute(
      'standingNormal',
      new T.BufferAttribute(new Int8Array(bytes(data.standingNormal).buffer), 3, true),
    );
  }
  if (data.tags)
    g.setAttribute('crowdPerson', new T.BufferAttribute(Float32Array.from(bytes(data.tags)), 3));
  // White albedo: kit, skin and hair colours are resolved in the shaders.
  g.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.name = `Procedural ${name}`;
  g.userData = { procedural: HUMAN_KIT.source, sourceSha256: HUMAN_KIT.sha256, authoredRole: name };
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function crewBodyGeometry(style: CrewKitStyle, lod: HumanLod) {
  const g = humanKitGeometry(`body_${style}_${lod}` as HumanKitMesh);
  // Real UVs for any consumer that samples them: cylindrical about the body.
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = Math.atan2(p.getX(i), p.getZ(i)) / (2 * Math.PI) + 0.5;
    uv[i * 2 + 1] = p.getY(i) / 1.75;
  }
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  return g;
}
export function humanHeadGeometry(wear: HeadWear, lod: HumanLod) {
  return humanKitGeometry(`head_${wear}_${lod}` as HumanKitMesh);
}
/** Gloved hand in the crew glove frame; the left hand is real mirrored topology. */
export function crewHandGeometry(lod: 0 | 1, left = false, bare = false) {
  const g = humanKitGeometry(`${bare ? 'handbare' : 'hand'}_${lod}` as HumanKitMesh);
  const p = g.getAttribute('position'),
    c = g.getAttribute('color');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = Math.atan2(p.getX(i), p.getZ(i)) / (2 * Math.PI) + 0.5;
    uv[i * 2 + 1] = (p.getY(i) + 0.13) / 0.25;
  }
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  // Charcoal technical glove with a lighter elastic cuff band.
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const v = y < -0.06 && y > -0.08 ? 0.12 : 0.035;
    c.setXYZ(i, v, v, v * 1.06);
  }
  if (left) {
    g.scale(-1, 1, 1);
    const index = g.index!;
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    g.name += ' left';
  }
  return g;
}

/** Seated spectator with its standing correspondence and crowd tags
 * (joint, skin mask, accessory). Garment zones are carried in color.r. */
export function spectatorKitGeometry(variant: 'a' | 'b', lod: HumanLod) {
  const name = `spectator_${variant}_${lod}` as HumanKitMesh;
  const g = humanKitGeometry(name);
  const data = (kit.meshes as Record<string, PackedMesh>)[name];
  const zone = data.zone ? bytes(data.zone) : new Uint8Array(g.getAttribute('position').count);
  const c = g.getAttribute('color');
  for (let i = 0; i < c.count; i++) c.setXYZ(i, zone[i] / 4, 0, 0);
  return g;
}

/** Deterministic skin and hair tones from a person id (GLSL). */
export const HUMAN_TONE_GLSL = `
float humanHash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
vec3 humanSkinTone(float id) {
  // Low-discrepancy (golden-ratio) selection: exact in float32 and in JS,
  // so separately drawn hands match the face (see humanSkinToneRGB).
  // Measured-looking sRGB skin albedos (not saturated orange), linearised.
  float h = fract(id * 0.6180339887 + 0.37) * 5.;
  vec3 s0 = vec3(.91,.76,.67), s1 = vec3(.83,.64,.53), s2 = vec3(.70,.51,.39);
  vec3 s3 = vec3(.55,.38,.28), s4 = vec3(.38,.26,.19), s5 = vec3(.25,.17,.13);
  vec3 tone = h < 1. ? mix(s0, s1, h) : h < 2. ? mix(s1, s2, h - 1.) : h < 3. ? mix(s2, s3, h - 2.)
    : h < 4. ? mix(s3, s4, h - 3.) : mix(s4, s5, h - 4.);
  return pow(tone, vec3(2.2));
}
vec3 humanHairTone(float id) {
  float h = humanHash(id + 5.17);
  vec3 tone = h < .45 ? vec3(.06,.045,.035) : h < .75 ? vec3(.17,.11,.07) : h < .9 ? vec3(.42,.30,.18) : vec3(.38,.37,.36);
  return tone * tone;
}
`;

/** CPU mirror of GLSL humanSkinTone (linear RGB), for bare hands. */
export function humanSkinToneRGB(id: number, out = new T.Color()) {
  const h = ((((id * 0.6180339887 + 0.37) % 1) + 1) % 1) * 5;
  const stops = [
    [0.91, 0.76, 0.67],
    [0.83, 0.64, 0.53],
    [0.7, 0.51, 0.39],
    [0.55, 0.38, 0.28],
    [0.38, 0.26, 0.19],
    [0.25, 0.17, 0.13],
  ];
  const k = Math.min(4, Math.floor(h)),
    t = h - k;
  const tone = stops[k].map((v, i) => v + (stops[k + 1][i] - v) * t);
  return out.setRGB(tone[0] ** 2.2, tone[1] ** 2.2, tone[2] ** 2.2, T.LinearSRGBColorSpace);
}

/** Skin wrap lighting: a soft terminator with warm scattered light instead of
 * a hard Lambert falloff. Applied only where `mask` (a GLSL float) is set. */
export function skinWrapLighting(fragmentShader: string, mask: string) {
  const chunk = T.ShaderChunk.lights_physical_pars_fragment;
  const target =
    'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
  if (!chunk.includes(target)) return fragmentShader;
  const wrapped = chunk.replace(
    target,
    `{
      float skinNL = dot( geometryNormal, directLight.direction );
      vec3 skinWrap = vec3( saturate( ( skinNL + .3 ) / 1.3 ), saturate( ( skinNL + .18 ) / 1.18 ), saturate( ( skinNL + .14 ) / 1.14 ) );
      skinWrap *= skinWrap;
      vec3 skinIrradiance = mix( irradiance, skinWrap * directLight.color, ${mask} );
      reflectedLight.directDiffuse += skinIrradiance * BRDF_Lambert( material.diffuseColor );
    }`,
  );
  return fragmentShader.replace('#include <lights_physical_pars_fragment>', wrapped);
}

/** Head material: zones (skin, hair, eyes, lips, brows, cap, headset) are
 * resolved analytically from the rigid head's local position, so features
 * stay crisp at every LOD. Per instance: `headPerson` (tone id) and the
 * instance colour (team colour for the cap and headset accents). */
export function installHumanHead(material: T.MeshStandardMaterial, wear: HeadWear) {
  const cap = wear === 'cap' || wear === 'cap-headset';
  const set = wear === 'headset' || wear === 'cap-headset' || wear === 'fem-headset';
  const fem = wear.startsWith('fem');
  material.vertexColors = false;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float headPerson;\nvarying float vHeadPerson;\nvarying vec3 vHeadLocal;\nvarying vec3 vHeadTeam;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vHeadLocal = position; vHeadPerson = headPerson;
#ifdef USE_INSTANCING_COLOR
vHeadTeam = instanceColor.rgb;
#else
vHeadTeam = vec3(.1,.12,.2);
#endif`,
      );
    shader.fragmentShader =
      (cap ? '#define HEAD_CAP\n' : '') +
      (set ? '#define HEAD_SET\n' : '') +
      (fem ? '#define HEAD_FEM\n' : '') +
      `varying float vHeadPerson;\nvarying vec3 vHeadLocal;\nvarying vec3 vHeadTeam;\nfloat vHeadSkin;\n${HUMAN_TONE_GLSL}
float headSeg(vec3 p, vec3 a, vec3 b) { vec3 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
float headEll(vec3 p, vec3 c, vec3 r) { vec3 q = (p - c) / r; return (length(q) - 1.) * min(r.x, min(r.y, r.z)); }
` +
      shader.fragmentShader;
    shader.fragmentShader = skinWrapLighting(shader.fragmentShader, 'vHeadSkin');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 hp = vHeadLocal; vec3 hq = vec3(abs(hp.x), hp.y, hp.z);
vec3 skin = humanSkinTone(vHeadPerson);
vec3 col = skin;
// Skin roughness: a glossier T-zone (forehead, nose), softer cheeks.
float tzone = max(smoothstep(.02, .0, abs(hp.x)) * step(-.03, hp.y) * step(hp.y, .07),
  smoothstep(.03, .01, abs(hp.y - .045)) * smoothstep(.05, .02, hq.x));
float rough = mix(.6, .44, tzone * smoothstep(.06, .09, hp.z));
vHeadSkin = 1.;
// Subtle anatomy tints: warmer cheeks, nose and ears, cooler jaw shadow.
col *= mix(vec3(1.), vec3(1.05,.95,.93), smoothstep(.02,-.01,headEll(hq, vec3(.038,-.03,.06), vec3(.025,.022,.025))));
col *= mix(vec3(1.), vec3(1.06,.92,.9), smoothstep(.012,.0,length(hq - vec3(0.,-.024,.104)) - .012));
col *= mix(vec3(1.), vec3(.9,.9,.93), smoothstep(-.07,-.1,hp.y) * step(.04,hp.z) * 0.6);
// Lips.
float lip = min(headEll(hq, vec3(0.,-.0505,.0862), vec3(.0195,.0052,.009)), headEll(hq, vec3(0.,-.0605,.084), vec3(.0175,.006,.0092)));
float lipMask = smoothstep(.0012,-.0006,lip) * step(.08, hp.z);
#ifdef HEAD_FEM
col = mix(col, skin * vec3(.8,.5,.5), lipMask);
#else
col = mix(col, skin * vec3(.86,.64,.6), lipMask);
#endif
rough = mix(rough, .4, lipMask);
float mouthLine = (1. - smoothstep(.0009, .0022, abs(hp.y + .0556))) * smoothstep(.0205, .017, hq.x) * step(.08, hp.z);
col = mix(col, skin * vec3(.28, .16, .15), mouthLine);
// Brows (follow the ridge), with stubble on darker-haired people.
vec3 hair = humanHairTone(vHeadPerson);
float brow = headSeg(hq, vec3(.014,.0295,.0965), vec3(.05,.0315,.084));
float browArch = brow - .0012 * sin(clamp((hq.x - .014) / .036, 0., 1.) * 3.1416);
#ifdef HEAD_FEM
col = mix(col, mix(col, hair, .65), smoothstep(.0028,.0016,browArch + .0006) * step(.07,hp.z));
#else
col = mix(col, mix(col, hair, .55), smoothstep(.0032,.0018,browArch) * step(.07,hp.z));
#endif
float jaw = smoothstep(-.035,-.065,hp.y) * smoothstep(.0,.05,hp.z) * (1. - smoothstep(.095,.125,-hp.y)) * (1. - smoothstep(.04,.06,hq.x) * .5);
#ifndef HEAD_FEM
col = mix(col, col * mix(vec3(1.), hair * 3. + .55, .22), jaw * step(humanHash(vHeadPerson + 9.1), .4) * (1.-smoothstep(.0013,-.0006,lip)));
#endif
// Eyes: sclera, iris, pupil, a wet highlight via low roughness.
vec3 eyeC = vec3(.031,.0105,.0765);
vec3 ed = hq - eyeC;
float eye = step(length(ed), .0128) * step(.079, hp.z);
vec3 en = normalize(ed);
vec3 iris = mix(vec3(.1,.055,.025), vec3(.12,.2,.26), step(.7, humanHash(vHeadPerson + 2.3)));
// Sclera is never paper white: shaded by the upper lid, warmer at the corners.
vec3 sclera = vec3(.42,.39,.37) * mix(.5, 1., smoothstep(.55, .1, en.y)) * mix(.8, 1., smoothstep(.3, .7, en.z));
vec3 eyeCol = mix(sclera, iris * mix(.6, 1., smoothstep(.97, .9, en.z)), smoothstep(.84,.86,en.z));
eyeCol = mix(eyeCol, vec3(.008), smoothstep(.968,.975,en.z));
col = mix(col, eyeCol, eye);
rough = mix(rough, .06, eye);
// Lash line along the upper lid and a soft lower-lid shadow.
float lidX = smoothstep(.047, .043, hq.x) * smoothstep(.015, .019, hq.x) * step(.075, hp.z);
float lash = lidX * (1. - smoothstep(.0012, .0026, abs(hp.y - (.0155 + .002 * (1. - pow((hq.x - .031) / .016, 2.))))));
float lower = lidX * (1. - smoothstep(.001, .003, abs(hp.y - .0045))) * .12;
#ifdef HEAD_FEM
lash = min(1., lash * 1.4);
#endif
col = mix(col, vec3(.02, .015, .012), max(lash * .85 * (1. - eye), lower));
// Hair: close crop above an irregular hairline, darker at the parting.
float frontLine = .066 - .008 * cos(hp.x * 40.) + .03 * smoothstep(.03,-.03,hp.z);
float back = smoothstep(-.07,.04,hp.z);
float hairline = back * frontLine + (1. - back) * -.045;
hairline += hq.x > .06 ? .032 * smoothstep(.06,.08,hq.x) * smoothstep(.03,-.03,hp.z) : 0.;
float earOval = length(vec2(hp.y / .042, (hp.z + .008) / .03));
if (hq.x > .06 && earOval < 1.) hairline = max(hairline, hp.y + .004 * (1. - earOval) + .002);
float hairMask = smoothstep(hairline - .0015, hairline + .0025, hp.y);
#ifdef HEAD_FEM
float femFront = .06 - .02 * smoothstep(.01, .06, hp.x + .012) + .04 * smoothstep(.045, 0., hp.z);
float femLine = min(femFront, femFront - .07 * smoothstep(.045, .07, hq.x) * smoothstep(.06, .02, hp.z));
hairMask = max(smoothstep(femLine - .0015, femLine + .002, hp.y), step(hp.z, -.088) * step(hq.x, .05) * step(-.16, hp.y));
hairMask = max(hairMask, step(.068, hq.x) * step(hp.y, .02) * step(-.09, hp.y) * step(hp.z, .04));
#endif
float strandPhase = dot(hp, vec3(900., 300., 1300.));
float strands = .88 + .12 * sin(strandPhase) * (1. - smoothstep(.6, 2., fwidth(strandPhase)));
col = mix(col, hair * strands, hairMask);
rough = mix(rough, .62, hairMask);
vHeadSkin = (1. - hairMask) * (1. - eye);
#ifdef HEAD_CAP
float capMask = step(.026 + .02 * smoothstep(.0,-.08,hp.z) - .0015, hp.y) * step(-.005, headEll(hp, vec3(0.,.038,-.012), vec3(.0795,.0885,.1025)));
float brimMask = step(.07, hp.z) * step(hp.y, .042) * step(.024, hp.y);
capMask = max(capMask, brimMask);
vec3 capCol = vHeadTeam * mix(1., .55, brimMask);
float logo = step(abs(hp.x), .016) * step(abs(hp.y - .068), .007) * step(.07, hp.z) * (1. - brimMask);
capCol = mix(capCol, vec3(.8), logo * .85);
col = mix(col, capCol, capMask);
rough = mix(rough, .82, capMask);
vHeadSkin *= 1. - capMask;
#endif
#ifdef HEAD_SET
float cups = step(.079, hq.x) * step(length(hp.yz - vec2(0.,-.01)), .036);
float band = step(.0, hp.y) * step(abs(length(hp.xy) - ${cap ? '.107' : '.102'}), .0095) * step(abs(hp.z + .01), .0095);
float boom = step(min(headSeg(hp, vec3(-.095,-.012,.012), vec3(-.045,-.058,.088)), length(hp - vec3(-.043,-.06,.09)) - .004), .0055);
float setMask = max(max(cups, band), boom);
vec3 setCol = mix(vec3(.025), vHeadTeam * .8, step(.0985, hq.x) * cups);
col = mix(col, setCol, setMask);
rough = mix(rough, .38, setMask);
vHeadSkin *= 1. - setMask;
#endif
diffuseColor.rgb = col;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = rough;',
      );
  };
  material.customProgramCacheKey = () => `human-head-v2-${wear}`;
  return material;
}

/** Instanced heads for a cast: one batch per (wear, LOD), allocated up front
 * so no shader variant or buffer changes at runtime. Each instance carries a
 * person id (skin/hair tone, shared with that person's body) and a team
 * colour (cap and headset accents). */
export class HumanHeadBatches {
  readonly meshes: T.InstancedMesh[] = [];
  private readonly people: T.InstancedBufferAttribute[] = [];
  /** Heads are drawn at 94 %: an eight-head-tall figure on the crew skeleton. */
  private readonly scale = new T.Matrix4().makeScale(0.94, 0.94, 0.94);
  private readonly scaled = new T.Matrix4();
  constructor(
    readonly capacity: number,
    readonly wears: readonly HeadWear[],
    readonly lods: readonly HumanLod[],
    name = 'Procedural heads',
  ) {
    for (const lod of lods)
      for (const wear of wears) {
        const g = humanHeadGeometry(wear, lod);
        const people = new T.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(
          T.DynamicDrawUsage,
        );
        g.setAttribute('headPerson', people);
        const material = installHumanHead(new T.MeshStandardMaterial({ roughness: 0.5 }), wear);
        material.userData.weatherSurface = 'skin';
        const mesh = new T.InstancedMesh(g, material, capacity);
        mesh.instanceColor = new T.InstancedBufferAttribute(
          new Float32Array(capacity * 3).fill(1),
          3,
        ).setUsage(T.DynamicDrawUsage);
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        mesh.name = `${name} ${wear} LOD${lod}`;
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.meshes.push(mesh);
        this.people.push(people);
      }
  }
  reset() {
    for (const mesh of this.meshes) mesh.count = 0;
  }
  /** `lod` and `wear` index into the constructor lists. */
  put(world: T.Matrix4, person: number, team: T.Color, lod: number, wear: number) {
    const k = lod * this.wears.length + (wear % this.wears.length);
    const mesh = this.meshes[k];
    if (!mesh || mesh.count >= this.capacity) throw new Error('Head batch capacity exceeded');
    this.people[k].setX(mesh.count, person);
    mesh.setColorAt(mesh.count, team);
    mesh.setMatrixAt(mesh.count++, this.scaled.multiplyMatrices(world, this.scale));
  }
  finish() {
    this.meshes.forEach((mesh, i) => {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      this.people[i].needsUpdate = true;
    });
  }
  get count() {
    return this.meshes.reduce((n, m) => n + m.count, 0);
  }
}
