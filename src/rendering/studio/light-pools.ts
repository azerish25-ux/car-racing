import * as T from 'three';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { inStandFootprint } from '../grandstand.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';

/**
 * Night floodlight pools (D28 night-golden-hour).
 *
 * Night races are lit by rows of poles along both sides of the circuit. Four
 * real point lights (VenueLighting) cannot draw that: the track read as one
 * flat dark grey. Here every track ribbon (road, kerbs, lines, run-off, gravel,
 * grass apron; their uv is lateral and lap metres / 5) adds the light of an
 * analytic row of lamps in lap space: one lamp every `spacing` m on each side,
 * the two sides staggered by half a spacing, `height` m up and `lateral` m from
 * the centreline. Each pixel sums the four nearest lamps per side (8 taps, any
 * number of lamps lit at 0 draw calls), E = I cos(theta) / r^2 on the surface
 * normal's vertical share, so pools sit under the lamps. Review (orchestrator,
 * perf-budget-v1 shot 40): with 13 m lamps every 32 m the road read one flat,
 * almost daytime grey; 9 m lamps every 40 m leave the asphalt between pools at
 * about 0.35 of the light under a lamp (the darker unlit night road).
 *
 * The visible poles (one instanced pole-and-arm mesh, one instanced lamp-head
 * mesh, +2 draws at night only, hidden by day) stand at the same lap positions,
 * just outside the track boundary, skipping grandstands and the pit straight's
 * pit side. Lamp heads are unlit HDR white so the bloom draws their halo.
 */
export const LIGHT_POOLS = Object.freeze({
  spacing: 40,
  height: 9,
  /** Analytic lamp offset from the centreline (m). */
  lateral: 12,
  /** Lamp intensity (cd-like units in the renderer's linear scale). */
  intensity: 300,
  colour: 0xf4f0e8,
  /** Lamp-head radiance (x linear white) for the threshold bloom's halo. */
  headGain: 12,
  /** ULTRA (energy-conserving bloom): the head in physical radiance, about
   * 25x sunlit white, so the lens's glare draws a halo around it. */
  physicalHeadGain: 300,
  /** Pole clearance outside the track boundary (m) and arm reach toward the road. */
  clearance: 2.5,
  arm: 2.2,
});
/** Pool strength by lighting: full at night, a hint at golden hour. */
export const POOL_STRENGTH = Object.freeze({ day: 0, sunset: 0.12, night: 1 });
/** Share of the directional key's diffuse light kept on the track ribbons.
 * At night the key is the floodlights' light on vertical faces (cars, walls;
 * circuitLightState night sun 0.6), but from the 52 degree sun direction it
 * also lit the road evenly, the "daytime grey" of the night review; the
 * ribbons take their light from the pools instead. */
export const RIBBON_KEY_SHARE = Object.freeze({ day: 1, sunset: 1, night: 0.3 });

export const lightPoolUniforms = Object.freeze({
  lightPoolStrength: { value: 0 },
  lightPoolKeyShare: { value: 1 },
  lightPoolColor: { value: new T.Color(LIGHT_POOLS.colour) },
});

const f = (v: number) => v.toFixed(4);
const DECLARATIONS = /* glsl */ `
varying vec2 vPoolLap;
uniform float lightPoolStrength;
uniform float lightPoolKeyShare;
uniform vec3 lightPoolColor;
// Sum of cos(theta) / r^2 from the nearest lamps of both rows (lap metres).
float apexPoolIrradiance( vec2 lap ) {
	float e = 0.0;
	for ( int side = 0; side < 2; side ++ ) {
		float sgn = side == 0 ? 1.0 : - 1.0;
		float phase = side == 0 ? 0.0 : ${f(LIGHT_POOLS.spacing / 2)};
		float k0 = floor( ( lap.y - phase ) / ${f(LIGHT_POOLS.spacing)} );
		for ( int k = - 1; k <= 2; k ++ ) {
			float along = ( k0 + float( k ) ) * ${f(LIGHT_POOLS.spacing)} + phase - lap.y;
			vec3 d = vec3( along, ${f(LIGHT_POOLS.height)}, sgn * ${f(LIGHT_POOLS.lateral)} - lap.x );
			float r2 = dot( d, d );
			e += ${f(LIGHT_POOLS.height)} * inversesqrt( r2 ) / r2;
		}
	}
	return e;
}`;

const POOL_GLSL = /* glsl */ `
if ( lightPoolStrength > 0.0 ) {
	// D28 floodlight pools: diffuse light from the analytic lamp rows above;
	// at night they replace most of the directional key on the track surfaces.
	reflectedLight.directDiffuse *= lightPoolKeyShare;
	vec3 poolUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
	float poolFacing = clamp( dot( normal, poolUp ), 0.0, 1.0 );
	vec3 poolIrradiance = lightPoolColor * ( lightPoolStrength * ${f(LIGHT_POOLS.intensity)} * poolFacing ) * apexPoolIrradiance( vPoolLap );
	reflectedLight.directDiffuse += poolIrradiance * BRDF_Lambert( material.diffuseColor );
}`;

export const LIGHT_POOL_HOOK = 'light-pools-v2';
/** Light a track ribbon material (uv = lateral, lap metres / 5) with the pools. */
export function installLightPools(material: T.Material) {
  return chainShaderHook(material, LIGHT_POOL_HOOK, (shader) => {
    Object.assign(shader.uniforms, lightPoolUniforms);
    injectDeclarations(shader, 'common', 'varying vec2 vPoolLap;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vPoolLap = uv * 5.0;', 'vertex');
    injectDeclarations(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'lights_fragment_end', POOL_GLSL, 'fragment');
  });
}

/** CPU twin of the shader sum, for tests and diagnostics. `lap` = (lateral, s). */
export function poolIrradiance(lateral: number, s: number) {
  let e = 0;
  for (let side = 0; side < 2; side++) {
    const sgn = side === 0 ? 1 : -1,
      phase = side === 0 ? 0 : LIGHT_POOLS.spacing / 2;
    const k0 = Math.floor((s - phase) / LIGHT_POOLS.spacing);
    for (let k = -1; k <= 2; k++) {
      const along = (k0 + k) * LIGHT_POOLS.spacing + phase - s;
      const across = sgn * LIGHT_POOLS.lateral - lateral;
      const r2 = along * along + LIGHT_POOLS.height ** 2 + across * across;
      e += LIGHT_POOLS.height / (Math.sqrt(r2) * r2);
    }
  }
  return e;
}

export interface PoolLampSite {
  s: number;
  side: number;
  x: number;
  z: number;
  baseY: number;
  /** Rotation about +Y that points the pole's local +X (its arm) at the track. */
  yaw: number;
}
/** Visible pole sites at the analytic lamp positions, outside the boundary. */
export function poolLampSites(track: Track): PoolLampSite[] {
  const sites: PoolLampSite[] = [],
    p = trackPoint();
  const count = Math.floor(track.length / LIGHT_POOLS.spacing);
  for (let side = 0; side < 2; side++) {
    const sgn = side === 0 ? 1 : -1,
      phase = side === 0 ? 0 : LIGHT_POOLS.spacing / 2;
    for (let k = 0; k < count; k++) {
      const s = k * LIGHT_POOLS.spacing + phase;
      // The pit building and wall line the pit side of the main straight.
      if (sgn > 0 && (s > track.length - 260 || s < 360)) continue;
      track.at(s, p);
      const offset = sgn * (track.boundary(s, sgn) + LIGHT_POOLS.clearance);
      const x = p.x + p.nx * offset,
        z = p.z + p.nz * offset;
      if (inStandFootprint(track, x, z, 2)) continue;
      // Local +X maps to (cos yaw, -sin yaw); aim it along -sgn * normal.
      sites.push({ s, side: sgn, x, z, baseY: p.y, yaw: Math.atan2(sgn * p.nz, -sgn * p.nx) });
    }
  }
  return sites;
}

export class LightPools {
  readonly root = new T.Group();
  readonly sites: readonly PoolLampSite[];
  readonly heads: T.InstancedMesh;
  readonly poles: T.InstancedMesh;
  private readonly headMaterial: T.MeshBasicMaterial;
  constructor(
    track: Track,
    private readonly roadHardware = true,
  ) {
    this.root.name = 'Floodlight pole rows (D28)';
    this.sites = poolLampSites(track);
    const H = LIGHT_POOLS.height,
      arm = LIGHT_POOLS.arm;
    // Pole along +Y, arm toward the track along local +X (flipped per side).
    const pole = new T.CylinderGeometry(0.07, 0.11, H, 6).translate(0, H / 2, 0);
    const reach = new T.BoxGeometry(arm, 0.08, 0.08).translate(arm / 2, H - 0.1, 0);
    const merged = mergeGeometries([pole, reach]);
    this.poles = new T.InstancedMesh(
      merged,
      new T.MeshStandardMaterial({ color: 0x5d646b, metalness: 0.6, roughness: 0.45 }),
      this.sites.length,
    );
    this.headMaterial = new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.headMaterial.color.setHex(LIGHT_POOLS.colour).multiplyScalar(LIGHT_POOLS.headGain);
    this.headMaterial.name = 'Floodlight lamp heads';
    this.heads = new T.InstancedMesh(
      new T.BoxGeometry(0.9, 0.16, 0.45).translate(arm - 0.2, H - 0.25, 0),
      this.headMaterial,
      this.sites.length,
    );
    const o = new T.Object3D();
    this.sites.forEach((site, i) => {
      o.position.set(site.x, site.baseY, site.z);
      o.rotation.set(0, site.yaw, 0);
      o.updateMatrix();
      this.poles.setMatrixAt(i, o.matrix);
      this.heads.setMatrixAt(i, o.matrix);
    });
    for (const mesh of [this.poles, this.heads]) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    }
    this.root.add(this.poles, this.heads);
    this.root.visible = false;
  }
  private headGain: number = LIGHT_POOLS.headGain;
  /** Lighting mode and venue strength (the renderer's venue lighting update).
   * `physical`: the energy-conserving bloom draws the heads' glare. */
  update(mode: 'day' | 'sunset' | 'night', physical = false) {
    const gain = physical ? LIGHT_POOLS.physicalHeadGain : LIGHT_POOLS.headGain;
    if (gain !== this.headGain) {
      this.headGain = gain;
      this.headMaterial?.color.setHex(LIGHT_POOLS.colour).multiplyScalar(gain);
    }
    const strength = POOL_STRENGTH[mode];
    lightPoolUniforms.lightPoolStrength.value = strength;
    lightPoolUniforms.lightPoolKeyShare.value = RIBBON_KEY_SHARE[mode];
    // Indoor MX lights are mounted on the arena roof. Preserve the analytic
    // soil illumination without exposing these roadside poles in tight lanes.
    this.root.visible = mode === 'night' && this.roadHardware !== false;
  }
}

function mergeGeometries(parts: T.BufferGeometry[]) {
  const position: number[] = [],
    normal: number[] = [],
    index: number[] = [];
  for (const g of parts) {
    const base = position.length / 3;
    const ng = g.index ? g.toNonIndexed() : g;
    ng.computeVertexNormals();
    position.push(...(ng.getAttribute('position').array as Float32Array));
    normal.push(...(ng.getAttribute('normal').array as Float32Array));
    for (let i = 0; i < ng.getAttribute('position').count; i++) index.push(base + i);
    g.dispose();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  g.setIndex(index);
  return g;
}
