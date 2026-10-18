import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { graphicsPreset, QUALITY_PRESETS } from '../src/rendering/options.ts';
import {
  FESTIVAL_PIPELINE,
  FESTIVAL_WET_SSR,
  festivalGraphics,
} from '../src/rendering/open-world/festival-quality.ts';
import {
  FESTIVAL_SHADOWS,
  FestivalFarShadow,
  FestivalShadows,
} from '../src/rendering/open-world/festival-shadows.ts';
import { FAR_SHADOW_MARK } from '../src/rendering/far-shadow.ts';
import {
  DEFAULT_FESTIVAL_PHOTO,
  FESTIVAL_PHOTO,
  FestivalPhotoLens,
  validateFestivalPhoto,
} from '../src/rendering/open-world/festival-photo-lens.ts';
import { thinLensScale } from '../src/rendering/ultra/replay-lens.ts';
import { GRADE_PROFILES } from '../src/rendering/broadcast-grade.ts';
import { lightingDirection } from '../src/rendering/daylight.ts';
import { FestivalFrameHistory } from '../src/rendering/open-world/festival-temporal.ts';
import { createStudioUniforms } from '../src/rendering/studio/studio-frame.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';

describe('festival image pipeline presets', () => {
  it('upgrades only the festival: temporal AA from MEDIUM, SSR and cascades on HIGH', () => {
    const before = QUALITY_PRESETS.map((p) => JSON.stringify(graphicsPreset(p)));
    const medium = festivalGraphics('medium', graphicsPreset('medium'));
    expect([medium.temporalAA, medium.taaSharpen, medium.ssr, medium.shadowCascades]).toEqual([
      true,
      0.3,
      false,
      2,
    ]);
    const high = festivalGraphics('high', graphicsPreset('high'));
    expect([
      high.temporalAA,
      high.ssr,
      high.shadowCascades,
      high.aoTemporal,
      high.lightShafts,
    ]).toEqual([true, true, 3, true, true]);
    // LOW and ULTRA keep their presets; the shared presets are untouched.
    expect(festivalGraphics('low', graphicsPreset('low'))).toEqual(graphicsPreset('low'));
    expect(festivalGraphics('ultra', graphicsPreset('ultra'))).toEqual(graphicsPreset('ultra'));
    expect(QUALITY_PRESETS.map((p) => JSON.stringify(graphicsPreset(p)))).toEqual(before);
    expect(FESTIVAL_WET_SSR.medium).toBe(true);
  });
  it("keeps a player's own override of a control", () => {
    const own = { ...graphicsPreset('high'), shadowCascades: 2 as const, taaSharpen: 0.8 };
    // shadowCascades 2 equals HIGH's preset value, so the festival may raise
    // it; a sharpening the player chose differs from the preset and stays.
    const out = festivalGraphics('high', own);
    expect(out.taaSharpen).toBe(0.8);
    expect(out.temporalAA).toBe(true);
    const noTaa = festivalGraphics('medium', { ...graphicsPreset('medium'), msaa: 4 });
    expect(noTaa.msaa).toBe(4);
    for (const preset of QUALITY_PRESETS)
      for (const key of Object.keys(FESTIVAL_PIPELINE[preset]))
        expect(key in graphicsPreset(preset)).toBe(true);
  });
});

function fakeRenderer() {
  const target = new T.WebGLRenderTarget(2, 2);
  const renderer = {
    shadowMap: { autoUpdate: false, enabled: true },
    info: { render: { calls: 0 } },
    target: target as T.WebGLRenderTarget | null,
    getRenderTarget() {
      return this.target;
    },
    setRenderTarget(next: T.WebGLRenderTarget | null) {
      this.target = next;
    },
    render: vi.fn(() => {
      renderer.info.render.calls += 7;
    }),
  };
  return renderer;
}

describe('festival sun shadow ranges', () => {
  const sun = new T.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  it('fits a camera-led near map with PCSS and a far map per preset', () => {
    const shadows = new FestivalShadows(sun, fakeRenderer() as unknown as T.WebGLRenderer);
    shadows.configure('medium', graphicsPreset('medium'));
    const c = sun.shadow.camera;
    expect([c.left, c.right, c.top, c.bottom]).toEqual([-52, 52, 52, -52]);
    expect(sun.shadow.radius).toBeGreaterThan(0);
    expect(sun.shadow.radius).toBeLessThan(1);
    expect(shadows.far.enabled).toBe(true);
    expect(shadows.far.light.shadow.mapSize.x).toBe(FESTIVAL_SHADOWS.farSize.medium);
    // Far texels: ~0.43 m on MEDIUM, a map several hundred metres wide.
    expect(shadows.stats.farMetresPerTexel).toBeCloseTo(880 / 2048, 5);
    shadows.configure('ultra', graphicsPreset('ultra'));
    expect(shadows.far.light.shadow.mapSize.x).toBe(4096);
    shadows.configure('low', graphicsPreset('low'));
    expect(shadows.enabled).toBe(false);
    expect(shadows.far.enabled).toBe(false);
  });
  it('fits the far map to a square around the box centre along the sun', () => {
    const far = new FestivalFarShadow(2048);
    far.halfExtent = 400;
    const dir = new T.Vector3(1, 2, 0.5);
    const texel = far.fit(
      dir,
      new T.Box3().setFromCenterAndSize(new T.Vector3(100, 5, -40), new T.Vector3(1, 1, 1)),
    );
    const c = far.light.shadow.camera;
    expect([c.left, c.right, c.top, c.bottom]).toEqual([-400, 400, 400, -400]);
    expect(texel).toBeCloseTo(800 / 2048, 6);
    expect(far.light.target.position.toArray()).toEqual([100, 5, -40]);
    const offset = far.light.position.clone().sub(far.light.target.position);
    expect(offset.length()).toBeCloseTo(FESTIVAL_SHADOWS.farLight, 3);
    expect(offset.normalize().dot(dir.clone().normalize())).toBeCloseTo(1, 6);
    expect(far.light.shadow.normalBias).toBeCloseTo(texel, 6);
  });
  it('leads the camera, casts the terrain and re-renders the far map only when due', () => {
    const renderer = fakeRenderer();
    const shadows = new FestivalShadows(sun, renderer as unknown as T.WebGLRenderer);
    shadows.configure('medium', graphicsPreset('medium'));
    const scene = new T.Scene();
    scene.add(sun, sun.target, shadows.far.light, shadows.far.light.target);
    const camera = new T.PerspectiveCamera(57, 16 / 9, 0.3, 1000);
    camera.position.set(0, 2, 0);
    camera.lookAt(0, 2, 100);
    camera.updateMatrixWorld();
    const terrainMaterial = new T.MeshStandardMaterial();
    const terrain = new T.Group();
    terrain.add(new T.Mesh(new T.BufferGeometry(), terrainMaterial));
    const car = new T.Group(),
      crowns = new T.InstancedMesh(new T.BufferGeometry(), new T.MeshStandardMaterial(), 1);
    crowns.castShadow = false;
    const instanced = () =>
      new T.InstancedMesh(new T.BufferGeometry(), new T.MeshStandardMaterial(), 1);
    const contact = instanced(),
      impostor = instanced();
    contact.userData.photoVegetation = 'contact';
    impostor.userData.photoVegetation = 'impostor';
    const vegetation = new T.Group();
    vegetation.add(crowns, contact, impostor);
    scene.add(terrain, car, vegetation);
    let castDuringBake: boolean[] = [];
    renderer.render.mockImplementation(() => {
      castDuringBake.push(crowns.castShadow, car.visible, contact.castShadow);
      renderer.info.render.calls += 7;
    });
    const frame = {
      camera,
      lighting: 'day' as const,
      time: 0,
      height: () => 0,
      terrain,
      streamed: 1,
      hidden: [car],
      farCasters: [vegetation],
      key: 'summer|medium',
    };
    expect(shadows.update(frame, scene)).toBe(true);
    expect(castDuringBake).toEqual([true, false, false]);
    expect([crowns.castShadow, car.visible]).toEqual([false, true]);
    // Impostors cast into every map (the mid cascade's trees), contact discs never.
    expect([impostor.castShadow, contact.castShadow]).toEqual([true, false]);
    expect(shadows.far.light.shadow.intensity).toBe(FAR_SHADOW_MARK);
    expect(shadows.stats.lastBakeDraws).toBe(7);
    expect(terrain.children[0].castShadow).toBe(true);
    expect(terrainMaterial.shadowSide).toBe(T.BackSide);
    // Near box centre ~0.4 R ahead of the camera along the view.
    const ahead = sun.target.position.z - camera.position.z;
    const texel = (2 * 52) / 2048;
    expect(Math.abs(ahead - 0.4 * 52)).toBeLessThan(2 * texel + 1e-6);
    const sunDir = sun.position.clone().sub(sun.target.position).normalize();
    expect(sunDir.dot(lightingDirection('day').clone().normalize())).toBeCloseTo(1, 6);
    // Small moves keep the far map; a tenth of its half extent re-renders it.
    castDuringBake = [];
    camera.position.z += 10;
    camera.updateMatrixWorld();
    expect(shadows.update({ ...frame, time: 1 }, scene)).toBe(false);
    camera.position.z += 40;
    camera.updateMatrixWorld();
    expect(shadows.update({ ...frame, time: 2 }, scene)).toBe(true);
    // A season or lighting change re-renders at once.
    expect(shadows.update({ ...frame, time: 2.1, key: 'winter|medium' }, scene)).toBe(true);
    expect(shadows.update({ ...frame, time: 2.2, key: 'winter|medium' }, scene)).toBe(false);
    // Streaming refreshes it after the refresh period.
    expect(shadows.update({ ...frame, time: 3, streamed: 2, key: 'winter|medium' }, scene)).toBe(
      false,
    );
    expect(
      shadows.update(
        {
          ...frame,
          time: 2.1 + FESTIVAL_SHADOWS.farRefresh + 0.1,
          streamed: 2,
          key: 'winter|medium',
        },
        scene,
      ),
    ).toBe(true);
    expect(shadows.stats.bakes).toBe(4);
  });
});

describe('festival photo lens', () => {
  const camera = new T.PerspectiveCamera(45, 16 / 9, 0.3, 1000);
  const depth = new T.DepthTexture(1, 1);
  it('is off until an aperture is chosen, then focuses a thin lens on the car', () => {
    const lens = new FestivalPhotoLens(camera, depth);
    camera.position.set(0, 1.5, -6);
    camera.lookAt(0, 0.6, 0);
    camera.updateMatrixWorld();
    const car = new T.Vector3(0, 0.6, 0);
    expect(lens.update(true, car)).toBe(false);
    expect(lens.pass.enabled).toBe(false);
    lens.set({ fStop: 2, focalLength: 85 });
    camera.fov = lens.fov!;
    camera.updateProjectionMatrix();
    expect(lens.update(false, car)).toBe(false);
    expect(lens.update(true, car)).toBe(true);
    const u = lens.pass.materialBokeh.uniforms;
    const focus = car.clone().sub(camera.position).length();
    expect(u.focus.value).toBeCloseTo(focus, 4);
    expect(u.lensK.value).toBeCloseTo(thinLensScale(camera.fov, focus, 2, 0.024), 8);
    // 85 mm f/2 at ~6 m: background ~2.4 % of the screen height (capped at 2.2 %).
    expect(u.lensK.value).toBeGreaterThan(0.02);
    expect(u.maxblur.value).toBe(FESTIVAL_PHOTO.maxBlur);
    lens.set({ focus: 30 });
    lens.update(true, car);
    expect(u.focus.value).toBe(30);
  });
  it('validates settings and leaves the grade alone without a look', () => {
    expect(validateFestivalPhoto({ fStop: 3, exposure: 9, filter: 'sepia', vignette: -1 })).toEqual(
      {
        ...DEFAULT_FESTIVAL_PHOTO,
        exposure: 2,
        vignette: 0,
      },
    );
    const lens = new FestivalPhotoLens(camera, depth);
    expect(lens.look('day', false, null)).toBeNull();
    lens.set({ filter: 'mono' });
    const look = lens.look('day', false, null)!;
    expect(look.saturation).toBe(0);
    expect(look.contrast).toBeGreaterThan(GRADE_PROFILES.day.contrast);
  });
});

describe('festival frame history', () => {
  it('advances the temporal passes on festival frames and restores the circuit state', () => {
    const uniforms = createStudioUniforms();
    const circuitView = new T.Matrix4().makeTranslation(1, 2, 3);
    uniforms.studioViewProj.value.copy(circuitView);
    uniforms.studioPrevViewProj.value.copy(circuitView);
    uniforms.studioFrameDt.value = 0.25;
    const history = new FestivalFrameHistory(uniforms);
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    frame[H.CARS] = 1;
    frame[carBase(0) + F.QW] = 1;
    const camera = new T.PerspectiveCamera(57, 16 / 9, 0.3, 1000);
    camera.position.set(0, 2, -5);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld();
    const sun = new T.DirectionalLight();
    sun.position.set(1, 2, 1);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    frame[H.TIME] = 10;
    history.update(frame, camera, sun, 'chase');
    expect(history.frameDt).toBe(0);
    frame[H.TIME] = 10 + 1 / 60;
    camera.position.x += 0.5;
    camera.updateMatrixWorld();
    history.update(frame, camera, sun, 'chase');
    expect(history.frameDt).toBeCloseTo(1 / 60, 6);
    expect(uniforms.studioPrevViewProj.value.equals(uniforms.studioViewProj.value)).toBe(false);
    // A held (photo) frame does not advance.
    history.update(frame, camera, sun, 'photo');
    expect(history.frameDt).toBe(0);
    const view = uniforms.studioViewProj.value;
    history.restore();
    expect(uniforms.studioViewProj.value).toBe(view);
    expect(uniforms.studioViewProj.value.equals(circuitView)).toBe(true);
    expect(uniforms.studioFrameDt.value).toBe(0.25);
    expect(uniforms.studioCarCount.value).toBe(0);
  });
});
