import * as T from 'three';
import { F, H, R, RACE_BASE, carBase } from '../../simulation/protocol.ts';
import { vehicleAt } from '../../simulation/vehicles.ts';
import { FormulaCar } from '../car.ts';
import { VehicleBodies } from '../vehicle-bodies/index.ts';

/**
 * Car presentation for the festival: every entrant is posed from the
 * interpolated snapshot; Formula definitions use the full FormulaCar (built
 * on first use), every other definition is drawn by the procedural
 * catalogue body library the circuit renderer uses (`VehicleBodies`), so a
 * new registry car appears here without festival code. Night lights the
 * body lamps and adds dipped headlights to the followed car.
 */
export class FestivalCars {
  readonly root = new T.Group();
  /** Non-Formula bodies (the circuit renderer's library). */
  readonly bodies = new VehicleBodies();
  private readonly holders: { root: T.Object3D; lodLevel: number }[] = [];
  private readonly formula = new Map<number, FormulaCar>();
  private readonly headlight = new T.SpotLight(0xfff2dc, 0, 150, 0.52, 0.55, 1.6);
  readonly reflectivePaint: T.Material[] = [];
  constructor() {
    this.root.name = 'Festival cars';
    this.root.add(this.bodies.root);
    this.headlight.name = 'Followed car headlights';
    this.headlight.castShadow = false;
    this.root.add(this.headlight, this.headlight.target);
  }
  /** The followed car's root (camera subject). */
  subject(id = 0) {
    return this.holders[id]?.root ?? null;
  }
  update(a: Float32Array, b: Float32Array, presented: Float32Array, alpha: number, dt: number, night: number) {
    const cars = Math.round(presented[H.CARS]);
    while (this.holders.length < cars) {
      const holder = new T.Object3D();
      holder.name = `Festival entrant ${this.holders.length + 1}`;
      this.root.add(holder);
      this.holders.push({ root: holder, lodLevel: this.holders.length ? 1 : 0 });
    }
    for (let id = 0; id < this.holders.length; id++) {
      const holder = this.holders[id].root,
        active = id < cars;
      holder.visible = active;
      const formula = this.formula.get(id);
      if (!active) {
        if (formula) formula.root.visible = false;
        continue;
      }
      const o = carBase(id),
        definition = vehicleAt(Math.round(presented[o + RACE_BASE + R.VEHICLE]));
      if (definition.classId === 'formula') {
        let car = formula;
        if (!car) {
          car = new FormulaCar(id);
          this.formula.set(id, car);
          this.root.add(car.root);
          this.reflectivePaint.push(...car.reflectivePaint);
        }
        car.root.visible = true;
        car.setLod(id === 0 ? 0 : 1, 'medium', id === 0);
        car.update(a, b, o, alpha, dt, presented[H.TIME], false);
        holder.position.copy(car.root.position);
        holder.quaternion.copy(car.root.quaternion);
      } else {
        if (formula) formula.root.visible = false;
        holder.position.set(presented[o + F.X], presented[o + F.Y], presented[o + F.Z]);
        holder.quaternion.set(presented[o + F.QX], presented[o + F.QY], presented[o + F.QZ], presented[o + F.QW]);
      }
    }
    // The body library reads the snapshots and the posed holders; Formula
    // entrants keep their own representation. Entrants beyond the current
    // field read as Formula (no vehicle slot in the snapshot), which hides
    // any body left over from a finished event.
    this.bodies.update(
      a,
      b,
      alpha,
      this.holders.map((h, id) => this.formula.get(id) ?? h),
      night > 0.05,
    );
    for (let id = 0; id < this.holders.length; id++) {
      const formula = this.formula.get(id);
      const isFormula =
        id < cars && vehicleAt(Math.round(presented[carBase(id) + RACE_BASE + R.VEHICLE])).classId === 'formula';
      if (formula) formula.root.visible = isFormula;
      this.holders[id].root.visible = false;
    }
    // Headlights at night on the followed car.
    const lead = this.holders[0]?.root;
    this.headlight.intensity = night > 0.05 ? 2600 * night : 0;
    if (lead) {
      this.headlight.position.set(0, 0.75, 2.4).applyQuaternion(lead.quaternion).add(lead.position);
      this.headlight.target.position.set(0, -0.6, 32).applyQuaternion(lead.quaternion).add(lead.position);
      this.headlight.target.updateMatrixWorld();
    }
  }
  dispose() {
    for (const car of this.formula.values()) this.root.remove(car.root);
    this.formula.clear();
  }
}
