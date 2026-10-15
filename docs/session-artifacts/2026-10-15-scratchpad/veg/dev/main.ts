import * as T from 'three';
import { loadEnvironment } from '@src/rendering/assets/environment-loader.ts';
import { VegetationLibrary } from '@src/rendering/vegetation/library.ts';
import { PhotoForest } from '@src/rendering/vegetation/forest.ts';
import { TrackGrass, type GrassClump } from '@src/rendering/vegetation/grass.ts';
import { SPECIES, type SpeciesId } from '@src/rendering/vegetation/species.ts';
import { studioUniforms } from '@src/rendering/studio/studio-frame.ts';
import { chainShaderHook } from '@src/rendering/studio/shader-hooks.ts';

const params = new URLSearchParams(location.search);
const W = Number(params.get('w') ?? 1280),
  H = Number(params.get('h') ?? 720);
const sky = params.get('sky') ?? 'rural-landscape';
const layout = params.get('layout') ?? 'row';
const preset = (params.get('preset') ?? 'ultra') as 'ultra';

const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.toneMapping = T.AgXToneMapping;
renderer.toneMappingExposure = Number(params.get('exposure') ?? 1.0);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new T.Scene();
const camera = new T.PerspectiveCamera(Number(params.get('fov') ?? 55), W / H, 0.1, 3000);
const status = (s: string) => ((window as unknown as { __status: string }).__status = s);
status('start');

async function main() {
  const env = await loadEnvironment(renderer, sky, { variant: '2k' });
  scene.background = env.background;
  scene.environment = env.environment;
  const info = env.info!;
  const az = (info.sunAzimuth * Math.PI) / 180,
    el = Math.max(0.25, (info.sunElevation * Math.PI) / 180);
  const sunDir = new T.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  const rot = Number(params.get('sunrot') ?? 0.9);
  sunDir.applyAxisAngle(new T.Vector3(0, 1, 0), rot);
  scene.backgroundRotation.y = scene.environmentRotation.y = env.rotationFor(sunDir);
  scene.environmentIntensity = Number(params.get('env') ?? 1.0);
  scene.backgroundIntensity = scene.environmentIntensity;
  const sun = new T.DirectionalLight(0xfff3e0, Number(params.get('sun') ?? 3.2));
  sun.position.copy(sunDir).multiplyScalar(150);
  sun.castShadow = params.get('shadow') !== '0';
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  c.left = c.bottom = -70;
  c.right = c.top = 70;
  c.near = 1;
  c.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  scene.fog = new T.Fog(0xa8b8c8, 200, 1600);

  const ground = new T.Mesh(
    new T.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
    new T.MeshStandardMaterial({ color: new T.Color(0.09, 0.13, 0.05), roughness: 0.95 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  const ids = Object.values(SPECIES) as SpeciesId[];
  const library = await VegetationLibrary.load(renderer, ids);
  const debug = params.get('debug');
  if (debug)
    for (const s of library.species.values())
      for (const m of [s.cardMaterial, s.impostorMaterial, s.barkMaterial])
        if (m)
          chainShaderHook(m, 'dev-debug-v1', (shader) => {
            const out =
              debug === 'normal'
                ? 'vec4( normal * 0.5 + 0.5, 1.0 )'
                : debug === 'alpha'
                  ? 'vec4( vec3( diffuseColor.a ), 1.0 )'
                  : debug === 'albedo'
                    ? 'vec4( diffuseColor.rgb, 1.0 )'
                    : 'vec4( vec3( vegVisibility ), 1.0 )';
            shader.fragmentShader = shader.fragmentShader.replace(
              '#include <dithering_fragment>',
              `#include <dithering_fragment>\n gl_FragColor = ${out};`,
            );
          });
  status(`loaded ${[...library.species.keys()].join(',')} failed ${library.failed.join(',')}`);
  const forest = new PhotoForest(library);
  const trees = [SPECIES.linden, SPECIES.chestnut, SPECIES.birch, SPECIES.rowan, SPECIES.fir, SPECIES.firB, SPECIES.shrub];
  const plants = [];
  if (layout === 'row') {
    // One of each species at 20 m, the same set again at 60 m and at 140 m.
    for (const [ring, distance] of [
      [0, Number(params.get('d0') ?? 22)],
      [1, 65],
      [2, 150],
    ] as const) {
      trees.forEach((id, i) => {
        const a = ((i - 3) / 7) * (ring === 0 ? 1.4 : ring === 1 ? 0.9 : 0.6);
        plants.push({
          species: id,
          x: Math.sin(a) * distance,
          y: 0,
          z: -Math.cos(a) * distance,
          scale: id === SPECIES.shrub ? 1.5 : 1,
          yaw: i * 1.7 + ring,
          tint: [1, 1, 1] as const,
        });
      });
    }
  } else {
    // A forest edge: dense mixed planting 30-200 m.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 900; k++) {
      const x = (rnd() - 0.5) * 500,
        z = -30 - rnd() * 260;
      const id = trees[Math.floor(rnd() * 6)];
      plants.push({ species: id, x, y: 0, z, scale: 0.9 + rnd() * 0.5, yaw: rnd() * 6.28, tint: [0.9 + rnd() * 0.2, 0.95 + rnd() * 0.1, 0.9 + rnd() * 0.15] as const });
    }
  }
  forest.add(plants, { label: 'dev', shadows: true, chunk: 60 });
  scene.add(forest.root);
  const grassSpecies = library.get(SPECIES.grass);
  let grass: TrackGrass | null = null;
  if (grassSpecies) {
    const clumps: GrassClump[] = [];
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 6000; k++) {
      const x = (rnd() - 0.5) * 70,
        z = -2 - rnd() * 40;
      if (Math.abs(x) < 4) continue;
      clumps.push({ x, y: -0.03, z, width: 0.45 + rnd() * 0.5, height: 0.85 + rnd() * 0.35, yaw: rnd() * 6.28, tile: Math.floor(rnd() * 8), tint: rnd() });
    }
    grass = new TrackGrass(grassSpecies, clumps);
    scene.add(grass.root);
  }
  camera.position.set(0, Number(params.get('cy') ?? 1.6), Number(params.get('cz') ?? 8));
  camera.lookAt(0, Number(params.get('ly') ?? 4), -40);
  camera.updateMatrixWorld();
  let frame = 0;
  const t0 = Number(params.get('t') ?? 3);
  const loop = () => {
    studioUniforms.studioWind.value.set(3, 2, t0 + frame * 0.016, 0.5);
    forest.update(camera, preset);
    grass?.update(camera, 55);
    renderer.render(scene, camera);
    frame++;
    if (frame === 3) status('ready');
    requestAnimationFrame(loop);
  };
  loop();
}
main().catch((e) => {
  status(`error ${e?.stack ?? e}`);
  console.error(e);
});
