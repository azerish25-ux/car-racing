import { SecondaryGrandstands } from './secondary-grandstands.ts';
import type { AurelQuarryKit } from './aurel-quarry.ts';
import type { AurelVegetationKit } from './aurel-vegetation.ts';
import type { TrackSignalHardwareKit } from './track-signal-hardware.ts';
import type { TrackBoardsKit } from './track-boards.ts';
import type { BroadcastCamerasKit } from './broadcast-cameras.ts';
import { infrastructureIdentity } from './track-infrastructure-diagnostics.ts';
import type { ConcreteBarrierKit } from './concrete-barriers.ts';
import { guardrailRole, type SteelGuardrailKit } from './steel-guardrails.ts';
import type { CatchFenceKit } from './catch-fence.ts';
import { impactBarrierRole, type ImpactBarriersKit } from './impact-barriers.ts';
import type { RecoveryGatesKit } from './recovery-gates.ts';
import type { MarshalPostsKit } from './marshal-posts.ts';
import type { StartGantryKit } from './start-gantry.ts';
import { StartFinishVenue } from './start-finish-venue.ts';
import { type PitBuildingFrontage } from './pit-building-frontage.ts';
import { PitWallStation, pitWallPlacement } from './pit-wall-station.ts';
import { HERO_GARAGE, type HeroGarage } from './hero-garage.ts';
import type { TyreBlanketSet } from './tyre-blankets.ts';
import { StaticTransformGroup } from './static-transform-group.ts';
import { VENUE_LAMP_RADIUS } from './light-footprint.ts';
import { buildGantrySolids, buildControlTowerSolids } from './race-structures.ts';
import { MarshalStaffView } from './marshal-staff.ts';
import { districtPlan, buildDistricts } from './venue-districts.ts';
import { BroadcastSightlines } from './broadcast-sightlines.ts';
import { serviceSitePlan } from './venue-service-plan.ts';
import { buildServiceAreas } from './venue-service.ts';
import type { CrowdCluster } from './crowd.ts';
import { apronWithSkirt } from './studio/apron-skirt.ts';
import { splitTerrainGrid } from './studio/terrain-tiles.ts';
import { installTerrainFinish, terrainTrackDistance } from './studio/terrain-finish.ts';
import { barrierMaterials, buildBarrierChunk } from './circuit-barriers.ts';
import { installCircuitFinish } from './circuit-finish.ts';
import { standMaterials, buildGrandstand } from './grandstand.ts';
import { kerbStyleAt, runoffStyleAt, venuePlan } from './venue-plan.ts';
import { terrainFor } from './terrain.ts';
import { buildSea, installShoreline, shoreWeight } from './sea.ts';
import { WetRoadReflection, reflectInWetRoad } from './wet-reflection.ts';
import { buildGarageBay, paddockMaterials } from './paddock-detail.ts';
import { buildVegetation } from './landscape.ts';
import { buildTyreMarks } from './tyre-marks.ts';
import {
  buildTrackInfrastructure,
  trackInfrastructurePlan as makeTrackInfrastructurePlan,
  updateSafetyPanel,
  type TrackInfrastructurePlan,
} from './track-infrastructure.ts';
import { surfaceMaterial } from './surface-detail.ts';
import { installGravelFinish } from './studio/grass-gravel-finish.ts';
import * as T from 'three';
import { BuildQueue } from './build-queue.ts';
import { sphereDetail, stripDetail, trunkDetail, type ProbeDetail } from './probe-detail.ts';
import { installWetRoad } from './materials.ts';
import { START_GRID, apexLineAt, installRoadDetail } from './studio/road-detail.ts';
import { installWetDetail } from './studio/wet-detail.ts';
import { kerbHeight } from '../simulation/contact.ts';
import { Track, CELL_ROWS, CELL_COLS, trackPoint } from '../simulation/track.ts';
import { H } from '../simulation/protocol.ts';
import { allFinite, clamp } from '../core/math.ts';
import { buildTracksideBranding, type BrandingBuild } from './studio/trackside-branding.ts';
import { installKerbFinish, installRunoffFinish, kerbUsage } from './studio/kerb-runoff-finish.ts';
import { installCarGrounding } from './studio/car-grounding.ts';
import { installLightPools } from './studio/light-pools.ts';
import { buildForestBelts } from './studio/forest-belts.ts';
import { venueKitFor, type VenueKit } from './venue-kit/index.ts';
import { batchScene, box, canvasTexture, label, mesh, unprintedBack } from './geometry.ts';
import { offroadSceneFor, type OffroadScene } from './offroad/index.ts';
/** Lit start lamp emission (D28: bright enough to bloom at night and in daylight). */
export const START_LAMP_EMISSIVE = 25;
interface RibbonOptions {
  start?: number;
  end?: number;
  step?: number;
  offset: (s: number, t: number) => number;
  height?: (s: number, l: number, t: number) => number;
  stripes?: boolean;
  /** Run-off ribbon: per-vertex `runoffStyle` (D15). */
  runoff?: boolean;
  columns?: number;
  road?: boolean;
  include?: (s: number, lateral: number) => boolean;
}
/** All surfaces are constructed from the same metre-valued track queries as physics. */
export class CircuitScene {
  quarry: AurelQuarryKit | null = null;
  vegetation: AurelVegetationKit | null = null;
  concreteBarriers: ConcreteBarrierKit | null = null;
  steelGuardrails: SteelGuardrailKit | null = null;
  catchFence: CatchFenceKit | null = null;
  impactBarriers: ImpactBarriersKit | null = null;
  recoveryGates: RecoveryGatesKit | null = null;
  /** Trackside sponsor vinyl and bridges (D13), once built. */
  branding: BrandingBuild | null = null;
  marshalPosts: MarshalPostsKit | null = null;
  startGantry: StartGantryKit | null = null;
  signalHardware: TrackSignalHardwareKit | null = null;
  trackBoards: TrackBoardsKit | null = null;
  broadcastCameras: BroadcastCamerasKit | null = null;
  heroGarage: HeroGarage | null = null;
  tyreBlankets: TyreBlanketSet | null = null;
  pitBuildingFrontage: PitBuildingFrontage | null = null;
  pitWallStation: PitWallStation | null = null;
  readonly group = new T.Group();
  readonly crowd = new T.Group();
  readonly startFinish: StartFinishVenue;
  readonly secondaryStands: SecondaryGrandstands;
  readonly crowdClusters: CrowdCluster[] = [];
  readonly staff: MarshalStaffView;
  readonly props = new StaticTransformGroup();
  readonly surfaces = new StaticTransformGroup();
  readonly sightlines = new BroadcastSightlines();
  readonly vegetationGroup = new StaticTransformGroup();
  /** Static scenery the local reflection probe may omit when, seen from the
   * probe, it cannot cover one cube-face texel (see probe-detail.ts). */
  readonly probeDetail: ProbeDetail[] = [];
  /** Widest ribbon recorded as a strip (painted lines and kerbs). */
  static readonly STRIP_WIDTH = 1.5;
  readonly stateTexture: T.DataTexture;
  /** Planar reflection sampled by the wet road and pit lane film. */
  readonly wetReflection = new WetRoadReflection();
  readonly roadMaterial: T.MeshStandardMaterial;
  readonly stateBytes = new Uint8Array(CELL_ROWS * CELL_COLS * 4);
  readonly startLamps: T.MeshStandardMaterial[] = [];
  readonly trackInfrastructure: TrackInfrastructurePlan;
  readonly serviceSites: ReturnType<typeof serviceSitePlan>;
  readonly districts: ReturnType<typeof districtPlan>;
  /** Procedural dressing for catalogue venues (WP30); null for Aurel/Vellamar. */
  readonly venueKit: VenueKit | null;
  /** Terrain venues (WP41): deformable soil, start gate, stadium, roost. */
  readonly offroad: OffroadScene | null;
  readonly safetyPanel = new T.MeshStandardMaterial({
    color: 0x2a5636,
    emissive: 0x2a5636,
    emissiveIntensity: 0.18,
    roughness: 0.38,
    metalness: 0.12,
  });
  private temp = trackPoint();
  readonly construction = new BuildQueue();
  constructor(
    readonly track: Track,
    deferred = false,
  ) {
    this.group.name = 'Aurel circuit';
    this.trackInfrastructure = makeTrackInfrastructurePlan(track);
    this.startFinish = new StartFinishVenue(track);
    this.secondaryStands = new SecondaryGrandstands(track);
    this.staff = new MarshalStaffView(this.trackInfrastructure.marshalPosts);
    this.serviceSites = serviceSitePlan(track);
    this.districts = districtPlan(track, this.serviceSites);
    this.venueKit = venueKitFor(track);
    this.group.add(this.props, this.crowd, this.vegetationGroup, this.surfaces);
    if (this.venueKit) this.group.add(this.venueKit.root);
    // A terrain venue's course is soil, not a paved ribbon with kerbs.
    this.offroad = offroadSceneFor(track, this.construction);
    const paved = !this.offroad;
    if (this.offroad) this.group.add(this.offroad.group);
    this.surfaces.name = 'Immutable circuit surfaces and barriers';
    this.vegetationGroup.name = 'Planting, groves and treelines';
    this.crowd.name = 'Spectators and marshal staff';
    this.props.name = 'Venue props and structures';
    // Dynamic trackside staff geometry exists immediately, but it must enter the
    // scene through the same cooperative construction queue as every other
    // circuit mesh. This keeps a deferred CircuitScene genuinely empty until
    // construction starts while preserving identical final synchronous output.
    this.construction.add('Trackside marshal staff', 1, () => this.crowd.add(this.staff.root));
    this.stateTexture = new T.DataTexture(this.stateBytes, CELL_COLS, CELL_ROWS, T.RGBAFormat);
    this.stateTexture.magFilter = T.LinearFilter;
    this.stateTexture.minFilter = T.LinearFilter;
    this.updateSurface(track.water, track.rubber, track.marbles);
    this.roadMaterial = surfaceMaterial('asphalt', undefined, true);
    installWetRoad(
      this.roadMaterial,
      this.stateTexture,
      true,
      VENUE_LAMP_RADIUS,
      this.wetReflection.uniforms,
    );
    // Rubbered racing line, edge dust, small repairs and crack sealant.
    installRoadDetail(this.roadMaterial, track.length);
    // Sub-cell puddles and an emerging dry line (D22).
    installWetDetail(this.roadMaterial);
    const grass = surfaceMaterial('grass');
    const runOff = surfaceMaterial('asphalt', 'paint');
    // D15: painted bands, chevrons or astroturf per corner (no flat tint).
    installRunoffFinish(runOff);
    const gravel = surfaceMaterial('gravel');
    // D19: Voronoi pebbles, cavities and raked furrows (#8f8470).
    installGravelFinish(gravel);
    // Sky and sun light under the cars (D08): the ground they stand on.
    for (const m of [this.roadMaterial, grass, runOff, gravel]) installCarGrounding(m);
    // D28: night floodlight pools on every track ribbon (lap-space lamp rows).
    for (const m of [this.roadMaterial, grass, runOff, gravel]) installLightPools(m);
    // The grass apron plus D17's skirt onto the terrain, both sides, as one
    // ribbon (D32: the skirt shares the apron's chunks, 0 extra draws).
    const ground = terrainFor(track);
    // Catalogue venues: the kit lays verges, run-off and skirts from data.
    if (!this.venueKit)
      this.queueRibbon(
        grass,
        apronWithSkirt(
          track,
          (x, z) => ground.height(x, z),
          (s) => track.at(s, this.temp).width,
        ),
      );
    if (!this.venueKit)
      this.queueRibbon(gravel, {
        offset: (s, t) => {
          track.at(s, this.temp);
          return (t * 2 - 1) * (this.temp.width + 10);
        },
        height: () => -0.027,
        columns: 12,
        include: (s, lateral) => {
          track.at(s, this.temp);
          return Math.abs(lateral) > this.temp.width + 4 && this.temp.curvature * lateral < -0.009;
        },
      });
    if (paved)
      this.queueRibbon(runOff, {
        offset: (s, t) => {
          track.at(s, this.temp);
          return (t * 2 - 1) * (this.temp.width + 4);
        },
        height: () => -0.008,
        columns: 4,
        runoff: true,
      });
    if (paved)
      this.queueRibbon(this.roadMaterial, {
        offset: (s, t) => {
          track.at(s, this.temp);
          return (t * 2 - 1) * this.temp.width;
        },
        columns: 14,
        road: true,
        step: 1.8,
      });
    // Line paint is an off-white with a little sheen, never pure white.
    const white = new T.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.55 });
    installCircuitFinish(white, 'paint');
    const kerb = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    installCircuitFinish(kerb, 'kerb');
    installKerbFinish(kerb);
    for (const m of [white, kerb]) {
      installCarGrounding(m);
      installLightPools(m);
    }
    for (const side of paved ? [-1, 1] : []) {
      this.queueRibbon(kerb, {
        offset: (s, t) => {
          track.at(s, this.temp);
          return side * (this.temp.width + t * 1.1);
        },
        height: (s, l, t) => {
          const pit = track.pitOffset(s);
          return track.isPitSection(s) && pit > 3 && Math.abs(l - pit) < 3.6
            ? 0
            : kerbHeight(s, t * 1.1);
        },
        step: 0.16,
        stripes: true,
        columns: 6,
      });
      this.queueRibbon(white, {
        offset: (s, t) => {
          track.at(s, this.temp);
          return side * (this.temp.width - 0.17 + t * 0.14);
        },
        height: () => 0.006,
        step: 2,
      });
    }
    // Smooth pit road ribbon and its marking; no decorative inaccessible lane.
    const pitMat = surfaceMaterial('asphalt', undefined, true);
    installWetRoad(
      pitMat,
      this.stateTexture,
      false,
      VENUE_LAMP_RADIUS,
      this.wetReflection.uniforms,
    );
    installCarGrounding(pitMat);
    for (const [start, end] of [
      [track.length - track.pit.divergeStart, track.length],
      [0, track.pit.mergeEnd],
    ]) {
      this.queueRibbon(pitMat, {
        start,
        end,
        offset: (s, t) => track.pitOffset(s) + (t * 2 - 1) * 3.6,
        height: () => 0.003,
        columns: 4,
        step: 1,
      });
      for (const side of [-1, 1])
        this.queueRibbon(white, {
          start,
          end,
          offset: (s, t) => track.pitOffset(s) + side * (3.35 + t * 0.12),
          height: () => 0.008,
          step: 1,
        });
    }
    // Surface colour below the horizon: track ribbons cover the actual collision elevation.
    this.construction.add('Distant terrain', 3, () => {
      const model = terrainFor(track);
      // 34 m cells resolve the ridged range's crests at horizon distance; the
      // coastal venue's embankments and cuttings need 21 m cells near the road.
      // Aurel 160 -> 320 segments (17 m cells): the canopy carpet's ridgelines (D17).
      const segments = model.kind === 'coast' ? 256 : 320;
      const terrain = new T.PlaneGeometry(5500, 5500, segments, segments);
      terrain.rotateX(-Math.PI / 2);
      const pos = terrain.getAttribute('position'),
        terrainUV = terrain.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i),
          z = pos.getZ(i);
        pos.setY(i, model.height(x, z));
        // Match the apron's metre-scaled original grass and world-space finish,
        // instead of a flat beige horizon with a hard material boundary.
        terrainUV.setXY(i, x / 5, z / 5);
      }
      terrain.computeVertexNormals();
      // Same original grass texels, plus slope/elevation landform shading.
      const land = surfaceMaterial('grass', 'terrain');
      // D17: forest carpet, strata rock and dry meadows by distance to the circuit.
      terrainTrackDistance(track, terrain);
      installTerrainFinish(land);
      if (model.seaLevel !== null && model.coastZ) {
        const shore = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++)
          shore[i] = shoreWeight(pos.getZ(i), model.coastZ(pos.getX(i)));
        terrain.setAttribute('shore', new T.BufferAttribute(shore, 1));
        installShoreline(land, model.seaLevel);
      }
      // D32: culled per tile (same vertices), not one always-visible plane.
      for (const tile of splitTerrainGrid(terrain, segments))
        reflectInWetRoad(mesh(this.surfaces, tile, land));
      terrain.dispose();
      if (model.seaLevel !== null) {
        const sea = buildSea(model.seaLevel);
        reflectInWetRoad(sea);
        this.surfaces.add(sea);
      }
    });
    const barriers = barrierMaterials();
    const spans = this.venueKit ? 0 : Math.ceil(track.length / 80);
    this.venueKit?.enqueue(this);
    for (let i = 0; i < spans; i++)
      this.construction.add('Profiled barriers and filtered catch fencing', 2, () => {
        const before = this.surfaces.children.length;
        buildBarrierChunk(
          track,
          this.surfaces,
          (track.length * i) / spans,
          (track.length * (i + 1)) / spans,
          barriers,
          this.concreteBarriers,
          this.steelGuardrails,
          this.catchFence,
          this.impactBarriers,
          this.recoveryGates,
        );
        // Barriers line the water's edge: they belong in the wet reflection.
        for (const child of this.surfaces.children.slice(before)) reflectInWetRoad(child);
      });
    // Fictional sponsor vinyl on every concrete run, and banner bridges (D13).
    this.construction.add('Trackside sponsor branding', 3, () => {
      if (this.venueKit) return;
      this.branding = buildTracksideBranding(
        track,
        this.surfaces,
        (s, side) =>
          !!(
            (this.steelGuardrails && guardrailRole(s, side)) ||
            (this.impactBarriers && impactBarrierRole(s, side)) ||
            this.recoveryGates?.role(s, side)
          ),
      );
    });
    this.infrastructure();
    this.construction.add('Drainage, marshal and replay-camera infrastructure', 3, () =>
      buildTrackInfrastructure(
        track,
        this.props,
        this.safetyPanel,
        this.trackInfrastructure,
        this.marshalPosts,
        this.signalHardware,
        this.broadcastCameras,
      ),
    );
    this.construction.add('Authored service areas', 2, () => {
      buildServiceAreas(this.props, this.serviceSites, this.sightlines, !!this.recoveryGates);
      // A05 was attached by boundary construction. Use the SAME owner for
      // its closed service gates and approach roads; never reparent the kit.
      this.recoveryGates?.buildAccessGates(track, this.surfaces);
    });
    this.construction.add('Four authored Aurel districts', 3, () =>
      buildDistricts(this.props, this.districts, this.sightlines, (x, z) =>
        terrainFor(track).height(x, z),
      ),
    );
    this.construction.add('Laid tyre rubber', 1, () =>
      buildTyreMarks(track, this.surfaces, undefined, this.stateTexture),
    );
    this.construction.add('Rule-placed layered foliage', 3, () => {
      const excluded = (x: number, z: number, padding: number) =>
        (this.recoveryGates?.blocksVegetation(x, z, padding) ?? false) ||
        (this.quarry?.blocksPlanting(track, x, z, padding) ?? false) ||
        (this.venueKit?.blocks(x, z, padding) ?? false);
      const style = this.venueKit?.context.style;
      if (style && !style.planting) return;
      if (this.vegetation)
        this.vegetation.build(track, this.vegetationGroup, this.serviceSites, excluded);
      else buildVegetation(track, this.vegetationGroup, this.serviceSites, excluded);
      // Continuous woodland 30-120 m behind the boundary (D11).
      if (!style || style.forestBelts)
        buildForestBelts(track, this.vegetationGroup, this.serviceSites, excluded);
    });
    this.construction.add('Grid and finish markings', 0, () => this.grid());
    this.construction.add('Spatial geometry batches', 4, () =>
      batchScene(
        this.props,
        new Set(
          [
            this.marshalPosts?.root,
            this.startGantry?.root,
            this.signalHardware?.root,
            ...(this.signalHardware?.displays.meshes ?? []),
            this.trackBoards?.root,
            this.broadcastCameras?.root,
            this.quarry?.root,
            this.heroGarage?.root,
            this.tyreBlankets?.root,
            this.pitWallStation?.root,
            this.pitBuildingFrontage?.root,
            ...this.startFinish.roots,
            ...this.secondaryStands.roots,
          ].filter((o) => o !== undefined),
        ),
      ),
    );
    this.construction.add('Seal static venue transforms', 6, () => {
      // Layers are not inherited. Tag all append-only boundary batches after
      // construction, before any colour, mirror or shadow survey uses them.
      for (const kit of [
        this.concreteBarriers,
        this.steelGuardrails,
        this.catchFence,
        this.impactBarriers,
        this.recoveryGates,
      ])
        if (kit) reflectInWetRoad(kit.root);
      if (this.concreteBarriers) barriers.concrete.dispose();
      if (this.catchFence) barriers.steel.dispose();
      this.props.sealTransforms();
      this.surfaces.sealTransforms();
      this.vegetationGroup.sealTransforms();
    });
    this.construction.add('Probe detail survey', 7, () => this.surveyProbeDetail());
    if (!deferred) this.construction.runSynchronously();
  }
  /** Read-only identity of constructed groups, not planned sites or an art approval.
   * Groups survive static batching; no mesh traversal or GPU readback is needed. */
  infrastructureDiagnostics() {
    return {
      concreteBarriers: this.concreteBarriers?.diagnostics() ?? null,
      steelGuardrails: this.steelGuardrails?.diagnostics() ?? null,
      catchFence: this.catchFence?.diagnostics() ?? null,
      impactBarriers: this.impactBarriers?.diagnostics() ?? null,
      recoveryGates: this.recoveryGates?.diagnostics() ?? null,
      marshalPosts: this.marshalPosts?.diagnostics() ?? null,
      startGantry: this.startGantry?.diagnostics() ?? null,
      signalHardware: this.signalHardware?.diagnostics() ?? null,
      trackBoards: this.trackBoards?.diagnostics() ?? null,
      broadcastCameras: this.broadcastCameras?.diagnostics() ?? null,
    };
  }
  environmentDiagnostics() {
    const districts = this.props.children
      .filter((group) => group.userData.architecture !== undefined)
      .map((group) => ({
        name: group.name,
        kind: String(group.userData.architecture.kind),
        revision: String(group.userData.architecture.revision),
        position: group.position.toArray(),
        finalArtApproved: false,
      }));
    return {
      source: 'constructed-runtime-groups',
      quarry: this.quarry?.diagnostics() ?? null,
      startFinish: this.startFinish.diagnostics(),
      secondaryStands: this.secondaryStands.diagnostics(),
      concreteBarriers: infrastructureIdentity(this.concreteBarriers?.diagnostics() ?? null),
      steelGuardrails: infrastructureIdentity(this.steelGuardrails?.diagnostics() ?? null),
      catchFence: infrastructureIdentity(this.catchFence?.diagnostics() ?? null),
      impactBarriers: infrastructureIdentity(this.impactBarriers?.diagnostics() ?? null),
      recoveryGates: infrastructureIdentity(this.recoveryGates?.diagnostics() ?? null),
      marshalPosts: infrastructureIdentity(this.marshalPosts?.diagnostics() ?? null),
      startGantry: infrastructureIdentity(this.startGantry?.diagnostics() ?? null),
      signalHardware: infrastructureIdentity(this.signalHardware?.diagnostics() ?? null),
      trackBoards: infrastructureIdentity(this.trackBoards?.diagnostics() ?? null),
      broadcastCameras: infrastructureIdentity(this.broadcastCameras?.diagnostics() ?? null),

      districts,
      garage: this.heroGarage?.diagnostics() ?? null,
      tyreBlankets: this.tyreBlankets?.diagnostics() ?? null,
      pitWall: this.pitWallStation?.diagnostics() ?? null,
      frontage: this.pitBuildingFrontage?.diagnostics() ?? null,
      finalArtApproved: false,
    };
  }
  private queueRibbon(material: T.Material, options: RibbonOptions) {
    const start = options.start ?? 0;
    const end = options.end ?? this.track.length;
    const count = Math.ceil((end - start) / 80);
    const priority = options.road || options.stripes || options.start !== undefined ? 0 : 2;
    for (let i = 0; i < count; i++) {
      const part = {
        ...options,
        start: start + ((end - start) * i) / count,
        end: start + ((end - start) * (i + 1)) / count,
      };
      this.construction.add(
        options.road
          ? 'Circuit asphalt'
          : options.stripes
            ? 'Physical kerb geometry'
            : 'Track surface',
        priority,
        () => this.ribbon(material, part),
      );
    }
  }
  ribbon(material: T.Material, options: RibbonOptions): T.Mesh {
    const begin = options.start ?? 0,
      finish = options.end ?? this.track.length;
    if (finish - begin > 80) {
      let first: T.Mesh | undefined;
      const pieces = Math.ceil((finish - begin) / 80);
      for (let i = 0; i < pieces; i++) {
        const part = this.ribbon(material, {
          ...options,
          start: begin + ((finish - begin) * i) / pieces,
          end: begin + ((finish - begin) * (i + 1)) / pieces,
        });
        first ??= part;
      }
      return first!;
    }
    const start = options.start ?? 0,
      end = options.end ?? this.track.length,
      rows = Math.ceil((end - start) / (options.step ?? 2)),
      cols = options.columns ?? 1;
    const vertices: number[] = [],
      uv: number[] = [],
      state: number[] = [],
      colors: number[] = [],
      edge: number[] = [],
      apex: number[] = [],
      kerb: number[] = [],
      runoff: number[] = [],
      indices: number[] = [];
    const p = trackPoint(),
      line: [number, number] = [0, 0];
    for (let i = 0; i <= rows; i++) {
      const s = start + ((end - start) * i) / rows;
      this.track.at(s, p);
      for (let j = 0; j <= cols; j++) {
        const t = j / cols,
          l = options.offset(s, t),
          extra = options.height?.(s, l, t) ?? 0;
        vertices.push(p.x + p.nx * l, p.y + p.bank * clamp(l, -12, 12) + extra, p.z + p.nz * l);
        uv.push(l / 5, s / 5);
        state.push(clamp((l / p.width) * 0.5 + 0.5, 0, 1), s / this.track.length);
        // Signed metres beyond the asphalt edge (negative on the road), shared
        // by the kerb, verge and terrain shaders.
        edge.push(Math.abs(l) - p.width);
        if (options.road) apex.push(...apexLineAt(this.track, s, l, line));
        const c = Math.floor(s / 3) % 2 === 0 ? new T.Color(0xdc553b) : new T.Color(0xe8e3cf);
        colors.push(c.r, c.g, c.b);
        if (options.stripes) {
          // D15: kerb scheme and how much the racing line uses this kerb.
          kerb.push(kerbStyleAt(this.track, s));
          const side = Math.sign(l) || 1;
          kerb.push(kerbUsage(Math.abs(apexLineAt(this.track, s, side * p.width, line)[0])));
        }
        if (options.runoff) runoff.push(runoffStyleAt(this.track, s));
      }
    }
    const ascending = options.offset(start, 1) >= options.offset(start, 0);
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const centreS = start + ((end - start) * (i + 0.5)) / rows;
        if (options.include && !options.include(centreS, options.offset(centreS, (j + 0.5) / cols)))
          continue;
        const a = i * (cols + 1) + j,
          b = a + cols + 1;
        if (ascending) indices.push(a, b, a + 1, b, b + 1, a + 1);
        else indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('trackUV', new T.Float32BufferAttribute(state, 2));
    g.setAttribute('edgeMetres', new T.Float32BufferAttribute(edge, 1));
    if (options.road) g.setAttribute('apexLine', new T.Float32BufferAttribute(apex, 2));
    if (options.stripes) {
      g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      g.setAttribute(
        'kerbStyle',
        new T.Float32BufferAttribute(
          kerb.filter((_, i) => i % 2 === 0),
          1,
        ),
      );
      g.setAttribute(
        'kerbUsage',
        new T.Float32BufferAttribute(
          kerb.filter((_, i) => i % 2 === 1),
          1,
        ),
      );
    }
    if (options.runoff) g.setAttribute('runoffStyle', new T.Float32BufferAttribute(runoff, 1));
    g.setIndex(indices);
    g.computeVertexNormals();
    const o = mesh(this.surfaces, g, material);
    o.castShadow = false;
    // Narrow ribbons (painted lines, kerbs) record their measured width and a
    // centreline sampled about every 4 m for the probe detail survey.
    let width = 0;
    const centreline: T.Vector3[] = [];
    for (let i = 0; i <= rows; i++) {
      const a = i * (cols + 1) * 3,
        b = a + cols * 3;
      width = Math.max(
        width,
        Math.hypot(vertices[b] - vertices[a], vertices[b + 2] - vertices[a + 2]),
      );
      if (i % Math.max(1, Math.round(4 / ((end - start) / rows))) === 0 || i === rows)
        centreline.push(
          new T.Vector3(
            (vertices[a] + vertices[b]) / 2,
            (vertices[a + 1] + vertices[b + 1]) / 2,
            (vertices[a + 2] + vertices[b + 2]) / 2,
          ),
        );
    }
    if (width <= CircuitScene.STRIP_WIDTH) o.userData.strip = { centreline, width };
    return o;
  }
  /** Register static drawables once construction is sealed: narrow ribbons
   * as strips, tree trunks by instance, everything else by bounding sphere. */
  private surveyProbeDetail() {
    for (const root of [this.props, this.surfaces, this.vegetationGroup])
      root.traverse((o) => {
        // A mesh drawn without frustum culling has no trustworthy bounds.
        if (!(o instanceof T.Mesh) || !o.frustumCulled) return;
        const strip = o.userData.strip as { centreline: T.Vector3[]; width: number } | undefined;
        if (strip) {
          o.updateWorldMatrix(true, false);
          const centreline = strip.centreline.map((p) => p.clone().applyMatrix4(o.matrixWorld));
          this.probeDetail.push(stripDetail(o, centreline, strip.width));
        } else
          this.probeDetail.push(
            o instanceof T.InstancedMesh &&
              root === this.vegetationGroup &&
              /branches/i.test(o.name)
              ? trunkDetail(o)
              : sphereDetail(o),
          );
      });
  }
  updateSurface(water: Float32Array, rubber: Float32Array, marbles: Float32Array) {
    const count = CELL_ROWS * CELL_COLS;
    if (
      water.length !== count ||
      rubber.length !== count ||
      marbles.length !== count ||
      !allFinite(water) ||
      !allFinite(rubber) ||
      !allFinite(marbles)
    )
      throw new Error('Invalid rendered track surface');
    for (let i = 0; i < water.length; i++) {
      this.stateBytes[i * 4] = clamp((water[i] / 2) * 255, 0, 255);
      this.stateBytes[i * 4 + 1] = Math.round(clamp(rubber[i], 0, 1) * 255);
      this.stateBytes[i * 4 + 2] = Math.round(clamp(marbles[i], 0, 1) * 255);
      this.stateBytes[i * 4 + 3] = 255;
    }
    this.stateTexture.needsUpdate = true;
  }
  at(s: number, l: number, y = 0) {
    const p = this.track.at(s, trackPoint());
    return new T.Vector3(p.x + p.nx * l, p.y + p.bank * clamp(l, -12, 12) + y, p.z + p.nz * l);
  }
  private sign(text: string, s: number, l: number, width = 7, height = 1.5) {
    const p = this.track.at(s, trackPoint()),
      g = new T.Group();
    g.position.copy(this.at(s, l, 2.2));
    g.rotation.y = Math.atan2(p.tx, p.tz) + (l < 0 ? Math.PI / 2 : -Math.PI / 2);
    this.props.add(g);
    const m = unprintedBack(
      new T.MeshStandardMaterial({ map: label(text), roughness: 0.72, side: T.DoubleSide }),
    );
    mesh(g, new T.PlaneGeometry(width, height), m);
    const metal = new T.MeshStandardMaterial({ color: 0x586463 });
    box(g, metal, -width * 0.35, -1.1, 0.02, 0.08, 2.5, 0.08);
    box(g, metal, width * 0.35, -1.1, 0.02, 0.08, 2.5, 0.08);
  }
  private infrastructure() {
    const paddock = paddockMaterials();
    const { concrete, steel: dark, cladding: roof, glass } = paddock;
    // Pit-box markings are lit road paint (one shared material for the 12
    // boxes): they take the car's shadow and contact occlusion and get wet
    // with the pit road. Light pools stay off, as on the pit asphalt under
    // them (box UVs are not lap metres).
    const boxPaint = new T.MeshStandardMaterial({ color: 0xd2b04a, roughness: 0.6 });
    installCircuitFinish(boxPaint, 'paint');
    installCarGrounding(boxPaint);
    // Paddock follows the main straight. Each garage has a separate bay and service box.
    // Catalogue venues build their own paddock on the venue's pit side.
    for (let i = 0; i < (this.venueKit ? 0 : 12); i++) {
      this.construction.add(`Garage ${i + 1} / 12`, 2, () => {
        const s = 70 + i * 9,
          p = this.track.at(s, trackPoint()),
          g = new T.Group();
        g.position.copy(this.at(s, 35, 0));
        g.rotation.y = Math.atan2(p.tx, p.tz);
        this.props.add(g);
        const authored = this.heroGarage && i === HERO_GARAGE.bayIndex;
        if (authored) {
          g.name = `Authored garage bay ${i + 1}`;
          g.add(this.heroGarage!.root);
          if (this.tyreBlankets) g.add(this.tyreBlankets.root);
        } else buildGarageBay(g, paddock, i);
        if (!authored) {
          const panel = mesh(
            g,
            new T.PlaneGeometry(7.5, 0.9),
            new T.MeshStandardMaterial({ map: label(`AUREL  ${String(i + 1).padStart(2, '0')}`) }),
            -6.62,
            3.5,
            0,
          );
          panel.rotation.y = -Math.PI / 2;
        }
        const boxS = this.track.boxS(i),
          mark = this.track.at(boxS, trackPoint());
        const painting = new T.Group();
        painting.position.copy(this.at(boxS, this.track.boxLateral(), 0.016));
        painting.rotation.y = Math.atan2(mark.tx, mark.tz);
        this.props.add(painting);
        for (const x of [-1.4, 1.4]) box(painting, boxPaint, x, 0, 0, 0.08, 0.012, 5);
        box(painting, boxPaint, 0, 0, 2.5, 2.9, 0.012, 0.08);
      });
    }
    this.construction.add('A21 hero pit-building frontage', 2, () => {
      if (!this.pitBuildingFrontage || this.venueKit) return;
      this.props.add(this.pitBuildingFrontage.root);
      this.pitBuildingFrontage.place(this.track, this.sightlines);
    });
    this.construction.add('A24 pit-wall command station', 2, () => {
      if (!this.pitWallStation || this.venueKit) return;
      const site = pitWallPlacement(this.track);
      const root = this.pitWallStation.root;
      root.position.set(site.x, site.y, site.z);
      root.rotation.y = site.yaw;
      root.userData.placement = site;
      this.props.add(root);
    });
    const stands = standMaterials();
    for (const site of venuePlan(this.track).grandstands)
      this.construction.add(`Detailed grandstand at ${site.s} m`, 3, () =>
        buildGrandstand(
          this.track,
          this.props,
          this.crowd,
          site,
          stands,
          this.crowdClusters,
          this.sightlines,
          this.startFinish,
          this.secondaryStands,
        ),
      );
    this.construction.add('A18 live race-information board', 3, () =>
      this.startFinish.buildScreen(this.props, this.sightlines),
    );
    this.construction.add('Signs, gantry and control tower', 2, () => {
      const plan = venuePlan(this.track);
      for (const sign of plan.signs)
        this.sign(sign.text, sign.s, sign.lateral, sign.width, sign.height);
      // Terrain venues have no braking-distance boards.
      const boards = this.offroad ? [] : plan.brakingBoards;
      if (this.trackBoards && !this.offroad) this.trackBoards.build(this.track, this.props);
      else
        for (const corner of boards)
          for (const distance of [50, 100, 150])
            this.sign(String(distance), corner - distance, -18, 1, 0.9);
      const p = this.track.at(0, trackPoint()),
        gantry = new T.Group();
      gantry.position.copy(this.at(0, 0));
      gantry.rotation.y = Math.atan2(p.tx, p.tz);
      this.props.add(gantry);
      if (this.startGantry) this.startGantry.build(this.track, gantry, this.sightlines);
      else buildGantrySolids(gantry, dark, concrete, this.sightlines);
      const banner = mesh(
        gantry,
        new T.PlaneGeometry(14, 1),
        unprintedBack(
          new T.MeshStandardMaterial({ map: label(plan.gantryLabel), side: T.DoubleSide }),
        ),
        0,
        6,
        -0.27,
      );
      banner.rotation.y = Math.PI;
      for (let i = 0; i < 5; i++) {
        const mat = new T.MeshStandardMaterial({
          color: 0x1a0e0c,
          emissive: 0xff210c,
          emissiveIntensity: 0,
        });
        this.startLamps.push(mat);
        const lamp = mesh(
          gantry,
          new T.CylinderGeometry(0.16, 0.16, 0.08, 20),
          mat,
          (i - 2) * 0.45,
          4.95,
          -0.3,
        );
        lamp.rotation.x = Math.PI / 2;
      }
      if (this.venueKit) return;
      const tower = new T.Group();
      tower.position.copy(this.at(235, 38));
      this.props.add(tower);
      buildControlTowerSolids(tower, concrete, glass, roof, this.sightlines);
    });
  }
  private grid() {
    // Grid boxes use the same lit, slightly worn line paint as the edges.
    const paint = new T.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.55 });
    installCircuitFinish(paint, 'paint');
    // The same slots as the simulation's grid and the road's launch rubber.
    for (let i = 0; i < START_GRID.rows * 2; i++) {
      const s = this.track.length - START_GRID.front - Math.floor(i / 2) * START_GRID.spacing,
        l = i % 2 === 0 ? -START_GRID.lateral : START_GRID.lateral,
        p = this.track.at(s, trackPoint()),
        g = new T.Group();
      g.position.copy(this.at(s, l, 0.012));
      g.rotation.y = Math.atan2(p.tx, p.tz);
      this.props.add(g);
      for (const x of [-1.1, 1.1]) box(g, paint, x, 0, 0, 0.08, 0.01, 4);
      box(g, paint, 0, 0, 2, 2.3, 0.01, 0.08);
    }
    const finish = canvasTexture(128, 32, (c) => {
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 16; x++) {
          c.fillStyle = (x + y) % 2 ? '#e8e5da' : '#242b29';
          c.fillRect(x * 8, y * 16, 8, 16);
        }
    });
    const p = this.track.at(0, trackPoint()),
      line = mesh(
        this.props,
        new T.PlaneGeometry(p.width * 2, 1.2),
        new T.MeshStandardMaterial({ map: finish, roughness: 0.8 }),
      );
    line.position.copy(this.at(0, 0, 0.015));
    line.rotation.set(-Math.PI / 2, 0, -Math.atan2(p.tx, p.tz));
  }
  update(frame: Float32Array) {
    this.offroad?.update(frame);
    for (let i = 0; i < 5; i++)
      this.startLamps[i].emissiveIntensity = i < frame[H.LIGHTS] ? START_LAMP_EMISSIVE : 0;
    updateSafetyPanel(this.safetyPanel, frame);
    this.signalHardware?.displays.update(frame);
  }
}
