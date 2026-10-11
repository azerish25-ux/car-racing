import { audienceAtlas } from './start-finish-assets.ts';
import { spectatorKitGeometry } from './human-kit.ts';
import { installAudienceActions } from './audience-actions.ts';
import { detailDistance } from './view-detail.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import * as T from 'three';
import { PEOPLE_ASSET } from './people-asset.ts';
import { clamp } from '../core/math.ts';
import { crowdResponse } from './crowd-response.ts';
import { installCrowdImpostorShader, spectatorImpostorGeometry } from './crowd-impostor.ts';

export type CrowdDetail = 0 | 1 | 2 | 3;

/** Procedural spectators (sculpted seated body with a standing
 * correspondence, two builds). The seat plan is unchanged at every level. */
export function spectatorGeometry(detail: Exclude<CrowdDetail, 3>, variant: 'a' | 'b' = 'a') {
  if (![0, 1, 2].includes(detail)) throw new Error('Invalid crowd detail');
  const geometry = spectatorKitGeometry(variant, detail);
  const standing = geometry.getAttribute('standingPosition');
  const point = new T.Vector3();
  for (let i = 0; i < standing.count; i++)
    geometry.boundingBox!.expandByPoint(point.fromBufferAttribute(standing, i));
  geometry.boundingBox!.getBoundingSphere(geometry.boundingSphere!);
  return geometry;
}

/** Stable, inspectable cohorts. Width/height change the garments above the
 * planted feet, never seat positions or aisle clearance. */
export function spectatorVariation(index: number, seed: number, canStand: boolean) {
  if (!Number.isInteger(index) || index < 0 || !Number.isSafeInteger(seed))
    throw new Error('Invalid spectator identity');
  const hash = (value: number) => {
    let h = Math.imul(value ^ (value >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const group = hash((Math.floor(index / 3) + 1) ^ seed);
  return [
    0.9 + hash((index + 1) ^ seed) * 0.2,
    0.94 + hash((index + 631) ^ seed) * 0.12,
    canStand && group > 0.7 ? 1 : 0,
    hash((index + 917) ^ seed),
  ] as const;
}

interface CrowdUniforms {
  crowdClock: { value: T.Vector2 };
  crowdMotion: { value: number };
  crowdReaction?: { value: T.Vector2 };
  crowdLodRange?: { value: T.Vector2 };
}

/** A spatial, not time-integrated handoff. Every spectator has one stable rank
 * and is rendered at exactly one LOD even inside a transition band. Individual
 * silhouettes switch at different distances instead of an entire stand popping.
 * Rewinds and paused camera movement do not accumulate a fading animation. */
export function crowdLodRanges(distance: number, out: readonly T.Vector2[]) {
  if (!Number.isFinite(distance) || distance < 0 || out.length !== 4)
    throw new Error('Invalid crowd handoff');
  out.forEach((range) => range.set(0, 0));
  const smooth = (start: number, end: number) => {
    const t = clamp((distance - start) / (end - start), 0, 1);
    return t * t * (3 - 2 * t);
  };
  if (distance < 108) {
    const weight = smooth(92, 108);
    out[0].set(weight, 1);
    out[1].set(0, weight);
  } else if (distance < 242) {
    const weight = smooth(218, 242);
    out[1].set(weight, 1);
    out[2].set(0, weight);
  } else {
    const weight = smooth(420, 480);
    out[2].set(weight, 1);
    out[3].set(0, weight);
  }
  return out;
}
const deform = `
attribute vec3 crowdPerson;
#define crowdJoint crowdPerson.x
#define skinMask crowdPerson.y
#define crowdAccessory crowdPerson.z
attribute float spectatorPhase;
attribute vec4 spectatorStyle;
attribute vec3 standingPosition;
attribute vec3 standingNormal;
varying float vCrowdAccessory;
uniform vec2 crowdClock;
uniform float crowdMotion;
uniform vec2 crowdReaction;
// Per-seat arm pose: about a third sit with their arms folded (no gestures).
float crowdCrossed() { return step(.66, fract(spectatorPhase * 6.71)); }
mat3 crowdTurn() {
  if (crowdJoint > .5 && crowdJoint < 2.5 && crowdCrossed() > .5) return mat3(1.);
  float wave = (sin(crowdClock.x + spectatorPhase) * 0.7
    + sin(crowdClock.y + spectatorPhase * 1.73) * 0.3) * crowdMotion;
  float angle = crowdJoint > 2.5 ? wave * 0.075 : wave * 0.035;
  if (crowdJoint > .5 && crowdJoint < 2.5) {
    float participant = smoothstep(.18,.5,fract(spectatorPhase * 2.17));
    float gesture = .86 + .14 * sin(crowdClock.x * 3. + spectatorPhase * 1.9);
    // Stable one-arm/both-arm cohorts, not twelve thousand synchronized poses.
    float handChoice=fract(spectatorPhase*4.13);
    float activeHand=handChoice<.34 ? step(1.5,crowdJoint) : handChoice<.68 ? 1.-step(1.5,crowdJoint) : 1.;
    participant*=activeHand;
    angle -= participant * (crowdReaction.x * .82 * gesture + crowdReaction.y * .48);
  }
  if (crowdJoint < 0.5) angle = 0.0;
  float c = cos(angle), s = sin(angle);
  if (crowdJoint > 2.5) return mat3(c,0.,-s, 0.,1.,0., s,0.,c);
  return mat3(c,s,0., -s,c,0., 0.,0.,1.);
}
vec3 crowdShape(vec3 p) {
  p.z *= spectatorStyle.x;
  if (p.y > .1) p.y = .1 + (p.y-.1) * spectatorStyle.y;
  return p;
}
vec3 crowdPivot() {
  vec3 p = crowdJoint > 2.5 ? vec3(.08,.565,0.) : vec3(.09,.50,crowdJoint < 1.5 ? -.165 : .165);
  p += vec3(-.44,.50,0.) * spectatorStyle.z;
  return crowdShape(p);
}
`;

/** Match colour and shadow deformation. Bounded angles are smaller than the
 * expanded instance bounds. No wall-clock animation, opacity sorting or alpha
 * test is needed; colour/skin variation comes from original vertex attributes. */
export function installCrowdShader(material: T.Material, uniforms: CrowdUniforms, colour: boolean) {
  material.onBeforeCompile = (shader) => {
    if (!shader.vertexShader.includes('#include <begin_vertex>'))
      throw new Error('Crowd shader position hook missing');
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.crowdReaction = uniforms.crowdReaction ?? { value: new T.Vector2() };
    shader.uniforms.crowdLodRange = uniforms.crowdLodRange ?? { value: new T.Vector2(0, 1) };
    shader.vertexShader =
      'varying float vCrowdRank;\n' +
      deform +
      (colour
        ? 'attribute vec3 spectatorSkin; varying float vCrowdCloth; varying vec4 vCrowdBind; varying vec4 vCrowdTop; varying vec3 vCrowdSkinTone; varying vec2 vCrowdTags;\n'
        : '') +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vCrowdRank = min(.9999999, spectatorPhase / 6.28318530718);
// Shells: 0 body, 1 cap, 2 phone, 3 resting arms, 4 folded arms, 6 cup.
float crowdArmsFolded = crowdCrossed();
float crowdPhone = step(.82, spectatorStyle.w) * (1. - crowdArmsFolded);
float crowdCup = step(fract(spectatorPhase * 4.37), .22) * (1. - crowdArmsFolded) * (1. - crowdPhone);
vCrowdAccessory = crowdAccessory < .5 ? 1. : crowdAccessory < 1.5 ? step(.55,spectatorStyle.w)
  : crowdAccessory < 2.5 ? crowdPhone : crowdAccessory < 3.5 ? 1. - crowdArmsFolded
  : crowdAccessory < 4.5 ? crowdArmsFolded : crowdAccessory < 5.5 ? 0. : crowdCup;
vec3 shaped = crowdShape(mix(position,standingPosition,spectatorStyle.z));
vec3 transformed = crowdTurn() * (shaped - crowdPivot()) + crowdPivot();
// Unselected shells collapse to a point: no fragments, no shadow.
if (vCrowdAccessory < .5) transformed = crowdPivot();`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
objectNormal = mix(objectNormal,standingNormal,spectatorStyle.z);
objectNormal.z /= spectatorStyle.x;
if (mix(position.y,standingPosition.y,spectatorStyle.z) > .1) objectNormal.y /= spectatorStyle.y;
objectNormal = crowdTurn() * normalize(objectNormal);`,
    );
    // Complementary half-open ranges use the same rank in colour AND depth.
    // No transparent sorting, alpha blend, wall time or camera-facing shadow trick.
    if (!shader.fragmentShader.includes('#include <alphatest_fragment>'))
      throw new Error('Crowd shader coverage hook missing');
    shader.fragmentShader =
      'uniform vec2 crowdLodRange; varying float vCrowdRank; varying float vCrowdAccessory;\n' +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      '#include <alphatest_fragment>\nif (vCrowdRank < crowdLodRange.x || vCrowdRank >= crowdLodRange.y || vCrowdAccessory < .5) discard;',
    );
    if (colour) {
      shader.fragmentShader =
        'varying float vCrowdCloth; varying vec4 vCrowdBind; varying vec4 vCrowdTop; varying vec3 vCrowdSkinTone; varying vec2 vCrowdTags;\n' +
        shader.fragmentShader;
      // Clothing, skin, hair and printed details are resolved per fragment in
      // the seated bind frame (facing -X, lateral Z): seams stay crisp at
      // every LOD and pose, with no vertex-colour smearing across triangles.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 p = vCrowdBind.xyz;
  float joint = vCrowdBind.w;
  float ph = vCrowdTop.w;
  vec3 top = vCrowdTop.rgb;
  vec3 skin = vCrowdSkinTone;
  float h2 = fract(ph*5.31), h3 = fract(ph*7.13), h4 = fract(ph*2.19), h5 = fract(ph*11.7), h6 = fract(ph*3.91), h7 = fract(ph*13.3), h8 = fract(ph*17.9);
  vec3 trousers = h2<.42 ? vec3(.06,.085,.15) : h2<.66 ? vec3(.022,.022,.026) : h2<.82 ? vec3(.26,.22,.15) : h2<.92 ? vec3(.14,.14,.15) : vec3(.55,.53,.48);
  vec3 shoes = h3<.45 ? vec3(.6,.6,.58) : h3<.75 ? vec3(.035,.035,.04) : vec3(.3,.2,.12);
  float shortSleeve = step(h4,.62), shorts = step(h3,.2);
  // Arms are separate shells (joint exactly 1 or 2, away from the neck);
  // body/head boundary triangles interpolate 0..3 and split at 1.5.
  bool arm = vCrowdTags.y > 2.5 && vCrowdTags.y < 5.5;
  bool head = !arm && vCrowdTags.y < 1.5 && joint > 1.5;
  vec3 c = top;
  float sk = 0.;
  if (arm) {
    // Hands beyond the wrist; bare forearms below a short sleeve's hem.
    float hand = step(.5, vCrowdTags.x);
    float bare = shortSleeve * step(p.y, .385) * step(p.x, .02);
    sk = max(hand, bare);
    // Raglan two-tone sleeves on some shirts.
    c = mix(top, top*.35 + vec3(.02), step(.7, h6) * step(.385, p.y));
  } else if (head) {
    sk = 1.;
  } else {
    // Torso / legs: waistband, thighs forward, shins, socks and shoes.
    float legs = max(step(p.y, .19), step(p.x, -.1) * step(p.y, .25));
    c = mix(c, trousers, legs);
    float shin = step(p.y, .075) * step(p.x, -.22);
    sk = shorts * shin * step(-.2, p.y);
    c = mix(c, shoes, step(p.y, -.205) * step(p.x, -.2));
    // Neck above a collar line that dips at the front.
    float collar = .532 + .3 * (p.x - .085);
    sk = max(sk, step(collar, p.y));
    // Team shirts: printed chest crest/sponsor, a horizontal band on others.
    float front = step(p.x, -.005) * (1. - legs);
    // A roundel crest on the left chest and a sponsor wordmark bar beneath.
    vec2 cp = vec2(p.z + .045, p.y - .415);
    float crest = (1. - smoothstep(.014, .017, length(cp))) * front * step(h5, .55);
    float word = step(abs(p.y - .388), .004) * step(abs(p.z + .045), .024) * front * step(h5, .55);
    float lumTop = dot(top, vec3(.3,.59,.11));
    vec3 ink = lumTop > .25 ? vec3(.03) : vec3(.85);
    c = mix(c, ink, max(crest * (1. - .6 * (1. - smoothstep(.006, .008, length(cp)))), word));
    float band = step(abs(p.y - .33), .022) * (1. - legs) * step(.78, h7);
    c = mix(c, lumTop > .25 ? top*.25 : vec3(.8,.78,.7), band);
  }
  vec3 hairCol = mix(vec3(.012,.008,.006), vec3(.15,.078,.025), fract(ph*1.31));
  hairCol = fract(ph*9.7) > .85 ? vec3(.42,.3,.16) : fract(ph*9.7) > .8 ? vec3(.3,.3,.29) : hairCol;
  c = mix(c, skin, sk);
  if (head) {
    // Head frame: crew-head axes (x lateral, y up, z forward) about the head centre.
    vec3 hp = vec3(p.z, p.y - .665, .06 - p.x);
    vec3 hq = vec3(abs(hp.x), hp.y, hp.z);
    float frontLine = .066 - .008 * cos(hp.x * 40.) + .03 * smoothstep(.03,-.03,hp.z);
    float back = smoothstep(-.07,.04,hp.z);
    float hairline = back * frontLine + (1. - back) * -.045;
    hairline += hq.x > .06 ? .032 * smoothstep(.06,.08,hq.x) * smoothstep(.03,-.03,hp.z) : 0.;
    float hairMask = max(smoothstep(hairline - .002, hairline + .002, hp.y), step(1.5, vCrowdTags.x));
    c = mix(c, hairCol, hairMask);
    float face = (1. - hairMask) * smoothstep(.02, .06, hp.z);
    vec2 e = vec2((hq.x-.031)/.0085,(hp.y-.011)/.0045);
    float eye = (1.-smoothstep(.7,1.,length(e))) * face;
    vec2 b = vec2((hq.x-.03)/.016,(hp.y-.03)/.0032);
    float brow = (1.-smoothstep(.6,1.,length(b))) * face;
    vec2 m = vec2(hp.x/.018,(hp.y+.056)/.0028);
    float mouth = (1.-smoothstep(.6,1.,length(m))) * face;
    c = mix(c, hairCol*.6 + vec3(.01), max(eye*.85, brow*.6));
    c = mix(c, c*vec3(.66,.46,.44), mouth);
    // Sunglasses on some faces (dark, with a frame across the brow line).
    vec2 lens = vec2((hq.x - .031) / .0175, (hp.y - .012) / .0115);
    float shades = step(h8, .22) * face * max(1. - smoothstep(.85, 1., length(lens)),
      step(hq.x, .014) * step(abs(hp.y - .017), .0018));
    c = mix(c, vec3(.012, .014, .016), shades);
  }
  // Separate accessory shells: caps in a team tint, phones dark.
  if (vCrowdTags.y > 5.5) c = mix(vec3(.9,.89,.86), vec3(.7,.08,.06), step(abs(p.y - .26), .018));
  else if (vCrowdTags.y > 1.5 && vCrowdTags.y < 2.5) c = vec3(.02,.02,.025);
  else if (vCrowdTags.y > .5 && vCrowdTags.y < 1.5) c = top*.7;
  diffuseColor.rgb = c;
}`,
      );
      if (!shader.vertexShader.includes('#include <color_vertex>'))
        throw new Error('Crowd shader colour hook missing');
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
vCrowdTop = vec4(instanceColor.rgb, spectatorPhase);
#else
vCrowdTop = vec4(vec3(.5), spectatorPhase);
#endif
vCrowdSkinTone = spectatorSkin;
// Seated bind position (the standing body is a deformation of it).
vCrowdBind = vec4(position, crowdJoint);
vCrowdTags = vec2(skinMask, crowdAccessory);
vCrowdCloth = 1. - step(.5, skinMask);
vColor.rgb = vec3(1.);`,
      );
    }
  };
  material.customProgramCacheKey = () => `apex-procedural-crowd-v11-${colour ? 'colour' : 'depth'}`;
}

export function crowdDetail(distance: number, previous: CrowdDetail): CrowdDetail {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid crowd distance');
  if (previous === 0 && distance < 108) return 0;
  if (previous === 1 && distance > 92 && distance < 242) return 1;
  if (previous === 2 && distance > 218 && distance < 480) return 2;
  if (previous === 3 && distance > 420) return 3;
  return distance < 100 ? 0 : distance < 230 ? 1 : distance < 450 ? 2 : 3;
}

/** A spatially culled cluster shares all instance storage across its levels.
 * One draw outside handoff bands, two only within a band, never three. */
export class CrowdCluster {
  readonly root = new T.Group();
  readonly levels: readonly T.InstancedMesh[];
  readonly uniforms = {
    crowdClock: { value: new T.Vector2() },
    crowdMotion: { value: 0 },
    crowdReaction: { value: new T.Vector2() },
  };
  readonly audienceTime = { value: 0 };
  level: CrowdDetail = 0;
  readonly lodRanges = [new T.Vector2(0, 1), new T.Vector2(), new T.Vector2(), new T.Vector2()];
  private centre = new T.Vector3();
  private localCentre = new T.Vector3();
  constructor(
    matrices: readonly T.Matrix4[],
    colors: readonly T.Color[],
    seed: number,
    material: T.MeshStandardMaterial,
    authoredFamily?: number,
  ) {
    if (!matrices.length || matrices.length !== colors.length || !Number.isSafeInteger(seed))
      throw new Error('Invalid spectator cluster');
    this.root.name = `Authored crowd cluster ${seed}`;
    this.root.userData.authoredPeople = PEOPLE_ASSET;
    const phase = new Float32Array(matrices.length),
      skin = new Float32Array(matrices.length * 3),
      style = new Float32Array(matrices.length * 4);
    const frontRow = Math.min(...matrices.map((m) => m.elements[13]));
    const skinPalette = [0xe3b9a2, 0xc99a7e, 0xa97559, 0x84573f, 0x5c3c2c, 0x3d2a20, 0xd4a68a].map(
      (c) => new T.Color(c),
    );
    for (let i = 0; i < matrices.length; i++) {
      let hash = (i + 1) ^ seed;
      hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
      hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
      hash ^= hash >>> 16;
      phase[i] = ((hash >>> 0) / 4294967296) * Math.PI * 2;
      style.set(spectatorVariation(i, seed, matrices[i].elements[13] > frontRow + 0.6), i * 4);
      const c = skinPalette[Math.abs((i * 17 + seed) % skinPalette.length)];
      skin.set([c.r, c.g, c.b], i * 3);
      this.localCentre.add(new T.Vector3().setFromMatrixPosition(matrices[i]));
    }
    this.localCentre.multiplyScalar(1 / matrices.length);
    const phases = new T.InstancedBufferAttribute(phase, 1),
      skins = new T.InstancedBufferAttribute(skin, 3),
      styles = new T.InstancedBufferAttribute(style, 4);
    const atlas = authoredFamily === undefined ? null : audienceAtlas();
    const levels: T.InstancedMesh[] = [];
    for (const level of [0, 1, 2, 3] as const) {
      const colorMaterial = material.clone();
      colorMaterial.vertexColors = true;
      // Authored partial shelter, not ray-traced rain occlusion. The existing
      // skin/head masks keep faces out of the cloth response at every LOD.
      tagWeatherSurface(colorMaterial, 'fabric', 0.25, level === 3 ? 'impostor' : 'spectator');
      const depth =
        level === 3 ? undefined : new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
      const distanceMaterial = level === 3 ? undefined : new T.MeshDistanceMaterial();
      const uniforms = { ...this.uniforms, crowdLodRange: { value: this.lodRanges[level] } };
      if (level === 3) installCrowdImpostorShader(colorMaterial, this.lodRanges[level]);
      else {
        installCrowdShader(colorMaterial, uniforms, true);
        installCrowdShader(depth!, uniforms, false);
        installCrowdShader(distanceMaterial!, uniforms, false);
      }
      if (atlas && level < 2) {
        for (const material of [colorMaterial, depth!, distanceMaterial!])
          installAudienceActions(material, atlas, this.audienceTime);
      }
      if (atlas && level === 0) colorMaterial.addEventListener('dispose', () => atlas.dispose());
      const geometry =
        level === 3
          ? spectatorImpostorGeometry()
          : spectatorGeometry(
              level,
              (authoredFamily ?? Math.floor(seed / 7)) % 2 === 0 ? 'a' : 'b',
            );
      geometry.setAttribute('spectatorPhase', phases);
      geometry.setAttribute('spectatorSkin', skins);
      geometry.setAttribute('spectatorStyle', styles);
      const people = new T.InstancedMesh(geometry, colorMaterial, matrices.length);
      if (levels.length) {
        people.instanceMatrix = levels[0].instanceMatrix;
        people.instanceColor = levels[0].instanceColor;
      } else
        matrices.forEach((matrix, i) => {
          people.setMatrixAt(i, matrix);
          people.setColorAt(i, colors[i]);
        });
      people.name = `${this.root.name} detail ${level}`;
      people.castShadow = level !== 3;
      people.receiveShadow = true;
      people.customDepthMaterial = depth;
      people.customDistanceMaterial = distanceMaterial;
      people.visible = level === 0;
      people.computeBoundingBox();
      people.computeBoundingSphere();
      // Raised forearms move by at most 32 cm; the card may rotate about its
      // seat. Keep both in the culling volume without changing seat transforms.
      const guard = 0.6;
      people.boundingBox!.expandByScalar(guard);
      people.boundingSphere!.radius += guard;
      levels.push(people);
      this.root.add(people);
    }
    this.levels = levels;
  }
  update(
    time: number,
    camera: T.Vector3,
    rain: number,
    frame?: Float32Array,
    fov = 58,
    aspect = 16 / 9,
  ) {
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(rain) ||
      !Number.isFinite(camera.x + camera.y + camera.z)
    )
      throw new Error('Invalid crowd presentation');
    this.root.updateWorldMatrix(true, false);
    this.centre.copy(this.localCentre).applyMatrix4(this.root.matrixWorld);
    const distance = this.centre.distanceTo(camera);
    const visualDistance = detailDistance(distance, fov, aspect);
    // Traffic relevance stays in world metres. Only mesh selection follows
    // magnification, so zooming cannot invent a distant crowd reaction.
    crowdResponse(frame, this.centre, this.uniforms.crowdReaction.value).multiplyScalar(
      clamp((180 - distance) / 50, 0, 1) * (1 - clamp(rain / 60, 0, 0.4)),
    );
    this.level = crowdDetail(visualDistance, this.level);
    crowdLodRanges(visualDistance, this.lodRanges);
    this.levels.forEach((mesh, i) => {
      mesh.visible = this.lodRanges[i].y > this.lodRanges[i].x;
    });
    // Both frequencies wrap at their own complete cycle, avoiding a long-race
    // float-time jump. The exact same replay timestamp restores the same pose.
    const cycle = Math.PI * 2;
    this.uniforms.crowdClock.value.set((time * 0.71) % cycle, (time * 0.43) % cycle);
    this.audienceTime.value = ((time % 4) + 4) % 4;
    this.uniforms.crowdMotion.value =
      clamp((120 - distance) / 40, 0, 1) * (1 - clamp(rain / 40, 0, 0.4));
  }
}
