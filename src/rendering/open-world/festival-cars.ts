import * as T from 'three';
import { F, H, R, RACE_BASE, carBase } from '../../simulation/protocol.ts';
import { vehicleAt } from '../../simulation/vehicles.ts';
import { bodyFrame } from '../vehicle-bodies/frame.ts';
import { bodySheetFor } from '../vehicle-bodies/body-sheet.ts';
import { FormulaCar } from '../car.ts';
import { VehicleBodies } from '../vehicle-bodies/index.ts';
import type { CarMaterials } from '../vehicle-bodies/common.ts';
import { installSpecularIBL } from '../studio/ibl-energy.ts';
import type { Quality } from '../options.ts';
import { lerp } from '../../core/math.ts';
import {
  FESTIVAL_LAMPS,
  disposeFestivalFinish,
  installFestivalFinish,
  setFestivalLampLevels,
  setLampHalos,
} from './festival-car-finish.ts';
import { setPlateLamp } from './festival-plates.ts';

/** The festival constructs the procedural Formula model without borrowed
 * hero/driver assets. Capture its own resources before reflection/mirror
 * systems attach external textures. The shared tyre-lettering atlas lives in
 * a shader uniform and is intentionally outside this list. */
function ownFormulaResources(car: FormulaCar) {
  const resources = new Set<T.BufferGeometry | T.Material | T.Texture | T.InstancedMesh>();
  car.root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    resources.add(node.geometry);
    // InstancedMesh owns GPU instance attributes in addition to its geometry.
    if (node instanceof T.InstancedMesh) resources.add(node);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      resources.add(material);
      for (const [key, value] of Object.entries(material))
        if (key !== 'envMap' && value instanceof T.Texture) resources.add(value);
    }
  });
  return () => {
    for (const resource of resources) resource.dispose();
    resources.clear();
    car.root.removeFromParent();
    car.root.clear();
  };
}

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
  readonly bodies = new VehicleBodies({ festival: true });
  private readonly holders: { root: T.Object3D; lodLevel: number }[] = [];
  private readonly formula = new Map<number, FormulaCar>();
  private readonly releaseFormula = new Map<number, () => void>();
  // The festival uses a low night exposure, not the circuit's floodlights.
  // An inverse-square dipped beam keeps nearby paint out of the broad white
  // clipping produced by the old 2600 / distance^1.6 spotlight.
  private readonly headlight = new T.SpotLight(0xfff2dc, 0, 85, 0.36, 0.72, 2);
  readonly reflectivePaint: T.Material[] = [];
  private readonly paintSet = new Set<T.Material>();
  paintVersion = 0;
  private headlightVehicle = -1;
  private lamp = { front: 0, y: 0, ground: 0 };
  /** Each entrant's live lamp materials and its night halo (festival lamp
   * levels). The halo finish is owned here and released with its body. */
  private readonly lamps = new Map<
    number,
    { materials: CarMaterials; halo: T.ShaderMaterial | null }
  >();
  constructor() {
    this.root.name = 'Festival cars';
    this.root.add(this.bodies.root);
    this.bodies.onBuild = (_root, body, id) => {
      this.lamps.get(id)?.halo?.dispose();
      const finish = installFestivalFinish(body, id);
      this.lamps.set(id, { materials: body.materials, halo: finish?.halo ?? null });
      this.refreshPaint();
    };
    this.headlight.name = 'Followed car headlights';
    this.headlight.castShadow = false;
    this.root.add(this.headlight, this.headlight.target);
  }
  /** Rebuild on body identity, including equal-sized garage replacements.
   * Removed car materials must not stay owned by the reflection probe. */
  private refreshPaint() {
    installSpecularIBL(this.root);
    this.paintSet.clear();
    this.reflectivePaint.length = 0;
    this.root.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (
          material instanceof T.MeshPhysicalMaterial &&
          material.clearcoat > 0 &&
          !this.paintSet.has(material)
        ) {
          this.paintSet.add(material);
          this.reflectivePaint.push(material);
        }
      }
    });
    this.paintVersion++;
  }
  /** The followed car's root (camera subject). */
  subject(id = 0) {
    return this.holders[id]?.root ?? null;
  }
  update(
    a: Float32Array,
    b: Float32Array,
    presented: Float32Array,
    alpha: number,
    dt: number,
    night: number,
    camera?: T.Camera,
    cockpit = false,
    quality: Quality = 'medium',
  ) {
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
      holder.position.set(presented[o + F.X], presented[o + F.Y], presented[o + F.Z]);
      holder.quaternion.set(
        presented[o + F.QX],
        presented[o + F.QY],
        presented[o + F.QZ],
        presented[o + F.QW],
      );
      if (definition.classId === 'formula') {
        let car = formula;
        if (!car) {
          car = new FormulaCar(id);
          this.formula.set(id, car);
          this.releaseFormula.set(id, ownFormulaResources(car));
          this.root.add(car.root);
          this.refreshPaint();
        }
        car.root.visible = true;
        const distance = camera ? holder.position.distanceTo(camera.position) : id === 0 ? 0 : 80;
        car.setLod(distance, quality, id === 0);
        car.update(a, b, o, alpha, dt, presented[H.TIME], false);
        holder.position.copy(car.root.position);
        holder.quaternion.copy(car.root.quaternion);
      } else {
        if (formula) formula.root.visible = false;
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
      // Every definition follows its current holder. A cached Formula root
      // stops being posed when this entrant changes to a road car.
      this.holders,
      night > 0.05,
      { follow: 0, cockpit, camera: camera?.position ?? null },
    );
    // Open-road lamp levels over the shared body library's circuit levels:
    // running tail bars by day, a hard brake flare, the LED signature.
    setFestivalLampLevels(night);
    setPlateLamp(night > 0.05 ? FESTIVAL_LAMPS.plateLamp * night : 0);
    for (const [id, { materials, halo }] of this.lamps) {
      if (id >= cars) continue;
      const o = carBase(id),
        brake = lerp(a[o + F.BRAKE], b[o + F.BRAKE], alpha);
      if (halo) setLampHalos(halo, night, brake > 0.05);
      materials.tail.emissiveIntensity =
        brake > 0.05
          ? FESTIVAL_LAMPS.brake
          : lerp(FESTIVAL_LAMPS.tailDay, FESTIVAL_LAMPS.tailNight, night);
      materials.head.emissiveIntensity =
        night > 0.05
          ? lerp(FESTIVAL_LAMPS.headDay, FESTIVAL_LAMPS.headNight, night)
          : FESTIVAL_LAMPS.headDay;
    }
    for (let id = 0; id < this.holders.length; id++) {
      const formula = this.formula.get(id);
      const isFormula =
        id < cars &&
        vehicleAt(Math.round(presented[carBase(id) + RACE_BASE + R.VEHICLE])).classId === 'formula';
      if (formula) formula.root.visible = isFormula;
      this.holders[id].root.visible = false;
    }
    // Headlights at night on the followed car.
    const lead = this.holders[0]?.root;
    this.headlight.intensity = night > 0.05 ? 140 * night : 0;
    if (lead) {
      const vehicle = Math.round(presented[carBase(0) + RACE_BASE + R.VEHICLE]);
      if (vehicle !== this.headlightVehicle) {
        const definition = vehicleAt(vehicle),
          frame = bodyFrame(definition),
          sheet = bodySheetFor(definition);
        this.lamp = {
          front: frame.frontAxle + (sheet?.kind === 'closed' ? sheet.overhang[0] : 0.45),
          y: frame.y(0.66),
          ground: frame.ground,
        };
        this.headlightVehicle = vehicle;
      }
      this.headlight.position
        .set(0, this.lamp.y, this.lamp.front + 0.05)
        .applyQuaternion(lead.quaternion)
        .add(lead.position);
      this.headlight.target.position
        .set(0, this.lamp.ground, this.lamp.front + 26)
        .applyQuaternion(lead.quaternion)
        .add(lead.position);
      this.headlight.target.updateMatrixWorld();
    }
  }
  /** Clear all entrants; repeated garage swaps reuse bounded Formula entries,
   * while a session exit releases every resource owned by those entries. */
  clear() {
    this.bodies.clear();
    for (const { halo } of this.lamps.values()) halo?.dispose();
    this.lamps.clear();
    for (const release of this.releaseFormula.values()) release();
    this.releaseFormula.clear();
    this.formula.clear();
    for (const holder of this.holders) holder.root.removeFromParent();
    this.holders.length = 0;
    this.headlight.intensity = 0;
    this.headlightVehicle = -1;
    this.paintSet.clear();
    this.reflectivePaint.length = 0;
    this.paintVersion++;
  }
  dispose() {
    this.clear();
    disposeFestivalFinish();
  }
}
