import { Vector3 } from 'three';
import { clamp, mod } from '../core/math.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../simulation/protocol.ts';
import { inStandFootprint } from './grandstand.ts';

export interface BroadcastSubjectVisibility {
  /** At most eight finite world-space subject-boundary points. */
  readonly points: readonly Vector3[];
  /** Actual actor culling anchor, not the offset optical target. */
  readonly anchor: Vector3;
  readonly maxDistance: number;
}

export interface CameraRig {
  id: number;
  centerS: number;
  coverageM: number;
  position: Vector3;
  baseFov: number;
  trackingHz: number;
  zoomHz: number;
  shot: 'grid-finish' | 'corner' | 'straight' | 'elevated';
  leadSeconds: number;
}
// Alternating crane/low platform placements are authored, not random camera
// teleport offsets. Pit-lane cameras stay across the circuit from the garages.
export const TRACKSIDE_PLATFORMS = [
  [-1, 5, 43],
  // Pit-facing pedestal clears the actual 3.8 m fence crown across all bays.
  // Circuit infrastructure is built from this same permanent authored site.
  [-1, 4.9, 38],
  [-1, 5, 42],
  [1, 7, 36],
  [-1, 4, 42],
  [1, 5, 40],
  [-1, 3.5, 45],
  [1, 6, 39],
  [-1, 5, 40],
  [1, 3.5, 42],
  [-1, 6, 38],
  [1, 5, 40],
  [-1, 4, 43],
  [1, 7, 37],
  [-1, 3.5, 44],
  [1, 5, 40],
  [-1, 6, 37],
  [1, 4, 42],
  [-1, 5, 40],
  [-1, 6, 42],
] as const;

export const BROADCAST_STYLES = Object.freeze({
  'grid-finish': { panHz: 12, zoomHz: 7, leadSeconds: 0.1 },
  corner: { panHz: 11, zoomHz: 6, leadSeconds: 0.08 },
  straight: { panHz: 9, zoomHz: 5, leadSeconds: 0.16 },
  elevated: { panHz: 7, zoomHz: 4, leadSeconds: 0.12 },
});

/** Widen for nearby moving battle participants without a nearest-car identity
 * switch. Weight reaches exactly zero at 16m. The followed car remains the
 * optical subject; portrait/close views may fall back to single-car framing. */
export function broadcastRadius(frame: Float32Array, followed: number) {
  const cars = frame[H.CARS];
  if (
    !Number.isInteger(cars) ||
    cars < 1 ||
    cars > 12 ||
    !Number.isInteger(followed) ||
    followed < 0 ||
    followed >= cars ||
    frame.length < HEADER + cars * CAR_STRIDE
  )
    throw new Error('Invalid broadcast frame');
  const o = carBase(followed);
  let radius = 3.1;
  for (let id = 0; id < cars; id++) {
    const b = carBase(id);
    if (id === followed || frame[b + F.RETIRED] || frame[b + F.IN_PIT]) continue;
    const d = Math.hypot(
      frame[b + F.X] - frame[o + F.X],
      frame[b + F.Y] - frame[o + F.Y],
      frame[b + F.Z] - frame[o + F.Z],
    );
    if (!Number.isFinite(d)) throw new Error('Invalid broadcast participant');
    const t = clamp((16 - d) / 8, 0, 1),
      weight = t * t * (3 - 2 * t);
    radius = Math.max(radius, 3.1 + d * weight);
  }
  return radius;
}

export function tracksideRigs(track: Track): readonly CameraRig[] {
  const p = trackPoint(),
    spacing = track.length / TRACKSIDE_PLATFORMS.length;
  return TRACKSIDE_PLATFORMS.map(([side, height, fov], id): CameraRig => {
    const centerS = id * spacing;
    track.at(centerS + spacing * 0.18, p);
    let offset = side * (p.width + 18);
    // Old lens sites were underneath or beside stand canopies. Author a permanent
    // front-walkway pedestal, outside the protected road and in front of the
    // canopy edge. The visible infrastructure consumes this SAME site; never
    // hide the stand or move a camera dynamically to mask an obstruction.
    if (inStandFootprint(track, p.x + p.nx * offset, p.z + p.nz * offset, 1.2, 22))
      offset = side * (track.boundary(centerS + spacing * 0.18, side) + 3.4);
    const shot: CameraRig['shot'] =
      id === 0
        ? 'grid-finish'
        : Math.abs(p.curvature) > 0.012
          ? 'corner'
          : height >= 6
            ? 'elevated'
            : 'straight';
    const style = BROADCAST_STYLES[shot];
    return {
      id,
      centerS,
      coverageM: spacing + 16,
      position: new Vector3(p.x + p.nx * offset, p.y + height, p.z + p.nz * offset),
      baseFov: fov,
      trackingHz: style.panHz,
      zoomHz: style.zoomHz,
      shot,
      leadSeconds: style.leadSeconds,
    };
  });
}

/** Broadcast telephoto (D30): a moving subject's sphere fills `fill` of the
 * smaller screen axis (scaled by the rig's authored lens: a wider rig frames
 * looser), giving a 12-24 degree lens over the authored distances with zoom
 * following the distance; a close pass widens only as far as the fit needs.
 * Below `dofBelow` degrees the renderer adds depth of field on the subject. */
export const TELEPHOTO = Object.freeze({
  fill: 0.5,
  minFov: 12,
  maxFov: 24,
  dofBelow: 20,
});
// The lens itself is a broadcast camera's thin lens (studio/subject-focus.ts
// BROADCAST_LENS): a depth-proportional blur reached 10 m either side of focus
// made every held broadcast shot a tilt-shift miniature (photoreal review).

/** A complete car fits within a 3.1 m bounding sphere. Reserve composition
 * room on the smaller screen axis, including narrow/portrait viewports. */
export function tracksideFraming(
  distanceM: number,
  baseFov: number,
  aspect = 16 / 9,
  subjectRadius = 3.1,
  service = false,
) {
  if (
    !Number.isFinite(distanceM) ||
    distanceM <= 0 ||
    !Number.isFinite(baseFov) ||
    !Number.isFinite(aspect) ||
    aspect <= 0 ||
    !Number.isFinite(subjectRadius) ||
    subjectRadius < 3.1
  )
    throw new Error('Invalid trackside framing');
  const smallAxis = Math.min(1, aspect);
  const radius = Math.asin(
    Math.min(0.98, subjectRadius / Math.max(subjectRadius + 0.1, distanceM)),
  );
  const required = (2 * Math.atan(Math.tan(radius / 0.72) / smallAxis) * 180) / Math.PI;
  // A stopped service is the crew envelope, not a wide establishing shot.
  // The old 24-degree floor left a legal distant lens showing mostly scenery.
  // Reserve the same 28% angular margin, but let the existing physical rig use
  // a telephoto lens. Ordinary moving-car and pack compositions stay unchanged.
  const fill = (TELEPHOTO.fill * 40) / clamp(baseFov, 30, 50);
  const tele = (2 * Math.atan(Math.tan(radius) / (fill * smallAxis)) * 180) / Math.PI;
  const fov = service
    ? clamp(required, 4, 55)
    : Math.min(55, Math.max(clamp(tele, TELEPHOTO.minFov, TELEPHOTO.maxFov), required));
  const half = Math.atan(Math.tan((fov * Math.PI) / 360) * smallAxis);
  return {
    fov,
    minimumFov: Math.min(55, required),
    gazeAllowance: Math.max(0, half * 0.78 - radius),
    fits: radius < half,
  };
}

/** Fixed trackside positions plus a predictable pan/zoom director. Replay seeks
 * and camera cuts reset the pan; normal boundary jitter uses coverage hysteresis. */
export class TracksideDirector {
  readonly rigs: readonly CameraRig[];
  readonly position = new Vector3();
  readonly gaze = new Vector3();
  private predicted = new Vector3();
  private targetDirection = new Vector3();
  private viewDirection = new Vector3();
  framingFits = true;
  occluded = false;
  visibilityCuts = 0;
  subjectRadius = 3.1;
  subjectScreenFraction = 0;
  subjectVisibleSamples = 1;
  subjectSampleCount = 1;
  subjectWithinRange = true;
  activeId = -1;
  cuts = 0;
  fov = 42;
  private previousS = NaN;
  private previousAspect = NaN;
  private previousService = false;
  constructor(
    readonly track: Track,
    private readonly blocked?: (from: Vector3, to: Vector3) => boolean,
  ) {
    this.rigs = tracksideRigs(track);
  }
  reset() {
    this.activeId = -1;
    this.previousS = NaN;
    this.previousAspect = NaN;
    this.previousService = false;
    this.subjectScreenFraction = 0;
    this.occluded = false;
    this.subjectVisibleSamples = this.subjectSampleCount = 1;
    this.subjectWithinRange = true;
  }
  update(
    s: number,
    target: Vector3,
    velocity: Vector3,
    dt: number,
    aspect = 16 / 9,
    radius = 3.1,
    strictRadius = false,
    visibility?: BroadcastSubjectVisibility,
  ) {
    if (
      !Number.isFinite(
        s + dt + target.x + target.y + target.z + velocity.x + velocity.y + velocity.z,
      ) ||
      dt < 0
    )
      throw new Error('Invalid trackside camera state');
    const length = this.track.length;
    s = mod(s, length);
    const spacing = length / this.rigs.length;
    const distance = (a: number, b: number) =>
      Math.abs(mod(a - b + length / 2, length) - length / 2);
    const seek = Number.isFinite(this.previousS) && distance(s, this.previousS) > spacing;
    let id = this.activeId;
    if (id < 0 || seek || distance(s, this.rigs[id].centerS) > this.rigs[id].coverageM / 2)
      id = Math.round(s / spacing) % this.rigs.length;
    const requestedId = id;
    this.subjectSampleCount = 1;
    this.subjectVisibleSamples = 1;
    this.subjectWithinRange = true;
    if (visibility) {
      if (
        visibility.points.length > 8 ||
        !Number.isFinite(visibility.maxDistance) ||
        visibility.maxDistance <= 0 ||
        ![visibility.anchor.x, visibility.anchor.y, visibility.anchor.z].every(Number.isFinite) ||
        visibility.points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
      )
        throw new Error('Invalid broadcast subject visibility');
      this.subjectSampleCount += visibility.points.length;
      const inRange = (candidate: number) =>
        this.rigs[candidate].position.distanceTo(visibility.anchor) <= visibility.maxDistance;
      const fits = (candidate: number) =>
        tracksideFraming(
          Math.max(0.001, this.rigs[candidate].position.distanceTo(target)),
          this.rigs[candidate].baseFov,
          aspect,
          radius,
          true,
        ).fits;
      // Prefer a previously chosen service lens while its physical view remains
      // suitable. A stopped car must not cut back and forth at a road-sector edge.
      if (!seek && this.activeId >= 0 && inRange(this.activeId) && fits(this.activeId))
        id = this.activeId;
      const samples = (candidate: number) => {
        const from = this.rigs[candidate].position;
        const centre = !(this.blocked?.(from, target) ?? false);
        let visible = 0;
        for (const point of visibility.points)
          if (!(this.blocked?.(from, point) ?? false)) visible++;
        // The optical centre outweighs every boundary probe combined. Never
        // trade a hidden car for merely visible empty corners of the envelope.
        return {
          centre,
          visible: visible + Number(centre),
          score: visible + (centre ? this.subjectSampleCount : 0),
        };
      };
      let best = samples(id),
        selected = id;
      const usable = inRange(id) && fits(id);
      if (!usable || best.visible < this.subjectSampleCount) {
        let bestScore = usable ? best.score : -1;
        const candidates = this.rigs.map((rig) => rig.id).filter((candidate) => candidate !== id);
        candidates.sort(
          (a, b) => distance(s, this.rigs[a].centerS) - distance(s, this.rigs[b].centerS) || a - b,
        );
        for (const candidate of candidates) {
          // A distant lens which fits a sphere but culls all fifteen mechanics
          // is not a valid service camera. Keep the real crew visibility limit.
          if (!inRange(candidate) || !fits(candidate)) continue;
          const current = samples(candidate);
          if (current.score > bestScore) {
            selected = candidate;
            best = current;
            bestScore = current.score;
          }
          if (best.visible === this.subjectSampleCount) break;
        }
      }
      id = selected;
      this.subjectVisibleSamples = best.visible;
      this.subjectWithinRange = inRange(id);
      this.occluded = !best.centre;
      if (id !== requestedId && id !== this.activeId) this.visibilityCuts++;
    } else {
      this.occluded = this.blocked?.(this.rigs[id].position, target) ?? false;
      if (this.occluded) {
        // Only choose existing neighbouring physical rigs. Never move a camera
        // through scenery or hide an occluder to manufacture a clear shot.
        const candidates = [-1, 1, -2, 2].map((offset) => mod(id + offset, this.rigs.length));
        candidates.sort(
          (a, b) => distance(s, this.rigs[a].centerS) - distance(s, this.rigs[b].centerS) || a - b,
        );
        const replacement = candidates.find(
          (candidate) => !this.blocked!(this.rigs[candidate].position, target),
        );
        if (replacement !== undefined) {
          id = replacement;
          this.occluded = false;
          if (id !== this.activeId) this.visibilityCuts++;
        }
      }
      if (
        strictRadius &&
        radius > 3.1 &&
        !tracksideFraming(
          Math.max(0.001, this.rigs[id].position.distanceTo(target)),
          this.rigs[id].baseFov,
          aspect,
          radius,
        ).fits
      ) {
        // A real pack requires a suitable physical camera, not a secretly reduced
        // bounding sphere. Prefer the nearest unobstructed authored rig that fits.
        const candidates = this.rigs.map((r) => r.id).filter((candidate) => candidate !== id);
        candidates.sort(
          (a, b) => distance(s, this.rigs[a].centerS) - distance(s, this.rigs[b].centerS) || a - b,
        );
        const replacement = candidates.find((candidate) => {
          const rig = this.rigs[candidate];
          return (
            !(this.blocked?.(rig.position, target) ?? false) &&
            tracksideFraming(
              Math.max(0.001, rig.position.distanceTo(target)),
              rig.baseFov,
              aspect,
              radius,
            ).fits
          );
        });
        if (replacement !== undefined) {
          id = replacement;
          this.occluded = false;
        }
      }
    }
    if (!visibility) this.subjectVisibleSamples = Number(!this.occluded);
    const cut = id !== this.activeId || seek;
    // A held replay may change composition without advancing the camera clock.
    // Present the requested lens immediately, rather than retaining a wide lens
    // forever until the player resumes. A moving sequence keeps its zoom rate.
    const resized =
      aspect !== this.previousAspect || (dt === 0 && !!visibility !== this.previousService);
    const rig = this.rigs[id];
    this.position.copy(rig.position);
    const distanceM = this.position.distanceTo(target);
    let framing = tracksideFraming(
      Math.max(0.001, distanceM),
      rig.baseFov,
      aspect,
      radius,
      !!visibility,
    );
    this.subjectRadius = radius;
    if (!framing.fits && radius > 3.1 && !strictRadius && !visibility) {
      this.subjectRadius = 3.1;
      framing = tracksideFraming(Math.max(0.001, distanceM), rig.baseFov, aspect);
    }
    this.framingFits = framing.fits;
    const speed = velocity.length();
    const lead = Math.min(
      rig.leadSeconds,
      (distanceM * Math.tan(framing.gazeAllowance * 0.6)) / Math.max(0.001, speed),
    );
    this.predicted.copy(target).addScaledVector(velocity, lead);
    const fov = framing.fov;
    if (cut || resized) {
      this.gaze.copy(this.predicted);
      this.fov = fov;
      if (cut) this.cuts++;
    } else {
      const mix = -Math.expm1(-rig.trackingHz * dt);
      this.gaze.lerp(this.predicted, mix);
      this.fov += (fov - this.fov) * -Math.expm1(-rig.zoomHz * dt);
      // Widen immediately when required for safety; tighten with the authored
      // lens rate. No lag-induced cropping on a fast approach.
      this.fov = Math.max(framing.minimumFov, this.fov);
    }
    // Pan filtering must not push a close, fast car outside the frame. Clamp
    // the optical direction to a safe cone; never translate the physical rig.
    if (cut || resized || dt > 0) {
      // The actual filtered FOV, not a second distance-scaled FOV, owns the cone.
      const half = Math.atan(Math.tan((this.fov * Math.PI) / 360) * Math.min(1, aspect));
      const radius = Math.asin(
        Math.min(0.98, this.subjectRadius / Math.max(this.subjectRadius + 0.1, distanceM)),
      );
      const allowed = Math.max(0, half * 0.78 - radius);
      this.framingFits = radius < half;
      this.targetDirection.copy(target).sub(this.position).normalize();
      this.viewDirection.copy(this.gaze).sub(this.position).normalize();
      const dot = clamp(this.targetDirection.dot(this.viewDirection), -1, 1);
      const angle = Math.acos(dot);
      if (angle > allowed + 1e-8) {
        if (dot < -0.9999 || allowed === 0) this.gaze.copy(target);
        else {
          const fraction = allowed / angle,
            sine = Math.sin(angle);
          this.gaze
            .copy(this.targetDirection)
            .multiplyScalar(Math.sin((1 - fraction) * angle) / sine)
            .addScaledVector(this.viewDirection, Math.sin(fraction * angle) / sine)
            .multiplyScalar(distanceM)
            .add(this.position);
        }
      }
    }
    this.framingFits = this.framingFits && !this.occluded && this.subjectWithinRange;
    this.activeId = id;
    this.previousS = s;
    this.previousAspect = aspect;
    this.previousService = !!visibility;
    // Projected sphere diameter / smaller viewport dimension. This is a bound
    // occupancy witness, not a claim that every enclosed actor pixel is visible.
    const angularRadius = Math.asin(
      Math.min(0.98, this.subjectRadius / Math.max(this.subjectRadius + 0.1, distanceM)),
    );
    this.subjectScreenFraction =
      Math.tan(angularRadius) / (Math.tan((this.fov * Math.PI) / 360) * Math.min(1, aspect));
    return this;
  }
}
