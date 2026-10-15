import type * as T from 'three';
import { chainShaderHook, injectAfter } from './studio/shader-hooks.ts';

/** Team kit in the procedural body's metre-scale bind coordinates (the rest
 * pose the skin weights were derived in). Zones are analytic, so seams and
 * sleeve hems stay crisp at every LOD; skin weights select torso/arm/leg
 * regions so a chest panel cannot slide onto an arm crossing the body.
 *
 * Two cuts share the shader: CREW_POLO (grid shirt with bare forearms) and the
 * default fire-resistant overall. The instance colour is the team colour; it
 * is carried separately so skin, boots and belts are never team-tinted. */
export const CREW_SUIT_VARYINGS = `
varying float vCrewCloth;
varying vec3 vCrewPattern;
varying vec2 vCrewRegion;
varying vec3 vCrewTint;
varying float vCrewPerson;
`;

export const crewSuitVertex = `
vCrewCloth = crewCloth;
vCrewPattern = position;
vCrewPerson = crewSlot;
vec4 crewIndices = crewJoint;
vCrewRegion = vec2(
  dot(crewWeight, vec4(1.) - step(vec4(2.5), crewIndices)),
  dot(crewWeight, step(vec4(2.5), crewIndices) * (vec4(1.) - step(vec4(8.5), crewIndices)))
);
`;

/** Runs after <color_vertex>: keep the raw albedo, hand the tint to the fragment. */
export const crewTintVertex = `
#ifdef USE_INSTANCING_COLOR
vCrewTint = instanceColor.rgb;
vColor.rgb = color.rgb;
#else
vCrewTint = vec3(1.);
#endif
`;

export const crewSuitFragment = `
vec3 suitP = vCrewPattern;
float suitTorso = clamp(vCrewRegion.x, 0., 1.);
float suitSleeve = clamp(vCrewRegion.y, 0., 1.);
float suitLeg = max(0., 1. - suitTorso - suitSleeve);
float suitAx = abs(suitP.x);
vec3 suitTeam = vCrewTint;
float suitNeutral = 1. - smoothstep(.2, .3, vCrewCloth);
// Analytic skin: bare forearms below the polo hem and the neck above the collar.
float suitCollar = 1.476 - .32 * suitP.z;
float suitNeckR = length(vec2(suitP.x, suitP.z + .008));
float suitNeck = step(suitCollar, suitP.y) * step(suitNeckR, .07);
#ifdef CREW_POLO
float suitArmSkin = step(suitP.y, 1.231) * step(.74, suitP.y) * step(.15, suitAx) * step(.5, suitSleeve);
#else
float suitArmSkin = 0.;
#endif
crewSkinMask = max(suitNeck, suitArmSkin) * (1. - suitNeutral);
// Team kit: shirt/overall in the team colour, darker side panels and yoke.
vec3 suitCol = suitTeam;
float suitSidePanel = smoothstep(.115, .135, suitAx) * suitTorso * step(1.0, suitP.y);
suitCol *= 1. - .38 * suitSidePanel;
float suitYoke = smoothstep(1.365 + suitAx * .12, 1.372 + suitAx * .12, suitP.y) * (suitTorso + suitSleeve);
suitCol = mix(suitCol, suitTeam * .32, suitYoke * .9);
float suitPipe = 1. - smoothstep(.0015, .0035, abs(suitP.y - (1.368 + suitAx * .12)));
suitCol = mix(suitCol, vec3(.78, .76, .7), suitPipe * (suitTorso + suitSleeve) * .7);
// Chest crest and a sponsor block on the other side, front only.
float suitFront = smoothstep(.05, .08, suitP.z) * suitTorso;
float suitCrest = step(abs(suitP.x - .07), .022) * step(abs(suitP.y - 1.31), .013) * suitFront;
float suitSponsor = step(abs(suitP.x + .072), .03) * step(abs(suitP.y - 1.315), .007) * suitFront;
suitCol = mix(suitCol, vec3(.86, .85, .8), suitCrest * .9);
suitCol = mix(suitCol, vec3(.04), suitSponsor * .85);
#ifdef CREW_POLO
// Placket with two buttons, collar in the dark secondary.
float suitPlacket = step(suitAx, .011) * step(1.36, suitP.y) * suitFront;
suitCol = mix(suitCol, suitTeam * .55, suitPlacket);
float suitButton = step(length(vec2(suitP.x, mod(suitP.y - 1.39, .035) - .0175)), .0035) * suitPlacket;
suitCol = mix(suitCol, vec3(.8), suitButton);
float suitCollarBand = step(suitCollar - .03, suitP.y) * step(suitP.y, suitCollar) * step(suitNeckR, .082);
suitCol = mix(suitCol, suitTeam * .3, suitCollarBand);
// Trousers: near-black team trousers.
suitCol = mix(suitCol, mix(suitTeam * .18, vec3(.028, .03, .034), .6), step(suitP.y, .973) * (1. - step(.5, suitSleeve)));
#else
// Overall: the legs in the team's dark secondary, a reflective knee band.
suitCol *= mix(1., .42, suitLeg);
float suitKnee = (1. - smoothstep(.006, .009, abs(suitP.y - .5))) * suitLeg;
suitCol = mix(suitCol, vec3(.7, .7, .66), suitKnee * .8);
float suitZip = step(suitAx, .004) * suitFront * step(1.0, suitP.y);
suitCol = mix(suitCol, vec3(.05), suitZip * .8);
#endif
// Boots: dark leather with a lighter rubber sole and toe scuffs.
vec3 suitBoot = mix(vec3(.035, .033, .032), vec3(.11, .105, .1), step(suitP.y, .022));
suitCol = mix(suitCol, suitBoot, suitNeutral * step(suitP.y, .18));
// Belt with a buckle.
float suitBelt = (1. - smoothstep(.0165, .0185, abs(suitP.y - .985))) * (1. - step(.5, suitSleeve));
suitCol = mix(suitCol, mix(vec3(.025), vec3(.45, .42, .36), step(suitAx, .018) * step(.05, suitP.z)), suitBelt);
suitCol = mix(suitCol, humanSkinTone(vCrewPerson), crewSkinMask);
diffuseColor.rgb *= suitCol;
`;

/** Height field for derivative bump-mapped creases (bind space metres). */
export const crewFoldFragment = `
float crewFoldHeight(vec3 p, float leg, float sleeve, float torso) {
  float h = 0.;
  // Trouser breaks above the boots and behind the knees.
  float a = atan(p.x, p.z);
  float wob = sin(a * 2. + p.y * 23.) * .5 + sin(a * 5. - p.y * 41.) * .3;
  h += leg * sin(p.y * 150. + wob * 3.) * .0009 * smoothstep(.12, .17, p.y) * (1. - smoothstep(.24, .3, p.y)) * (.6 + .4 * sin(a * 3.));
  h += leg * sin(p.y * 180. + wob * 4.) * .0007 * smoothstep(.4, .43, p.y) * (1. - smoothstep(.5, .53, p.y)) * smoothstep(.02, -.03, p.z);
  h += leg * sin(a * 6. + p.y * 9.) * .0006 * smoothstep(.62, .75, p.y);
  // Shirt creases: blousing above the belt and drag lines from the armpits.
  h += torso * sin(atan(p.x, p.z) * 11. + p.y * 30.) * .0012 * smoothstep(.99, 1.03, p.y) * (1. - smoothstep(1.08, 1.15, p.y));
  h += torso * sin((p.y - abs(p.x) * .8) * 120.) * .0006 * smoothstep(.1, .16, abs(p.x)) * smoothstep(1.12, 1.2, p.y) * (1. - smoothstep(1.3, 1.36, p.y));
  // Sleeve gathers at the elbow.
  h += sleeve * sin(p.y * 190. + sin(atan(p.x - sign(p.x) * .2, p.z) * 2.) * 2.) * .0008 * smoothstep(1.01, 1.05, p.y) * (1. - smoothstep(1.12, 1.15, p.y));
  return h;
}
`;

/** View depth (m) under which crew fabric, helmets and gloves dissolve in a
 * stable 4x4 screen-door pattern: fully gone at `gone`, intact from `from`. A
 * lens that ends up inside the crew sees past the nearest person instead of
 * a frame-filling helmet. */
export const CREW_NEAR_FADE = Object.freeze({ gone: 0.45, from: 1.2 });
const NEAR_FADE = `{
  float crewNear = length(vViewPosition);
  if (crewNear < ${CREW_NEAR_FADE.from.toFixed(2)}) {
    const float crewBayer[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
    ivec2 crewCell = ivec2(mod(floor(gl_FragCoord.xy), 4.));
    float crewThreshold = (crewBayer[crewCell.y * 4 + crewCell.x] + .5) / 16.;
    if (smoothstep(${CREW_NEAR_FADE.gone.toFixed(2)}, ${CREW_NEAR_FADE.from.toFixed(2)}, crewNear) < crewThreshold) discard;
  }
}`;
/** Install the near-camera screen-door fade on a lit crew material. */
export function installNearFade(material: T.Material) {
  return chainShaderHook(material, 'crew-near-fade-v1', (shader) => {
    injectAfter(shader, 'clipping_planes_fragment', NEAR_FADE, 'fragment');
  });
}
