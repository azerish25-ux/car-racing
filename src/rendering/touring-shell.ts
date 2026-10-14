import * as T from 'three';
import { LIVERIES } from '../simulation/config.ts';
import { F, R, RACE_BASE, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import { vehicleAt, type VehicleDefinition } from '../simulation/vehicles.ts';

/** Provisional exterior for non-Formula vehicle definitions (WP18). The
 * snapshot's R.VEHICLE decides the representation, so live play, replay and
 * results always show the machine that was simulated. This is provisional
 * greybox art: a closed-wheel saloon silhouette with posed, spinning,
 * steering wheels at the definition's own wheel positions and brake lights
 * from the recorded pedal. No interior, damage variants or LODs yet: those
 * belong to the vehicle's content acceptance packet (§10.3). */
interface Shell {
  root: T.Group;
  wheels: T.Group[];
  spins: T.Mesh[];
  brake: T.MeshStandardMaterial;
  definition: VehicleDefinition;
}
export class TouringShells {
  readonly root = new T.Group();
  private readonly shells = new Map<number, Shell>();
  private readonly glass = new T.MeshStandardMaterial({
    color: 0x10161c,
    roughness: 0.08,
    metalness: 0.6,
  });
  private readonly tyre = new T.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
  private readonly rim = new T.MeshStandardMaterial({
    color: 0xb8bcc2,
    roughness: 0.35,
    metalness: 0.85,
  });
  constructor() {
    this.root.name = 'Touring shells (provisional greybox art)';
  }
  private build(id: number, definition: VehicleDefinition): Shell {
    const root = new T.Group(),
      [hx, , hz] = definition.halfExtents,
      ride = -0.516;
    root.name = `${definition.name} ${id + 1}`;
    const paint = new T.MeshStandardMaterial({
      color: LIVERIES[id % LIVERIES.length],
      roughness: 0.32,
      metalness: 0.45,
    });
    const box = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      m: T.Material,
    ) => {
      const mesh = new T.Mesh(new T.BoxGeometry(w, h, d, 2, 1, 4), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };
    // Lower body, bonnet slope and boot: a saloon silhouette, not a wing car.
    box(hx * 2, 0.62, hz * 2, 0, ride + 0.47, 0, paint);
    const nose = box(hx * 1.96, 0.3, 0.9, 0, ride + 0.62, hz - 0.5, paint);
    nose.rotation.x = 0.16;
    box(hx * 1.7, 0.5, 2.1, 0, ride + 1.02, -0.25, this.glass);
    box(hx * 1.62, 0.06, 1.7, 0, ride + 1.29, -0.3, paint);
    const brake = new T.MeshStandardMaterial({
      color: 0x3a0505,
      emissive: 0xff1010,
      emissiveIntensity: 0,
    });
    for (const x of [-hx * 0.72, hx * 0.72])
      box(0.32, 0.1, 0.04, x, ride + 0.66, -hz - 0.01, brake);
    const wheels: T.Group[] = [],
      spins: T.Mesh[] = [];
    const radius = definition.spec.wheelRadius;
    for (const [x, , z] of definition.wheelPositions) {
      const pivot = new T.Group();
      pivot.position.set(x, ride + radius, z);
      const spin = new T.Mesh(new T.CylinderGeometry(radius, radius, 0.24, 24), this.tyre);
      spin.rotation.z = Math.PI / 2;
      spin.castShadow = true;
      const hub = new T.Mesh(
        new T.CylinderGeometry(radius * 0.62, radius * 0.62, 0.25, 12),
        this.rim,
      );
      spin.add(hub);
      pivot.add(spin);
      root.add(pivot);
      wheels.push(pivot);
      spins.push(spin);
    }
    this.root.add(root);
    return { root, wheels, spins, brake, definition };
  }
  /** Pose shells over their entrants and hide the Formula representation. */
  update(frame: Float32Array, cars: readonly { root: T.Object3D }[]) {
    for (let id = 0; id < cars.length; id++) {
      const o = carBase(id),
        definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
      let shell = this.shells.get(id);
      if (definition.classId === 'formula') {
        if (shell?.root.visible) {
          shell.root.visible = false;
          cars[id].root.visible = true;
        }
        continue;
      }
      if (!shell || shell.definition !== definition) {
        if (shell) this.root.remove(shell.root);
        shell = this.build(id, definition);
        this.shells.set(id, shell);
      }
      const car = cars[id].root;
      car.visible = false;
      shell.root.visible = true;
      shell.root.position.copy(car.position);
      shell.root.quaternion.copy(car.quaternion);
      shell.brake.emissiveIntensity = frame[o + F.BRAKE] > 0.05 ? 2.2 : 0;
      for (let i = 0; i < 4; i++) {
        const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
        shell.wheels[i].rotation.y = frame[p + W.STEER];
        shell.spins[i].rotation.x = frame[p + W.ROTATION];
      }
    }
  }
  /** Vehicles represented by a shell (diagnostics). */
  get count() {
    let n = 0;
    for (const s of this.shells.values()) if (s.root.visible) n++;
    return n;
  }
}
