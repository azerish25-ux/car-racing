import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';

/** Immutable axle-local coordinates survive rigid wheel batching and spin.
 * The fourth coordinate is half-width in metres, distinguishing the 120 mm
 * front from the 200 mm rear. No position, normal, UV or index is changed. */
export function bindGpTyre<G extends T.BufferGeometry>(geometry: G, halfWidth: number): G {
  if (!Number.isFinite(halfWidth) || halfWidth < 0.03 || halfWidth > 0.16)
    throw new RangeError('Invalid GP tyre half-width');
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize !== 3) throw new Error('Missing GP tyre geometry');
  const values = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    if (![x, y, z].every(Number.isFinite)) throw new Error('Non-finite GP tyre geometry');
    values.set([x, y, z, halfWidth], i * 4);
  }
  geometry.setAttribute('gpTyreBind', new T.BufferAttribute(values, 4));
  return geometry;
}

export interface GpTyreAppearance {
  compound?: number;
  frontWear?: number;
  rearWear?: number;
  frontSurfaceTemp?: number;
  rearSurfaceTemp?: number;
  frontWater?: number;
  rearWater?: number;
  speed?: number;
}
const finite = (value: number | undefined, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? T.MathUtils.clamp(value, min, max)
    : fallback;
/** Compound indices are the existing protocol order, not inferred from paint.
 * Intermediate and wet gain different drainage density. Slicks stay uncut. */
export function gpDrainageStyle(compound: number | undefined) {
  return compound === 3 ? 1 : compound === 4 ? 2 : 0;
}

/** Close-range material relief only; the physics carcass/contact is unchanged.
 * Uniforms are written from recorded tyre observations, not time integration.
 * Rib pitch, crown profile and tread scuff vary across the tyre rather than
 * making the whole wheel an evenly shiny plastic torus. */
export function installGpTyreFinish(material: T.MeshStandardMaterial) {
  const front = { value: new T.Vector4(0, 80, 0, 0) };
  const rear = { value: new T.Vector4(0, 80, 0, 0) };
  const style = { value: new T.Vector2(0, 0) };
  chainShaderHook(material, 'gp-tyre-drainage-v2', (shader) => {
    Object.assign(shader.uniforms, { gpTyreFront: front, gpTyreRear: rear, gpTyreStyle: style });
    injectDeclarations(
      shader,
      'common',
      'attribute vec4 gpTyreBind; varying vec4 vGpTyreBind;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vGpTyreBind=gpTyreBind;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `
      varying vec4 vGpTyreBind;
      uniform vec4 gpTyreFront, gpTyreRear;
      uniform vec2 gpTyreStyle;
      float gpTyreRelief, gpTyreRoughness, gpTyreCoverage;
    `,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `
    {
      vec4 p=vGpTyreBind;
      gpTyreCoverage=step(.025,p.w)*gpTyreStyle.y;
      float across=abs(p.x)/max(p.w,.03);
      float crown=1.-smoothstep(.62,.97,across);
      vec4 condition=mix(gpTyreFront,gpTyreRear,step(.08,p.w));
      float heat=smoothstep(45.,95.,condition.y);
      float water=clamp(condition.z * max(condition.w,2.) / 25.,0.,1.);
      // Integer circumferential pitch closes exactly at the angular seam.
      float theta=atan(p.z,p.y)/6.28318530718;
      float cuts=mix(28.,40.,step(1.5,gpTyreStyle.x));
      float phase=theta*cuts + across*.85 + sin(across*3.14159265)*.16;
      // Derivatives of the continuous plane, not of fract(), avoid a dark
      // unfiltered seam at every groove. Fade subpixel grooves to no relief.
      float px=max(fwidth(phase),.00001);
      float resolved=1.-smoothstep(.16,.45,px);
      float width=mix(.033,.048,step(1.5,gpTyreStyle.x));
      float groove=(1.-smoothstep(width-px*.5,width+px*.5,abs(fract(phase)-.5)))
        * smoothstep(.1,.2,across) * (1.-smoothstep(.87,.97,across))
        * step(.5,gpTyreStyle.x) * resolved;
      // Shoulder scrubbing (references 002/015/060) is local to the contact
      // crown. The centre strip and sidewall retain their own rubber finish.
      // Integer angular harmonics close at atan's seam; grain uses continuous
      // axle-local metres and fades before either scale becomes subpixel.
      float pixel=length(fwidth(p.xyz));
      float streak=sin(theta*6.28318530718*54. + across*84.)*.5+.5;
      float shoulder=smoothstep(.28,.52,across)*(1.-smoothstep(.83,1.,across));
      float scuff=(1.-smoothstep(.006,.025,pixel))*sqrt(condition.x)*shoulder;
      float grain=sin(p.y*1221.+sin(p.z*891.)*.8)*sin(p.x*1493.+p.z*823.);
      float resolvedGrain=1.-smoothstep(.00065,.0025,pixel);
      diffuseColor.rgb *= mix(1., mix(1.08,.94,heat)*mix(1.,.56,groove)
        *(1.+scuff*(.08+(streak-.5)*.13)+grain*.022*resolvedGrain),gpTyreCoverage*crown);
      gpTyreRelief=(-.0016*groove + .000035*(streak-.5)*scuff
        + grain*.000018*resolvedGrain*crown)*gpTyreCoverage;
      gpTyreRoughness=clamp(mix(.71,.84-.08*heat+.055*condition.x,crown)
        +.045*scuff-.20*water*crown+.12*groove,.48,.94);
    }
    `,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor=mix(roughnessFactor,gpTyreRoughness,gpTyreCoverage);',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `
    {
      vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
      vec3 r1=cross(dy,normal),r2=cross(normal,dx);float det=dot(dx,r1);
      vec3 grad=sign(det)*(dFdx(gpTyreRelief)*r1+dFdy(gpTyreRelief)*r2);
      normal=normalize(max(abs(det),1.e-10)*normal-grad);
    }`,
      'fragment',
    );
  });
  return {
    front,
    rear,
    style,
    update(state: GpTyreAppearance, enabled = true) {
      const speed = finite(state.speed, 0, 0, 150);
      front.value.set(
        finite(state.frontWear, 0, 0, 1),
        finite(state.frontSurfaceTemp, 80, -40, 200),
        finite(state.frontWater, 0, 0, 5),
        speed,
      );
      rear.value.set(
        finite(state.rearWear, 0, 0, 1),
        finite(state.rearSurfaceTemp, 80, -40, 200),
        finite(state.rearWater, 0, 0, 5),
        speed,
      );
      style.value.set(gpDrainageStyle(state.compound), enabled ? 1 : 0);
    },
  };
}
