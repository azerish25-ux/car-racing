import type * as T from 'three';
import {
  STUDIO_UNIFORM_NAMES,
  StudioFrame,
  studioUniforms,
  type StudioUniforms,
} from '../studio/studio-frame.ts';

type Copyable = { copy(value: unknown): unknown; clone(): Copyable };
type Snapshot = Partial<Record<keyof StudioUniforms, unknown>>;

/**
 * The festival's main-camera frame history. Temporal AA, ULTRA temporal AO
 * and the SSR ray rotation advance only on frames whose presented time moved
 * (`studioFrameDt > 0`) and reproject through `studioPrevViewProj`; the
 * festival never wrote them, so its TAA never resolved (even on ULTRA) and
 * would have reprojected through the idle circuit's camera. This writes the
 * shared studio uniforms from the festival's own camera, sun and followed
 * car each frame, and gives the circuit renderer (which owns them while it
 * draws) its values back on dispose, so its next frame continues its own
 * history instead of the festival's.
 */
export class FestivalFrameHistory {
  private readonly frame: StudioFrame;
  private readonly saved: Snapshot = {};
  constructor(private readonly uniforms: StudioUniforms = studioUniforms) {
    this.frame = new StudioFrame(uniforms);
    for (const name of STUDIO_UNIFORM_NAMES) this.saved[name] = clone(uniforms[name].value);
  }
  /** After the camera solve and the sun's placement, before the scene pass. */
  update(
    presented: Float32Array,
    camera: T.Camera,
    sun: T.Object3D & { target: T.Object3D },
    view: string,
  ) {
    this.frame.update(presented, camera, sun, view);
  }
  /** Seconds the presented frame advanced (0: held, paused or cut). */
  get frameDt() {
    return this.uniforms.studioFrameDt.value;
  }
  /** Give the shared uniforms back as they were before the festival. */
  restore() {
    for (const name of STUDIO_UNIFORM_NAMES) {
      const uniform = this.uniforms[name] as T.IUniform<unknown>;
      uniform.value = restoreInto(uniform.value, this.saved[name]);
    }
  }
}

function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object' && 'clone' in value) return (value as Copyable).clone();
  return value;
}
/** Copies `saved` into `current` in place where it holds objects (shader
 * programs keep the uniform's object identity), else returns `saved`. */
function restoreInto(current: unknown, saved: unknown): unknown {
  if (Array.isArray(current) && Array.isArray(saved)) {
    current.forEach((item, i) => (current[i] = restoreInto(item, saved[i])));
    return current;
  }
  if (current && typeof current === 'object' && 'copy' in current) {
    (current as Copyable).copy(saved);
    return current;
  }
  return saved;
}
