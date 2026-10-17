import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BikeModel, BikeMaterials, staticSag } from '../../../src/rendering/bike.ts';
import { VEHICLES } from '../../../src/simulation/vehicles.ts';

/** Offline production-model inspector, deliberately not the racing application. */
const canvas = document.querySelector<HTMLCanvasElement>('#model')!;
const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
const scene = new T.Scene();
scene.background = new T.Color(0x343a42);
const camera = new T.PerspectiveCamera(38, 1, 0.035, 80);
camera.position.set(3.05, 1.65, 4.15);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.83, 0);
controls.enableDamping = true;
controls.minDistance = 0.6; controls.maxDistance = 10;
controls.maxPolarAngle = Math.PI * .49;
controls.update();
const environment = new RoomEnvironment();
const pmrem = new T.PMREMGenerator(renderer);
const environmentMap = pmrem.fromScene(environment, 0.04);
scene.environment = environmentMap.texture;
scene.environmentIntensity = .8;
environment.dispose(); pmrem.dispose();
const sun = new T.DirectionalLight(0xffffff, 3.2);
sun.position.set(3.5, 6.5, 4.5); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -3;
sun.shadow.camera.right = 3; sun.shadow.camera.top = 3; sun.shadow.camera.bottom = -3;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 18;
sun.shadow.normalBias = .015; sun.shadow.bias = -.00003;
scene.add(sun, sun.target);
scene.add(new T.HemisphereLight(0xdbe4ee, 0x323135, .45));
const floor = new T.Mesh(new T.PlaneGeometry(70, 70), new T.MeshStandardMaterial({color:0x50555b,roughness:.9}));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const byId = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
const machine = byId<HTMLSelectElement>('machine');
const quality = byId<HTMLSelectElement>('detail');
const lean = byId<HTMLInputElement>('lean');
const tuck = byId<HTMLInputElement>('tuck');
const animate = byId<HTMLInputElement>('spin');
const status = byId<HTMLSpanElement>('status');
let model: BikeModel, materials: BikeMaterials, rotation = 0, last = performance.now(), frames = 0;
let failed = false, totalTriangles = 0;
const errors: string[] = [];
function pose() {
  const def = VEHICLES[machine.value], sag = staticSag(def);
  model.pose({ fork:sag.fork, shock:sag.shock, steer:0,
    frontRotation:rotation, rearRotation:rotation, chassisLean:0,
    riderOffset:Number(lean.value)*.45, tuck:Number(tuck.value), brake:.05,
    rearBrake:0, discTemp:280, compoundColour:0xffffff, riding:true,
    speed:42, gear:4, rpm:12200 });
  // Explicit inspection transform, not a physically driven lean/corner.
  model.root.rotation.z = Number(lean.value);
  model.root.position.y = def.bike!.cgHeight + .12 * Math.abs(Number(lean.value));
}
function switchModel() {
  if (model) { scene.remove(model.root); model.dispose(); materials.dispose(); }
  const detail = quality.value as 'high' | 'mid' | 'far';
  materials = new BikeMaterials(0);
  model = new BikeModel(VEHICLES[machine.value], 0, detail, materials, true);
  scene.add(model.root); rotation = 0; totalTriangles = 0;
  model.root.traverse((object) => {
    if (object instanceof T.Mesh) totalTriangles +=
      ((object.geometry.index?.count ?? object.geometry.getAttribute('position').count)/3) *
      (object instanceof T.InstancedMesh ? object.count : 1);
  });
  byId<HTMLSpanElement>('triangles').textContent = totalTriangles.toLocaleString();
  pose();
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
}
function view(mode: string) {
  const views: Record<string, [number,number,number]> = {
    front:[.001,1.25,4.6], side:[4.6,1.25,0], rear:[2.6,1.7,-4.0],
    detail:[1.6,.85,2.25], three:[3.05,1.65,4.15]
  };
  camera.position.set(...(views[mode] ?? views.three));
  controls.target.set(0,mode==='detail'?.58:.83,mode==='detail'?.4:0);
  controls.update();
}
for (const element of [machine, quality]) element.addEventListener('change', switchModel);
for (const element of [lean, tuck]) element.addEventListener('input', pose);
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button =>
  button.addEventListener('click',()=>view(button.dataset.view!)));
canvas.addEventListener('webglcontextlost', () => {
  failed = true; status.textContent = 'Graphics context lost. Reload the inspector.';
  errors.push('webglcontextlost');
});
window.addEventListener('error',event=>{errors.push(event.message);});
const observer = new ResizeObserver(resize); observer.observe(canvas);
switchModel(); resize(); status.textContent = 'Production mesh · studio inspection';
function draw(time: number) {
  if (failed) return;
  const dt = Math.min(.05,Math.max(0,(time-last)/1000)); last = time;
  if (animate.checked) { rotation += dt*3; pose(); }
  controls.update(); renderer.render(scene,camera); frames++;
  if (frames%30===0) byId<HTMLSpanElement>('calls').textContent=String(renderer.info.render.calls);
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
(window as unknown as {gpInspector:unknown}).gpInspector = {
  getState:()=>({ machine:machine.value, detail:quality.value, triangles:totalTriangles,
    frames, errors:[...errors], glError:renderer.getContext().getError(),
    scope:'Production BikeModel with dedicated studio inspection lighting and explicit pose controls; not the racing application.' }),
};
