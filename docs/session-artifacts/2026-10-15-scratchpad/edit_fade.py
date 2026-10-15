p='src/rendering/crew-suit.ts'
s=open(p).read()
s="import type * as T from 'three';\nimport { chainShaderHook, injectAfter } from './studio/shader-hooks.ts';\n\n"+s
s+='''
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
'''
open(p,'w').write(s)
