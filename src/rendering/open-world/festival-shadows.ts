import * as T from 'three';
import { lightingDirection, shadowAnchor, type LightingMode } from '../daylight.ts';
import { FarShadow } from '../far-shadow.ts';
import type { GraphicsOptions, QualityPreset } from '../options.ts';
import { sunPenumbraScale } from '../studio/shadow-filter.ts';

/**
 * Festival sun shadow ranges. The festival drew one 140 m car-following map
 * (the far light was constructed but never baked), so every building, tree
 * and hill beyond ~70 m stood unshadowed and frames went flat (FH6 refs 013,
 * 026, 030, 039, 093: building, canopy and balcony shadows read to 150-400 m).
 *
 *  - near: the sun map, now led along the camera's view (more cover ahead
 *    than behind the car), texel-snapped in light space, PCSS for the 0.53 deg
 *    sun disc (studio/shadow-filter.ts) instead of a fixed one-texel disc;
 *  - mid (HIGH, ULTRA): the ULTRA pipeline's camera-led cascade
 *    (ultra/cascades.ts), enabled for the festival by `shadowCascades: 3`;
 *  - far: the shared far map (far-shadow.ts, directional shadow 1) re-fitted
 *    as a camera-led, texel-snapped box of several hundred metres and
 *    re-rendered after the camera has moved a tenth of it, on a lighting
 *    change and every few seconds while streaming adds casters. Distant tree
 *    crowns and photographic impostors cast into it only.
 *
 * The streamed terrain casts too (back faces only, so a sunlit slope never
 * shadows itself), giving ridges and valleys their relief shadow at the
 * golden hour.
 */
export const FESTIVAL_SHADOWS = Object.freeze({
  /** Near map half extent (m) per preset. */
  near: Object.freeze({ low: 70, medium: 52, high: 56, ultra: 64 }),
  /** Far map half extent (m) per preset (0: none). */
  far: Object.freeze({ low: 0, medium: 440, high: 620, ultra: 760 }),
  /** Far map texels per side per preset. */
  farSize: Object.freeze({ low: 1024, medium: 2048, high: 2048, ultra: 4096 }),
  /** Share of the half extent each box leads the camera's horizontal view. */
  nearLead: 0.4,
  farLead: 0.5,
  /** Light distance from the box centre and depth range (m). */
  nearLight: 600,
  nearDepth: 1300,
  farLight: 2600,
  farDepth: 5200,
  /** Near depth offset in texels (the normal offset stays the shared light
   * palette's 8 mm, 4 mm at the golden hour: lighting-coherence.ts). */
  nearBiasTexels: 0.5,
  /** Re-render the far map after the camera moved this share of its half extent. */
  farMove: 0.1,
  /** ...or after this many seconds once anything streamed in or moved. */
  farRefresh: 4,
});

/** The shared far map, fitted to a camera-led square instead of a whole
 * circuit's bounds: `bounds`' centre is the (snapped) box centre. */
export class FestivalFarShadow extends FarShadow {
  halfExtent: number = FESTIVAL_SHADOWS.far.medium;
  private readonly centre = new T.Vector3();
  private readonly direction = new T.Vector3();
  override fit(direction: T.Vector3, bounds: T.Box3) {
    if (bounds.isEmpty() || !(direction.lengthSq() > 0))
      throw new Error('Invalid far shadow region');
    const light = this.light,
      shadow = light.shadow,
      camera = shadow.camera,
      e = this.halfExtent;
    bounds.getCenter(this.centre);
    this.direction.copy(direction).normalize();
    light.target.position.copy(this.centre);
    light.position.copy(this.centre).addScaledVector(this.direction, FESTIVAL_SHADOWS.farLight);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    Object.assign(camera, {
      left: -e,
      right: e,
      top: e,
      bottom: -e,
      near: 1,
      far: FESTIVAL_SHADOWS.farDepth,
    });
    camera.updateProjectionMatrix();
    // About one texel of offsets keeps lit faces from self-shadowing.
    const texel = (2 * e) / shadow.mapSize.x;
    shadow.normalBias = texel;
    shadow.bias = -texel / (camera.far - camera.near);
    return texel;
  }
}

export interface FestivalShadowFrame {
  camera: T.Camera;
  lighting: LightingMode;
  /** Presented seconds (refresh cadence). */
  time: number;
  /** Ground height for the box centres. */
  height: (x: number, z: number) => number;
  /** Streamed terrain tiles (they cast too). */
  terrain: T.Object3D;
  /** Changes whenever streaming built or dropped scenery. */
  streamed: number;
  /** Roots left out of the far map (cars, riders, traffic, effects, markers). */
  hidden: readonly (T.Object3D | null | undefined)[];
  /** Roots whose non-casting instanced meshes cast into the far map only. */
  farCasters: readonly T.Object3D[];
  /** A season or scenery change that needs a fresh far map. */
  key: string;
}

/** Owns the near map's fit and the far map's placement and re-renders. */
export class FestivalShadows {
  readonly far = new FestivalFarShadow(FESTIVAL_SHADOWS.farSize.medium);
  enabled = false;
  nearHalfExtent: number = FESTIVAL_SHADOWS.near.medium;
  stats = { bakes: 0, lastBakeMs: 0, lastBakeDraws: 0, farHalfExtent: 0, farMetresPerTexel: 0 };
  private readonly forward = new T.Vector3();
  private readonly centre = new T.Vector3();
  private readonly anchor = new T.Vector3();
  private readonly size = new T.Vector3();
  private readonly direction = new T.Vector3();
  private readonly bakedCentre = new T.Vector3(NaN, NaN, NaN);
  private readonly lastCamera = new T.Vector3(NaN, NaN, NaN);
  private readonly bounds = new T.Box3();
  private readonly casters: T.Object3D[] = [];
  private bakedKey = '';
  private bakedAt = -Infinity;
  private bakedStreamed = NaN;
  private castStreamed = NaN;
  private terrainSide: T.Material | null = null;
  constructor(
    private readonly sun: T.DirectionalLight,
    private readonly renderer: T.WebGLRenderer,
  ) {
    this.far.light.name = 'Festival far sun shadow (no light of its own)';
  }
  /** Fit the maps to the preset (after the graphics options are applied). */
  configure(preset: QualityPreset, graphics: GraphicsOptions) {
    this.enabled = graphics.shadowSize > 0;
    const sun = this.sun,
      e = FESTIVAL_SHADOWS.near[preset];
    this.nearHalfExtent = e;
    Object.assign(sun.shadow.camera, {
      left: -e,
      right: e,
      top: e,
      bottom: -e,
      near: 1,
      far: FESTIVAL_SHADOWS.nearDepth,
    });
    sun.shadow.camera.updateProjectionMatrix();
    // PCSS for the sun's disc (the shader reads the scale from `radius`).
    sun.shadow.radius = sunPenumbraScale(sun.shadow.camera);
    const texel = (2 * e) / Math.max(1, graphics.shadowSize || sun.shadow.mapSize.x);
    sun.shadow.bias = (-FESTIVAL_SHADOWS.nearBiasTexels * texel) / FESTIVAL_SHADOWS.nearDepth;
    const farExtent = FESTIVAL_SHADOWS.far[preset];
    this.far.halfExtent = Math.max(1, farExtent);
    this.far.setEnabled(this.enabled && farExtent > 0, FESTIVAL_SHADOWS.farSize[preset]);
    this.stats.farHalfExtent = this.far.enabled ? farExtent : 0;
    this.stats.farMetresPerTexel = (2 * farExtent) / FESTIVAL_SHADOWS.farSize[preset];
    this.bakedKey = '';
    this.castStreamed = NaN;
  }
  /** Per frame, after the camera solve and before anything renders: place
   * the near map, and re-render the far map when it is due. */
  update(frame: FestivalShadowFrame, scene: T.Scene) {
    const camera = frame.camera,
      sun = this.sun;
    // Terrain casts (back faces: a lit slope never shades itself).
    for (const tile of frame.terrain.children) tile.castShadow = this.enabled;
    const terrainMaterial = (frame.terrain.children[0] as T.Mesh | undefined)?.material;
    if (terrainMaterial instanceof T.Material && terrainMaterial !== this.terrainSide) {
      terrainMaterial.shadowSide = T.BackSide;
      this.terrainSide = terrainMaterial;
    }
    // Photographic impostors (HIGH/ULTRA trees beyond the card distance)
    // cast light-facing into every map, so the mid cascade's 60-190 m keep
    // their tree shadows; re-checked whenever streaming changed the tiles.
    if (frame.streamed !== this.castStreamed) {
      this.castStreamed = frame.streamed;
      for (const root of frame.farCasters)
        root.traverse((object) => {
          if (object.userData.photoVegetation === 'impostor') object.castShadow = this.enabled;
        });
    }
    this.direction.copy(lightingDirection(frame.lighting)).normalize();
    camera.getWorldDirection(this.forward).setY(0);
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, 1);
    this.forward.normalize();
    // Near map: camera-led, snapped to its texel grid in light space.
    this.lead(camera, FESTIVAL_SHADOWS.nearLead * this.nearHalfExtent, frame.height);
    shadowAnchor(
      this.centre,
      sun.shadow.mapSize.x,
      this.nearHalfExtent,
      sun.target.position,
      frame.lighting,
    );
    sun.position
      .copy(sun.target.position)
      .addScaledVector(this.direction, FESTIVAL_SHADOWS.nearLight);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    if (!this.enabled || !this.far.enabled) return false;
    // Far map: camera-led, snapped, re-rendered when due.
    const e = this.far.halfExtent;
    this.lead(camera, FESTIVAL_SHADOWS.farLead * e, frame.height);
    const key = `${frame.lighting}|${this.direction.toArray().map((v) => v.toFixed(4))}|${frame.key}|${this.far.light.shadow.mapSize.x}|${e}`;
    const moved = this.centre.distanceTo(this.bakedCentre);
    const stirred =
      frame.streamed !== this.bakedStreamed || !(camera.position.distanceTo(this.lastCamera) < 2);
    const due =
      !this.far.baked ||
      key !== this.bakedKey ||
      !(moved < FESTIVAL_SHADOWS.farMove * e) ||
      (stirred && !(Math.abs(frame.time - this.bakedAt) < FESTIVAL_SHADOWS.farRefresh));
    if (!due) return false;
    shadowAnchor(this.centre, this.far.light.shadow.mapSize.x, e, this.anchor, frame.lighting);
    this.bounds.setFromCenterAndSize(this.anchor, this.size.set(2 * e, 200, 2 * e));
    this.casters.length = 0;
    for (const root of frame.farCasters)
      root.traverse((object) => {
        // Distant crowns and impostors; never the flat crown-contact discs.
        if (
          object instanceof T.InstancedMesh &&
          !object.castShadow &&
          object.visible &&
          object.userData.photoVegetation !== 'contact'
        )
          this.casters.push(object);
      });
    const calls = this.renderer.info.render.calls;
    const baked = this.far.bake(this.renderer, scene, {
      direction: this.direction,
      bounds: this.bounds,
      hidden: frame.hidden,
      farCasters: this.casters,
      sun,
    });
    this.casters.length = 0;
    if (!baked) return false;
    this.stats.bakes++;
    this.stats.lastBakeMs = this.far.lastBakeMs;
    this.stats.lastBakeDraws = this.renderer.info.render.calls - calls;
    // The un-snapped lead point is what `moved` is measured against.
    this.lead(camera, FESTIVAL_SHADOWS.farLead * e, frame.height);
    this.bakedCentre.copy(this.centre);
    this.lastCamera.copy(camera.position);
    this.bakedKey = key;
    this.bakedAt = frame.time;
    this.bakedStreamed = frame.streamed;
    return true;
  }
  /** `centre` = the ground point `distance` ahead of the camera. */
  private lead(camera: T.Camera, distance: number, height: (x: number, z: number) => number) {
    camera.getWorldPosition(this.centre).addScaledVector(this.forward, distance);
    const y = height(this.centre.x, this.centre.z);
    if (Number.isFinite(y)) this.centre.y = y;
  }
  diagnostics() {
    return {
      enabled: this.enabled,
      near: {
        halfExtent: this.nearHalfExtent,
        mapSize: this.sun.shadow.mapSize.x,
        metresPerTexel: (2 * this.nearHalfExtent) / this.sun.shadow.mapSize.x,
        pcss: this.sun.shadow.radius,
      },
      far: { ...this.far.diagnostics(), ...this.stats },
    };
  }
  dispose() {
    this.far.dispose();
  }
}
