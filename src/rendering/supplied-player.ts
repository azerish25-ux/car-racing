import { applySuppliedCharacterLookdev } from './studio/supplied-character-lookdev.ts';
import { installSuppliedWheelBlur, type SuppliedWheelBlur } from './studio/wheel-blur.ts';
import { wheelBlur } from './studio/tyre-letters.ts';
import { SuppliedSkinBounds } from './supplied-skin-bounds.ts';
import * as T from 'three';
import { installSuppliedShaderWork } from './supplied-shader-work.ts';
import { configureSuppliedMaterial } from './supplied-player-materials.ts';
import { applySuppliedLookdev } from './studio/supplied-lookdev.ts';
import { loadPlayerLods, SuppliedPlayerLods, type PlayerLodData } from './supplied-player-lods.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, lerp } from '../core/math.ts';
import { F, H, R, RACE_BASE, W, WHEEL_BASE, WHEEL_STRIDE } from '../simulation/protocol.ts';
import { COMPOUNDS } from '../simulation/config.ts';
import { wheelPhase, wheelTravel } from './wheel-pose.ts';
import { serviceWheelOffset } from './pit-crew.ts';
import { rearLampIntensity } from './rear-signal.ts';
import manifest from './supplied-player.manifest.json' with { type: 'json' };

/** The Blender assembly uses the nominal wheel-centre datum, while the
 * simulation publishes absolute suspension lengths below chassis hardpoints. */
export const PLAYER_SUSPENSION_DATUM = 0.25;
/** DRS flap rotation (rad about the lateral axis) when fully open. */
export const PLAYER_DRS_OPEN = -0.5;

/** These two source images are scalar height, not tangent-space RGB normals.
 * Preserve their UV transforms and restore the source Bump-node interpretation.
 * Other R06 normal maps are genuine normal maps and must remain untouched. */
export function restoreSuppliedHeightMap(material: T.MeshStandardMaterial) {
  const texture = material.normalMap;
  const scale =
    texture?.name === 'carbon_twill_height'
      ? 0.00015
      : texture?.name === 'tyre_scrub_height_16bit'
        ? 0.0004
        : null;
  if (scale === null || !texture) return false;
  texture.colorSpace = T.NoColorSpace;
  material.bumpMap = texture;
  material.bumpScale = scale;
  material.normalMap = null;
  material.needsUpdate = true;
  return true;
}

const aborted = () => new DOMException('Player model loading cancelled', 'AbortError');
const hash = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
const requiredNames = [
  'PLAYER_VEHICLE',
  'PLAYER_SOCKET_EYE',
  'PLAYER_SOCKET_POD',
  'PLAYER_SOCKET_STEERING',
  'PLAYER_HEAD',
  'PLAYER_DRIVER',
  'PLAYER_CONTROLS',
  'PLAYER_LCD',
  'RB19_BODY',
  'RB19_MIRROR_0',
  'RB19_MIRROR_1',
  'PLAYER_FRONT_WING',
  'PLAYER_REAR_WING',
  ...[0, 1, 2, 3].flatMap((i) => [`PLAYER_WHEEL_${i}`, `PLAYER_SPIN_${i}`]),
];
interface AssetDocument {
  asset?: { version?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { name?: string; children?: number[]; mesh?: number; skin?: number }[];
  meshes?: { primitives?: { indices?: number; attributes?: Record<string, number> }[] }[];
  accessors?: { count?: number; bufferView?: number }[];
  buffers?: { uri?: string; byteLength?: number }[];
  bufferViews?: { buffer?: number; byteOffset?: number; byteLength?: number }[];
  skins?: { joints?: number[] }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  materials?: unknown[];
  animations?: { name?: string; channels?: unknown[] }[];
}
/** Separate contract for the user's textured, animated assembly. The original
 * static shell and nine-bone AI-driver validators remain unchanged. */
export function validateSuppliedPlayerDocument(value: unknown) {
  const fail = (): never => {
    throw new Error('Invalid supplied player model contract');
  };
  if (!value || typeof value !== 'object') fail();
  const d = value as AssetDocument;
  if (
    d.asset?.version !== '2.0' ||
    d.scene !== 0 ||
    d.scenes?.length !== 1 ||
    d.nodes?.length !== manifest.nodes ||
    d.meshes?.length !== manifest.meshes ||
    d.materials?.length !== manifest.materials ||
    d.images?.length !== manifest.images ||
    d.buffers?.length !== 1 ||
    d.buffers[0].uri !== undefined ||
    !Number.isInteger(d.buffers[0].byteLength) ||
    d.buffers[0].byteLength! < 1 ||
    d.buffers[0].byteLength! > manifest.maxRawBytes ||
    !Array.isArray(d.bufferViews) ||
    !Array.isArray(d.accessors) ||
    !Array.isArray(d.skins) ||
    d.skins.length < 1 ||
    !d.animations?.some((a) => a.name === manifest.steeringClip && a.channels?.length)
  )
    fail();
  const names = d.nodes!.map((n) => n.name);
  if (requiredNames.some((name) => names.filter((n) => n === name).length !== 1)) fail();
  const seen = new Set<number>();
  const walk = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= d.nodes!.length || seen.has(i)) fail();
    seen.add(i);
    const n = d.nodes![i];
    if (n.mesh !== undefined && (!Number.isInteger(n.mesh) || !d.meshes![n.mesh])) fail();
    if (n.skin !== undefined && (!Number.isInteger(n.skin) || !d.skins![n.skin])) fail();
    if (n.children !== undefined && !Array.isArray(n.children)) fail();
    for (const child of n.children ?? []) walk(child);
  };
  if (!Array.isArray(d.scenes![0].nodes)) fail();
  for (const i of d.scenes![0].nodes!) walk(i);
  if (seen.size !== d.nodes!.length) fail();
  for (const view of d.bufferViews!) {
    if (
      view.buffer !== 0 ||
      !Number.isInteger(view.byteLength) ||
      view.byteLength! < 1 ||
      !Number.isInteger(view.byteOffset ?? 0) ||
      (view.byteOffset ?? 0) < 0 ||
      (view.byteOffset ?? 0) + view.byteLength! > d.buffers![0].byteLength!
    )
      fail();
  }
  for (const image of d.images!)
    if (
      image.uri !== undefined ||
      !Number.isInteger(image.bufferView) ||
      !d.bufferViews![image.bufferView!] ||
      !['image/png', 'image/jpeg'].includes(image.mimeType ?? '')
    )
      fail();
  for (const skin of d.skins!) {
    if (
      skin.joints?.length !== manifest.joints ||
      new Set(skin.joints).size !== manifest.joints ||
      skin.joints.some((i) => !Number.isInteger(i) || !d.nodes![i])
    )
      fail();
  }
  let triangles = 0;
  for (const mesh of d.meshes!) {
    if (!Array.isArray(mesh.primitives) || !mesh.primitives.length) fail();
    for (const prim of mesh.primitives!) {
      const count = d.accessors![prim.indices ?? -1]?.count;
      if (
        !Number.isInteger(count) ||
        count! < 3 ||
        count! % 3 ||
        (!prim.attributes?.POSITION && prim.attributes?.POSITION !== 0)
      )
        fail();
      triangles += count! / 3;
    }
  }
  if (triangles !== manifest.triangles) fail();
}

function release(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>(),
    skeletons = new Set<T.Skeleton>();
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        for (const v of Object.values(m)) if (v instanceof T.Texture) textures.add(v);
      }
    }
    if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => {
    t.dispose();
    if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
  });
  skeletons.forEach((s) => s.dispose());
}

export function steeringSample(steering: number, duration: number) {
  if (!Number.isFinite(steering) || !Number.isFinite(duration) || duration <= 0)
    throw new Error('Invalid supplied driver steering sample');
  // The authored clip runs from the right lock (-35 degrees, driver's left hand
  // raised) to the left lock (+35 degrees). Positive steering is a left turn.
  const normalized = clamp(
    (steering * 2.2) / T.MathUtils.degToRad(manifest.steeringDegrees),
    -1,
    1,
  );
  return (normalized + 1) * 0.5 * duration;
}

/** One owned assembly for car zero, not a replacement for every AI opponent. */
export class SuppliedPlayerAsset {
  private constructor(
    private prototype: T.Group | null,
    private clips: T.AnimationClip[],
    private lods: SuppliedPlayerLods,
  ) {}
  take(display: T.CanvasTexture) {
    if (!this.prototype)
      throw new Error('Supplied player asset has already been claimed or disposed');
    const player = new SuppliedPlayer(this.prototype, this.clips, display, this.lods);
    this.prototype = null; // RacingRenderer's normal scene disposal now owns it.
    return player;
  }
  dispose() {
    if (this.prototype) {
      this.lods.dispose();
      release(this.prototype);
    }
    this.prototype = null;
  }
  static async decode(
    input: Uint8Array<ArrayBuffer>,
    signal?: AbortSignal,
    loadLods?: () => Promise<PlayerLodData>,
  ) {
    if (signal?.aborted) throw aborted();
    let bytes = input;
    if (
      bytes.byteLength === manifest.compressedBytes &&
      (await hash(bytes)) === manifest.compressedSHA256
    )
      bytes = new Uint8Array(
        await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
        ).arrayBuffer(),
      );
    if (bytes.byteLength !== manifest.bytes || (await hash(bytes)) !== manifest.sha256)
      throw new Error('Supplied player model integrity check failed');
    if (signal?.aborted) throw aborted();
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const len = v.getUint32(12, true);
    if (
      v.getUint32(0, true) !== 0x46546c67 ||
      v.getUint32(4, true) !== 2 ||
      v.getUint32(8, true) !== bytes.length ||
      v.getUint32(16, true) !== 0x4e4f534a ||
      len > bytes.length - 28
    )
      throw new Error('Invalid supplied player GLB header');
    validateSuppliedPlayerDocument(
      JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))),
    );
    if (!loadLods) throw new Error('Missing required supplied player LOD data');
    const lodData = await loadLods();
    if (signal?.aborted) throw aborted();
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
    try {
      if (signal?.aborted) throw aborted();
      for (const name of requiredNames)
        if (!gltf.scene.getObjectByName(name))
          throw new Error(`Missing supplied player node: ${name}`);
      gltf.scene.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.castShadow = o.receiveShadow = true;
          // Known small seated envelope. Do not CPU-skin high-detail driver
          // vertices every frame just to recompute frustum bounds.
          if (o instanceof T.SkinnedMesh) o.frustumCulled = false;
        }
      });
      const lods = new SuppliedPlayerLods(
        gltf.scene,
        (mesh) => gltf.parser.associations.get(mesh),
        lodData,
      );
      return new SuppliedPlayerAsset(gltf.scene, gltf.animations, lods);
    } catch (error) {
      release(gltf.scene);
      throw error;
    }
  }
}

export class SuppliedPlayer {
  readonly wheels: T.Object3D[];
  readonly spins: T.Object3D[];
  readonly mirrors: T.Mesh[];
  readonly heads: T.Object3D[] = [];
  readonly reflectivePaint: T.MeshPhysicalMaterial[] = [];
  readonly eye: T.Vector3;
  readonly pod: T.Vector3;
  readonly steering: T.Vector3;
  readonly mixer: T.AnimationMixer;
  private readonly action: T.AnimationAction;
  private readonly front: T.Object3D;
  private readonly rear: T.Object3D;
  private readonly drsFlap: T.Object3D | null;
  private readonly rain: T.MeshStandardMaterial[] = [];
  private readonly compound: T.MeshStandardMaterial[] = [];
  private readonly wheelBlur: SuppliedWheelBlur;
  private readonly rubber: { material: T.MeshStandardMaterial; roughness: number }[] = [];
  private readonly lcd: T.Mesh;
  readonly skinBounds: SuppliedSkinBounds;
  private readonly screenPoint = new T.Vector3();
  private disposed = false;
  private heightMapsRestored = 0;
  private readonly bones = new Map<string, T.Bone>();
  constructor(
    readonly root: T.Group,
    clips: T.AnimationClip[],
    display: T.CanvasTexture,
    readonly lods?: SuppliedPlayerLods,
  ) {
    root.position.y = -PLAYER_SUSPENSION_DATUM;
    const node = (name: string) => {
      const value = root.getObjectByName(name);
      if (!value) throw new Error(`Missing supplied player node: ${name}`);
      return value;
    };
    const firstMesh = (name: string) => {
      const n = node(name);
      let mesh: T.Mesh | undefined;
      n.traverse((o) => {
        if (!mesh && o instanceof T.Mesh) mesh = o;
      });
      if (!mesh) throw new Error(`Missing supplied player surface: ${name}`);
      return mesh;
    };
    this.wheels = [0, 1, 2, 3].map((i) => node(`PLAYER_WHEEL_${i}`));
    this.spins = [0, 1, 2, 3].map((i) => node(`PLAYER_SPIN_${i}`));
    this.mirrors = [0, 1].map((i) => firstMesh(`RB19_MIRROR_${i}`));
    this.front = node('PLAYER_FRONT_WING');
    this.rear = node('PLAYER_REAR_WING');
    // DRS: the upper flap hinges near its trailing edge; the leading edge lifts.
    this.drsFlap = root.getObjectByName('PLAYER_DRS') ?? null;
    this.eye = new T.Vector3(...(manifest.sockets.eye as [number, number, number]));
    this.pod = new T.Vector3(...(manifest.sockets.pod as [number, number, number]));
    this.steering = new T.Vector3(...(manifest.sockets.steering as [number, number, number]));
    // Public sockets are in the enclosing car/chassis frame, not asset-local.
    for (const socket of [this.eye, this.pod, this.steering]) socket.add(root.position);
    this.lcd = firstMesh('PLAYER_LCD');
    // Blender/glTF UVs are already top-down; unlike the legacy procedural plane,
    // an assigned CanvasTexture must not flip them a second time.
    display.flipY = false;
    display.needsUpdate = true;
    const original = Array.isArray(this.lcd.material) ? this.lcd.material : [this.lcd.material];
    this.lcd.material = new T.MeshBasicMaterial({
      map: display,
      side: T.DoubleSide,
      toneMapped: false,
    });
    original.forEach((m) => m.dispose());
    this.lcd.geometry.computeBoundingBox();
    this.lcd.geometry.boundingBox!.getCenter(this.screenPoint);
    // A palette can be shared by multiple primitives only when all skinned
    // uses have the same skeleton. Ordinary non-skinned uses compile without it.
    const materialSkeletons = new Map<T.Material, T.Skeleton | null>();
    root.traverse((object) => {
      if (!(object instanceof T.SkinnedMesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        const previous = materialSkeletons.get(material);
        materialSkeletons.set(
          material,
          previous === undefined || previous === object.skeleton ? object.skeleton : null,
        );
      }
    });
    const seen = new Set<T.Material>();
    root.traverse((o) => {
      if (o.name.startsWith('PLAYER_HEAD')) this.heads.push(o);
      if (o instanceof T.Bone) this.bones.set(o.userData.name ?? o.name, o);
      if (o instanceof T.Mesh)
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!(m instanceof T.MeshStandardMaterial) || seen.has(m)) continue;
          seen.add(m);
          if (restoreSuppliedHeightMap(m)) this.heightMapsRestored++;
          configureSuppliedMaterial(m);
          installSuppliedShaderWork(m, materialSkeletons.get(m) ?? undefined);
          applySuppliedLookdev(m, root);
          applySuppliedCharacterLookdev(m);
          if (
            m instanceof T.MeshPhysicalMaterial &&
            (m.name.startsWith('Paint |') ||
              (m.name.startsWith('Decal |') && !m.name.includes('tyre')) ||
              m.name === 'F1CP_MAT_HelmetPaint')
          )
            this.reflectivePaint.push(m);
          if (m.name.startsWith('Tyre | compound')) this.compound.push(m);
          if (m.name.startsWith('Tyre | lightly'))
            this.rubber.push({ material: m, roughness: m.roughness });
          if (m.name.toLowerCase().includes('rain') && m.emissive.getHex() !== 0) this.rain.push(m);
        }
    });
    // D12: per-wheel tyre-art copies that smear with wheel speed.
    this.wheelBlur = installSuppliedWheelBlur(this.spins);
    for (const m of this.wheelBlur.materials.flat())
      if (m instanceof T.MeshStandardMaterial && m.name.startsWith('Tyre | compound'))
        this.compound.push(m);
    const clip = clips.find((c) => c.name === manifest.steeringClip);
    if (!clip || clip.duration <= 0) throw new Error('Missing supplied driver steering animation');
    this.mixer = new T.AnimationMixer(root);
    this.action = this.mixer.clipAction(clip);
    this.action.setLoop(T.LoopOnce, 1);
    this.action.clampWhenFinished = true;
    this.action.play();
    this.action.paused = true;
    this.action.time = steeringSample(0, clip.duration);
    this.mixer.update(0);
    root.updateMatrixWorld(true);
    this.skinBounds = new SuppliedSkinBounds(root);
  }
  /** Groups three made from multi-primitive glTF meshes (body, wings, DRS,
   * wheels, cockpit, controls, driver, head): their primitives have identity
   * placement and move only with the group (the steering clip animates
   * bones, never mesh nodes). Shadow casters may merge each one. Mirror
   * surfaces, whose visibility follows the camera, are never included. */
  shadowFrames(): T.Object3D[] {
    const frames: T.Object3D[] = [];
    const identity = new T.Matrix4();
    this.root.traverse((object) => {
      const meshes = object.children.filter((c): c is T.Mesh => c instanceof T.Mesh);
      if (
        meshes.length >= 2 &&
        meshes.length === object.children.length &&
        meshes.every((m) => !this.mirrors.includes(m) && m.matrix.equals(identity))
      )
        frames.push(object);
    });
    return frames;
  }
  headWorld(out: T.Vector3) {
    const head = this.bones.get('head');
    return head
      ? head.getWorldPosition(out)
      : this.root.localToWorld(out.copy(this.eye).sub(this.root.position));
  }
  screenWorld(out: T.Vector3) {
    out.copy(this.screenPoint);
    if (this.lcd instanceof T.SkinnedMesh) this.lcd.applyBoneTransform(0, out);
    return this.lcd.localToWorld(out);
  }
  update(a: Float32Array, b: Float32Array, o: number, t: number, cockpit: boolean) {
    this.action.time = steeringSample(
      lerp(a[o + F.STEER], b[o + F.STEER], t),
      this.action.getClip().duration,
    );
    this.mixer.update(0);
    this.heads.forEach((head) => {
      head.visible = !cockpit;
    });
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
      // Root carries the nominal datum; keep world hubs identical to physics.
      this.wheels[i].position.y = 0.05 + PLAYER_SUSPENSION_DATUM - wheelTravel(a, b, p, t);
      this.wheels[i].rotation.y = lerp(a[p + W.STEER], b[p + W.STEER], t);
      this.wheels[i].rotation.z = -lerp(a[p + W.CAMBER], b[p + W.CAMBER], t);
      this.spins[i].rotation.x = wheelPhase(a, b, o, p, t);
      this.wheelBlur.blur[i].value = wheelBlur(lerp(a[p + W.OMEGA], b[p + W.OMEGA], t));
      this.spins[i].position.x =
        (i % 2 === 0 ? -1 : 1) *
        serviceWheelOffset(b[o + F.PIT_PHASE], b[o + F.PIT_CLOCK], b[p + W.LOAD]);
    }
    this.front.visible = b[o + F.FRONT_HEALTH] > 0.08;
    this.rear.visible = b[o + F.REAR_HEALTH] > 0.08;
    this.front.scale.x = 0.35 + 0.65 * clamp(b[o + F.FRONT_HEALTH], 0, 1);
    this.front.rotation.z = (1 - b[o + F.FRONT_HEALTH]) * 0.12;
    this.rear.rotation.z = (1 - b[o + F.REAR_HEALTH]) * 0.09;
    if (this.drsFlap)
      this.drsFlap.rotation.x =
        PLAYER_DRS_OPEN * lerp(a[o + RACE_BASE + R.DRS_FLAP], b[o + RACE_BASE + R.DRS_FLAP], t);
    const style = Object.values(COMPOUNDS)[Math.round(b[o + F.COMPOUND])] ?? COMPOUNDS.medium;
    this.compound.forEach((m) => m.color.setHex(style.color));
    this.rubber.forEach(({ material, roughness }) => {
      material.roughness = roughness * (1 - 0.3 * clamp(b[H.RAIN] / 14, 0, 1));
    });
    this.rain.forEach((m) => {
      m.emissiveIntensity = rearLampIntensity(
        lerp(a[o + F.BRAKE], b[o + F.BRAKE], t),
        lerp(a[H.TIME], b[H.TIME], t),
      );
    });
    this.root.updateMatrixWorld(true);
    this.skinBounds.invalidate();
  }
  driverPose() {
    this.root.updateWorldMatrix(true, true);
    const point = (name: string) => {
      const bone = this.bones.get(name);
      return bone ? this.root.worldToLocal(bone.getWorldPosition(new T.Vector3())).toArray() : null;
    };
    return {
      // Rotation about the car's +Z (nose) axis, as the procedural wheel: a
      // left turn is negative.
      wheelRadians:
        (1 - (this.action.time / this.action.getClip().duration) * 2) *
        T.MathUtils.degToRad(manifest.steeringDegrees),
      arms: ['L', 'R'].map((side) => ({
        side,
        shoulder: point(`upper_arm.${side}`),
        elbow: point(`forearm.${side}`),
        wrist: point(`hand.${side}`),
        authoredSkin: true,
        source: manifest.revision,
      })),
    };
  }
  diagnostics() {
    return {
      loaded: !this.disposed,
      revision: manifest.revision,
      sha256: manifest.sha256,
      triangles: this.lods?.diagnostics().triangles ?? manifest.triangles,
      lod: this.lods?.diagnostics() ?? null,
      compressedBytes: manifest.compressedBytes,
      joints: manifest.joints,
      headVisible: this.heads.some((h) => h.visible),
      steeringTime: this.action.time,
      eye: this.eye.toArray(),
      pod: this.pod.toArray(),
      suspensionDatum: PLAYER_SUSPENSION_DATUM,
      heightMapsRestored: this.heightMapsRestored,
      skinBounds: this.skinBounds.diagnostics(),
      chassisWheelCenters: this.wheels.map((w) =>
        w.position.clone().add(this.root.position).toArray(),
      ),
      wheelCenters: this.wheels.map((w) => w.position.toArray()),
      finalArtApproved: false,
    };
  }
  disposeAnimation() {
    this.skinBounds.dispose();
    this.lods?.dispose();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.disposed = true;
  }
}

export async function loadSuppliedPlayer(
  cancelled: () => boolean = () => false,
  fetcher: typeof fetch = fetch,
  url?: string,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  const poll = setInterval(() => {
    if (cancelled()) controller.abort();
  }, 50);
  let asset: SuppliedPlayerAsset | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ??
        `${new URL('./models/supplied-player.glb.gz', document.baseURI).href}?v=${manifest.compressedSHA256.slice(0, 16)}`,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Unable to load supplied player model (${response.status})`);
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled() || controller.signal.aborted) throw aborted();
        size += value.byteLength;
        if (size > Math.max(manifest.bytes, manifest.compressedBytes))
          throw new Error('Supplied player download exceeds its byte budget');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const input = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      input.set(chunk, offset);
      offset += chunk.length;
    }
    asset = await SuppliedPlayerAsset.decode(input, controller.signal, () =>
      loadPlayerLods(
        new URL(
          'supplied-player-lods.bin.gz',
          url ?? new URL('./models/supplied-player.glb.gz', document.baseURI),
        ).href,
        controller.signal,
        fetcher,
      ),
    );
    if (cancelled() || controller.signal.aborted) throw aborted();
    return asset;
  } catch (error) {
    asset?.dispose();
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}
