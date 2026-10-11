import * as T from 'three';
import { configureSuppliedMaterial } from '../supplied-player-materials.ts';
import { installSuppliedShaderWork } from '../supplied-shader-work.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';

/**
 * Painted wheel covers and anthracite rims (D12 vehicle-tyres-wheels).
 *
 * Covers: the team primary under a clear coat, with an accent outer ring and
 * three secondary-colour sweeps, drawn from the cover's polar coordinates in
 * the wheel's spin frame (axle = object X, so the art turns with the wheel).
 * `coverBlur` (0..1, from presented wheel speed through `wheelBlur`) smears the
 * sweeps along the angle into their average tint: the moving-wheel read of
 * F1 25 at speed. Rims and hubs: anthracite alloy with a lighter machined lip.
 * Both replace existing materials one for one, so the merged spin keeps its
 * draw count.
 */
export const WHEEL_LOOK = Object.freeze({
  rim: Object.freeze({ color: 0x2b2e31, metalness: 0.75, roughness: 0.38 }),
  lip: 0x3a3b3e,
  /** Radius (m) beyond which the rim reads as the machined lip. */
  lipRadius: 0.226,
  cover: Object.freeze({ roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.05 }),
  /** Cover art radii (m): accent ring and sweep band. */
  ring: Object.freeze([0.196, 0.214] as const),
  sweep: Object.freeze([0.07, 0.19] as const),
  sweeps: 3,
  /** Share of the sweep band that the sweeps cover (their blurred tint). */
  sweepCoverage: 0.32,
});

const OBJECT_POSITION = /* glsl */ `varying vec3 vWheelLocal;`;
const OBJECT_POSITION_VERTEX = /* glsl */ `vWheelLocal = position;`;

const f = (v: number) => v.toFixed(4);
const rgb = (hex: number) => {
  const c = new T.Color(hex);
  return `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;
};

/** A team's painted cover material with sweeps and speed blur. */
export function wheelCoverMaterial(
  primary: T.ColorRepresentation,
  secondary: T.ColorRepresentation,
  accent: T.ColorRepresentation,
  blur: T.IUniform<number> = { value: 0 },
) {
  const material = new T.MeshPhysicalMaterial({
    color: primary,
    roughness: WHEEL_LOOK.cover.roughness,
    clearcoat: WHEEL_LOOK.cover.clearcoat,
    clearcoatRoughness: WHEEL_LOOK.cover.clearcoatRoughness,
    metalness: 0,
  });
  material.name = 'Team painted wheel cover';
  const uniforms = {
    coverSecondary: { value: new T.Color(secondary) },
    coverAccent: { value: new T.Color(accent) },
    coverBlur: blur,
  };
  chainShaderHook(material, 'wheel-cover-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(shader, 'common', OBJECT_POSITION, 'vertex');
    injectAfter(shader, 'begin_vertex', OBJECT_POSITION_VERTEX, 'vertex');
    injectDeclarations(
      shader,
      'common',
      `${OBJECT_POSITION}\nuniform vec3 coverSecondary;\nuniform vec3 coverAccent;\nuniform float coverBlur;`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `{
	// D12 cover art in the spin frame: accent ring, three sweeps, speed blur.
	float r = length( vWheelLocal.yz );
	float a = atan( vWheelLocal.z, vWheelLocal.y ) / 6.28318531;
	float px = max( fwidth( r ), 1e-4 );
	float ring = smoothstep( ${f(WHEEL_LOOK.ring[0])} - px, ${f(WHEEL_LOOK.ring[0])} + px, r ) * ( 1.0 - smoothstep( ${f(WHEEL_LOOK.ring[1])} - px, ${f(WHEEL_LOOK.ring[1])} + px, r ) );
	float band = smoothstep( ${f(WHEEL_LOOK.sweep[0])}, ${f(WHEEL_LOOK.sweep[0] + 0.012)}, r ) * ( 1.0 - smoothstep( ${f(WHEEL_LOOK.sweep[1] - 0.012)}, ${f(WHEEL_LOOK.sweep[1])}, r ) );
	float phase = fract( a * ${WHEEL_LOOK.sweeps}.0 + r * 2.4 );
	float aw = max( fwidth( phase ), 1e-3 );
	float sweep = smoothstep( 0.0, aw, phase ) * ( 1.0 - smoothstep( ${f(WHEEL_LOOK.sweepCoverage)} - aw, ${f(WHEEL_LOOK.sweepCoverage)}, phase ) );
	sweep = mix( sweep, ${f(WHEEL_LOOK.sweepCoverage)}, clamp( coverBlur, 0.0, 1.0 ) ) * band;
	diffuseColor.rgb = mix( diffuseColor.rgb, coverSecondary, sweep );
	diffuseColor.rgb = mix( diffuseColor.rgb, coverAccent, ring );
}`,
      'fragment',
    );
  });
  return { material, uniforms };
}

/** Anthracite rim and hub alloy with a lighter machined lip. */
export function anthraciteRimMaterial() {
  const material = new T.MeshStandardMaterial({ ...WHEEL_LOOK.rim });
  material.name = 'Anthracite wheel rim';
  chainShaderHook(material, 'wheel-rim-v1', (shader) => {
    injectDeclarations(shader, 'common', OBJECT_POSITION, 'vertex');
    injectAfter(shader, 'begin_vertex', OBJECT_POSITION_VERTEX, 'vertex');
    injectDeclarations(shader, 'common', OBJECT_POSITION, 'fragment');
    injectAfter(
      shader,
      'color_fragment',
      `diffuseColor.rgb = mix( diffuseColor.rgb, ${rgb(WHEEL_LOOK.lip)}, smoothstep( ${f(WHEEL_LOOK.lipRadius - 0.004)}, ${f(WHEEL_LOOK.lipRadius)}, length( vWheelLocal.yz ) ) );`,
      'fragment',
    );
  });
  return material;
}

/** Supplied-car tyre art that smears with speed: the (de-branded) sidewall
 * decals and the compound ink. */
export function isSuppliedTyreArt(material: T.Material) {
  return (
    material.name.startsWith('Decal | tyre_') || material.name === 'Tyre | compound sidewall ink'
  );
}

const SUPPLIED_BLUR_TAPS = 8;
/**
 * Rotational blur for an arbitrary UV layout: the UV direction along the
 * wheel's angle (radius held) comes from the screen-space Jacobians of the
 * UVs and of the polar coordinates, and the map is re-sampled along it.
 */
const SUPPLIED_BLUR_GLSL = /* glsl */ `
#ifdef USE_MAP
if ( wheelBlurAmount > 0.01 ) {
	vec3 wp = vWheelLocal - wheelCentre;
	vec3 q = wp - wheelAxis * dot( wp, wheelAxis );
	vec3 bu = normalize( abs( wheelAxis.y ) < 0.9 ? cross( wheelAxis, vec3( 0.0, 1.0, 0.0 ) ) : cross( wheelAxis, vec3( 1.0, 0.0, 0.0 ) ) );
	vec3 bv = cross( wheelAxis, bu );
	vec2 pq = vec2( dot( q, bu ), dot( q, bv ) );
	float r2 = max( dot( pq, pq ), 1e-8 );
	vec2 pdx = dFdx( pq ), pdy = dFdy( pq );
	// d(theta) and d(r) per screen pixel, without the atan branch cut.
	vec2 dTheta = vec2( pq.x * pdx.y - pq.y * pdx.x, pq.x * pdy.y - pq.y * pdy.x ) / r2;
	vec2 dRadius = vec2( dot( pq, pdx ), dot( pq, pdy ) ) * inversesqrt( r2 );
	float det = dTheta.x * dRadius.y - dTheta.y * dRadius.x;
	if ( abs( det ) > 1e-10 ) {
		// Screen step that advances theta by one radian at constant radius.
		vec2 screenStep = vec2( dRadius.y, - dRadius.x ) / det;
		vec2 uvPerRadian = dFdx( vMapUv ) * screenStep.x + dFdy( vMapUv ) * screenStep.y;
		float spread = 0.9 * clamp( wheelBlurAmount, 0.0, 1.0 );
		vec4 sum = vec4( 0.0 );
		for ( int k = 0; k < ${SUPPLIED_BLUR_TAPS}; k ++ ) {
			float t = ( float( k ) / ${SUPPLIED_BLUR_TAPS - 1}.0 - 0.5 ) * spread;
			sum += texture2D( map, vMapUv + uvPerRadian * t );
		}
		sum /= ${SUPPLIED_BLUR_TAPS}.0;
		diffuseColor = vec4( diffuse, opacity ) * sum;
	}
}
#endif`;

export interface SuppliedWheelBlur {
  /** Per wheel (0..3) blur uniform, shared by that wheel's cloned materials. */
  blur: T.IUniform<number>[];
  /** Cloned materials per wheel, in traversal order. */
  materials: T.Material[][];
}
/**
 * Give each supplied wheel its own copy of the tyre-art materials (no extra
 * draw: each primitive already draws on its own) with a rotational blur about
 * that wheel's axle. `spins` are the spinning wheel nodes, at phase 0.
 */
export function installSuppliedWheelBlur(spins: readonly T.Object3D[]): SuppliedWheelBlur {
  const blur = spins.map(() => ({ value: 0 }));
  const materials: T.Material[][] = spins.map(() => []);
  const centre = new T.Vector3(),
    axisEnd = new T.Vector3();
  spins.forEach((spin, wheel) => {
    spin.updateMatrixWorld(true);
    const clones = new Map<T.Material, T.Material>();
    spin.traverse((object) => {
      if (!(object instanceof T.Mesh) || object instanceof T.SkinnedMesh) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      if (!list.some(isSuppliedTyreArt)) return;
      // The wheel's centre and axle (spin-local X) in this mesh's frame.
      spin.getWorldPosition(centre);
      object.worldToLocal(centre);
      axisEnd.set(1, 0, 0);
      spin.localToWorld(axisEnd);
      object.worldToLocal(axisEnd);
      const axis = axisEnd.clone().sub(centre).normalize();
      const swapped = list.map((material) => {
        if (!isSuppliedTyreArt(material)) return material;
        const existing = clones.get(material);
        if (existing) return existing;
        {
          const copy = material.clone();
          copy.name = `${material.name} | wheel ${wheel}`;
          // Material.clone() copies visual parameters, not the original
          // onBeforeCompile/onBeforeRender hooks. Reinstall them per wheel
          // before chaining the UV blur so the twelve tyre-sidewall copies
          // keep their independently switchable zero-alpha decal coverage
          // and source-preserving shader optimizations.
          if (copy instanceof T.MeshStandardMaterial) {
            configureSuppliedMaterial(copy);
            installSuppliedShaderWork(copy);
          }
          const uniforms = {
            wheelCentre: { value: centre.clone() },
            wheelAxis: { value: axis.clone() },
            wheelBlurAmount: blur[wheel],
          };
          chainShaderHook(copy, 'supplied-wheel-blur-v1', (shader) => {
            Object.assign(shader.uniforms, uniforms);
            injectDeclarations(shader, 'common', OBJECT_POSITION, 'vertex');
            injectAfter(shader, 'begin_vertex', OBJECT_POSITION_VERTEX, 'vertex');
            injectDeclarations(
              shader,
              'common',
              `${OBJECT_POSITION}\nuniform vec3 wheelCentre;\nuniform vec3 wheelAxis;\nuniform float wheelBlurAmount;`,
              'fragment',
            );
            injectAfter(shader, 'map_fragment', SUPPLIED_BLUR_GLSL, 'fragment');
          });
          clones.set(material, copy);
          materials[wheel].push(copy);
          return copy;
        }
      });
      object.material = Array.isArray(object.material) ? swapped : swapped[0];
    });
  });
  return { blur, materials };
}
