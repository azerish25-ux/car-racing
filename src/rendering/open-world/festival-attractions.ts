import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RoadNetwork } from '../../simulation/open-world/road-network.ts';
import type { Structure } from '../../simulation/open-world/placement.ts';

/** Ferris wheel (refs 072, 079): 46 m wheel on a 26 m axle, 36 gondolas. */
const WHEEL = Object.freeze({ radius: 23, axle: 26.5, gondolas: 36, revolution: 540 });
/** Fireworks (ref 072): shells per show, sparks per shell, burst height. */
const SHELLS = 18;
const SPARKS = 220;
/** Preferred wheel sites beside the Kestrel hub, first clear one wins. */
const SITES: readonly (readonly [number, number])[] = [
  [2010, 1700],
  [1880, 1690],
  [2260, 1700],
  [1880, 1950],
  [2300, 1960],
];

/**
 * Festival fairground attractions at the Kestrel hub: a slowly turning Ferris
 * wheel with rim and spoke LEDs that cycle colours at night, and a fireworks
 * show above the hub at night. Visual only (no colliders): the wheel stands
 * on open apron at least 45 m from any road and 30 m from any building.
 */
export class FestivalAttractions {
  readonly root = new T.Group();
  private readonly wheel = new T.Group();
  private readonly gondolas: T.InstancedMesh;
  private readonly fireworks: T.Points;
  private readonly lights: T.MeshStandardMaterial;
  private readonly sparkMaterial: T.ShaderMaterial;
  private readonly owned: (T.BufferGeometry | T.Material)[] = [];
  private readonly site = new T.Vector3();
  private readonly time = { value: 0 };
  private readonly show = { value: 0 };
  private readonly matrix = new T.Matrix4();
  private readonly level = new T.Matrix4();
  readonly placed: boolean;
  constructor(
    network: RoadNetwork,
    structures: readonly Structure[],
    ground: (x: number, z: number) => number,
  ) {
    this.root.name = 'Festival attractions';
    const p = {
      s: 0,
      x: 0,
      y: 0,
      z: 0,
      tx: 0,
      tz: 1,
      nx: 1,
      nz: 0,
      curvature: 0,
      width: 0,
      bank: 0,
      gradient: 0,
    };
    const site = SITES.find(([x, z]) => {
      const lateral = Math.abs(network.nearest(x, z, p));
      const clearRoad = Math.hypot(p.x - x, p.z - z) > 45 && lateral > 45;
      const clearBuildings = structures.every(
        (s) => Math.hypot(s.x - x, s.z - z) > 30 + Math.hypot(s.hx, s.hz),
      );
      return clearRoad && clearBuildings;
    });
    this.placed = !!site;
    const steel = this.own(
      new T.MeshStandardMaterial({
        name: 'Wheel steel',
        color: 0xe8ecef,
        roughness: 0.42,
        metalness: 0.65,
      }),
    );
    this.lights = this.own(
      new T.MeshStandardMaterial({
        name: 'Wheel LEDs',
        color: 0x222222,
        emissive: 0xffffff,
        emissiveIntensity: 0,
        roughness: 0.3,
      }),
    );
    const cabin = this.own(
      new T.MeshStandardMaterial({
        name: 'Wheel gondolas',
        color: 0xffffff,
        roughness: 0.35,
        metalness: 0.2,
      }),
    );
    const gondola = this.own(new T.CylinderGeometry(1.15, 1.15, 2.1, 10).translate(0, -1.6, 0));
    this.gondolas = new T.InstancedMesh(gondola, cabin, WHEEL.gondolas);
    const palette = [0xff4fa3, 0x4fd6ff, 0xc8f04a, 0xffc94a, 0xa77bff, 0xffffff];
    for (let i = 0; i < WHEEL.gondolas; i++)
      this.gondolas.setColorAt(i, new T.Color(palette[i % palette.length]));
    this.wheel.add(this.gondolas);
    if (site) {
      const [x, z] = site;
      this.site.set(x, ground(x, z), z);
      this.root.position.copy(this.site);
      this.root.add(this.structure(steel), this.wheel);
      this.wheel.position.y = WHEEL.axle;
      this.wheel.add(this.rimLights());
    }
    // Fireworks: every spark is evaluated on the GPU from its shell's clock.
    const sparks = new Float32Array(SHELLS * SPARKS * 4);
    let seed = 12345;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let s = 0; s < SHELLS; s++)
      for (let k = 0; k < SPARKS; k++) {
        const o = (s * SPARKS + k) * 4;
        // Uniform direction on the sphere, shell index in w.
        const u = random() * 2 - 1,
          a = random() * Math.PI * 2,
          r = Math.sqrt(1 - u * u);
        sparks[o] = r * Math.cos(a);
        sparks[o + 1] = u;
        sparks[o + 2] = r * Math.sin(a);
        sparks[o + 3] = s + random() * 0.15;
      }
    const geometry = this.own(new T.BufferGeometry());
    geometry.setAttribute(
      'position',
      new T.BufferAttribute(new Float32Array(SHELLS * SPARKS * 3), 3),
    );
    geometry.setAttribute('spark', new T.BufferAttribute(sparks, 4));
    geometry.boundingSphere = new T.Sphere(new T.Vector3(0, 200, 0), 400);
    this.sparkMaterial = this.own(
      new T.ShaderMaterial({
        name: 'Festival fireworks',
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        uniforms: { fwTime: this.time, fwShow: this.show },
        vertexShader: /* glsl */ `
uniform float fwTime;
attribute vec4 spark;
varying vec3 vColour;
varying float vAlpha;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float shell = floor(spark.w);
  // A shell every ~0.3 s across the show (ref 072: several bursts at once).
  float period = 3.6 + hash(shell * 3.1) * 2.6;
  float t = mod(fwTime + hash(shell * 7.7) * period, period);
  float burst = 1.2;
  vec3 centre = vec3((hash(shell * 1.3) - 0.5) * 220.0, 120.0 + hash(shell * 2.9) * 120.0,
                     (hash(shell * 5.1) - 0.5) * 200.0);
  float life = t - burst;
  // Peony/chrysanthemum stars: 45-75 m/s, a 60-110 m burst.
  float speed = 45.0 + hash(shell * 9.2) * 30.0;
  vec3 p;
  if (life < 0.0) {
    // The rising shell: a single bright tracer (all sparks together).
    p = centre - vec3(0.0, (1.0 - t / burst) * centre.y * 0.9, 0.0);
    vAlpha = 0.6 * step(fract(spark.w) * 6.0, 1.0);
  } else {
    float drag = (1.0 - exp(-life * 1.6)) / 1.6;
    p = centre + spark.xyz * speed * drag - vec3(0.0, 4.9 * life * life * 0.55, 0.0);
    vAlpha = clamp(1.0 - life / 3.0, 0.0, 1.0) * (0.75 + 0.25 * sin(life * 40.0 + spark.w * 17.0));
  }
  vec3 a = vec3(1.0, 0.45 + 0.4 * hash(shell), 0.2);
  vec3 b = vec3(1.0, 0.3, 0.75);
  vec3 c = vec3(0.45, 0.85, 1.0);
  float pick = hash(shell * 11.0);
  vColour = pick < 0.34 ? a : pick < 0.67 ? b : c;
  vColour = mix(vColour, vec3(1.0, 0.95, 0.85), 0.35 * step(0.85, fract(spark.w * 13.0)));
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(5200.0 / -view.z, 2.0, 14.0);
}`,
        fragmentShader: /* glsl */ `
uniform float fwShow;
varying vec3 vColour;
varying float vAlpha;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  float core = exp(-d * 6.0);
  float alpha = core * vAlpha * fwShow;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vColour * 6.0 * alpha, alpha);
}`,
      }),
    );
    this.fireworks = new T.Points(geometry, this.sparkMaterial);
    this.fireworks.name = 'Festival fireworks';
    this.fireworks.frustumCulled = false;
    this.fireworks.renderOrder = 4;
    this.fireworks.visible = false;
    if (site) this.root.add(this.fireworks);
  }
  private own<V extends T.BufferGeometry | T.Material>(value: V): V {
    this.owned.push(value);
    return value;
  }
  /** A-frame legs, axle hub, twin rims and 18 spoke pairs. */
  private structure(steel: T.Material) {
    const parts: T.BufferGeometry[] = [];
    const leg = (x: number, z: number) => {
      const top = new T.Vector3(0, WHEEL.axle, z * 0.35);
      const foot = new T.Vector3(x, 0, z);
      const length = top.distanceTo(foot);
      const g = new T.CylinderGeometry(0.32, 0.45, length, 8);
      g.translate(0, length / 2, 0);
      const q = new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        top.clone().sub(foot).normalize(),
      );
      g.applyMatrix4(new T.Matrix4().compose(foot, q, new T.Vector3(1, 1, 1)));
      parts.push(g);
    };
    for (const x of [-9, 9]) for (const z of [-4.5, 4.5]) leg(x, z);
    const spokes: T.BufferGeometry[] = [];
    for (const z of [-1.6, 1.6]) {
      spokes.push(new T.TorusGeometry(WHEEL.radius, 0.28, 6, 96).translate(0, 0, z));
      spokes.push(new T.TorusGeometry(WHEEL.radius * 0.55, 0.16, 6, 64).translate(0, 0, z));
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        const g = new T.BoxGeometry(0.18, WHEEL.radius, 0.18).translate(0, WHEEL.radius / 2, z);
        g.rotateZ(a);
        spokes.push(g);
      }
    }
    spokes.push(new T.CylinderGeometry(1.1, 1.1, 4.4, 16).rotateX(Math.PI / 2));
    const legs = new T.Mesh(this.own(mergeGeometries(parts)!), steel);
    const frame = new T.Mesh(this.own(mergeGeometries(spokes)!), steel);
    parts.forEach((g) => g.dispose());
    spokes.forEach((g) => g.dispose());
    legs.castShadow = frame.castShadow = true;
    legs.name = 'Wheel A-frame';
    frame.name = 'Wheel rims and spokes';
    this.wheel.add(frame);
    return legs;
  }
  /** LED points along both rims and the spokes, turning with the wheel. */
  private rimLights() {
    const bulbs: T.BufferGeometry[] = [];
    const bulb = new T.SphereGeometry(0.22, 6, 4);
    for (const z of [-1.6, 1.6])
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2;
        bulbs.push(
          bulb
            .clone()
            .translate(
              Math.cos(a) * WHEEL.radius,
              Math.sin(a) * WHEEL.radius,
              z + Math.sign(z) * 0.3,
            ),
        );
      }
    const mesh = new T.Mesh(this.own(mergeGeometries(bulbs)!), this.lights);
    bulbs.forEach((g) => g.dispose());
    bulb.dispose();
    mesh.name = 'Wheel rim LEDs';
    return mesh;
  }
  update(time: number, night: number, camera: T.Camera) {
    if (!this.placed) return;
    const angle = (time / WHEEL.revolution) * Math.PI * 2;
    this.wheel.rotation.z = angle;
    // Gondolas hang level from the rim.
    this.level.makeRotationZ(-angle);
    for (let i = 0; i < WHEEL.gondolas; i++) {
      const a = (i / WHEEL.gondolas) * Math.PI * 2;
      // Fixed on the rim, counter-rotated inside the turning wheel group.
      this.matrix
        .makeTranslation(Math.cos(a) * WHEEL.radius, Math.sin(a) * WHEEL.radius, 0)
        .multiply(this.level);
      this.gondolas.setMatrixAt(i, this.matrix);
    }
    this.gondolas.instanceMatrix.needsUpdate = true;
    // LEDs cycle through the festival colours after dusk.
    const hue = (time * 0.05) % 1;
    this.lights.emissive.setHSL(hue, 0.85, 0.55);
    this.lights.emissiveIntensity = 0.15 + night * 5;
    this.time.value = time;
    this.show.value = night > 0.5 ? 1 : 0;
    const far = camera.position.distanceTo(this.site) > 5200;
    this.fireworks.visible = night > 0.5 && !far;
  }
  dispose() {
    this.gondolas.dispose();
    for (const value of this.owned) value.dispose();
    this.root.clear();
  }
}
