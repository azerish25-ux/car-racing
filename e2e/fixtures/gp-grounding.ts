import * as T from 'three';
import { GP_R1, GP_R2 } from '../../src/simulation/bike-definitions.ts';
import { BikeVehicle, writeBikeBlock } from '../../src/simulation/bike-vehicle.ts';
import { DEFAULT_SETUP } from '../../src/simulation/config.ts';
import { BIKE_PIT_SERVICE } from '../../src/simulation/pit-service.ts';
import {
  BIKE_BASE,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../src/simulation/protocol.ts';
import type { SurfaceSample, Track, TrackPoint } from '../../src/simulation/track.ts';
import { FORMULA_APX01, vehicleIndex } from '../../src/simulation/vehicles.ts';
import { installCarGrounding } from '../../src/rendering/studio/car-grounding.ts';
import { StudioFrame, studioUniforms } from '../../src/rendering/studio/studio-frame.ts';
import { pixelDifference } from './pixel-difference.ts';

/** Bounded material integration check, not a full-scene or gameplay fixture.
 * Only two receiving planes are rendered, so actual shader contact lighting
 * can be measured without a motorcycle mesh obscuring the footprint. GP
 * snapshots use the production BikeVehicle pose writer and bike-block writer. */
const WIDTH = 512,
  HEIGHT = 256;
type Case = 'empty' | 'gp' | 'lean' | 'wheelie' | 'stand' | 'formula';
class GroundingBike extends BikeVehicle {
  presentPose(track: Track) {
    this.writeBody(track, 0);
  }
}
const flatRoad = {
  sample(_x: number, _z: number, out: SurfaceSample) {
    out.height = 0;
    return out;
  },
  nearest(_x: number, z: number, out: TrackPoint) {
    out.s = z;
    return 0;
  },
} as unknown as Track;

export function captureGpGrounding() {
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NoToneMapping;
  document.body.style.cssText = 'margin:0;background:#18212a;color:#eef3f6;font:14px monospace';
  const label = document.createElement('p');
  label.textContent = 'GP GROUNDING · BOUNDED MATERIAL CHECK · STANDARD / PHYSICAL RECEIVERS';
  document.body.replaceChildren(label, renderer.domElement);
  const gl = renderer.getContext();
  const shaderErrors: string[] = [],
    glErrors: number[] = [];
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    shaderErrors.push(
      [
        context.getProgramInfoLog(program),
        context.getShaderInfoLog(vertex),
        context.getShaderInfoLog(fragment),
      ].join('\n'),
    );
  };
  const scene = new T.Scene();
  scene.background = new T.Color(0x18212a);
  scene.add(new T.AmbientLight(0xffffff, 1.8));
  const sun = new T.DirectionalLight(0xffffff, 1);
  sun.position.set(-3, 10, -5);
  scene.add(sun, sun.target);
  const camera = new T.OrthographicCamera(-8, 8, 4, -4, 0.1, 30);
  camera.position.set(0, 12, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const geometry = new T.PlaneGeometry(7.6, 7.6).rotateX(-Math.PI / 2);
  const standard = new T.MeshStandardMaterial({ color: 0x929292, roughness: 0.8 });
  const physical = new T.MeshPhysicalMaterial({
    color: 0x929292,
    roughness: 0.12,
    clearcoat: 0.6,
    clearcoatRoughness: 0.08,
  });
  const bindings: { material: string; gpUniformsShared: boolean }[] = [];
  for (const material of [standard, physical]) {
    installCarGrounding(material);
    const compile = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, webgl) {
      compile.call(this, shader, webgl);
      bindings.push({
        material: material.type,
        gpUniformsShared: (['studioGpFront', 'studioGpRear', 'studioGpShape'] as const).every(
          (name) => shader.uniforms[name] === studioUniforms[name],
        ),
      });
    };
  }
  // Nonidentity object AND instance transforms exercise the production world
  // varying's matrix order. Net Standard receiver centre is x=-4 metres.
  const instanced = new T.InstancedMesh(geometry, standard, 1);
  instanced.position.x = -4.35;
  instanced.setMatrixAt(0, new T.Matrix4().makeTranslation(0.35, 0, 0));
  instanced.instanceMatrix.needsUpdate = true;
  const plain = new T.Mesh(geometry, physical);
  plain.position.x = 4;
  scene.add(instanced, plain);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const studio = new StudioFrame();
  const bikes = [GP_R1, GP_R2].map((definition, id) => {
    const bike = new GroundingBike(id, 'medium', DEFAULT_SETUP, 'sport', definition);
    bike.placeFree(flatRoad, id === 0 ? -4 : 4, 0, 0, 0);
    return bike;
  });
  const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
  const uniformArrays = [
    studioUniforms.studioGpFront.value,
    studioUniforms.studioGpRear.value,
    studioUniforms.studioGpShape.value,
  ];
  const uniformSlots = uniformArrays.map((array) => [...array]);
  const resources = () => ({
    ...renderer.info.memory,
    programs: renderer.info.programs?.length ?? 0,
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  });
  const samples: { kind: Case; time: number; resources: ReturnType<typeof resources> }[] = [];
  const images: { name: string; image: string }[] = [];
  const uniformState = () => ({
    count: studioUniforms.studioCarCount.value,
    time: studioUniforms.studioTime.value,
    dt: studioUniforms.studioFrameDt.value,
    front: studioUniforms.studioGpFront.value.map((v) => v.toArray()),
    rear: studioUniforms.studioGpRear.value.map((v) => v.toArray()),
    shape: studioUniforms.studioGpShape.value.map((v) => v.toArray()),
  });
  function draw(kind: Case, time: number, capture?: string) {
    frame.fill(0);
    frame[H.TIME] = time;
    frame[H.CARS] = kind === 'empty' ? 0 : 2;
    for (let id = 0; id < 2; id++) {
      const o = carBase(id),
        bike = bikes[id];
      if (kind === 'formula') {
        // A coherent Formula witness uses its own four mount heights. No GP
        // uniforms are patched manually to manufacture the family difference.
        frame[o + F.X] = id === 0 ? -4 : 4;
        frame[o + F.Y] =
          0.25 + 0.335 - FORMULA_APX01.wheelPositions.reduce((sum, p) => sum + p[1], 0) / 4;
        frame[o + F.QW] = 1;
        frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
        for (let wheel = 0; wheel < 4; wheel++) {
          const w = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
          frame[w + W.LENGTH] = 0.25;
          frame[w + W.RADIUS] = 0.335;
        }
      } else {
        bike.dynamics.lean = kind === 'lean' ? 0.85 : 0;
        bike.dynamics.pitch = kind === 'wheelie' ? 0.25 : 0;
        bike.dynamics.riderOffset = kind === 'lean' ? 0.25 : 0;
        bike.presentPose(flatRoad);
        const p = bike.body.position,
          q = bike.body.orientation;
        frame[o + F.X] = p.x;
        frame[o + F.Y] = p.y;
        frame[o + F.Z] = p.z;
        frame[o + F.QX] = q.x;
        frame[o + F.QY] = q.y;
        frame[o + F.QZ] = q.z;
        frame[o + F.QW] = q.w;
        frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(bike.definition.id);
        writeBikeBlock(frame, o + BIKE_BASE, bike);
        if (kind === 'stand') {
          frame[o + F.IN_PIT] = 1;
          frame[o + F.JACK_HEIGHT] = BIKE_PIT_SERVICE.liftHeight;
        }
      }
    }
    studio.update(frame, camera, sun, 'grounding-fixture');
    renderer.render(scene, camera);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) glErrors.push(error);
    samples.push({ kind, time, resources: resources() });
    if (!capture) return undefined;
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const readError = gl.getError();
    if (readError !== gl.NO_ERROR) glErrors.push(readError);
    if (capture !== 'readback-only')
      images.push({ name: capture, image: renderer.domElement.toDataURL('image/png') });
    return pixels;
  }
  function probeDarkness(open: Uint8Array, grounded: Uint8Array, x: number, z: number) {
    const at = new T.Vector3(x, 0, z).project(camera);
    const px = Math.floor((at.x * 0.5 + 0.5) * WIDTH),
      py = Math.floor((at.y * 0.5 + 0.5) * HEIGHT);
    let delta = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const o = ((py + dy) * WIDTH + px + dx) * 4;
        for (let c = 0; c < 3; c++) delta += open[o + c] - grounded[o + c];
      }
    return delta / 27;
  }
  try {
    // Compile and upload each fixed receiver before counting steady resources.
    draw('gp', 1);
    draw('formula', 2);
    const before = resources();
    samples.length = 0;
    const empty = draw('empty', 9, 'empty')!;
    const gp = draw('gp', 10, 'gp')!;
    const gpState = uniformState();
    for (let i = 0; i < 6; i++) draw('gp', 10);
    const held = draw('gp', 10, 'readback-only')!,
      heldState = uniformState();
    const lean = draw('lean', 12, 'lean')!;
    const rewind = draw('gp', 10, 'readback-only')!,
      rewindState = uniformState();
    const formula = draw('formula', 13, 'formula')!,
      formulaState = uniformState();
    const restored = draw('gp', 14, 'readback-only')!;
    draw('wheelie', 15, 'wheelie');
    const wheelieState = uniformState();
    draw('stand', 16, 'stand');
    const standState = uniformState();
    const cycle: Case[] = ['gp', 'lean', 'wheelie', 'formula', 'empty', 'stand'];
    for (let i = 0; i < 36; i++) draw(cycle[i % cycle.length], 20 + i / 30);
    const cleared = draw('empty', 30, 'readback-only')!,
      clearedState = uniformState();
    const probes = bikes.map((bike, id) => {
      const x = id === 0 ? -4 : 4;
      return {
        material: id === 0 ? 'standard-instanced' : 'physical',
        frontDarkness: probeDarkness(empty, gp, x, bike.bikeSpec.cgToFront),
        rearDarkness: probeDarkness(empty, gp, x, -bike.bikeSpec.cgToRear),
        gpAtFormulaTyre: probeDarkness(empty, gp, x + 0.83, 1.82),
        formulaAtFormulaTyre: probeDarkness(empty, formula, x + 0.83, 1.82),
      };
    });
    return {
      kind: 'bounded-ground-material-integration',
      webgl2: gl instanceof WebGL2RenderingContext,
      viewport: { width: WIDTH, height: HEIGHT },
      before,
      after: resources(),
      samples,
      bindings,
      shaderErrors,
      glErrors,
      fixedUniformSlots: uniformArrays.every((array, a) =>
        array.every((slot, i) => slot === uniformSlots[a][i]),
      ),
      gpState,
      heldState,
      rewindState,
      formulaState,
      wheelieState,
      standState,
      clearedState,
      differences: {
        applied: pixelDifference(empty, gp),
        family: pixelDifference(gp, formula),
        lean: pixelDifference(gp, lean),
        held: pixelDifference(gp, held),
        rewind: pixelDifference(gp, rewind),
        restored: pixelDifference(gp, restored),
        cleared: pixelDifference(empty, cleared),
      },
      probes,
      images,
    };
  } finally {
    geometry.dispose();
    standard.dispose();
    physical.dispose();
    renderer.dispose();
  }
}
