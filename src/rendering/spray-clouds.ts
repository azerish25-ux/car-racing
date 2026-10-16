import { precipitationLighting } from './precipitation-light.ts';
import { RearSignalField } from './rear-signal.ts';
import * as T from 'three';
import { markAll, markItems } from './attribute-ranges.ts';

/** Rain-light in-scatter on the wheel spray (see the vertex shader). */
export const SPRAY_SIGNAL = Object.freeze({
  /** Red radiance per unit lamp signal at the lamp (was 0.34, isotropic). */
  gain: 0.06,
  /** Gaussian falloff exp(-d^2 * falloff): half at about 0.7 m. */
  falloff: 1.5,
  /** Beam gate on the cosine to the lamp's rear axis. */
  beam: Object.freeze([0.3, 0.8] as const),
  /** Henyey-Greenstein asymmetry of the scattering toward the camera. */
  g: 0.6,
  /** Red increment ceiling as a share of the puff's ambient luminance. */
  ceiling: 0.5,
});

/** CPU reference of one lamp's red increment on a puff (linear), given the
 * distance to the lamp, the cosine to its rear axis, the cosine between the
 * lamp-to-puff ray and the puff-to-camera ray, the puff opacity and its
 * ambient luminance. */
export function spraySignalTint(
  signal: number,
  distance: number,
  beamCos: number,
  viewCos: number,
  opacity: number,
  ambient: number,
) {
  const k = SPRAY_SIGNAL,
    smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
  const phase = (1 - k.g) ** 3 / (1 + k.g ** 2 - 2 * k.g * viewCos) ** 1.5;
  const lit =
    signal *
    Math.exp(-distance * distance * k.falloff) *
    smooth(k.beam[0], k.beam[1], beamCos) *
    phase;
  return Math.min(k.gain * lit * Math.min(1, Math.max(0, opacity)), k.ceiling * ambient);
}

/** One instanced draw over Effects' existing contact pool for every soft
 * volume: wheel-water spray, tyre smoke and off-track dust. This changes only
 * presentation: wheel water/load, slip work, births, advection and lifetime
 * still belong to Effects and its recorded simulation-time playback. Quads are
 * sized in metres (not clamped GL points) and fade analytically where they meet
 * the ground under their birth, avoiding hard intersection lines. */
export class SprayClouds {
  readonly signals = new RearSignalField();
  readonly geometry = new T.InstancedBufferGeometry();
  readonly material: T.ShaderMaterial;
  readonly mesh: T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
  constructor(
    positions: Float32Array,
    velocities: Float32Array,
    sizes: Float32Array,
    opacity: Float32Array,
    kinds: Uint8Array,
    floors: Float32Array = new Float32Array(opacity.length).fill(-1e6),
    colors?: Float32Array,
  ) {
    const count = opacity.length;
    if (
      !count ||
      positions.length !== count * 3 ||
      velocities.length !== count * 3 ||
      sizes.length !== count ||
      kinds.length !== count ||
      floors.length !== count ||
      (colors !== undefined && colors.length !== count * 3)
    )
      throw new Error('Spray instance arrays must have matching nonzero lengths');
    this.geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
    );
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    for (const [name, array, stride] of [
      ['center', positions, 3],
      ['velocity', velocities, 3],
      ['size', sizes, 1],
      ['opacity', opacity, 1],
      ['kind', kinds, 1],
      ['floor', floors, 1],
    ] as const)
      this.geometry.setAttribute(
        name,
        new T.InstancedBufferAttribute(array, stride).setUsage(T.DynamicDrawUsage),
      );
    if (colors)
      this.geometry.setAttribute(
        'cloudColor',
        new T.InstancedBufferAttribute(colors, 3).setUsage(T.DynamicDrawUsage),
      );
    // Stable slot variation; neither frames nor camera movement reseed the mist.
    const variation = Float32Array.from({ length: count }, (_, i) => ((i * 73 + 19) % 251) / 251);
    this.geometry.setAttribute('variation', new T.InstancedBufferAttribute(variation, 1));
    this.geometry.instanceCount = count;
    this.material = new T.ShaderMaterial({
      defines: colors ? { USE_CLOUD_COLOR: 1 } : {},
      transparent: true,
      depthWrite: false,
      fog: true,
      lights: true,
      uniforms: T.UniformsUtils.merge([
        T.UniformsLib.fog,
        T.UniformsLib.lights,
        {
          nearPlane: { value: 0.1 },
        },
      ]),
      vertexShader: `
        uniform int signalCount;
        uniform vec4 signalPositions[12];
        uniform vec3 signalDirections[12];
        attribute vec3 center;
        attribute vec3 velocity;
        attribute float size;
        attribute float opacity;
        attribute float kind;
        attribute float variation;
        attribute float floor;
        #ifdef USE_CLOUD_COLOR
          attribute vec3 cloudColor;
        #endif
        uniform float nearPlane;
        varying vec2 vUv;
        varying float vGround;
        varying float vOpacity;
        varying float vVariation;
        varying float vAnisotropy;
        varying vec3 vLight;
        #include <common>
        #include <lights_pars_begin>
        #include <fog_pars_vertex>
        ${precipitationLighting}
        void main() {
          vUv=position.xy; vVariation=variation;
          vOpacity=0.0; vLight=vec3(0.0); vAnisotropy=0.0; vGround=1.0;
          vec4 mvPosition=modelViewMatrix*vec4(center,1.0);
          #include <fog_vertex>
          float depth=-mvPosition.z;
          // A metre-sized puff within a few metres of the lens fills a large
          // part of the frame as one flat card; at night a floodlight makes it a
          // bright rectangle. Dissolve puffs over 0.6-3.5 m, as the GL points do.
          float nearFade=smoothstep(max(0.6,nearPlane*6.0),max(3.5,nearPlane*30.0),depth);
          bool spray=kind<0.5, dust=kind>0.5&&kind<1.5, smoke=kind>3.5&&kind<4.5;
          if(!(spray||dust||smoke) || opacity<=0.0 || nearFade<=0.0) {
            gl_Position=vec4(2.0,2.0,2.0,1.0); return;
          }
          vOpacity=opacity*nearFade;
          // View-plane footprint in metres, not capped GL_POINTS pixels. The
          // projected velocity gives a continuous wake direction at any aspect.
          vec3 motion=(modelViewMatrix*vec4(velocity,0.0)).xyz;
          vec2 projected=motion.xy-mvPosition.xy*motion.z/mvPosition.z;
          float speed=length(projected);
          vec2 along=speed>0.001?projected/speed:vec2(0.0,1.0);
          vec2 across=vec2(along.y,-along.x);
          float radius=max(0.01,size)*0.72;
          // D24 hanging mist: a quarter of the older puffs spread wide and thin.
          float mist=spray?step(variation,0.25)*(1.0-clamp(opacity/0.5,0.0,1.0)):0.0;
          radius*=1.0+1.5*mist;
          vOpacity*=1.0-0.65*mist;
          // A wake viewed along its motion has no defined screen-space axis.
          // Collapse to a radial footprint before that axis can flip or spin.
          float stretch=1.0+min(1.1,speed*0.12);
          vAnisotropy=smoothstep(0.05,1.0,speed);
          vec2 offset=radius*(across*position.x+along*position.y*stretch);
          mvPosition.xy+=offset;
          gl_Position=projectionMatrix*mvPosition;
          // World height of this corner above the ground at the puff's birth:
          // the quad dissolves into the road instead of cutting it. The view
          // rotation is orthonormal, so its transpose maps the offset to world.
          float cornerY=(modelMatrix*vec4(center,1.0)).y+(transpose(mat3(viewMatrix))*vec3(offset,0.0)).y;
          vGround=(cornerY-floor)/max(0.05,radius*0.55);
          // Use the scene's real light state. Unlike the old unlit point color,
          // spray cannot remain luminous when the venue lights are switched off.
          vec3 energy=precipitationEnergy((modelViewMatrix*vec4(center,1.0)).xyz);
          // Preserve calibrated spray/smoke radiance. Dust uses its recorded
          // per-puff surface colour, shared with the existing contact pool.
          vec3 albedo=spray?vec3(0.672,0.701,0.708):dust?vec3(0.5,0.42,0.3):vec3(0.8,0.8,0.78);
          #ifdef USE_CLOUD_COLOR
            if(dust) albedo=cloudColor;
          #endif
          vLight=albedo*energy;
          // A diffuse volume cannot be brighter than a fully lit white card;
          // an unbounded nearby floodlight otherwise blooms a puff into a
          // glowing block. Smoke and dust stay radial (no wake anisotropy).
          vLight=min(vLight,vec3(1.6));
          if(!spray) { vAnisotropy=0.0; return; }
          // Rain-light in-scatter: a bounded, forward-scattered single-scatter
          // tint of the puffs right behind each lamp (half at ~0.7 m), inside
          // its beam, phase-weighted toward the camera (HG relative to its
          // forward peak) and by the puff's own density. It never exceeds half
          // of the puff's ambient light: an LED cannot paint the spray red,
          // and the lamp's own bloom carries its glow.
          vec3 worldCenter=(modelMatrix*vec4(center,1.0)).xyz;
          vec3 toCamera=normalize(cameraPosition-worldCenter);
          float signal=0.0;
          for(int i=0;i<12;i++) {
            if(i>=signalCount) break;
            vec3 delta=worldCenter-signalPositions[i].xyz;
            float d2=dot(delta,delta);
            vec3 ray=delta*inversesqrt(max(0.0001,d2));
            float beam=smoothstep(${SPRAY_SIGNAL.beam[0].toFixed(2)},${SPRAY_SIGNAL.beam[1].toFixed(2)},dot(ray,signalDirections[i]));
            float phase=${((1 - SPRAY_SIGNAL.g) ** 3).toFixed(4)}/pow(${(1 + SPRAY_SIGNAL.g ** 2).toFixed(4)}-${(2 * SPRAY_SIGNAL.g).toFixed(4)}*dot(ray,toCamera),1.5);
            signal+=signalPositions[i].w*exp(-d2*${SPRAY_SIGNAL.falloff.toFixed(2)})*beam*phase;
          }
          float ambient=dot(vLight,vec3(0.2126,0.7152,0.0722));
          float tint=min(${SPRAY_SIGNAL.gain.toFixed(3)}*signal*clamp(opacity,0.0,1.0),${SPRAY_SIGNAL.ceiling.toFixed(2)}*ambient);
          vLight+=vec3(1.0,0.012,0.003)*tint;
        }`,
      fragmentShader: `
        varying vec2 vUv;
        varying float vOpacity;
        varying float vVariation;
        varying float vAnisotropy;
        varying vec3 vLight;
        varying float vGround;
        #include <fog_pars_fragment>
        void main() {
          // A connected dense core, entrained mist and filtered turbulent
          // filaments replace the two visibly separate circular lobes. Slot
          // identity and physical advection provide variation; no wall clock.
          vec2 p=vUv;
          float phase=vVariation*6.2831853;
          vec2 q=vec2(p.x+0.09*sin(p.y*4.0+phase),p.y);
          float broad=exp(-dot(q*vec2(1.12,0.97),q*vec2(1.12,0.97))*3.0);
          float core=exp(-dot(q*vec2(1.70,0.88),q*vec2(1.70,0.88))*3.0);
          vec2 noiseP=q*vec2(11.0,7.0);
          float footprint=max(length(dFdx(noiseP)),length(dFdy(noiseP)));
          float resolved=1.0-smoothstep(0.7,2.0,footprint);
          float filaments=0.5+0.5*sin(noiseP.x+sin(noiseP.y+phase))*sin(noiseP.y*0.73-phase);
          float turbulent=(0.60*core+0.40*broad)*(1.0+resolved*(filaments-0.5)*0.42);
          float density=mix(exp(-dot(p,p)*3.6),turbulent,vAnisotropy);
          // The cutoff must become radial as well; a square cutoff still
          // rotates visibly when near-axial motion changes to a diagonal.
          float edge=mix(length(p),max(abs(p.x),abs(p.y)),vAnisotropy*0.5);
          density*=1.0-smoothstep(0.48,1.0,edge);
          // Optical-depth alpha composes into a continuous cloud. This remains
          // bounded billboards, not a claim of volumetric multiple scattering.
          float alpha=(1.0-exp(-density*vOpacity*1.25))*smoothstep(0.0,1.0,vGround);
          if(alpha<0.003) discard;
          gl_FragColor=vec4(vLight,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    // Install after UniformsUtils.merge so this field retains the actual shared
    // uniform objects instead of silently cloning the source arrays.
    this.material.uniforms.signalCount = this.signals.count;
    this.material.uniforms.signalPositions = { value: this.signals.positions };
    this.material.uniforms.signalDirections = { value: this.signals.directions };
    this.material.userData.localWeatherPosition = 'center';
    this.mesh = new T.Mesh(this.geometry, this.material);
    this.mesh.name = 'Lit wheel-water spray clouds';
    this.mesh.userData.kinds = ['spray', 'dust', 'smoke'];
    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      this.material.uniforms.nearPlane.value = 'near' in camera ? camera.near : 0.1;
    };
  }
  /** Draw pool items `0..count - 1`. Items past the last live particle are
   * transparent (culled in the vertex stage), so this changes no pixel; an
   * empty pool submits no draw at all. */
  drawUpTo(count: number) {
    this.geometry.instanceCount = count;
  }
  /** Upload pool items `first..last` (inclusive); the whole pool by default. */
  upload(first = 0, last = this.geometry.instanceCount - 1) {
    for (const name of ['center', 'velocity', 'size', 'opacity', 'kind', 'floor'])
      markItems(this.geometry.getAttribute(name) as T.BufferAttribute, first, last);
    const color = this.geometry.getAttribute('cloudColor') as T.BufferAttribute | undefined;
    if (color) markItems(color, first, last);
  }
  clear() {
    this.signals.count.value = 0;
    markAll(this.geometry.getAttribute('opacity') as T.BufferAttribute);
  }
}
