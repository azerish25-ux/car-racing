import * as T from 'three';
import { setOwnEnvMap } from '../studio/ibl-energy.ts';

/** Cheap local reflection for the festival cars on the Medium tier (refs
 * 010, 019, 045, 074, 097: buildings, trees and neighbours mirrored in the
 * paint). High/Ultra keep the shared 256 px ReflectionSystem probe; Medium
 * had only the sky PMREM. Here a 96 px half-float cube is captured around
 * the followed car one face per frame (six frames per refresh, a refresh
 * every 1.2 s of presentation time), with the cars, effects and overlays
 * excluded like the High probe, and published to the car paint only when
 * all six faces are complete (two targets, so a material never samples the
 * cube being drawn). Cost: one extra scene pass per frame at 96 x 96 px,
 * frustum-culled to a 90-degree face and 450 m, plus a PMREM per refresh. */
export const CAR_PROBE = Object.freeze({ face: 96, interval: 1.2, far: 450, eyeHeight: 1.2 });

export class FestivalCarProbe {
  private readonly targets = [0, 1].map(
    () =>
      new T.WebGLCubeRenderTarget(CAR_PROBE.face, {
        type: T.HalfFloatType,
        generateMipmaps: true,
        minFilter: T.LinearMipmapLinearFilter,
      }),
  );
  private readonly cubes = this.targets.map((t) => new T.CubeCamera(0.2, CAR_PROBE.far, t));
  private next = 0;
  private face = -1;
  private started = -Infinity;
  private clock = NaN;
  private published: T.Texture | null = null;
  private readonly owned = new Map<
    T.MeshStandardMaterial,
    { map: T.Texture | null; intensity: number }
  >();
  private readonly hidden: boolean[] = [];
  /** Completed captures (diagnostics). */
  updates = 0;
  get active() {
    return this.published !== null;
  }
  /** Advance the capture by one face and keep `materials` on the latest
   * complete cube; `active` false releases every material to the sky. */
  update(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    subject: T.Object3D | null,
    materials: readonly T.Material[],
    active: boolean,
    time: number,
    exclusions: readonly T.Object3D[],
    skyScale?: { value: number },
    specularGain = 1,
  ) {
    if (!active || !subject || !Number.isFinite(time)) {
      this.release();
      return;
    }
    // A seek or a long stall restarts the refresh from the current eye.
    if (!Number.isFinite(this.clock) || time < this.clock || time - this.clock > 2) {
      this.face = -1;
      this.started = -Infinity;
    }
    const paused = time === this.clock;
    this.clock = time;
    if (this.face < 0 && time - this.started >= CAR_PROBE.interval) {
      this.face = 0;
      this.started = time;
      this.cubes[this.next].position.copy(subject.position);
      this.cubes[this.next].position.y += CAR_PROBE.eyeHeight;
    }
    if (this.face >= 0 && !paused)
      this.renderFace(renderer, scene, subject, exclusions, skyScale, specularGain);
    this.apply(materials);
  }
  private renderFace(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    subject: T.Object3D,
    exclusions: readonly T.Object3D[],
    skyScale: { value: number } | undefined,
    specularGain: number,
  ) {
    const cube = this.cubes[this.next],
      texture = cube.renderTarget.texture,
      face = this.face;
    const target = renderer.getRenderTarget(),
      activeFace = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel(),
      shadows = renderer.shadowMap.autoUpdate,
      xr = renderer.xr.enabled,
      visible = subject.visible,
      sky = skyScale?.value,
      mipmaps = texture.generateMipmaps;
    this.hidden.length = 0;
    try {
      subject.visible = false;
      for (const root of exclusions) {
        this.hidden.push(root.visible);
        root.visible = false;
      }
      renderer.shadowMap.autoUpdate = false;
      renderer.xr.enabled = false;
      // The visible dome at the radiance sky-lit specular sees (as on High).
      if (skyScale) skyScale.value = scene.environmentIntensity * specularGain;
      if (cube.coordinateSystem !== renderer.coordinateSystem) {
        cube.coordinateSystem = renderer.coordinateSystem;
        cube.updateCoordinateSystem();
      }
      cube.updateMatrixWorld();
      texture.generateMipmaps = mipmaps && face === 5;
      renderer.setRenderTarget(cube.renderTarget, face, cube.activeMipmapLevel);
      renderer.render(scene, cube.children[face] as T.Camera);
    } finally {
      texture.generateMipmaps = mipmaps;
      if (skyScale) skyScale.value = sky!;
      subject.visible = visible;
      exclusions.forEach((root, i) => {
        if (i < this.hidden.length) root.visible = this.hidden[i];
      });
      renderer.shadowMap.autoUpdate = shadows;
      renderer.xr.enabled = xr;
      renderer.setRenderTarget(target, activeFace, mip);
    }
    this.face++;
    if (this.face < 6) return;
    texture.needsPMREMUpdate = true;
    this.published = texture;
    this.next = 1 - this.next;
    this.face = -1;
    this.updates++;
  }
  private apply(materials: readonly T.Material[]) {
    const texture = this.published;
    if (!texture) return;
    const keep = new Set<T.Material>();
    for (const m of materials) {
      if (!(m instanceof T.MeshStandardMaterial)) continue;
      keep.add(m);
      if (!this.owned.has(m)) {
        this.owned.set(m, { map: m.envMap, intensity: m.envMapIntensity });
        m.needsUpdate = true;
      }
      m.envMap = texture;
      // The cube already holds radiance (its dome at the specular gain).
      m.envMapIntensity = 1;
      setOwnEnvMap(m, true);
    }
    for (const [m, original] of this.owned)
      if (!keep.has(m)) {
        this.restore(m, original);
        this.owned.delete(m);
      }
  }
  private restore(
    m: T.MeshStandardMaterial,
    original: { map: T.Texture | null; intensity: number },
  ) {
    m.envMap = original.map;
    m.envMapIntensity = original.intensity;
    setOwnEnvMap(m, false);
    m.needsUpdate = true;
  }
  /** Return every material to the sky environment (tier change, exit). */
  release() {
    for (const [m, original] of this.owned) this.restore(m, original);
    this.owned.clear();
    this.published = null;
    this.face = -1;
    this.started = -Infinity;
  }
  dispose() {
    this.release();
    for (const t of this.targets) t.dispose();
  }
}
