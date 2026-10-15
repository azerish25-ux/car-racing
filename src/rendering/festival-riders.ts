import * as T from 'three';
import { F, H, carBase } from '../simulation/protocol.ts';
import { BikeShells } from './bike.ts';
import type { QualityPreset } from './options.ts';

/**
 * Motorcycles in the festival: the circuit's procedural bike presentation
 * (BikeShells: road bikes and the supermoto, rider, lean, suspension) posed
 * over the festival snapshot. The festival car presentation draws no body
 * for a motorcycle entrant, so this is the only representation; it is
 * updated before the festival renderer draws, from the same interpolation.
 */
export class FestivalRiders {
  readonly shells = new BikeShells();
  private readonly hosts: { root: T.Object3D }[] = [];
  private readonly qa = new T.Quaternion();
  private readonly qb = new T.Quaternion();
  private active = false;
  get root() {
    return this.shells.root;
  }
  update(a: Float32Array, b: Float32Array, alpha: number, camera: T.PerspectiveCamera, quality: QualityPreset) {
    if (a.length !== b.length || a[H.CARS] !== b[H.CARS] || b[H.TIME] < a[H.TIME]) a = b;
    const cars = Math.round(b[H.CARS]);
    let bikes = false;
    for (let id = 0; id < cars && !bikes; id++) bikes = BikeShells.isBike(b, id);
    // Nothing to draw and nothing left over from an earlier rider.
    if (!bikes && !this.active) return;
    this.active = bikes;
    while (this.hosts.length < cars) this.hosts.push({ root: new T.Object3D() });
    const t = a === b ? 1 : Math.min(1, Math.max(0, alpha));
    for (let id = 0; id < cars; id++) {
      const o = carBase(id),
        host = this.hosts[id].root;
      host.position.set(
        T.MathUtils.lerp(a[o + F.X], b[o + F.X], t),
        T.MathUtils.lerp(a[o + F.Y], b[o + F.Y], t),
        T.MathUtils.lerp(a[o + F.Z], b[o + F.Z], t),
      );
      this.qa.set(a[o + F.QX], a[o + F.QY], a[o + F.QZ], a[o + F.QW]);
      this.qb.set(b[o + F.QX], b[o + F.QY], b[o + F.QZ], b[o + F.QW]);
      host.quaternion.copy(this.qa.slerp(this.qb, t));
    }
    this.shells.update(a, b, t, this.hosts, camera, quality === 'ultra' ? 'high' : quality, 0);
  }
  /** Release every bike built for this session (models, riders, materials
   * and their textures) and detach the root: the festival shares the
   * application's WebGL renderer, which outlives it. */
  dispose() {
    this.shells.disposeAll();
    this.shells.root.removeFromParent();
    this.active = false;
  }
}
