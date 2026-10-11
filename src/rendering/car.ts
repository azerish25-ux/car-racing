import type { RivalLevels } from './a61-rival.ts';
import type { SuppliedPlayer, SuppliedPlayerAsset } from './supplied-player.ts';
import { mountAuthoredWing, mountAuthoredWheel, uprightSocketX } from './car-assembly.ts';
import type { DriverAsset } from './driver-asset.ts';
import type { HeroShells } from './hero-shells.ts';
import { installManufacturingFinish, ventilatedBrakeGeometry } from './manufacturing.ts';
import { addSafetyCell, addAirbox, buildWing } from './car-architecture.ts';
import { floorGeometry, floorFenceGeometry, wheelCoverGeometry } from './car-floor.ts';
import { rearSignalIntensity } from './rear-signal.ts';
import {
  NOSE_SECTIONS,
  sidepodShell,
  sidepodPatch,
  ENGINE_SECTIONS,
  POD_OPENINGS,
  bodySurfacePatch,
  suspensionMount,
} from './car-surfaces.ts';
import {
  installPaintFinish,
  installPaintObservation,
  installRaceGrime,
  setPaintObservation,
} from './paint-finish.ts';
import {
  addTailMechanicalDetail,
  addWheelMechanicalDetail,
  buildHelmet,
  openFrontCap,
  addSidepodDuct,
} from './car-mechanical-detail.ts';
import { addMirrorHousing, apertureGeometry, CockpitControls } from './cockpit.ts';
import { sculptedLoft, wingElement } from './bodywork.ts';
import {
  flankLivery,
  installTeamPaint,
  liveryScheme,
  playerSecondary,
  repaintFlank,
  setLiveryPattern,
} from './car-livery.ts';
import { drawWordmark, fitHeight } from './studio/brand-atlas.ts';
import { liveryCustomised, validateLivery, type Livery } from '../storage/livery.ts';
import { setSuppliedLivery, suppliedLookdevReport } from './studio/supplied-lookdev.ts';
import { TireCarcass } from './tire-carcass.ts';
import { anthraciteRimMaterial, wheelCoverMaterial } from './studio/wheel-blur.ts';
import { wheelBlur } from './studio/tyre-letters.ts';
import { bindTireSurface, tireHeatAppearance, tireWetAppearance } from './tire-finish.ts';
import { wheelPhase, wheelTravel } from './wheel-pose.ts';
import * as T from 'three';
import { DriverRig } from './driver.ts';
import { serviceWheelOffset } from './pit-crew.ts';
import { drawSteeringDisplay, shiftLight, SteeringDisplayClock } from './steering-display.ts';
import { carbonMaterial, treadMaterial } from './materials.ts';
import { ReducedCar, carLod } from './lod.ts';
import { box, canvasTexture, cockpitShell, mergeStatic, mesh, rod } from './geometry.ts';
import { COMPOUNDS, LIVERIES } from '../simulation/config.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE } from '../simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../simulation/vehicle.ts';
import { clamp, lerp } from '../core/math.ts';
const COMPOUND_STYLES = Object.values(COMPOUNDS);
export class FormulaCar {
  readonly root = new T.Group();
  readonly suppliedPlayer: SuppliedPlayer | null;
  readonly mirrors: T.Mesh[] = [];
  readonly staticBody = new T.Group();
  private highDetail = new T.Group();
  private reduced: ReducedCar[] = [];
  lodLevel = 0;
  readonly frontWing = new T.Group();
  readonly rearWing = new T.Group();
  readonly wheelPivots: T.Group[] = [];
  readonly wheelSpins: T.Group[] = [];
  /** Steered, non-rotating wheel hardware (ducts, uprights, calipers). */
  readonly wheelCarriers: T.Group[] = [];
  readonly carcasses: TireCarcass[] = [];
  readonly discs: T.MeshStandardMaterial[] = [];
  readonly brakeRotors: T.Mesh[] = [];
  readonly treads: ReturnType<typeof treadMaterial>[] = [];
  readonly rings: T.MeshStandardMaterial[] = [];
  /** Painted cover speed blur 0..1 (D12), shared by this car's four covers. */
  readonly coverBlur = { value: 0 };
  readonly links: { mesh: T.Object3D; anchor: T.Vector3; wheel: number; dy: number; dx: number }[] =
    [];
  private suspension: T.InstancedMesh;
  readonly steering = new T.Group();
  readonly cockpitControls: CockpitControls;
  readonly driver: DriverRig;
  readonly helmet = new T.Group();
  readonly rainLight: T.MeshStandardMaterial;
  readonly rearSignal: T.Mesh;
  readonly display: T.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private displayClock = new SteeringDisplayClock();
  readonly shiftLeds: T.InstancedMesh;
  readonly wheelButtons: T.InstancedMesh;
  private indicatorColor = new T.Color();
  readonly paint: T.MeshPhysicalMaterial;
  readonly accent: T.MeshPhysicalMaterial;
  readonly identityTexture: T.CanvasTexture;
  readonly reflectivePaint: T.MeshPhysicalMaterial[] = [];
  private qa = new T.Quaternion();
  private qb = new T.Quaternion();
  private v = new T.Vector3();
  private linkChord = new T.Vector3();
  private linkThickness = new T.Vector3();
  private linkBasis = new T.Matrix4();
  setLivery(value: Livery) {
    const livery = validateLivery(value);
    this.paint.color.set(livery.primary);
    this.accent.color.set(livery.accent);
    const secondary = playerSecondary(livery.primary);
    setLiveryPattern(this.paint, { secondary, accent: livery.accent });
    for (const material of this.reflectivePaint) repaintFlank(material, this.id, livery);
    if (this.suppliedPlayer)
      setSuppliedLivery(this.suppliedPlayer.root, liveryCustomised(livery) ? livery : null);
    this.drawIdentity(
      `${livery.sponsor} / ${String(livery.number).padStart(2, '0')}`,
      secondary,
      livery.accent,
    );
  }
  /** The nose identity panel: path-drawn text (no system font), so every
   * machine paints the same pixels. */
  private drawIdentity(text: string, background: string, ink: string) {
    const canvas = this.identityTexture.image as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = ink;
    const style = { weight: 0.18, width: 0.96 };
    const height = fitHeight(text, canvas.width * 0.9, canvas.height * 0.56, style);
    drawWordmark(context, text, canvas.width / 2, canvas.height / 2, height, style);
    this.identityTexture.needsUpdate = true;
  }
  /** Supplied-car look-dev applied at load (de-branded sheets, overrides). */
  get suppliedLookdev() {
    return this.suppliedPlayer ? suppliedLookdevReport(this.suppliedPlayer.root) : null;
  }
  constructor(
    readonly id: number,
    hero?: HeroShells,
    driverAsset?: DriverAsset,
    suppliedAsset?: SuppliedPlayerAsset,
    rivals?: RivalLevels,
  ) {
    if (id > 0 && rivals) hero = rivals[0];
    this.root.name = `Formula ${id + 1}`;
    this.root.userData.a61 = id > 0 && rivals ? rivals.map((asset) => asset.diagnostics()) : null;
    this.root.userData.authoredBodywork = hero?.diagnostics() ?? null;
    this.root.add(this.staticBody, this.frontWing, this.rearWing);
    const s = this.staticBody;
    const scheme = liveryScheme(id);
    // Team finish (gloss, metallic, satin or matte), flakes, orange peel and the
    // body livery pattern, before the flank skins clone it.
    this.paint = installTeamPaint(
      new T.MeshPhysicalMaterial({ color: LIVERIES[id % LIVERIES.length] }),
      id,
    );
    this.reflectivePaint.push(this.paint);
    const carbon = carbonMaterial();
    // Raw satin carbon for the floor (one extra submission per near car).
    const floorCarbon = carbonMaterial('satin');
    const dark = new T.MeshStandardMaterial({ color: 0x101416, roughness: 0.75 });
    const metal = installManufacturingFinish(
      new T.MeshStandardMaterial({ color: 0x7c8589, metalness: 0.88, roughness: 0.3 }),
      'turned-alloy',
    );
    // D12: anthracite rims and painted covers (one for one, draw-neutral).
    const rimAlloy = anthraciteRimMaterial();
    const wheelCover = wheelCoverMaterial(
      LIVERIES[id % LIVERIES.length],
      scheme.secondary,
      scheme.accent,
      this.coverBlur,
    ).material;
    const ivory = new T.MeshPhysicalMaterial({
      color: scheme.accent,
      roughness: 0.3,
      metalness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
    });
    installPaintFinish(ivory);
    this.accent = ivory;
    // Venturi floor, sculpted monocoque, narrow nose and smoothly undercut sidepods.
    mesh(s, hero?.copy('floor') ?? floorGeometry(), floorCarbon);
    if (hero) mesh(s, hero.copy('floor_edges'), floorCarbon);
    mesh(s, hero?.copy('nose') ?? sculptedLoft(NOSE_SECTIONS, 0, 0.32), this.paint);
    mesh(s, hero?.copy('monocoque') ?? cockpitShell(), this.paint);
    if (hero) {
      mesh(s, hero.copy('seat_shell'), carbon);
      mesh(s, hero.copy('seat_padding'), dark);
    } else {
      box(s, dark, 0, -0.24, -0.14, 0.5, 0.08, 1.02);
      box(s, dark, 0, -0.02, -0.6, 0.44, 0.45, 0.09);
    }
    const flankMaterials: [T.MeshPhysicalMaterial, T.MeshPhysicalMaterial] = [
      flankLivery(this.paint, -1, id),
      flankLivery(this.paint, 1, id),
    ];
    // Brake dust, rubber spray and a dirtier rear end on raced bodywork.
    for (const material of [this.paint, ...flankMaterials]) installRaceGrime(material);
    for (const sign of [-1, 1]) {
      const livery = flankMaterials[sign < 0 ? 0 : 1];
      this.reflectivePaint.push(livery);
      const pod = mesh(
        s,
        hero?.copy('sidepod') ?? openFrontCap(sidepodShell()),
        livery,
        sign * 0.53,
        0,
        0,
      );
      pod.rotation.z = sign * -0.08;
      addSidepodDuct(s, sign, { carbon, dark, metal, paint: this.paint });
      for (let j = 0; j < 4; j++) {
        const bolt = mesh(
          s,
          new T.CylinderGeometry(0.003, 0.003, 0.002, 6),
          metal,
          sign * (0.41 + j * 0.09),
          0.119,
          0.235,
        );
        bolt.rotation.x = 0.08;
      }
      // Actual holes in the livery shell, with recessed dark interior skins.
      // The inset shares the pod transform and is batched with existing carbon.
      for (const opening of POD_OPENINGS) {
        const recess = mesh(s, sidepodPatch(opening, -0.008), carbon, sign * 0.53, 0, 0);
        recess.rotation.z = sign * -0.08;
      }
      if (!hero) {
        mesh(s, floorFenceGeometry(sign * 0.97, 0, 5, 0.042), carbon);
        for (const across of [0.25, 0.5, 0.76])
          mesh(s, floorFenceGeometry(sign * across, 0, 2, 0.082), carbon);
      }
    }
    mesh(
      s,
      hero?.copy('engine') ?? openFrontCap(sculptedLoft(ENGINE_SECTIONS, 0, 0.18)),
      this.paint,
    );
    if (hero) {
      mesh(s, hero.copy('airbox_paint'), this.paint);
      mesh(s, hero.copy('airbox_carbon'), carbon);
      mesh(s, hero.copy('airbox_dark'), dark);
      // D18: a halo painted in the team primary (merges with the bodywork).
      mesh(s, hero.copy('safety'), this.paint);
    } else {
      addAirbox(s, this.paint, carbon, dark, 'high');
      addSafetyCell(s, carbon, 'high');
    }
    for (const sign of [-1, 1]) {
      rod(
        s,
        carbon,
        new T.Vector3(sign * 0.29, 0.13, 0.36),
        new T.Vector3(sign * 0.59, 0.29, 0.46),
        0.012,
      );
      const glass = addMirrorHousing(s, this.paint, carbon, sign, hero?.copy('mirror_shell'));
      // Batch the lit shell/bezel with the body, but keep the rear-camera feed
      // independently owned. attach preserves its housing-space placement.
      this.root.attach(glass);
      this.mirrors.push(glass);
    }
    rod(s, metal, new T.Vector3(0.055, 0.13, 0.93), new T.Vector3(0.055, 0.52, 0.93), 0.004);
    if (hero) {
      const materials = { paint: this.paint, carbon, metal, dark };
      mountAuthoredWing(this.frontWing, hero, 'front', materials);
      mountAuthoredWing(this.rearWing, hero, 'rear', materials);
      mesh(s, hero.copy('beam'), carbon);
    } else {
      buildWing(this.frontWing, 'front', 'high', this.paint, carbon);
      buildWing(this.rearWing, 'rear', 'high', this.paint, carbon);
      mesh(s, wingElement(1.41, 0.23, 0.018, 0.011, 0.015, 0.008), carbon, 0, -0.12, -2.06);
      mesh(s, wingElement(1.36, 0.17, 0.018, 0.009, 0.02, 0.009), carbon, 0, -0.05, -2.18);
    }
    const rain = new T.MeshStandardMaterial({
      color: 0x710000,
      emissive: 0xff1b0a,
      emissiveIntensity: 0.4,
    });
    this.rainLight = rain;
    // One physical lamp survives bodywork LOD switches. Its local anchor also
    // drives RearSignalField; a low-detail car must not leave a phantom lit plume.
    this.rearSignal = box(this.root, rain, 0, -0.23, -2.28, 0.095, 0.065, 0.02);
    this.rearSignal.name = 'Recorded rear signal';
    // Original car identity and livery: small, deliberate markings on bodywork.
    const logo = installPaintFinish(
      new T.MeshPhysicalMaterial({
        map: canvasTexture(512, 128, () => {}),
        roughness: 0.32,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
      }),
    );
    this.reflectivePaint.push(logo);
    this.identityTexture = logo.map as T.CanvasTexture;
    this.identityTexture.userData.dynamic = true;
    this.drawIdentity(`APEX / ${String(id + 7).padStart(2, '0')}`, scheme.secondary, scheme.accent);
    mesh(
      s,
      bodySurfacePatch(NOSE_SECTIONS, { z0: 0.7, z1: 0.815, u0: 0.365, u1: 0.635 }, 0, 0.32),
      logo,
    );
    for (const side of [-1, 1]) {
      const u = side < 0 ? 0.66 : 0.326;
      mesh(
        s,
        bodySurfacePatch(
          NOSE_SECTIONS,
          { z0: 0.44, z1: 1.42, u0: u, u1: u + 0.014 },
          0,
          0.32,
          0.0016,
        ),
        ivory,
      );
    }
    // Wheels use articulated pivots; tire geometry follows load-compression telemetry.
    WHEEL_POSITIONS.forEach((p, i) => {
      const pivot = new T.Group(),
        spin = new T.Group();
      pivot.position.set(p[0], -0.183, p[2]);
      pivot.add(spin);
      this.root.add(pivot);
      this.wheelPivots.push(pivot);
      this.wheelSpins.push(spin);
      const half = i < 2 ? 0.155 : 0.19;
      const tread = treadMaterial(half);
      this.treads.push(tread);
      const ringMaterial = new T.MeshStandardMaterial({
        color: COMPOUNDS.medium.color,
        roughness: 0.82,
      });
      this.rings.push(ringMaterial);
      if (!hero) {
        const wheel = mesh(
          spin,
          new T.CylinderGeometry(0.246, 0.246, half * 2 + 0.002, 40, 1, true),
          dark,
        );
        wheel.rotation.z = Math.PI / 2;
        for (const side of [-1, 1]) {
          const rim = mesh(
            spin,
            new T.TorusGeometry(0.24, 0.011, 8, 40),
            rimAlloy,
            side * (half + 0.002),
            0,
            0,
          );
          rim.rotation.y = Math.PI / 2;
          const hub = mesh(
            spin,
            new T.CylinderGeometry(0.046, 0.052, 0.027, 12),
            metal,
            side * (half + 0.008),
            0,
            0,
          );
          hub.rotation.z = Math.PI / 2;
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2;
            rod(
              spin,
              metal,
              new T.Vector3(side * (half + 0.001), Math.sin(a) * 0.052, Math.cos(a) * 0.052),
              new T.Vector3(
                side * (half + 0.001),
                Math.sin(a + 0.13) * 0.23,
                Math.cos(a + 0.13) * 0.23,
              ),
              0.008,
            );
          }
        }
      }
      const discMaterial = installManufacturingFinish(
        new T.MeshStandardMaterial({
          color: 0x4b4a45,
          metalness: 0.05,
          roughness: 0.6,
          emissive: 0xff4d08,
        }),
        'carbon-ceramic',
      );
      this.discs.push(discMaterial);
      const carrierDetails = new T.Group();
      pivot.add(carrierDetails);
      this.wheelCarriers.push(carrierDetails);
      const disc = mesh(
        pivot,
        hero?.copy('brake_rotor') ?? ventilatedBrakeGeometry(),
        discMaterial,
        0,
        0,
        0,
      );
      if (hero) {
        // The bell is rotor-owned: spins with the disc, never leaves with a
        // withdrawn rim during the real pit service state.
        mesh(disc, hero.copy(i < 2 ? 'front_hat' : 'rear_hat', p[0] < 0 ? -1 : 1), metal);
      }
      this.brakeRotors.push(disc);
      if (!hero) box(carrierDetails, dark, 0, 0.05, -0.19, 0.11, 0.14, 0.055);
      for (const dy of [-0.075, 0.055])
        for (const dz of [-0.3, 0.3]) {
          const anchor = suspensionMount(p[0], p[2], dy, dz),
            end = new T.Vector3(p[0], -0.183 + dy, p[2]);
          const link = new T.Object3D();
          link.position.copy(end);
          this.links.push({
            mesh: link,
            anchor,
            wheel: i,
            dy,
            dx: hero ? uprightSocketX(i < 2, p[0] < 0 ? -1 : 1) : 0,
          });
        }
      // The opaque cover sits OUTSIDE the spoke envelope (8mm rod radius),
      // rather than intersecting it and exposing a false spoked-cover pattern.
      // Rigid aero cover and machined hub detail spin with the rim, never with
      // the deforming contact patch. The compound rings remain on the carcass.
      const outside = Math.sign(p[0]);
      if (hero) {
        mountAuthoredWheel(
          carrierDetails,
          spin,
          hero,
          i < 2 ? 'front' : 'rear',
          outside < 0 ? -1 : 1,
          { carbon, dark, metal, paint: this.paint, rim: rimAlloy, cover: wheelCover },
        );
      } else {
        const cover = mesh(spin, wheelCoverGeometry(), wheelCover, outside * (half + 0.014), 0, 0);
        cover.rotation.y = (outside * Math.PI) / 2;
        const centreRing = mesh(
          spin,
          new T.TorusGeometry(0.049, 0.006, 8, 32),
          metal,
          outside * (half + 0.018),
          0,
          0,
        );
        centreRing.rotation.y = Math.PI / 2;
        for (let j = 0; j < 10; j++) {
          const angle = (j / 10) * Math.PI * 2;
          const fastener = mesh(
            spin,
            new T.CylinderGeometry(0.004, 0.004, 0.004, 6),
            metal,
            outside * (half + 0.021),
            Math.cos(angle) * 0.193,
            Math.sin(angle) * 0.193,
          );
          fastener.rotation.z = Math.PI / 2;
        }
        addWheelMechanicalDetail(carrierDetails, spin, outside, half, {
          carbon,
          dark,
          metal,
          paint: this.paint,
        });
      }
      mergeStatic(carrierDetails);
      // Batch only the rigid wheel. Rubber must remain independently deformable.
      mergeStatic(spin);
      const carcass = new TireCarcass(
        half,
        tread.material,
        ringMaterial,
        hero?.copy(i < 2 ? 'tire_front' : 'tire_rear'),
      );
      this.carcasses.push(carcass);
      spin.add(carcass.root);
    });
    this.suspension = new T.InstancedMesh(
      hero?.copy('suspension_link') ??
        new T.CylinderGeometry(0.013, 0.017, 1, 8).scale(1.8, 1, 0.45),
      carbon,
      this.links.length,
    );
    this.suspension.name = 'Shared articulated suspension';
    this.suspension.castShadow = true;
    this.root.add(this.suspension);
    // Driver and steering assembly; hands are attached to the rotating wheel.
    this.root.add(this.steering, this.helmet);
    this.steering.position.set(0, 0.115, 0.22);
    this.steering.rotation.x = 0.12;
    this.cockpitControls = new CockpitControls(this.steering, carbon);
    this.display = canvasTexture(512, 256, (c) => {
      c.fillStyle = '#0c1212';
      c.fillRect(0, 0, 512, 256);
    });
    this.display.userData.dynamic = true;
    this.canvas = this.display.image as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    const screen = mesh(
      this.steering,
      apertureGeometry(0.182, 0.09, 0.004),
      new T.MeshBasicMaterial({ map: this.display }),
      0,
      0.014,
      -0.028,
    );
    screen.rotation.y = Math.PI;
    // Identical controls share geometry/material submissions, not state. Each
    // LED retains its own linear-space colour and each button its exact pose.
    this.shiftLeds = new T.InstancedMesh(
      new T.BoxGeometry(0.01, 0.005, 0.003),
      new T.MeshBasicMaterial(),
      10,
    );
    this.shiftLeds.name = 'Individual RPM LEDs (one submission)';
    this.wheelButtons = new T.InstancedMesh(
      new T.CylinderGeometry(0.009, 0.009, 0.009, 12),
      new T.MeshStandardMaterial(),
      6,
    );
    this.wheelButtons.name = 'Original wheel buttons (one submission)';
    const indicator = new T.Object3D();
    for (let j = 0; j < 10; j++) {
      indicator.position.set(-0.071 + j * 0.016, 0.074, -0.018);
      indicator.updateMatrix();
      this.shiftLeds.setMatrixAt(j, indicator.matrix);
      this.shiftLeds.setColorAt(
        j,
        this.indicatorColor.setHex(j < 5 ? 0x6fec9b : j < 8 ? 0xed6540 : 0xaabef8),
      );
    }
    this.shiftLeds.instanceColor!.setUsage(T.DynamicDrawUsage);
    let button = 0;
    indicator.rotation.x = Math.PI / 2;
    for (const sign of [-1, 1])
      for (let k = 0; k < 3; k++) {
        indicator.position.set(sign * (0.117 + (k % 2) * 0.026), 0.037 - k * 0.028, -0.027);
        indicator.updateMatrix();
        this.wheelButtons.setMatrixAt(button, indicator.matrix);
        this.wheelButtons.setColorAt(
          button++,
          this.indicatorColor.setHex([0xe65739, 0x56b8a6, 0xe6c254][k]),
        );
      }
    for (const controls of [this.shiftLeds, this.wheelButtons]) {
      controls.castShadow = true;
      controls.receiveShadow = true;
      controls.computeBoundingBox();
      controls.computeBoundingSphere();
      this.steering.add(controls);
    }
    // D16: the driver wears the team's kit and helmet.
    const kit = {
      primary: LIVERIES[id % LIVERIES.length],
      secondary: scheme.secondary,
      accent: scheme.accent,
    };
    this.driver = new DriverRig(this.steering, driverAsset, kit);
    this.root.add(this.driver.root);

    buildHelmet(this.helmet, { carbon, dark, metal, paint: ivory }, kit);
    if (hero) {
      mesh(s, hero.copy('tail_carbon'), carbon);
      mesh(s, hero.copy('tail_alloy'), metal);
      mesh(s, hero.copy('tail_dark'), dark);
    } else addTailMechanicalDetail(s, { carbon, dark, metal, paint: this.paint });
    mergeStatic(s);
    mergeStatic(this.frontWing);
    mergeStatic(this.rearWing);
    const highChildren = [...this.root.children].filter(
      (child) => child !== this.suspension && child !== this.rearSignal,
    );
    this.root.add(this.highDetail);
    this.highDetail.add(...highChildren);
    for (const level of [1, 2] as const) {
      const reduced = new ReducedCar(
        level,
        this.paint,
        carbon,
        dark,
        flankMaterials,
        id > 0 ? rivals?.[level] : undefined,
      );
      for (let i = 0; i < 4; i++) {
        bindTireSurface(reduced.tires[i].geometry, 'y');
        reduced.tires[i].material = this.treads[i].material;
      }
      this.reduced.push(reduced);
      reduced.root.visible = false;
      this.root.add(reduced.root);
    }
    for (const material of [...this.reflectivePaint, this.accent])
      installPaintObservation(material);
    this.suppliedPlayer = id === 0 && suppliedAsset ? suppliedAsset.take(this.display) : null;
    if (this.suppliedPlayer) {
      for (const child of this.root.children) child.visible = false;
      this.root.add(this.suppliedPlayer.root);
      this.reflectivePaint.push(...this.suppliedPlayer.reflectivePaint);
      this.mirrors.splice(0, this.mirrors.length, ...this.suppliedPlayer.mirrors);
      this.root.userData.suppliedPlayer = this.suppliedPlayer.diagnostics();
    }
  }
  /** Groups whose own mesh and direct mesh children never move relative to
   * the group: batched bodywork, wings, wheel carriers, rims, brake rotors
   * (with their bells), the steering-wheel body, helmet and torso, at every
   * LOD. Shadow casters may merge each one. The supplied player car lists
   * its own glTF groups. */
  shadowFrames(): T.Object3D[] {
    if (this.suppliedPlayer) return this.suppliedPlayer.shadowFrames();
    return [
      this.staticBody,
      this.frontWing,
      this.rearWing,
      ...this.wheelCarriers,
      ...this.wheelSpins,
      ...this.brakeRotors,
      this.cockpitControls.staticParts,
      this.helmet,
      this.driver.body,
      ...this.reduced.flatMap((car) => [car.body, car.front, car.rear, ...car.spins]),
    ];
  }
  setLod(
    distance: number,
    quality: 'low' | 'medium' | 'high',
    player: boolean,
    exactClose = false,
  ) {
    if (this.suppliedPlayer) {
      // Never let an old procedural LOD reappear in replay, menu or photo mode.
      this.lodLevel = carLod(distance, this.lodLevel, quality, player);
      this.suppliedPlayer.lods?.setLevel(this.lodLevel, quality, exactClose);
      this.highDetail.visible = false;
      this.reduced.forEach((car) => {
        car.root.visible = false;
      });
      this.suppliedPlayer.root.visible = true;
      return;
    }
    this.lodLevel = carLod(distance, this.lodLevel, quality, player);
    this.highDetail.visible = this.lodLevel === 0;
    this.reduced.forEach((car, index) => (car.root.visible = this.lodLevel === index + 1));
  }
  update(
    a: Float32Array,
    b: Float32Array,
    o: number,
    t: number,
    _dt: number,
    time: number,
    cockpit: boolean,
  ) {
    this.root.position.set(
      lerp(a[o + F.X], b[o + F.X], t),
      lerp(a[o + F.Y], b[o + F.Y], t),
      lerp(a[o + F.Z], b[o + F.Z], t),
    );
    this.qa.set(a[o + F.QX], a[o + F.QY], a[o + F.QZ], a[o + F.QW]);
    this.qb.set(b[o + F.QX], b[o + F.QY], b[o + F.QZ], b[o + F.QW]);
    this.root.quaternion.copy(this.qa).slerp(this.qb, t);
    if (this.suppliedPlayer) {
      if (this.displayClock.due(b[H.TIME], b[o + F.GEAR])) {
        drawSteeringDisplay(this.ctx, b, o);
        this.display.needsUpdate = true;
      }
      this.suppliedPlayer.update(a, b, o, t, cockpit);
      return;
    }
    let contactWater = 0;
    for (let i = 0; i < 4; i++) {
      const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
      if (b[w + W.LOAD] > 20) contactWater += Math.max(0, b[w + W.WATER]) / 4;
    }
    const wetPaint = Math.max(
      clamp(b[H.RAIN] / 14, 0, 1),
      clamp((contactWater * Math.abs(b[o + F.SPEED])) / 25, 0, 1),
    );
    for (const material of this.reflectivePaint)
      setPaintObservation(material, wetPaint, b[o + F.FRONT_HEALTH], b[o + F.REAR_HEALTH]);
    setPaintObservation(this.accent, wetPaint, b[o + F.FRONT_HEALTH], b[o + F.REAR_HEALTH]);
    // Update before the reduced-car return, using recorded interpolation rather
    // than a render timer. Pauses, seeks and hysteretic LOD handoffs stay in phase.
    this.rainLight.emissiveIntensity = rearSignalIntensity(
      lerp(a[o + F.BRAKE], b[o + F.BRAKE], t),
      lerp(a[H.TIME], b[H.TIME], t),
    );
    // Every visible representation shares this wheel's live material. Observe
    // snapshots before any LOD return; pit swaps and replay seeks cannot leave
    // reduced tyres clean/slick while the near representation is worn or wet.
    const compoundIndex = Math.round(b[o + F.COMPOUND]);
    const compound = COMPOUND_STYLES[compoundIndex] ?? COMPOUNDS.medium;
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
      this.rings[i].color.setHex(compound.color);
      // D12 sidewall band in the compound colour; art smears with wheel speed.
      this.treads[i].band.value.setHex(compound.color);
      this.treads[i].side.value.x = wheelBlur(b[p + W.OMEGA]);
      this.treads[i].condition.value.set(
        b[p + W.DIRT],
        b[p + W.WEAR],
        b[p + W.BLISTERING],
        b[p + W.GRAINING],
      );
      this.treads[i].surface.value.x = tireWetAppearance(
        b[H.RAIN],
        b[p + W.WATER],
        b[p + W.LOAD],
        b[o + F.SPEED],
      );
      this.treads[i].surface.value.y = compoundIndex === 3 ? 1 : compoundIndex === 4 ? 2 : 0;
      this.treads[i].heat.value = tireHeatAppearance(b[p + W.SURFACE_TEMP]);
    }
    let coverBlur = -Infinity;
    for (const tread of this.treads) coverBlur = Math.max(coverBlur, tread.side.value.x);
    this.coverBlur.value = coverBlur;
    // Reduced representations a mirror may show (never more detailed than the
    // main view's) stay posed and damaged like the car.
    for (let level = Math.max(1, this.lodLevel); level <= this.reduced.length; level++)
      this.poseReduced(this.reduced[level - 1], a, b, o, t);
    // The shared suspension instances keep the last posed representation's
    // links; solve them once for it instead of once per representation.
    if (this.lodLevel > 0) {
      this.updateSuspension(this.reduced[this.reduced.length - 1].wheels);
      return;
    }
    this.poseDetailed(a, b, o, t, time, cockpit);
  }
  /** Show the representation for `level` without changing the chosen LOD:
   * a mirror pass shows small reflections coarser, then restores lodLevel. */
  showDetail(level: number) {
    if (this.suppliedPlayer) return;
    if (!Number.isInteger(level) || level < 0 || level > this.reduced.length)
      throw new Error('Invalid car detail level');
    this.highDetail.visible = level === 0;
    this.reduced.forEach((car, index) => (car.root.visible = level === index + 1));
  }
  private poseReduced(reduced: ReducedCar, a: Float32Array, b: Float32Array, o: number, t: number) {
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
      reduced.wheels[i].position.y = 0.05 - wheelTravel(a, b, p, t);
      const radius = (lerp(a[p + W.RADIUS], b[p + W.RADIUS], t) || 0.335) / 0.335;
      // The reduced cylinder's axle is local Y; neither rim nor hub scales.
      reduced.tires[i].scale.set(radius, 1, radius);
      reduced.wheels[i].rotation.y = lerp(a[p + W.STEER], b[p + W.STEER], t);
      reduced.wheels[i].rotation.z = -lerp(a[p + W.CAMBER], b[p + W.CAMBER], t);
      reduced.spins[i].rotation.x = wheelPhase(a, b, o, p, t);
      reduced.spins[i].position.x =
        Math.sign(WHEEL_POSITIONS[i][0]) *
        serviceWheelOffset(b[o + F.PIT_PHASE], b[o + F.PIT_CLOCK], b[p + W.LOAD]);
      reduced.brakes[i].rotation.x = reduced.spins[i].rotation.x;
    }
    reduced.front.visible = b[o + F.FRONT_HEALTH] > 0.08;
    reduced.rear.visible = b[o + F.REAR_HEALTH] > 0.08;
    reduced.front.scale.x = 0.35 + 0.65 * b[o + F.FRONT_HEALTH];
    reduced.front.rotation.z = (1 - b[o + F.FRONT_HEALTH]) * 0.12;
    reduced.rear.rotation.z = (1 - b[o + F.REAR_HEALTH]) * 0.09;
  }
  private poseDetailed(
    a: Float32Array,
    b: Float32Array,
    o: number,
    t: number,
    time: number,
    cockpit: boolean,
  ) {
    this.steering.rotation.z = -lerp(a[o + F.STEER], b[o + F.STEER], t) * 2.2;
    this.driver.update(
      time,
      b[o + F.GEAR],
      b[o + F.ERS_MODE],
      lerp(a[o + F.G_LAT], b[o + F.G_LAT], t),
      lerp(a[o + F.G_LONG], b[o + F.G_LONG], t),
      lerp(a[o + F.G_VERT], b[o + F.G_VERT], t),
    );
    this.helmet.rotation.set(this.driver.headPitch, 0, this.driver.headRoll);
    this.cockpitControls.update(b, o);
    this.helmet.visible = !cockpit;
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE,
        pivot = this.wheelPivots[i];
      pivot.position.y = 0.05 - wheelTravel(a, b, p, t);
      pivot.rotation.y = lerp(a[p + W.STEER], b[p + W.STEER], t);
      // Tire-force camber is signed about the rolling direction; the visual
      // axle uses the opposite local-Z rotation. Negative setup camber leans in.
      pivot.rotation.z = -lerp(a[p + W.CAMBER], b[p + W.CAMBER], t);
      this.wheelSpins[i].rotation.x = wheelPhase(a, b, o, p, t);
      this.wheelSpins[i].position.x =
        Math.sign(WHEEL_POSITIONS[i][0]) *
        serviceWheelOffset(b[o + F.PIT_PHASE], b[o + F.PIT_CLOCK], b[p + W.LOAD]);
      this.brakeRotors[i].rotation.x = this.wheelSpins[i].rotation.x;
      this.discs[i].emissiveIntensity = clamp((b[p + W.DISC_TEMP] - 500) / 450, 0, 2);
      this.carcasses[i].update(
        this.wheelSpins[i].rotation.x,
        lerp(a[p + W.RADIUS], b[p + W.RADIUS], t),
        lerp(a[p + W.LOAD], b[p + W.LOAD], t),
        lerp(a[p + W.PRESSURE], b[p + W.PRESSURE], t),
        lerp(a[p + W.FLAT], b[p + W.FLAT], t),
      );
    }
    this.updateSuspension(this.wheelPivots);
    this.frontWing.visible = b[o + F.FRONT_HEALTH] > 0.08;
    this.rearWing.visible = b[o + F.REAR_HEALTH] > 0.08;
    this.frontWing.scale.x = 0.35 + 0.65 * b[o + F.FRONT_HEALTH];
    this.frontWing.rotation.z = (1 - b[o + F.FRONT_HEALTH]) * 0.12;
    this.rearWing.rotation.z = (1 - b[o + F.REAR_HEALTH]) * 0.09;
    if (this.id === 0 && this.displayClock.due(b[H.TIME], b[o + F.GEAR])) {
      drawSteeringDisplay(this.ctx, b, o);
      for (let j = 0; j < this.shiftLeds.count; j++)
        this.shiftLeds.setColorAt(
          j,
          this.indicatorColor.setHex(
            shiftLight(b[o + F.RPM], j)
              ? j < 5
                ? 0x6fec9b
                : j < 8
                  ? 0xed6540
                  : 0xaabef8
              : 0x20292a,
          ),
        );
      this.shiftLeds.instanceColor!.needsUpdate = true;
      this.display.needsUpdate = true;
    }
  }
  private updateSuspension(pivots: readonly T.Group[]) {
    for (let j = 0; j < this.links.length; j++) {
      const link = this.links[j];
      const pivot = pivots[link.wheel];
      this.v.set(link.dx, link.dy, 0).applyQuaternion(pivot.quaternion).add(pivot.position);
      const length = this.v.distanceTo(link.anchor);
      link.mesh.position.copy(this.v).add(link.anchor).multiplyScalar(0.5);
      this.v.sub(link.anchor).normalize();
      // Local Y spans the joints. Align the aerofoil chord with car-forward
      // projected perpendicular to that span, rather than rolling it upright.
      this.linkChord.set(0, 0, 1).addScaledVector(this.v, -this.v.z);
      if (this.linkChord.lengthSq() < 1e-10)
        this.linkChord.set(1, 0, 0).addScaledVector(this.v, -this.v.x);
      this.linkChord.normalize();
      this.linkThickness.crossVectors(this.linkChord, this.v).normalize();
      this.linkBasis.makeBasis(this.linkChord, this.v, this.linkThickness);
      link.mesh.quaternion.setFromRotationMatrix(this.linkBasis);
      link.mesh.scale.y = length;
      link.mesh.updateMatrix();
      this.suspension.setMatrixAt(j, link.mesh.matrix);
    }
    this.suspension.instanceMatrix.needsUpdate = true;
    // Bounds follow articulated endpoints; stale instance bounds must not cull links.
    this.suspension.computeBoundingBox();
    this.suspension.computeBoundingSphere();
  }
}
