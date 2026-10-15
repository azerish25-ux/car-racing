p='src/rendering/spray-clouds.ts'
s=open(p).read()
old="""          vLight=min(vLight,vec3(1.6));
          if(!spray) { vAnisotropy=0.0; return; }
          vec3 worldCenter=(modelMatrix*vec4(center,1.0)).xyz;
          for(int i=0;i<12;i++) {
            if(i>=signalCount) break;
            vec3 delta=worldCenter-signalPositions[i].xyz;
            float d2=dot(delta,delta);
            float rear=smoothstep(-0.08,0.5,dot(delta,signalDirections[i])/sqrt(max(0.0001,d2)));
            float attenuation=exp(-d2*0.35)*rear;
            vLight+=vec3(0.34,0.004,0.001)*signalPositions[i].w*attenuation;
          }
          vLight=min(vLight,vec3(2.2,1.6,1.6));
        }`,"""
new="""          vLight=min(vLight,vec3(1.6));
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
        }`,"""
assert old in s; s=s.replace(old,new)
old="""/** One instanced draw over Effects' existing contact pool for every soft"""
new="""/** Rain-light in-scatter on the wheel spray (see the vertex shader). */
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

/** One instanced draw over Effects' existing contact pool for every soft"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='tests/spray-lighting.test.ts'
s=open(p).read()
s=s.replace("import { SprayClouds } from '../src/rendering/spray-clouds.ts';","import { SPRAY_SIGNAL, SprayClouds, spraySignalTint } from '../src/rendering/spray-clouds.ts';")
s+='''
describe('rain-light in-scatter on the spray', () => {
  it('is a bounded, forward-scattered tint near the lamp, never a red fog', () => {
    // Braking (signal 2.5), puff 0.5 m straight behind, camera behind it.
    const near = spraySignalTint(2.5, 0.5, 1, 1, 1, 0.47);
    expect(near).toBeGreaterThan(0);
    // Never more than half of the puff's own ambient light.
    expect(spraySignalTint(2.5, 0, 1, 1, 1, 0.1)).toBeCloseTo(0.05, 10);
    expect(near).toBeLessThanOrEqual(0.5 * 0.47);
    // Half at about 0.7 m; nothing worth seeing 2 m away.
    expect(
      spraySignalTint(2.5, 0.7, 1, 1, 1, 10) / spraySignalTint(2.5, 0, 1, 1, 1, 10),
    ).toBeCloseTo(Math.exp(-0.49 * SPRAY_SIGNAL.falloff), 6);
    expect(spraySignalTint(2.5, 2, 1, 1, 1, 10)).toBeLessThan(0.002);
    // Puffs beside the lamp (outside its beam) and back-scatter stay dark.
    expect(spraySignalTint(2.5, 0.5, 0.2, 1, 1, 10)).toBe(0);
    expect(spraySignalTint(2.5, 0.5, 1, -1, 1, 10)).toBeLessThan(0.03 * near);
    // Thin puffs scatter less than dense ones.
    expect(spraySignalTint(2.5, 0.5, 1, 1, 0.2, 10)).toBeCloseTo(
      0.2 * spraySignalTint(2.5, 0.5, 1, 1, 1, 10),
      10,
    );
    // The old isotropic term put 0.34 * 2.5 = 0.85 of red on every puff at the lamp.
    expect(spraySignalTint(2.5, 0, 1, 1, 1, 10)).toBeLessThan(0.2);
  });
  it('compiles the bounded term into the spray vertex shader', () => {
    const spray = new SprayClouds(
      new Float32Array(3),
      new Float32Array(3),
      new Float32Array(1),
      new Float32Array(1),
      new Uint8Array(1),
    );
    const v = spray.material.vertexShader;
    expect(v).toContain('dot(ray,toCamera)');
    expect(v).toContain(`exp(-d2*${SPRAY_SIGNAL.falloff.toFixed(2)})`);
    expect(v).not.toContain('vec3(0.34,0.004,0.001)');
    expect(v).toContain(`${SPRAY_SIGNAL.ceiling.toFixed(2)}*ambient`);
    spray.material.dispose();
    spray.geometry.dispose();
  });
});
'''
open(p,'w').write(s)
