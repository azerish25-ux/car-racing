import * as T from 'three';
import type { FestivalEvent } from '../../simulation/open-world/festival-events.ts';
import type { FestivalEventKind } from '../../simulation/open-world/region-data.ts';
import { pathPoint } from '../../simulation/open-world/route-path.ts';

export const EVENT_COLOURS: Readonly<Record<FestivalEventKind, number>> = Object.freeze({
  'road-race': 0xff6a2a,
  circuit: 0xffb000,
  sprint: 0xff3d6e,
  'speed-trap': 0x2ec8ff,
  'speed-zone': 0x29e0a6,
  'drift-zone': 0xb46cff,
  showcase: 0xf2f2f2,
});
const beamVertex = /* glsl */ `
varying float vHeight;
varying float vDepth;
void main() {
  vHeight = uv.y;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;
const beamFragment = /* glsl */ `
uniform vec3 colour;
uniform float strength;
uniform float time;
uniform vec2 nearFade;
varying float vHeight;
varying float vDepth;
void main() {
  float fade = (1.0 - vHeight) * (1.0 - vHeight);
  float pulse = 0.8 + 0.2 * sin(time * 2.4 - vHeight * 9.0);
  // A column the camera stands in (the player waiting at a start, a gate
  // being driven through) fades out instead of washing over the view.
  float near = nearFade.y > 0.0 ? smoothstep(nearFade.x, nearFade.y, vDepth) : 1.0;
  gl_FragColor = vec4(colour * strength * pulse * fade * near * 0.72, 1.0);
}`;
/** Light column (fades within `near` metres of the camera) or ground ring. */
function beamMaterial(colour: number, near: readonly [number, number] = [0, 0]) {
  return new T.ShaderMaterial({
    uniforms: {
      colour: { value: new T.Color(colour) },
      strength: { value: 1 },
      time: { value: 0 },
      nearFade: { value: new T.Vector2(near[0], near[1]) },
    },
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false,
    side: T.DoubleSide,
    toneMapped: false,
  });
}
interface Marker {
  event: FestivalEvent;
  root: T.Group;
  beam: T.ShaderMaterial;
  ring: T.ShaderMaterial;
}
/** Columns fade between these camera distances (m). */
const COLUMN_FADE: readonly [number, number] = [14, 48];
/**
 * World markers: a light column and ground ring at every event start
 * (coloured by format, dim until discovered), the speed-trap cameras, and
 * during an event the next checkpoint as a column on the route.
 */
export class EventMarkers {
  readonly root = new T.Group();
  private readonly markers: Marker[] = [];
  private readonly gate: T.Mesh;
  private readonly gateMaterial = beamMaterial(0x46e0ff, COLUMN_FADE);
  private readonly geometry = new T.CylinderGeometry(0.55, 1.05, 24, 16, 1, true).translate(
    0,
    12,
    0,
  );
  private readonly ring = new T.RingGeometry(4.1, 4.55, 48).rotateX(-Math.PI / 2);
  private readonly cameraMaterial = new T.MeshStandardMaterial({
    color: 0x2b2f33,
    roughness: 0.5,
    metalness: 0.6,
  });
  private readonly poleGeometry = new T.CylinderGeometry(0.12, 0.14, 6, 8).translate(0, 3, 0);
  private readonly cameraGeometry = new T.BoxGeometry(0.5, 0.4, 0.8).translate(0, 6.1, 0);
  constructor(events: readonly FestivalEvent[], groundHeight: (x: number, z: number) => number) {
    this.root.name = 'Festival event markers';
    const camera = this.cameraMaterial,
      pole = this.poleGeometry,
      box = this.cameraGeometry;
    const p = pathPoint();
    for (const event of events) {
      const colour = EVENT_COLOURS[event.spec.kind];
      const root = new T.Group();
      root.name = `Marker ${event.spec.id}`;
      const beam = beamMaterial(colour, COLUMN_FADE),
        ringMaterial = beamMaterial(colour);
      const column = new T.Mesh(this.geometry, beam);
      column.frustumCulled = false;
      const ring = new T.Mesh(this.ring, ringMaterial);
      ring.position.y = 0.25;
      root.add(column, ring);
      const m = event.marker;
      root.position.set(m.x, groundHeight(m.x, m.z), m.z);
      this.root.add(root);
      this.markers.push({ event, root, beam, ring: ringMaterial });
      if (event.spec.kind === 'speed-trap') {
        // The camera at the trap line, on the right-hand verge.
        event.path.at(event.path.finishDistance, p);
        const lateral = -(p.halfWidth + 3);
        const x = p.x + p.nx * lateral,
          z = p.z + p.nz * lateral;
        const post = new T.Mesh(pole, camera),
          head = new T.Mesh(box, camera);
        post.position.set(x, groundHeight(x, z), z);
        head.position.copy(post.position);
        head.rotation.y = Math.atan2(-p.tx, -p.tz);
        post.castShadow = head.castShadow = true;
        this.root.add(post, head);
      }
    }
    this.gate = new T.Mesh(this.geometry, this.gateMaterial);
    this.gate.scale.set(0.6, 0.45, 0.6);
    this.gate.visible = false;
    this.gate.frustumCulled = false;
    this.root.add(this.gate);
  }
  update(
    time: number,
    discovered: ReadonlySet<string>,
    active: string | null,
    gate: { x: number; z: number } | null,
    groundHeight: (x: number, z: number) => number,
  ) {
    for (const m of this.markers) {
      const known = discovered.has(m.event.spec.id);
      m.root.visible = !active;
      for (const material of [m.beam, m.ring]) {
        material.uniforms.time.value = time;
        material.uniforms.strength.value = known ? 1 : 0.3;
      }
    }
    this.gateMaterial.uniforms.time.value = time;
    this.gate.visible = !!gate;
    if (gate) this.gate.position.set(gate.x, groundHeight(gate.x, gate.z), gate.z);
  }
  dispose() {
    this.geometry.dispose();
    this.ring.dispose();
    for (const m of this.markers) {
      m.beam.dispose();
      m.ring.dispose();
    }
    this.gateMaterial.dispose();
    this.cameraMaterial.dispose();
    this.poleGeometry.dispose();
    this.cameraGeometry.dispose();
    this.root.clear();
  }
}
