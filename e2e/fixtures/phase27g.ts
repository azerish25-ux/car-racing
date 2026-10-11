import { validateReferenceImage } from '../../src/ui/reference-image.ts';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { TeamMediaView } from '../../src/ui/team-media.ts';
import { PhotoStudio } from '../../src/ui/photo-studio.ts';
import { FormulaCar } from '../../src/rendering/car.ts';
import { newTeam } from '../../src/storage/team-career.ts';
import { DEFAULT_LIVERY, emptyDecal, type Livery } from '../../src/storage/livery.ts';
import {
  configureSky,
  SkyEnvironment,
  circuitLightState,
  lightingDirection,
  type LightingMode,
} from '../../src/rendering/daylight.ts';
import { Interface } from '../../src/ui/interface.ts';
import { Track } from '../../src/simulation/track.ts';
import { referenceSessionPanel } from '../../src/ui/reference-session.ts';
let media: TeamMediaView | null = null;
let photo: PhotoStudio | null = null;
let car: FormulaCar | null = null;
let paintChanges = 0;
let currentLivery: Livery = { ...DEFAULT_LIVERY };
function root() {
  cleanup();
  document.body.style.cssText = 'margin:0;background:#101a24';
  document.body.innerHTML = '<main id="app"></main>';
  return document.querySelector<HTMLElement>('#app')!;
}
export function mountMedia() {
  media = new TeamMediaView(root(), newTeam());
  return media.diagnostics();
}
export function mediaCapture(time: number) {
  if (!media) throw new Error('No media component');
  media.seek(time);
  media.draw();
  const first = media.canvas.toDataURL('image/png');
  media.draw();
  const second = media.canvas.toDataURL('image/png');
  return { png: first, exact: first === second, ...media.diagnostics() };
}
export function mountPhoto() {
  const parent = root();
  car = new FormulaCar(0);
  paintChanges = 0;
  photo = new PhotoStudio(parent, {
    change: () => {},
    preview: (l) => {
      currentLivery = structuredClone(l);
      car!.setLivery(l);
      paintChanges++;
    },
    save: async () => {},
    capture: () => {},
    close: () => photo!.close(),
  });
  currentLivery = {
    ...DEFAULT_LIVERY,
    decals: [
      { ...emptyDecal(1), text: 'AUREL', x: -0.35 },
      { ...emptyDecal(2), text: 'ORIGINAL', x: 0.4 },
    ],
  };
  car.setLivery(currentLivery);
  photo.open(currentLivery, 1);
}
export function photoState() {
  if (!photo || !car) throw new Error('No photo component');
  return {
    livery: structuredClone(currentLivery),
    paintChanges,
    texture: (
      car.reflectivePaint.find((m) => m.userData.liverySide === 1)!.map!.image as HTMLCanvasElement
    ).toDataURL(),
    hidden: photo.element.hidden,
  };
}
export function mountEvent() {
  const r = root();
  const ui = new Interface(r, new Track(), {
    action: () => {},
    start: () => {},
    apply: () => {},
    seek: () => {},
    replaySpeed: () => {},
    exportSetup: () => {},
    importSetup: () => {},
  });
  ui.showMode('menu');
  ui.modalContent(referenceSessionPanel(93, true));
}
export function skyModes() {
  const renderer = new T.WebGLRenderer({ antialias: false });
  renderer.setSize(480, 270);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene(),
    sky = new Sky();
  configureSky(sky);
  sky.scale.setScalar(450000);
  scene.add(sky);
  const camera = new T.PerspectiveCamera(65, 480 / 270, 0.1, 700000);
  camera.lookAt(-1, 0.14, -1);
  const env = new SkyEnvironment(sky),
    target = new T.WebGLRenderTarget(480, 270);
  const capture = (mode: LightingMode, cover: number, rain: number) => {
    const light = circuitLightState(cover, rain, mode);
    sky.material.uniforms.cloudCover.value = cover;
    sky.material.uniforms.sunsetAmount.value = mode === 'sunset' ? 1 : 0;
    sky.material.uniforms.nightAmount.value = mode === 'night' ? 1 : 0;
    sky.material.uniforms.sunPosition.value.copy(lightingDirection(mode));
    sky.material.uniforms.skyRadiance.value = light.skyRadiance;
    renderer.toneMappingExposure = light.exposure;
    env.update(renderer, scene, cover, mode);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const p = new Uint8Array(480 * 270 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 480, 270, p);
    const sum = [0, 0, 0];
    let opaque = 0;
    for (let i = 0; i < p.length; i += 4) {
      for (let j = 0; j < 3; j++) sum[j] += p[i + j];
      if (p[i + 3]) opaque++;
    }
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    return { mode, cover, rain, sum, opaque, png: renderer.domElement.toDataURL('image/png') };
  };
  try {
    const shots = [
      capture('day', 0.12, 0),
      capture('sunset', 0.12, 0),
      capture('day', 0.9, 0),
      capture('day', 1, 14),
      capture('night', 0.6, 14),
      capture('sunset', 0.12, 0),
    ];
    return {
      shots,
      restored: shots[1].png === shots[5].png,
      glError: renderer.getContext().getError(),
      captures: env.captures,
    };
  } finally {
    env.dispose();
    target.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
export function cleanup() {
  media?.dispose();
  media = null;
  photo?.close();
  photo = null;
  if (car) {
    const gs = new Set<T.BufferGeometry>(),
      ms = new Set<T.Material>(),
      ts = new Set<T.Texture>();
    car.root.traverse((o) => {
      if (o instanceof T.Mesh) {
        gs.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          ms.add(m);
          for (const t of Object.values(m)) if (t instanceof T.Texture) ts.add(t);
        }
      }
    });
    gs.forEach((g) => g.dispose());
    ms.forEach((m) => m.dispose());
    ts.forEach((t) => t.dispose());
    car = null;
  }
}

export async function validatePNGEvidence() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 54;
  const context = canvas.getContext('2d')!;
  const blob = () =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG failed'))), 'image/png'),
    );
  const rejected: string[] = [];
  try {
    await validateReferenceImage(await blob(), 96, 54);
  } catch (e) {
    rejected.push(String(e));
  }
  context.fillStyle = '#000';
  context.fillRect(0, 0, 96, 54);
  try {
    await validateReferenceImage(await blob(), 96, 54);
  } catch (e) {
    rejected.push(String(e));
  }
  context.fillStyle = '#436b91';
  context.fillRect(12, 12, 70, 28);
  const image = await blob();
  const visible = await validateReferenceImage(image, 96, 54);
  try {
    await validateReferenceImage(image, 1920, 1080);
  } catch (e) {
    rejected.push(String(e));
  }
  return { rejected, visible };
}
