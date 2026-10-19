import * as T from 'three';
import { BikeMaterials, BikeModel, staticSag } from '../../src/rendering/bike.ts';
import { EffectPlayback } from '../../src/rendering/effect-playback.ts';
import { Effects, PARTICLE_KIND } from '../../src/rendering/effects.ts';
import { GpContactEffects } from '../../src/rendering/gp-contact-effects.ts';
import { GP_SPRAY_SCALE, SPRAY_PROFILE, SprayClouds } from '../../src/rendering/spray-clouds.ts';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { GP_R1, chassisLean } from '../../src/simulation/bike-definitions.ts';
import { BikeVehicle, writeBikeBlock } from '../../src/simulation/bike-vehicle.ts';
import { DEFAULT_SETUP } from '../../src/simulation/config.ts';
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
import { vehicleIndex } from '../../src/simulation/vehicles.ts';
import { pixelDifference } from './pixel-difference.ts';

/** Bounded actual BikeModel + Effects draw. Controlled wheel water/load allow
 * exact source comparisons; this is not a complete wet-race acceptance scene.
 * Chassis transforms come from BikeVehicle.writeBody, not a fixture lean rig. */
const WIDTH = 900,
  HEIGHT = 550;

class ContactBike extends BikeVehicle {
  pose(track: Track) {
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

function particleBytesEqual(a: Effects, b: Effects, omitProfile = false) {
  return a.group.children.every((node, i) => {
    const actual = (node as T.Mesh).geometry,
      expected = (b.group.children[i] as T.Mesh).geometry;
    return Object.keys(expected.attributes).every((name) => {
      if (omitProfile && name === 'sprayProfile') return true;
      const x = actual.getAttribute(name).array,
        y = expected.getAttribute(name).array,
        bytesX = new Uint8Array(x.buffer, x.byteOffset, x.byteLength),
        bytesY = new Uint8Array(y.buffer, y.byteOffset, y.byteLength);
      return bytesX.length === bytesY.length && bytesX.every((value, n) => value === bytesY[n]);
    });
  });
}

function opticalImpact(clean: Uint8Array, spray: Uint8Array) {
  let channelDifference = 0;
  for (let i = 0; i < clean.length; i += 4)
    for (let c = 0; c < 3; c++) channelDifference += Math.abs(clean[i + c] - spray[i + c]);
  return { ...pixelDifference(clean, spray), channelDifference };
}

export function captureGpContactEffects() {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  document.body.style.cssText = 'margin:0;background:#202830';
  document.body.replaceChildren(renderer.domElement);
  const gl = renderer.getContext(),
    shaderErrors: string[] = [],
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
  scene.background = new T.Color(0x91a3af);
  scene.add(new T.HemisphereLight(0xc5d8e8, 0x3b3c3d, 2.4));
  const sun = new T.DirectionalLight(0xe6edf5, 1.8);
  sun.position.set(3, 8, 2);
  scene.add(sun);
  const floor = new T.Mesh(
    new T.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
    new T.MeshStandardMaterial({ color: 0x41474b, roughness: 0.58 }),
  );
  scene.add(floor);
  const camera = new T.PerspectiveCamera(39, WIDTH / HEIGHT, 0.05, 80);
  camera.position.set(-4.1, 4.6, -6.2);
  camera.lookAt(0, 0.5, -0.5);
  const materials = new BikeMaterials(0),
    model = new BikeModel(GP_R1, 0, 'mid', materials, true),
    bike = new ContactBike(0, 'wet', DEFAULT_SETUP, 'sport', GP_R1),
    sag = staticSag(GP_R1),
    frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0),
    weather = new WeatherPresentation();
  bike.placeFree(flatRoad, 0, 0, 0, 0);
  scene.add(model.root);
  weather.install(model.root);
  const legacy = new Effects(),
    corrected = new Effects(),
    unprofiled = new Effects(),
    adapter = new GpContactEffects(),
    legacyPlayback = new EffectPlayback(legacy),
    correctedPlayback = new EffectPlayback(corrected),
    unprofiledPlayback = new EffectPlayback(unprofiled),
    effectPools = [legacy, corrected, unprofiled],
    playbacks = [legacyPlayback, correctedPlayback, unprofiledPlayback];
  for (const effects of [corrected, unprofiled]) {
    effects.contactEnabled = adapter.contactEnabled;
    effects.contactOffset = adapter.contactOffset;
    effects.diffuserEnabled = adapter.diffuserEnabled;
    effects.smokeSliding = adapter.smokeSliding;
  }
  corrected.sprayProfile = adapter.sprayProfile;
  const births: {
    wheel: number;
    plume: boolean;
    x: number;
    y: number;
    z: number;
    floor: number;
  }[] = [];
  const worldPoint = new T.Vector3(),
    q = new T.Quaternion();
  corrected.contactOffset = (sample, id, wheel, plume, target) => {
    const floorHeight = adapter.contactOffset(sample, id, wheel, plume, target),
      offset = carBase(id);
    q.fromArray(sample, offset + F.QX);
    worldPoint.copy(target).applyQuaternion(q);
    births.push({
      wheel,
      plume,
      x: sample[offset + F.X] + worldPoint.x,
      y: sample[offset + F.Y] + worldPoint.y,
      z: sample[offset + F.Z] + worldPoint.z,
      floor: sample[offset + F.Y] + floorHeight,
    });
    return floorHeight;
  };
  scene.add(...effectPools.map((effects) => effects.group));
  const cloud = corrected.group.getObjectByName('Lit wheel-water spray clouds') as T.Mesh<
    T.InstancedBufferGeometry,
    T.ShaderMaterial
  >;
  // Compile the public unprofiled shader path over the same raw arrays. Its
  // GP branch is absent, providing an independent zero-profile pixel control.
  const originalCloud = new SprayClouds(
    cloud.geometry.getAttribute('center').array as Float32Array,
    cloud.geometry.getAttribute('velocity').array as Float32Array,
    cloud.geometry.getAttribute('size').array as Float32Array,
    cloud.geometry.getAttribute('opacity').array as Float32Array,
    cloud.geometry.getAttribute('kind').array as Uint8Array,
    cloud.geometry.getAttribute('floor').array as Float32Array,
    cloud.geometry.getAttribute('cloudColor').array as Float32Array,
  );
  originalCloud.material.uniforms.nearPlane.value = camera.near;
  const initialGeometry = cloud.geometry,
    initialMaterial = cloud.material,
    initialAttributes = Object.values(cloud.geometry.attributes).map((a) => a.array);
  const resources = () => ({
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
  });
  const images: { name: string; image: string }[] = [];
  const capture = (name: string, source: Effects | null, save = true) => {
    for (const effects of effectPools) effects.group.visible = effects === source;
    const beforeFrame = frame.slice();
    renderer.render(scene, camera);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) glErrors.push(error);
    if (save) images.push({ name, image: renderer.domElement.toDataURL('image/png') });
    if (!frame.every((value, index) => value === beforeFrame[index]))
      throw new Error('Rendering modified the source GP frame');
    return pixels;
  };
  const captureOriginalShader = () => {
    cloud.material = originalCloud.material;
    try {
      return capture('unprofiled-shader-control', corrected, false);
    } finally {
      cloud.material = initialMaterial;
    }
  };
  const pose = (lean: number, pitch: number, down: boolean, moving = false, vehicle = 'gpr1') => {
    bike.dynamics.lean = lean;
    bike.dynamics.pitch = pitch;
    bike.dynamics.state = down ? 'separated' : 'riding';
    bike.dynamics.speed = 30;
    bike.pose(flatRoad);
    frame.fill(0);
    frame[H.CARS] = 1;
    frame[H.TIME] = 1;
    frame[H.WATER] = 0.7;
    frame[o + F.X] = bike.body.position.x;
    frame[o + F.Y] = bike.body.position.y;
    frame[o + F.Z] = bike.body.position.z - (moving ? 15 : 0);
    frame[o + F.QX] = bike.body.orientation.x;
    frame[o + F.QY] = bike.body.orientation.y;
    frame[o + F.QZ] = bike.body.orientation.z;
    frame[o + F.QW] = bike.body.orientation.w;
    frame[o + F.SPEED] = 30;
    frame[o + F.VZ] = 30;
    frame[o + F.COMPOUND] = 4;
    frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
    writeBikeBlock(frame, o + BIKE_BASE, bike);
    for (let wheel = 0; wheel < 4; wheel++) {
      const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
      frame[p + W.LOAD] = 1200;
      frame[p + W.WATER] = 0.7;
      frame[p + W.SURFACE] = 1;
    }
    model.root.position.fromArray(frame, o + F.X);
    model.root.quaternion.fromArray(frame, o + F.QX);
    model.pose({
      speed: 30,
      rpm: 11500,
      gear: 3,
      fork: sag.fork,
      shock: sag.shock,
      steer: 0,
      frontRotation: 0,
      rearRotation: 0,
      chassisLean: chassisLean(lean, GP_R1.bike!),
      riderOffset: lean === 0 ? 0 : 0.18 * Math.sign(lean),
      tuck: 0.8,
      brake: 0,
      rearBrake: 0,
      discTemp: 140,
      compoundColour: 0xffffff,
      compound: 4,
      frontWater: 0.7,
      rearWater: 0.7,
      riding: !down,
    });
    // A separated rider belongs to the full scene's independent rig. This
    // bounded bike/effect fixture hides the seated mesh for the down check.
    model.rider.root.visible = !down;
    weather.update(frame);
    for (const playback of playbacks) {
      playback.reset();
      playback.update(frame);
    }
    births.length = 0;
    for (let i = 0; i < 15; i++) {
      frame[H.TIME] += 1 / 30;
      if (moving) frame[o + F.Z] += 1;
      for (const playback of playbacks) playback.update(frame);
    }
    model.root.position.fromArray(frame, o + F.X);
  };
  try {
    pose(0, 0, false);
    // Prepare both actual particle geometries and material programs, then
    // hold the exact same particle/pose state for the comparison captures.
    for (let i = 0; i < 3; i++) {
      capture('warm-legacy', legacy, false);
      capture('warm-gp', corrected, false);
      capture('warm-profile-off', unprofiled, false);
    }
    captureOriginalShader();
    const before = resources(),
      baseline = capture('legacy-four-wheel-spray', legacy),
      gp = capture('gp-two-tyre-spray', corrected),
      wetBirths = births.map((birth) => ({ ...birth })),
      wetCounts = {
        legacy: legacy.diagnostics().spawned[PARTICLE_KIND.SPRAY],
        gp: corrected.diagnostics().spawned[PARTICLE_KIND.SPRAY],
      };
    for (let i = 0; i < 20; i++) correctedPlayback.update(frame);
    const held = capture('held-gp', corrected, false);
    pose(0.6, 0, false);
    const lean = capture('gp-leaned-two-tyre-spray', corrected),
      leanBirths = births.map((birth) => ({ ...birth }));
    pose(0, 0.25, false);
    capture('gp-wheelie-rear-tyre-only', corrected);
    const wheelie = {
      contacts: [...new Set(births.map((birth) => birth.wheel))],
      spray: corrected.diagnostics().spawned[PARTICLE_KIND.SPRAY],
    };
    pose(1.5, 0, true);
    capture('gp-down-no-tyre-spray', corrected);
    const down = {
      births: births.length,
      spray: corrected.diagnostics().spawned[PARTICLE_KIND.SPRAY],
    };
    // Unlike the original contact-position check, these emitters really move
    // 15 m over 0.5 s. Both pools have identical contacts, random history and
    // raw particle data; only the birth-time GP optical profile differs.
    pose(0, 0, false, true);
    const cleanMoving = capture('moving-no-spray-control', null, false),
      movingOff = capture('gp-moving-profile-off', unprofiled),
      offDraws = renderer.info.render.calls,
      movingOn = capture('gp-moving-profile-on', corrected),
      onDraws = renderer.info.render.calls,
      movingCount = corrected.diagnostics().spawned[PARTICLE_KIND.SPRAY],
      offCount = unprofiled.diagnostics().spawned[PARTICLE_KIND.SPRAY],
      rawBytesEqual = particleBytesEqual(corrected, unprofiled, true),
      profile = cloud.geometry.getAttribute('sprayProfile') as T.InstancedBufferAttribute,
      profilesBeforeHold = profile.array.slice(),
      profileVersion = profile.version,
      movingOrigins = births.map((birth) => birth.z);
    for (let i = 0; i < 20; i++) correctedPlayback.update(frame);
    const movingHeld = capture('moving-profile-held', corrected, false),
      profileHeld =
        profile.version === profileVersion &&
        profile.array.every((value, i) => value === profilesBeforeHold[i]);
    frame[H.TIME] = 0.25;
    correctedPlayback.update(frame);
    const seek = {
      active: corrected.diagnostics().active,
      profileCleared: profile.array.every((value) => value === SPRAY_PROFILE.DEFAULT),
      difference: pixelDifference(cleanMoving, capture('moving-profile-seek', corrected, false)),
    };
    const moving = {
      speed: 30,
      duration: 0.5,
      distance: 15,
      originRange: [Math.min(...movingOrigins), Math.max(...movingOrigins)],
      counts: { profiled: movingCount, unprofiled: offCount },
      rawBytesEqual,
      scale: GP_SPRAY_SCALE,
      profileBytes: profile.array.byteLength,
      profileHeld,
      impact: {
        unprofiled: opticalImpact(cleanMoving, movingOff),
        profiled: opticalImpact(cleanMoving, movingOn),
      },
      difference: pixelDifference(movingOff, movingOn),
      held: pixelDifference(movingOn, movingHeld),
      draws: { profiled: onDraws, unprofiled: offDraws },
      seek,
    };
    // The bike geometry remains a fixed backdrop: this checks only the car
    // particle fallback and original shader, not a substitute car-model test.
    pose(0, 0, false, true, 'apx01');
    const carDefault = capture('car-default-particles', unprofiled, false),
      carAdapted = capture('car-adapted-particles', corrected, false),
      carOriginalShader = captureOriginalShader(),
      nonGp = {
        rawBytesEqual: particleBytesEqual(corrected, unprofiled),
        profileZero: profile.array.every((value) => value === SPRAY_PROFILE.DEFAULT),
        adapterDifference: pixelDifference(carDefault, carAdapted),
        shaderDifference: pixelDifference(carAdapted, carOriginalShader),
      };
    for (let i = 0; i < 12; i++) {
      pose(i % 2 ? 0.6 : 0, 0, false);
      capture('resource-hold', corrected, false);
    }
    return {
      webgl2: gl instanceof WebGL2RenderingContext,
      shaderErrors,
      glErrors,
      images,
      before,
      after: resources(),
      wetBirths,
      wetCounts,
      leanBirths,
      wheelie,
      down,
      moving,
      nonGp,
      differences: {
        applied: pixelDifference(baseline, gp),
        held: pixelDifference(gp, held),
        lean: pixelDifference(gp, lean),
      },
      fixedResources:
        cloud.geometry === initialGeometry &&
        cloud.material === initialMaterial &&
        Object.values(cloud.geometry.attributes).every((a, i) => a.array === initialAttributes[i]),
      capacities: corrected.diagnostics(),
    };
  } finally {
    for (const effects of effectPools) {
      effects.clear();
      effects.group.traverse((node) => {
        if (!(node instanceof T.Mesh) && !(node instanceof T.Points)) return;
        node.geometry.dispose();
        for (const material of Array.isArray(node.material) ? node.material : [node.material])
          material.dispose();
      });
    }
    originalCloud.geometry.dispose();
    originalCloud.material.dispose();
    model.dispose();
    materials.dispose();
    floor.geometry.dispose();
    floor.material.dispose();
    renderer.dispose();
  }
}
