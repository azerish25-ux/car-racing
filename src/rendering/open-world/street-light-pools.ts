import * as T from 'three';
import type { QualityPreset } from '../options.ts';

export interface StreetLightSocket {
  position: T.Vector3;
  target: T.Vector3;
}
interface Candidate {
  socket: StreetLightSocket;
  index: number;
  score: number;
}
interface Slot {
  light: T.SpotLight;
  index: number;
  requested: number;
  level: number;
}

/** Real, inverse-square illumination from the existing town lamp heads.
 * Four local pools on MEDIUM, six on HIGH, eight on ULTRA; LOW keeps emissive
 * heads only. No new poles, collision objects or full-world light array.
 * Pools are unshadowed: the existing sun/contact AO supplies local shadowing.
 * Stable assignments fade to dark before moving a slot between sockets. */
export class StreetLightPools {
  readonly root = new T.Group();
  private readonly candidates: Candidate[];
  private readonly slots: Slot[] = [];
  private readonly selected = new Set<number>();
  private readonly assigned = new Set<number>();
  private readonly eye = new T.Vector3();
  private disposed = false;
  constructor(readonly sockets: readonly StreetLightSocket[]) {
    this.root.name = 'Budgeted town street illumination';
    this.candidates = sockets.map((socket, index) => ({ socket, index, score: Infinity }));
    for (let i = 0; i < 8; i++) {
      const light = new T.SpotLight(0xffdfb1, 0, 29, 0.72, 0.72, 2);
      light.name = `Town lamp pool ${i + 1}`;
      light.castShadow = false;
      light.visible = false;
      this.root.add(light, light.target);
      this.slots.push({ light, index: -1, requested: -1, level: 0 });
    }
  }
  update(camera: T.Camera, night: number, quality: QualityPreset, dt: number) {
    if (this.disposed) return;
    const strength = Number.isFinite(night) ? T.MathUtils.clamp(night, 0, 1) : 0;
    const count =
      quality === 'low' || strength <= 0.01
        ? 0
        : quality === 'medium'
          ? 4
          : quality === 'high'
            ? 6
            : 8;
    camera.getWorldPosition(this.eye);
    this.assigned.clear();
    for (const slot of this.slots) if (slot.index >= 0) this.assigned.add(slot.index);
    for (const item of this.candidates) {
      const p = item.socket.position;
      const distance = p.distanceToSquared(this.eye);
      // Retention bias prevents alternating assignments on a Voronoi edge.
      item.score = distance * (this.assigned.has(item.index) ? 0.82 : 1);
    }
    this.candidates.sort((a, b) => a.score - b.score || a.index - b.index);
    this.selected.clear();
    for (const candidate of this.candidates) {
      if (this.selected.size >= count || candidate.score > 72 * 72) break;
      this.selected.add(candidate.index);
    }
    // Preserve sockets already represented. Reserve each new destination once.
    const desired = new Set(this.selected);
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      slot.requested = i < count && this.selected.has(slot.index) ? slot.index : -1;
      if (slot.requested >= 0) desired.delete(slot.requested);
    }
    for (let i = 0; i < count; i++)
      if (this.slots[i].requested < 0) {
        const first = desired.values().next();
        if (!first.done) {
          this.slots[i].requested = first.value;
          desired.delete(first.value);
        }
      }
    const step = Number.isFinite(dt) ? T.MathUtils.clamp(dt, 0, 0.08) : 0;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const stable = slot.index === slot.requested && slot.index >= 0 && i < count;
      slot.level = T.MathUtils.clamp(slot.level + step * (stable ? 2.2 : -4), 0, 1);
      if (!stable && slot.level === 0) {
        slot.index = slot.requested;
        if (slot.index >= 0) {
          slot.light.position.copy(this.sockets[slot.index].position);
          slot.light.target.position.copy(this.sockets[slot.index].target);
          slot.light.target.updateMatrixWorld();
        }
      }
      // Fixed shader light count within a quality/lighting state, even in an
      // unlit rural area, avoids recompilation every time a lamp enters range.
      slot.light.visible = i < count;
      slot.light.intensity = 520 * strength * slot.level;
    }
  }
  get activeSockets() {
    return this.slots.filter((s) => s.light.visible && s.level > 0).map((s) => s.index);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const { light } of this.slots) light.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }
}
