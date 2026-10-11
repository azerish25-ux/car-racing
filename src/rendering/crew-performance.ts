import * as T from 'three';
import data from './crew-performance.geometry.json' with { type: 'json' };
import manifest from './crew-performance.manifest.json' with { type: 'json' };
import { CREW_FOREARM, CREW_UPPER_ARM, type CrewPoseStyle } from './crew-pose.ts';
import { crewBodyGeometry, crewHandGeometry } from './human-kit.ts';

export const CREW_PERFORMANCE = Object.freeze({ ...manifest });
export type CrewMesh = keyof typeof data.meshes;
export type CrewAction = keyof typeof data.clips;
let verified = false;

/** The exact Blender-exported kit is shared by grid and pit service. Legacy
 * spectators, marshals and supplied driver remain on their retained assets. */
export function crewPerformanceGeometry(role: CrewMesh, left = false) {
  // Bodies and gloves are the procedural human kit (sculpted anatomy on the
  // same skeleton); the authored helmet and the evaluated actions remain.
  if (role === 'suit_near' || role === 'suit_mid' || role === 'glove') {
    if (left && role !== 'glove') throw new Error('Only glove topology has a left-hand variant');
    const g =
      role === 'glove'
        ? crewHandGeometry(0, left)
        : crewBodyGeometry('suit', role === 'suit_near' ? 0 : 1);
    g.name = `A41/A42 ${role}${left ? ' left' : ''}`;
    g.userData = { ...g.userData, authoredRole: role, finalArtApproved: false };
    return g;
  }
  if (!verified) {
    for (const [name, mesh] of Object.entries(data.meshes)) {
      const n = mesh.position.length / 3;
      if (!Number.isInteger(n) || n < 3 || n > 20000 || mesh.index.length % 3)
        throw new Error(`Invalid crew-performance topology: ${name}`);
      for (const [key, values] of Object.entries(mesh)) {
        if (!values.every(Number.isFinite)) throw new Error(`Nonfinite crew ${key}`);
      }
      for (const [values, size] of [
        [mesh.normal, 3],
        [mesh.color, 3],
        [mesh.joints, 4],
        [mesh.weights, 4],
        [mesh.cloth, 1],
        [mesh.uv, 2],
      ] as const) {
        if (values.length !== n * size)
          throw new Error(`Invalid crew-performance attribute: ${name}`);
      }
      if (mesh.index.some((i) => !Number.isInteger(i) || i < 0 || i >= n))
        throw new Error(`Invalid crew-performance index: ${name}`);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const j = mesh.joints[i * 4 + k],
            w = mesh.weights[i * 4 + k];
          if (!Number.isInteger(j) || j < 0 || j >= 15 || w < 0 || w > 1)
            throw new Error(`Invalid crew-performance skin: ${name}`);
          sum += w;
        }
        if (Math.abs(sum - 1) > 1e-5) throw new Error('Unnormalized crew skin');
      }
    }
    verified = true;
  }
  const mesh = data.meshes[role],
    g = new T.BufferGeometry();
  for (const [key, values, size] of [
    ['position', mesh.position, 3],
    ['normal', mesh.normal, 3],
    ['color', mesh.color, 3],
    ['crewJoint', mesh.joints, 4],
    ['crewWeight', mesh.weights, 4],
    ['crewCloth', mesh.cloth, 1],
    ['uv', mesh.uv, 2],
  ] as const)
    g.setAttribute(key, new T.Float32BufferAttribute(values, size));
  g.setIndex(mesh.index);
  if (left) throw new Error('Only glove topology has a left-hand variant');
  g.name = `A41/A42 ${role}${left ? ' left' : ''}`;
  g.userData = {
    sourceSHA256: manifest.runtimeSHA256,
    authoredRole: role,
    finalArtApproved: false,
  };
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The authored actions were keyed for a longer (0.70 m) arm. Hand targets
 * taken from them are pulled towards the shoulder so the human-length arm
 * hangs relaxed, elbow softly bent, instead of locking straight. */
export function relaxedWrist(
  joints: readonly T.Vector3[],
  side: 0 | 1,
  out: T.Vector3,
  reach = CREW_UPPER_ARM + CREW_FOREARM,
) {
  const shoulder = joints[side ? 6 : 3],
    wrist = joints[side ? 8 : 5];
  out.copy(wrist).sub(shoulder);
  const length = out.length();
  // 0.70 m authored arm -> at most 94 % of the human reach.
  const target = Math.min(length * (reach / 0.7), reach * 0.965);
  if (length > 1e-6) out.multiplyScalar(target / length);
  // A little outward and forward carry, like a relaxed stance.
  out.z += 0.035;
  return out.add(shoulder);
}

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
/** No per-actor AnimationMixer or per-frame buffers. These poses are sampled
 * from evaluated Blender actions. IK retargets only external contact constraints.
 * The table retains every joint so sampled poses are independently inspectable. */
export class CrewPerformanceSampler {
  readonly joints = Array.from({ length: 15 }, () => new T.Vector3());
  readonly rotations = Array.from({ length: 15 }, () => new T.Quaternion());
  readonly style: CrewPoseStyle = {
    pelvis: new T.Vector3(),
    torso: new T.Quaternion(),
    head: new T.Quaternion(),
    arms: [new T.Vector3(), new T.Vector3()],
    legs: [new T.Vector3(), new T.Vector3()],
  };
  action: CrewAction = 'idle';
  time = 0;
  private readonly next = new T.Quaternion();
  private readonly point = new T.Vector3();

  sample(action: CrewAction, time: number, loop = false, blend = 1) {
    const clip = data.clips[action];
    if (!clip || !Number.isFinite(time) || !Number.isFinite(blend) || blend < 0 || blend > 1)
      throw new Error('Invalid authored crew sample');
    time = loop
      ? ((time % clip.duration) + clip.duration) % clip.duration
      : Math.max(0, Math.min(clip.duration, time));
    const frame = time * clip.fps,
      lo = Math.floor(frame),
      hi = Math.min(lo + 1, clip.frames.length - 1);
    const a = clip.frames[lo],
      b = clip.frames[hi],
      u = frame - lo;
    for (let bone = 0; bone < 15; bone++) {
      const offset = bone * 7;
      this.point.fromArray(a, offset);
      this.point.x += (b[offset] - a[offset]) * u;
      this.point.y += (b[offset + 1] - a[offset + 1]) * u;
      this.point.z += (b[offset + 2] - a[offset + 2]) * u;
      if (blend === 1) this.joints[bone].copy(this.point);
      else this.joints[bone].lerp(this.point, blend);
      this.next.fromArray(a, offset + 3);
      // Reuse the style quaternion as scratch until the evaluated style is built.
      this.style.torso.fromArray(b, offset + 3);
      this.next.slerp(this.style.torso, u).normalize();
      if (blend === 1) this.rotations[bone].copy(this.next);
      else this.rotations[bone].slerp(this.next, blend).normalize();
    }
    this.action = action;
    this.time = time;
    this.style.pelvis.set(this.joints[0].x, 0, this.joints[0].z);
    this.style.torso.copy(this.rotations[1]);
    this.style.head.copy(this.rotations[2]);
    for (const side of [0, 1] as const) {
      const a = side ? 6 : 3,
        l = side ? 12 : 9;
      this.style.arms[side]
        .copy(this.joints[a + 1])
        .sub(this.joints[a])
        .normalize();
      // Retarget an authored elbow to a different handle without crossing its
      // anatomical bend plane. A nearly collinear pole makes the IK solution
      // flip while lifting; keep an outward component on the original side.
      const sign = side ? 1 : -1;
      this.style.arms[side].x = sign * Math.max(0.35, sign * this.style.arms[side].x);
      this.style.arms[side].normalize();
      this.style.legs[side]
        .copy(this.joints[l + 1])
        .sub(this.joints[l])
        .normalize();
    }
    return this;
  }

  grid(time: number, distancePhase: number) {
    if (!Number.isFinite(time + distancePhase)) throw new Error('Invalid grid-action clock');
    let action: CrewAction,
      local: number,
      previous: CrewAction,
      previousTime: number,
      start: number;
    if (time < 4) return this.sample('idle', time, true);
    if (time < 7) {
      action = 'walk';
      local = distancePhase * 1.2;
      previous = 'idle';
      previousTime = 4;
      start = 4;
    } else if (time < 9) {
      action = 'kneel';
      local = time - 7;
      previous = 'walk';
      previousTime = 1.2;
      start = 7;
    } else if (time < 12) {
      action = 'inspect';
      local = time - 9;
      previous = 'kneel';
      previousTime = 2;
      start = 9;
    } else if (time < 15) {
      action = 'lift';
      local = time - 12;
      previous = 'inspect';
      previousTime = 3;
      start = 12;
    } else if (time < 17) {
      action = 'stand';
      local = time - 15;
      previous = 'lift';
      previousTime = 3;
      start = 15;
    } else if (time < 20) {
      action = 'turn';
      local = (time - 17) / 2.5;
      previous = 'stand';
      previousTime = 2;
      start = 17;
    } else if (time < 23) {
      action = 'carry';
      local = distancePhase * 1.2;
      previous = 'turn';
      previousTime = 1.2;
      start = 20;
    } else if (time < 26) {
      action = 'turn';
      local = (time - 23) / 2.5;
      previous = 'carry';
      previousTime = 1.2;
      start = 23;
    } else if (time < 34) {
      action = 'carry';
      local = distancePhase * 1.2;
      previous = 'turn';
      previousTime = 1.2;
      start = 26;
    } else {
      action = 'idle';
      local = 0;
      previous = 'carry';
      previousTime = 1.2;
      start = 34;
    }
    if (time - start < 0.3) this.sample(previous, previousTime);
    return this.sample(
      action,
      local,
      action === 'walk' || action === 'carry',
      smooth((time - start) / 0.3),
    );
  }
}
