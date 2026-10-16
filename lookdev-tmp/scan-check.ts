// Temporary look-dev harness (not shipped): compiles every scanned ground
// material of a few venues with the scanned path active and reports GLSL
// errors and the sampler count per program.
import * as T from 'three';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { Track } from '../src/simulation/track.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { scannedGround } from '../src/rendering/ground/scan-store.ts';
import { terrainMaterial } from '../src/rendering/open-world/terrain-material.ts';
import { loadEnvironment } from '../src/rendering/assets/environment-loader.ts';
import { RoadMeshes } from '../src/rendering/open-world/roads.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';

const out: string[] = [];
const log = (s: string) => {
  out.push(s);
  (document.getElementById('log') as HTMLElement).textContent = out.join('\n');
};
async function main() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  document.body.append(canvas);
  const renderer = new T.WebGLRenderer({ canvas });
  const gl = renderer.getContext();
  log(`max fragment textures ${gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)}`);
  renderer.debug.onShaderError = (g, program, vs, fs) => {
    const info = g.getShaderInfoLog(fs) || g.getShaderInfoLog(vs) || g.getProgramInfoLog(program);
    log(`SHADER ERROR: ${info}`);
  };
  scannedGround.attach(renderer, 'ultra');
  const ids = (new URLSearchParams(location.search).get('ids') ?? 'aurel,poggio-alto,valley-ridge-mx,kestrel-rx').split(',');
  const camera = new T.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  for (const id of ids) {
    const t0 = performance.now();
    const track = new Track('clear', false, undefined, CIRCUITS[id as keyof typeof CIRCUITS]);
    const circuit = new CircuitScene(track);
    log(`${id}: scene built in ${(performance.now() - t0).toFixed(0)} ms`);
    const ok = await scannedGround.ready(120000);
    log(`${id}: ready ${ok} ${JSON.stringify(scannedGround.diagnostics())}`);
    const scene = new T.Scene();
    scene.add(circuit.group);
    scene.add(new T.DirectionalLight(0xffffff, 3), new T.AmbientLight(0xffffff, 0.3));
    const p = { x: 0, y: 0, z: 0 } as { x: number; y: number; z: number };
    track.at(40, p as never);
    camera.position.set(p.x + 6, p.y + 3, p.z + 6);
    camera.lookAt(p.x, p.y, p.z);
    if (new URLSearchParams(location.search).get('timing')) {
      for (const preset of ['low', 'medium', 'ultra', 'low', 'ultra'] as const) {
        scannedGround.setPreset(preset);
        const t1 = performance.now();
        renderer.compile(scene, camera);
        renderer.render(scene, camera);
        gl.finish();
        const t2 = performance.now();
        renderer.render(scene, camera);
        gl.finish();
        const t3 = performance.now();
        log(`TIMING ${id} ${preset}: compile+first ${(t2 - t1).toFixed(0)} ms, frame ${(t3 - t2).toFixed(0)} ms`);
      }
    }
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    const programs = renderer.info.programs ?? [];
    let scanned = 0;
    for (const program of programs as unknown as { name: string; cacheKey: string; program: WebGLProgram }[]) {
      if (!program.cacheKey.includes('APEX_SCAN')) continue;
      scanned++;
      const n = gl.getProgramParameter(program.program, gl.ACTIVE_UNIFORMS) as number;
      let samplers = 0;
      for (let i = 0; i < n; i++) {
        const u = gl.getActiveUniform(program.program, i);
        if (u && (u.type === gl.SAMPLER_2D || u.type === gl.SAMPLER_CUBE || u.type === gl.SAMPLER_2D_SHADOW || u.type === gl.SAMPLER_2D_ARRAY))
          samplers += u.size;
      }
      log(`  program ${program.name} samplers ${samplers}`);
    }
    log(`${id}: ${scanned} scanned programs, ${programs.length} total`);
    const shotAt = Number(new URLSearchParams(location.search).get('shot') ?? 'NaN');
    if (Number.isFinite(shotAt)) {
      renderer.setSize(1280, 720, false);
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.outputColorSpace = T.SRGBColorSpace;
      const sunDir = new T.Vector3(0.45, 0.78, 0.43).normalize();
      const env = await loadEnvironment(renderer, 'rural-landscape', { variant: '2k' });
      scene.background = env.background;
      scene.environment = env.environment;
      scene.environmentIntensity = 0.7;
      scene.backgroundRotation.y = scene.environmentRotation.y = env.rotationFor(sunDir);
      renderer.toneMappingExposure = 1.0;
      const sun = new T.DirectionalLight(0xfff0dc, 2.6);
      sun.position.copy(sunDir).multiplyScalar(200);
      scene.add(sun);
      const a = { x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, width: 6 } as Record<string, number>;
      track.at(shotAt, a as never);
      // chase: behind and above the line; side: low over the kerb looking along it.
      const views = {
        chase: () => {
          camera.position.set(a.x - a.tx * 9 + a.nx * 1.5, a.y + 2.2, a.z - a.tz * 9 + a.nz * 1.5);
          camera.lookAt(a.x + a.tx * 30, a.y, a.z + a.tz * 30);
        },
        side: () => {
          const l = a.width - 1;
          camera.position.set(a.x + a.nx * l - a.tx * 4, a.y + 1.1, a.z + a.nz * l - a.tz * 4);
          camera.lookAt(a.x + a.nx * (l + 4) + a.tx * 10, a.y, a.z + a.nz * (l + 4) + a.tz * 10);
        },
      };
      for (const [view, place] of Object.entries(views)) {
        place();
        camera.updateProjectionMatrix();
        for (const preset of ['low', 'ultra'] as const) {
          scannedGround.setPreset(preset);
          renderer.render(scene, camera);
          (window as unknown as Record<string, string>)[`shot_${id}-${view}_${preset}`] = canvas.toDataURL('image/png');
          log(`SHOT ${id}-${view} ${preset}`);
        }
      }
    }
  }
  // Festival terrain.
  const m = terrainMaterial();
  await scannedGround.ready(60000);
  const scene = new T.Scene();
  const g = new T.PlaneGeometry(100, 100, 4, 4);
  g.setAttribute('splat', new T.BufferAttribute(new Float32Array(25 * 4).fill(0.25), 4));
  g.setAttribute('shade', new T.BufferAttribute(new Float32Array(25 * 4).fill(0.25), 4));
  scene.add(new T.Mesh(g, m), new T.DirectionalLight(0xffffff, 3));
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  log(`festival terrain compiled; defines ${JSON.stringify(m.defines)}`);
  if (new URLSearchParams(location.search).get('roads')) {
    const world = openWorld();
    const roads = new RoadMeshes(world.network, world.field);
    await scannedGround.ready(60000);
    const rs = new T.Scene();
    rs.add(roads.root, new T.DirectionalLight(0xffffff, 3));
    renderer.compile(rs, camera);
    renderer.render(rs, camera);
    log(`festival roads compiled ${JSON.stringify(scannedGround.diagnostics().scanned)}`);
  }
  log('DONE');
}
main().catch((e) => log(`FAILED ${e?.stack ?? e}`));
