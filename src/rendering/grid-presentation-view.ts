import {
  crewPerformanceGeometry,
  CrewPerformanceSampler,
  CREW_PERFORMANCE,
  relaxedWrist,
} from './crew-performance.ts';
import * as T from 'three';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../simulation/vehicle.ts';
import { CREW_BONES } from './people-asset.ts';
import { CrewPose, installCrewSkin } from './crew-pose.ts';
import { crewTeamColour } from './crew-geometry.ts';
import { crewBodyGeometry, HumanHeadBatches, type HeadWear } from './human-kit.ts';
import { GridCastView } from './grid-cast.ts';

/** Grid crews: headsets on most, team caps on many. */
export const GRID_HEADWEAR: readonly HeadWear[] = ['cap-headset', 'headset', 'cap', 'cap-headset'];
import { CUFF } from './pit-crew.ts';
export const GRID_GLOVE_GRIP = new T.Vector3(0, 0.034, 0.041);
import { gridBlanketPoint, gridMechanicMotion, poseGridMechanic } from './grid-mechanic-motion.ts';

const ACTORS = 48;
/** Original quilted blanket surface, with a shared wrap-to-gather deformation.
 * Colour, directional depth and point-light depth use identical vertices. */
export function gridBlanketGeometry() {
  const g = new T.BufferGeometry(),
    positions: number[] = [],
    folded: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  const p = new T.Vector3(),
    across = 8,
    around = 32;
  for (let v = 0; v <= around; v++)
    for (let u = 0; u <= across; u++) {
      const angle = -Math.PI + (v / around) * 2 * Math.PI;
      gridBlanketPoint(u / across - 0.5, angle, 0, p);
      positions.push(p.x, p.y, p.z);
      gridBlanketPoint(u / across - 0.5, angle, 1, p);
      folded.push(p.x, p.y, p.z);
      uv.push(u / across, v / around);
    }
  for (let v = 0; v < around; v++)
    for (let u = 0; u < across; u++) {
      const a = v * (across + 1) + u,
        b = a + across + 1;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  // Four stitched loop handles are part of the same draw and deformation.
  // The outermost tube centre (u = +/- .68) is the actual finger-grip socket.
  for (const side of [-1, 1])
    for (const sign of [-1, 1]) {
      const angle = (sign * side * Math.PI) / 4,
        start = positions.length / 3;
      for (let segment = 0; segment < 12; segment++) {
        const phase = (segment * 2 * Math.PI) / 12;
        for (let ring = 0; ring < 6; ring++) {
          const a = (ring * 2 * Math.PI) / 6;
          const u = side * (0.59 + 0.09 * Math.cos(phase)) + 0.008 * Math.cos(a);
          const tangent = 0.055 * Math.sin(phase) + 0.008 * Math.sin(a);
          for (const fold of [0, 1]) {
            gridBlanketPoint(u, angle, fold, p);
            p.y -= Math.sin(angle) * tangent;
            p.z += Math.cos(angle) * tangent;
            (fold ? folded : positions).push(p.x, p.y, p.z);
          }
          uv.push(u + 0.5, (angle + Math.PI) / (2 * Math.PI));
        }
      }
      for (let segment = 0; segment < 12; segment++)
        for (let ring = 0; ring < 6; ring++) {
          const a = start + segment * 6 + ring,
            b = start + segment * 6 + ((ring + 1) % 6);
          const c = start + ((segment + 1) % 12) * 6 + ring,
            d = start + ((segment + 1) % 12) * 6 + ((ring + 1) % 6);
          index.push(a, b, c, b, d, c);
        }
    }
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  const f = g.clone();
  f.setAttribute('position', new T.Float32BufferAttribute(folded, 3));
  f.computeVertexNormals();
  g.setAttribute('gridFolded', f.getAttribute('position').clone());
  g.setAttribute('gridFoldedNormal', f.getAttribute('normal').clone());
  f.dispose();
  return g;
}
export function installGridBlanket(material: T.Material, colour: boolean) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute vec3 gridFolded;\nattribute vec3 gridFoldedNormal;\nattribute float gridFold;\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <begin_vertex>', 'vec3 transformed = mix(position, gridFolded, gridFold);')
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nobjectNormal = normalize(mix(objectNormal, gridFoldedNormal, gridFold));',
      );
    if (colour) {
      shader.vertexShader = 'varying vec2 vGridCloth;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\nvGridCloth = uv;',
      );
      shader.fragmentShader = 'varying vec2 vGridCloth;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float strap = 1. - smoothstep(.015, .022, min(abs(vGridCloth.x-.18), abs(vGridCloth.x-.82)));
        vec2 stitch = abs(fract(vGridCloth * vec2(8.,16.))-.5);
        float seam = 1. - smoothstep(.01,.055,min(stitch.x,stitch.y));
        diffuseColor.rgb *= 1. - seam * .12;
        diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.48,.38,.19),strap*.85);`,
      );
    }
  };
  material.customProgramCacheKey = () => `grid-blanket-wrap-gather-v1-${colour}`;
}

/** A bounded pre-race cast using the retained authored bodies, helmets and
 * gloves. All objects and GPU attributes are allocated during renderer creation. */
export class GridPresentationView {
  readonly root = new T.Group();
  private readonly boneData = new Float32Array(ACTORS * CREW_BONES * 16);
  private readonly bones = new T.DataTexture(
    this.boneData,
    CREW_BONES * 4,
    ACTORS,
    T.RGBAFormat,
    T.FloatType,
  );
  private readonly cloth: T.InstancedMesh[];
  private readonly slots = [0, 1].map(() =>
    new T.InstancedBufferAttribute(new Float32Array(ACTORS), 1).setUsage(T.DynamicDrawUsage),
  );
  private readonly heads: HumanHeadBatches;
  readonly cast = new GridCastView();
  private readonly gloves: [T.InstancedMesh, T.InstancedMesh];
  private readonly blankets: T.InstancedMesh;
  private readonly folds = new T.InstancedBufferAttribute(new Float32Array(ACTORS), 1).setUsage(
    T.DynamicDrawUsage,
  );
  private readonly pose = new CrewPose();
  private readonly performance = new CrewPerformanceSampler();
  private readonly motion = gridMechanicMotion();
  private readonly actor = new T.Object3D();
  private readonly car = new T.Object3D();
  private readonly part = new T.Object3D();
  private readonly matrix = new T.Matrix4();
  private readonly hub = new T.Vector3();
  private readonly hands = [new T.Vector3(), new T.Vector3()];
  private readonly wrists = [new T.Vector3(), new T.Vector3()];
  private readonly handRotations = [new T.Quaternion(), new T.Quaternion()];
  private readonly gripDelta = new T.Vector3();
  private readonly feet = [new T.Vector3(), new T.Vector3()];
  private readonly head = new T.Quaternion();
  private readonly gloveBind = [-1, 1].map((sign) =>
    new T.Quaternion()
      .setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI)
      .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (sign * Math.PI) / 2)),
  );
  private actors = 0;
  private parked = false;
  private phase = 'inactive';
  private readonly contacts: {
    car: number;
    wheel: number;
    arms: boolean;
    feet: boolean;
    gripError: number;
  }[] = [];
  constructor() {
    this.root.name = 'Original pre-race mechanic performances';
    this.bones.generateMipmaps = false;
    this.bones.minFilter = this.bones.magFilter = T.NearestFilter;
    this.bones.name = 'Grid presentation bone atlas';
    this.bones.needsUpdate = true;
    this.cloth = ([0, 1] as const).map((lod, i) => {
      // Grid crews wear the team polo with bare forearms, caps and headsets.
      const geometry = crewBodyGeometry('polo', lod);
      geometry.setAttribute('crewSlot', this.slots[i]);
      const material = new T.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.88,
      });
      material.userData.weatherSurface = 'fabric';
      installCrewSkin(material, this.bones, ACTORS, true, 'polo');
      const mesh = new T.InstancedMesh(geometry, material, ACTORS);
      mesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(ACTORS * 3).fill(1), 3);
      const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
      const distance = new T.MeshDistanceMaterial();
      installCrewSkin(depth, this.bones, ACTORS, false);
      installCrewSkin(distance, this.bones, ACTORS, false);
      mesh.customDepthMaterial = depth;
      mesh.customDistanceMaterial = distance;
      return mesh;
    });
    const batch = (g: T.BufferGeometry, roughness: number) =>
      new T.InstancedMesh(
        g,
        new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness }),
        ACTORS,
      );
    this.heads = new HumanHeadBatches(ACTORS, GRID_HEADWEAR, [0, 1], 'Grid crew heads');
    this.gloves = [
      batch(crewPerformanceGeometry('glove', true), 0.82),
      batch(crewPerformanceGeometry('glove'), 0.82),
    ];
    const blanket = gridBlanketGeometry();
    blanket.setAttribute('gridFold', this.folds);
    const textile = new T.MeshStandardMaterial({
      color: 0x252c31,
      roughness: 0.96,
      side: T.DoubleSide,
    });
    installGridBlanket(textile, true);
    this.blankets = new T.InstancedMesh(blanket, textile, ACTORS);
    const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, side: T.DoubleSide });
    const distance = new T.MeshDistanceMaterial({ side: T.DoubleSide });
    installGridBlanket(depth, false);
    installGridBlanket(distance, false);
    this.blankets.customDepthMaterial = depth;
    this.blankets.customDistanceMaterial = distance;
    this.root.add(...this.cloth, ...this.heads.meshes, ...this.gloves, this.blankets);
    // Umbrella holders and engineers share the presentation clock.
    this.root.add(this.cast.root);
    for (const mesh of this.batches()) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    }
  }
  private batches() {
    return [...this.cloth, ...this.heads.meshes, ...this.gloves, this.blankets];
  }
  private put(mesh: T.InstancedMesh, local: T.Matrix4) {
    this.matrix.multiplyMatrices(this.car.matrix, local);
    mesh.setMatrixAt(mesh.count++, this.matrix);
  }
  reset() {
    this.cast.hide();
    this.heads.reset();
    this.parked = false;
    this.actors = 0;
    this.contacts.length = 0;
    this.phase = 'inactive';
    for (const mesh of this.batches()) {
      mesh.count = 0;
      mesh.frustumCulled = false;
    }
  }
  /** The race has started: as on a real grid, every mechanic, umbrella
   * holder and engineer has left the circuit for the garages before the
   * lights, so nothing of the pre-race cast is drawn while racing. `frame`
   * is accepted for the existing call sites; no snapshot is written. */
  park(frame: Float32Array) {
    void frame;
    this.reset();
    this.parked = true;
  }
  update(frame: Float32Array, camera: T.Vector3, time: number | null) {
    if (time === null && this.parked) return;
    this.parked = false;
    this.cast.update(frame, camera, time);
    for (const mesh of this.batches()) {
      mesh.count = 0;
      mesh.frustumCulled = false;
    }
    this.actors = 0;
    this.contacts.length = 0;
    this.phase = 'inactive';
    if (time === null || !Number.isFinite(time) || frame[H.PHASE] >= 2 || frame[H.TIME] > 0) return;
    for (let id = 0; id < Math.min(12, frame[H.CARS]); id++) {
      const base = carBase(id);
      if (Math.abs(frame[base + F.SPEED]) > 0.5) continue;
      this.car.position.fromArray(frame, base + F.X);
      this.car.quaternion.fromArray(frame, base + F.QX);
      this.car.updateMatrix();
      if (this.car.position.distanceToSquared(camera) > 100 ** 2) continue;
      for (let wheel = 0; wheel < 4; wheel++) {
        const [x, y, z] = WHEEL_POSITIONS[wheel];
        this.hub.set(
          x,
          y - (frame[base + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LENGTH] || 0.25),
          z,
        );
        const m = poseGridMechanic(
          time,
          wheel,
          this.hub,
          this.motion,
          id,
          (Math.sign(frame[base + F.LATERAL]) || -1) * 9.5 - frame[base + F.LATERAL],
        );
        this.performance.grid(m.time, m.distancePhase);
        const hip = Math.min(m.hip, this.performance.joints[0].y);
        this.phase = m.phase;
        if (!m.visible) continue;
        const side = Math.sign(x),
          width = wheel < 2 ? 0.34 : 0.42;
        this.actor.position.copy(m.position);
        this.actor.rotation.set(0, m.yaw, 0);
        this.actor.updateMatrix();
        this.part.position.copy(m.blanket);
        this.part.quaternion.setFromAxisAngle(this.part.up, m.blanketYaw);
        this.part.scale.set(width, 1, 1);
        this.part.updateMatrix();
        this.folds.setX(this.blankets.count, m.fold);
        this.put(this.blankets, this.part.matrix);
        for (let hand = 0; hand < 2; hand++) {
          const angle = ((hand === 0 ? -1 : 1) * side * Math.PI) / 4;
          gridBlanketPoint(side * 0.68, angle, m.fold, this.hands[hand]).applyMatrix4(
            this.part.matrix,
          );
          this.feet[hand].copy(m.feet[hand]).applyMatrix4(this.actor.matrix);
          if (m.grip < 1) {
            const idle = relaxedWrist(
              this.performance.joints,
              hand as 0 | 1,
              this.part.position,
            ).applyMatrix4(this.actor.matrix);
            this.hands[hand].lerp(idle, 1 - m.grip);
          }
        }
        // Work from the glove's measured finger-grip socket, not its wrist.
        // Iterate the forearm orientation to keep the cuff and fingers on both
        // constraints without scaling bones or detaching the glove.
        for (let hand = 0; hand < 2; hand++) this.wrists[hand].copy(this.hands[hand]);
        for (let iteration = 0; iteration < 32; iteration++) {
          this.pose.set(
            this.actor.matrix,
            hip,
            m.lean,
            this.wrists,
            0.15,
            this.feet,
            this.performance.style,
            false,
          );
          let correction = 0;
          for (let hand = 0; hand < 2; hand++) {
            this.gloveOrientation(hand, this.handRotations[hand]);
            this.gripDelta
              .copy(GRID_GLOVE_GRIP)
              .sub(CUFF)
              .applyQuaternion(this.handRotations[hand]);
            this.gripDelta
              .transformDirection(this.actor.matrix)
              .multiplyScalar(GRID_GLOVE_GRIP.distanceTo(CUFF));
            this.gripDelta.sub(this.hands[hand]).negate();
            correction = Math.max(correction, this.wrists[hand].distanceToSquared(this.gripDelta));
            this.wrists[hand].lerp(this.gripDelta, 0.5);
          }
          if (correction < 1e-12) break;
        }
        this.pose.set(
          this.actor.matrix,
          hip,
          m.lean,
          this.wrists,
          0.15,
          this.feet,
          this.performance.style,
        );
        this.pose.write(this.boneData, this.actors);
        const tier = id === 0 ? 0 : 1,
          body = this.cloth[tier];
        this.slots[tier].setX(body.count, this.actors);
        body.setColorAt(body.count, crewTeamColour(id));
        this.put(body, this.actor.matrix);
        this.head.setFromAxisAngle(this.part.up, m.headYaw);
        this.part.position.copy(this.pose.joints[2]);
        this.part.quaternion.copy(this.pose.rotations[2]).multiply(this.head);
        this.part.scale.set(1, 1, 1);
        this.part.updateMatrix();
        this.matrix.multiplyMatrices(this.actor.matrix, this.part.matrix);
        this.matrix.premultiply(this.car.matrix);
        this.heads.put(
          this.matrix,
          this.actors,
          crewTeamColour(id),
          tier,
          (id * 4 + wheel) % GRID_HEADWEAR.length,
        );
        let gripError = 0;
        for (let hand = 0; hand < 2; hand++) {
          const wrist = this.pose.joints[hand === 0 ? 5 : 8];
          this.gloveOrientation(hand, this.part.quaternion);
          this.part.position.copy(CUFF).applyQuaternion(this.part.quaternion).negate().add(wrist);
          this.part.updateMatrix();
          this.matrix.multiplyMatrices(this.actor.matrix, this.part.matrix);
          this.put(this.gloves[hand], this.matrix);
          // Read the rendered glove's finger socket back in car space.
          this.gripDelta
            .copy(GRID_GLOVE_GRIP)
            .applyMatrix4(this.part.matrix)
            .applyMatrix4(this.actor.matrix);
          gripError = Math.max(gripError, this.gripDelta.distanceTo(this.hands[hand]));
        }
        this.contacts.push({
          car: id,
          wheel,
          arms: this.pose.reachable.every(Boolean),
          feet: this.pose.feetReachable.every(Boolean),
          gripError,
        });
        this.actors++;
      }
    }
    for (const mesh of this.batches()) mesh.instanceMatrix.needsUpdate = true;
    this.heads.finish();
    for (const mesh of this.cloth) mesh.instanceColor!.needsUpdate = true;
    for (const slots of this.slots) slots.needsUpdate = true;
    this.bones.needsUpdate = true;
    this.folds.needsUpdate = true;
  }
  private gloveOrientation(hand: number, out: T.Quaternion) {
    // Transport the bind wrist frame with the forearm rotation. Projecting a
    // fixed palm axis perpendicular to the arm becomes singular when they align
    // (for example while rising with a blanket); bind-frame transport does not.
    return out.copy(this.pose.rotations[hand === 0 ? 4 : 7]).multiply(this.gloveBind[hand]);
  }

  diagnostics() {
    return {
      asset: CREW_PERFORMANCE.runtimeSHA256,
      authoredAction: this.performance.action,
      phase: this.phase,
      parked: this.parked,
      actors: this.actors,
      highDetail: this.cloth[0].count,
      blankets: this.blankets.count,
      contacts: this.contacts.map((c) => ({ ...c })),
      cast: this.cast.diagnostics(),
    };
  }
  dispose() {
    this.cast.dispose();
    this.bones.dispose();
  }
}
