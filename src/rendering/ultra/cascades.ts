import * as T from 'three';
import { FAR_SHADOW_BLEND } from '../far-shadow.ts';
import { lightingDirection, shadowAnchor, type LightingMode } from '../daylight.ts';
import { sunPenumbraScale } from '../studio/shadow-filter.ts';

/**
 * Sun shadow cascades (ULTRA `shadowCascades: 3`).
 *
 * The retained renderer already has two sun maps: the near, car-following map
 * (directional shadow 0: light-space snapped, PCSS for the 0.53 deg sun disc)
 * and the static, whole-circuit far map (directional shadow 1, baked once per
 * lighting). Between them every caster beyond ~38 m fell back to the coarse far
 * map, and moving cars beyond it cast nothing. The mid cascade is a third
 * shadowed directional light (no light of its own) whose map covers a
 * camera-led box, re-rendered on a cadence with every caster, snapped to its
 * texel grid in light space (stable under translation) and filtered with the
 * same PCSS. The sun samples near -> mid -> far with edge hand-overs.
 *
 * Shader: a guarded patch of the far-shadow chunks. Its code exists only in
 * programs with three or more shadowed directional lights, i.e. never on
 * Low/Medium/High (two), so those programs compile exactly as before. It is
 * installed lazily when the cascade is first enabled.
 */
export const MID_SHADOW_MARK = -2;
export const CASCADES = Object.freeze({
  /** Mid map size (texels per side). */
  midSize: 2048,
  /** Practical split weight between logarithmic (1) and uniform (0) splits. */
  lambda: 0.8,
  /** Re-render every N presented frames (cut, seek and lighting force one). */
  cadence: 2,
  /** Share of the half extent the box leads the camera by. */
  lead: 0.35,
  /** Limits of the balanced mid half extent, metres. */
  minHalfExtent: 60,
  maxHalfExtent: 260,
  /** Light distance and depth range around the box centre, metres. */
  lightDistance: 700,
  depthRange: 1400,
});

/** Practical split scheme (Zhang et al., PSSM): `count` cascades between
 * `near` and `far`, returned as `count + 1` monotone distances. */
export function cascadeSplits(
  near: number,
  far: number,
  count: number,
  lambda: number = CASCADES.lambda,
) {
  if (
    !(near > 0 && far > near) ||
    !Number.isInteger(count) ||
    count < 1 ||
    !(lambda >= 0 && lambda <= 1)
  )
    throw new Error('Invalid cascade split request');
  const out = [near];
  for (let i = 1; i < count; i++) {
    const f = i / count;
    out.push(lambda * near * (far / near) ** f + (1 - lambda) * (near + (far - near) * f));
  }
  out.push(far);
  return out;
}

/** Texel-balanced mid cascade: its texel size is the geometric mean of the
 * near and far texels, so each hand-over changes resolution by the same ratio.
 * Returns the half extent in metres. */
export function balancedMidExtent(
  nearHalfExtent: number,
  nearSize: number,
  farWidth: number,
  farSize: number,
  midSize: number = CASCADES.midSize,
) {
  if (
    ![nearHalfExtent, nearSize, farWidth, farSize, midSize].every(
      (v) => Number.isFinite(v) && v > 0,
    )
  )
    throw new Error('Invalid cascade extents');
  const nearTexel = (2 * nearHalfExtent) / nearSize,
    farTexel = farWidth / farSize;
  const texel = Math.sqrt(nearTexel * farTexel);
  // At least ~1.6x the near box, so the mid cascade always covers its edge band.
  return Math.min(
    CASCADES.maxHalfExtent,
    Math.max(CASCADES.minHalfExtent, 1.6 * nearHalfExtent, (texel * midSize) / 2),
  );
}

/** World texel size of an orthographic shadow box. */
export function cascadeTexel(halfExtent: number, size: number) {
  return (2 * halfExtent) / size;
}

const DIRECTIONAL_SUN_FAR =
  /(\t\t#if defined\( USE_SHADOWMAP \) && NUM_DIR_LIGHT_SHADOWS > 1 && UNROLLED_LOOP_INDEX == 0\n)/;
const FAR_HANDOVER = 'vDirectionalShadowCoord[ 1 ], vDirectionalShadowCoord[ 0 ] );';
const FAR_OPEN =
  /(\t\t#if defined\( USE_SHADOWMAP \) && NUM_DIR_LIGHT_SHADOWS > 1 && UNROLLED_LOOP_INDEX == 1\n\t\tif \( directionalLightShadows\[ 1 \]\.shadowIntensity >= 0\.0 \) \{\n\t\t#endif\n)/;
const FAR_CLOSE =
  /(\t\t#if defined\( USE_SHADOWMAP \) && NUM_DIR_LIGHT_SHADOWS > 1 && UNROLLED_LOOP_INDEX == 1\n\t\t\}\n\t\t#endif\n)/;
const midGuard = 'defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 2';

const MID_SHADOW_GLSL = `
#if ${midGuard}
// Mid cascade: PCSS where the near map does not reach (short hand-over).
float apexMidShadow( sampler2D map, vec2 size, float bias, float radius, vec4 midCoord, vec4 nearCoord ) {
	vec3 near = nearCoord.xyz / nearCoord.w;
	float edge = min( min( near.x, 1.0 - near.x ), min( near.y, 1.0 - near.y ) );
	float nearWeight = near.z <= 1.0 ? smoothstep( 0.0, ${FAR_SHADOW_BLEND.toFixed(3)}, edge ) : 0.0;
	if ( nearWeight >= 1.0 ) return 1.0;
	vec3 c = midCoord.xyz / midCoord.w;
	c.z += bias;
	if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0 ) return 1.0;
	return mix( apexShadowFilter( map, size, radius, c.xy, c.z ), 1.0, nearWeight );
}
#define APEX_FAR_HANDOVER ( directionalLightShadows[ 2 ].shadowIntensity < -1.5 ? vDirectionalShadowCoord[ 2 ] : vDirectionalShadowCoord[ 0 ] )
#else
#define APEX_FAR_HANDOVER vDirectionalShadowCoord[ 0 ]
#endif
`;

/** Patched copies of the (far-patched) chunks with the mid cascade. Throws when
 * the far patch is not where expected; idempotent on already patched text. */
export function midCascadeChunks(lightsBegin: string, shadowPars: string) {
  if (lightsBegin.includes('apexMidShadow(')) return { lightsBegin, shadowPars };
  if (
    !DIRECTIONAL_SUN_FAR.test(lightsBegin) ||
    lightsBegin.split(FAR_HANDOVER).length !== 2 ||
    !FAR_OPEN.test(lightsBegin) ||
    !FAR_CLOSE.test(lightsBegin) ||
    !shadowPars.includes('apexFarShadow(') ||
    !shadowPars.includes('apexShadowFilter(')
  )
    throw new Error('Unexpected far-shadow chunk layout');
  const sun = `\t\t#if ${midGuard} && UNROLLED_LOOP_INDEX == 0
\t\tif ( receiveShadow && directLight.visible && directionalLightShadows[ 2 ].shadowIntensity < -1.5 )
\t\t\tdirectLight.color *= apexMidShadow( directionalShadowMap[ 2 ], directionalLightShadows[ 2 ].shadowMapSize, directionalLightShadows[ 2 ].shadowBias, directionalLightShadows[ 2 ].shadowRadius, vDirectionalShadowCoord[ 2 ], vDirectionalShadowCoord[ 0 ] );
\t\t#endif
`;
  const open = `\t\t#if ${midGuard} && UNROLLED_LOOP_INDEX == 2
\t\tif ( directionalLightShadows[ 2 ].shadowIntensity >= 0.0 ) {
\t\t#endif
`;
  const close = `\t\t#if ${midGuard} && UNROLLED_LOOP_INDEX == 2
\t\t}
\t\t#endif
`;
  const patched = lightsBegin
    .replace(DIRECTIONAL_SUN_FAR, `${sun}$1`)
    .replace(FAR_HANDOVER, 'vDirectionalShadowCoord[ 1 ], APEX_FAR_HANDOVER );')
    .replace(FAR_OPEN, `$1${open}`)
    .replace(FAR_CLOSE, `$1${close}`);
  return { lightsBegin: patched, shadowPars: shadowPars + MID_SHADOW_GLSL };
}

let installed = false;
/** Install once, before the first program with three shadowed directional
 * lights compiles (the mid cascade's first enable). */
export function installMidCascadeChunks() {
  if (installed) return false;
  const chunks = midCascadeChunks(
    T.ShaderChunk.lights_fragment_begin,
    T.ShaderChunk.shadowmap_pars_fragment,
  );
  T.ShaderChunk.lights_fragment_begin = chunks.lightsBegin;
  T.ShaderChunk.shadowmap_pars_fragment = chunks.shadowPars;
  installed = true;
  return true;
}

export interface MidCascadeFrame {
  /** Followed subject (the near map's anchor). */
  subject: T.Vector3;
  camera: T.PerspectiveCamera;
  lighting: LightingMode;
  /** The near map's half extent (sun.shadow.camera.right) and size. */
  nearHalfExtent: number;
  nearSize: number;
  /** The far map's world width and size. */
  farWidth: number;
  farSize: number;
  /** Presented time advanced (false: held, paused or menu frame). */
  advancing: boolean;
  /** View key changed or seek: refresh now. */
  cut: boolean;
}

/** The mid cascade light. Add `light` and `light.target` to the scene AFTER
 * the sun and the far light so it is directional shadow 2. */
export class MidCascade {
  readonly light = new T.DirectionalLight(0xffffff, 0);
  halfExtent: number = CASCADES.minHalfExtent;
  updates = 0;
  private frame = 0;
  private wanted = false;
  private rendered = false;
  private requested = false;
  private lighting: LightingMode | null = null;
  private readonly centre = new T.Vector3();
  private readonly forward = new T.Vector3();
  private readonly anchor = new T.Vector3();
  private readonly direction = new T.Vector3();
  constructor(size: number = CASCADES.midSize) {
    this.light.name = 'Mid sun shadow cascade (no light of its own)';
    this.light.castShadow = true;
    this.light.visible = false;
    this.light.shadow.intensity = 0;
    this.light.shadow.autoUpdate = false;
    this.light.shadow.needsUpdate = false;
    this.light.shadow.mapSize.set(size, size);
  }
  get active() {
    return this.light.visible && this.light.shadow.intensity === MID_SHADOW_MARK;
  }
  /** `available`: shadows on and the far map baked (so this light is index 2). */
  setEnabled(wanted: boolean, available: boolean) {
    this.wanted = wanted;
    const visible = wanted && available;
    if (visible) installMidCascadeChunks();
    if (visible === this.light.visible) return;
    this.light.visible = visible;
    // A map from an earlier enable may be stale: re-render before marking.
    this.light.shadow.intensity = 0;
    this.rendered = false;
    this.requested = visible;
    this.light.shadow.needsUpdate = visible;
  }
  get enabled() {
    return this.wanted;
  }
  /** Position, fit and (on cadence) request a re-render; call before the main
   * scene draw of the frame. Matrices are updated here (the renderer's frame
   * runs with scene matrix auto-update off). */
  prepare(frame: MidCascadeFrame) {
    if (!this.light.visible) return false;
    this.halfExtent = balancedMidExtent(
      frame.nearHalfExtent,
      frame.nearSize,
      frame.farWidth,
      frame.farSize,
      this.light.shadow.mapSize.x,
    );
    // Lead the camera's horizontal view direction: more cover ahead than behind.
    frame.camera.getWorldDirection(this.forward).setY(0);
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, 1);
    this.forward.normalize();
    this.centre.copy(frame.subject).addScaledVector(this.forward, CASCADES.lead * this.halfExtent);
    shadowAnchor(
      this.centre,
      this.light.shadow.mapSize.x,
      this.halfExtent,
      this.anchor,
      frame.lighting,
    );
    this.direction.copy(lightingDirection(frame.lighting)).normalize();
    this.light.target.position.copy(this.anchor);
    this.light.position.copy(this.anchor).addScaledVector(this.direction, CASCADES.lightDistance);
    this.light.updateMatrixWorld();
    this.light.target.updateMatrixWorld();
    const camera = this.light.shadow.camera;
    const e = this.halfExtent;
    if (camera.right !== e || camera.far !== CASCADES.depthRange) {
      Object.assign(camera, {
        left: -e,
        right: e,
        top: e,
        bottom: -e,
        near: 1,
        far: CASCADES.depthRange,
      });
      camera.updateProjectionMatrix();
      this.light.shadow.radius = sunPenumbraScale(camera);
    }
    const texel = cascadeTexel(e, this.light.shadow.mapSize.x);
    this.light.shadow.normalBias = texel;
    this.light.shadow.bias = -texel / (camera.far - camera.near);
    const relit = this.lighting !== frame.lighting;
    this.lighting = frame.lighting;
    if (frame.advancing) this.frame++;
    const due =
      !this.rendered ||
      relit ||
      frame.cut ||
      (frame.advancing && this.frame % CASCADES.cadence === 0);
    if (due) {
      this.light.shadow.needsUpdate = true;
      this.requested = true;
    }
    return due;
  }
  /** After the frame's scene draw: a consumed request means the map is current
   * and may shade the scene from the next frame on. */
  afterFrame() {
    if (!this.light.visible || !this.requested) return;
    if (!this.light.shadow.needsUpdate && this.light.shadow.map) {
      this.updates++;
      this.requested = false;
      this.rendered = true;
      this.light.shadow.intensity = MID_SHADOW_MARK;
    }
  }
  diagnostics() {
    return {
      enabled: this.wanted,
      active: this.active,
      mapSize: this.light.shadow.mapSize.x,
      halfExtent: this.halfExtent,
      metresPerTexel: cascadeTexel(this.halfExtent, this.light.shadow.mapSize.x),
      cadence: CASCADES.cadence,
      updates: this.updates,
    };
  }
  dispose() {
    this.light.shadow.map?.dispose();
    this.light.shadow.dispose();
  }
}
