import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '../core/math.ts';
import { chainShaderHook, injectAfter } from './studio/shader-hooks.ts';
import { useStudioUniforms } from './studio/studio-frame.ts';

/**
 * Canopy volume for the authored A51-A54 hero trees.
 *
 * The exported crowns are ~90 crossed spray cards per tree. Lit with their own
 * card normals they read as flat fronds up close. Three changes make the crown
 * read as one rounded, self-shadowed mass of leaves (the Speedtree/UE5 recipe):
 *
 *  - crown normals: every leaf vertex's normal is bent toward the outward
 *    normal of an ellipsoid fitted to its tier's crown (`CANOPY_VOLUME.bend`),
 *    so sun and sky shade the crown as a volume with a soft terminator;
 *  - crown occlusion and clumping (baked per vertex, `canopy` = ao, edge,
 *    clump): the interior and underside see less sky, the thin rim transmits
 *    sunlight from behind, and low-frequency clumps shift hue and value so a
 *    crown is never one flat green;
 *  - an original leaf-cluster atlas (`canopyLeafAtlas`): each spray tile is
 *    redrawn as overlapping, individually shaded broadleaf / poplar / olive
 *    leaves on twigs, with a matching per-leaf normal atlas (folded blades at
 *    random tilts) so highlights break up leaf by leaf.
 *
 * Everything is baked at load. The per-fragment cost is one normal-map tap and
 * a handful of ALU ops; no extra geometry or draw.
 */
export const CANOPY_VOLUME = Object.freeze({
  /** Share of the crown ellipsoid normal in the shading normal. */
  bend: 0.8,
  /** Sky visibility at the crown centre (1 at the rim). */
  aoFloor: 0.34,
  /** Share of the occlusion that also darkens the albedo (direct light). */
  aoAlbedo: 0.45,
  /** Sunlight scattered through thin rim leaves on the crown's shadow side. */
  backScatter: 0.24,
  /** Sky light filtered through the canopy (linear RGB gain). */
  skyFilter: Object.freeze([0.74, 0.84, 0.6] as const),
  /** Clump hue/value variation. */
  clump: 0.55,
  /** Leaf blade roughness with the per-leaf normal atlas. */
  roughness: 0.72,
  /** Tiers (from LOD0) that carry the inner crown shell. */
  shellLevels: 2,
  /** Inner shell: turn about the stem (radians) and radial / vertical scale. */
  shell: Object.freeze({ turn: 2.39996, radial: 0.66, vertical: 0.9 }),
});

/**
 * The near tier's crown plus an inner shell: the same leaf cards turned by the
 * golden angle and drawn in toward the stem about the crown's centre. The
 * exported crowns are a single layer of cards around an empty core; real
 * crowns are leaf mass all the way in. The shell sits behind the outer cards
 * (so it is lit by the occlusion bake as interior foliage) and closes the gaps
 * that read as cards. Same material, same draw; leaf triangles double on the
 * near and middle tiers (LOD0, LOD1).
 */
export function withCanopyShell(geometry: T.BufferGeometry) {
  if (geometry.index) throw new Error('Canopy shell expects a non-indexed stream');
  geometry.computeBoundingBox();
  const centre = geometry.boundingBox!.getCenter(new T.Vector3()),
    { turn, radial, vertical } = CANOPY_VOLUME.shell;
  const inner = geometry.clone();
  inner.applyMatrix4(
    new T.Matrix4()
      .makeTranslation(0, centre.y, 0)
      .multiply(new T.Matrix4().makeScale(radial, vertical, radial))
      .multiply(new T.Matrix4().makeRotationY(turn))
      .multiply(new T.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z))
      .premultiply(new T.Matrix4().makeTranslation(centre.x, 0, centre.z)),
  );
  const merged = mergeGeometries([geometry, inner], false);
  inner.dispose();
  if (!merged) throw new Error('Unable to add the canopy shell');
  return merged;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function hash3(x: number, y: number, z: number, seed: number) {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^
    Math.imul(y | 0, 0x165667b1) ^
    Math.imul(z | 0, 0x9e3779b1) ^
    Math.imul(seed | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
/** Smooth 3D value noise, 0..1. */
export function canopyNoise(x: number, y: number, z: number, seed = 0) {
  const i = Math.floor(x),
    j = Math.floor(y),
    k = Math.floor(z),
    fx = x - i,
    fy = y - j,
    fz = z - k,
    u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy),
    w = fz * fz * (3 - 2 * fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (a: number, b: number, d: number) => hash3(i + a, j + b, k + d, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

export interface CanopyRange {
  start: number;
  count: number;
}
/**
 * Bake crown normals and the `ao, edge, clump` attribute for one non-indexed
 * leaf stream. Each LOD range gets its own crown ellipsoid (the tiers have
 * different card sets but the same crown). Normals are rewritten in place;
 * returns the canopy attribute array (3 floats per vertex).
 */
export function bakeCanopyVolume(
  position: T.BufferAttribute | T.InterleavedBufferAttribute,
  normal: T.BufferAttribute | T.InterleavedBufferAttribute,
  ranges: readonly CanopyRange[],
  seed = 0,
) {
  if (position.count !== normal.count) throw new Error('Canopy streams differ in length');
  const canopy = new Float32Array(position.count * 3),
    p = new T.Vector3(),
    n = new T.Vector3(),
    crown = new T.Vector3(),
    centre = new T.Vector3(),
    radius = new T.Vector3(),
    box = new T.Box3();
  for (const range of ranges) {
    if (range.start < 0 || range.start + range.count > position.count)
      throw new Error('Canopy range outside its stream');
    box.makeEmpty();
    for (let i = range.start; i < range.start + range.count; i++)
      box.expandByPoint(p.fromBufferAttribute(position, i));
    if (box.isEmpty()) continue;
    box.getCenter(centre);
    // The card corners reach past the leaf mass: fit the ellipsoid slightly
    // inside the card envelope so the visible rim sits at |d| ~ 1.
    box
      .getSize(radius)
      .multiplyScalar(0.5 * 0.88)
      .max(new T.Vector3(1e-3, 1e-3, 1e-3));
    // Crowns sit on a clear stem: the volume centre is a little above the box
    // centre (more foliage mass high up), its base a little flattened.
    centre.y += radius.y * 0.08;
    for (let i = range.start; i < range.start + range.count; i++) {
      p.fromBufferAttribute(position, i);
      const dx = (p.x - centre.x) / radius.x,
        dy = (p.y - centre.y) / radius.y,
        dz = (p.z - centre.z) / radius.z,
        rho = Math.sqrt(dx * dx + dy * dy + dz * dz);
      crown.set(dx / radius.x, dy / radius.y, dz / radius.z);
      if (crown.lengthSq() < 1e-10) crown.set(0, 1, 0);
      crown.normalize();
      n.fromBufferAttribute(normal, i);
      if (n.lengthSq() < 1e-10) n.copy(crown);
      n.normalize();
      // A double-sided card's stored normal may face into the crown.
      if (n.dot(crown) < 0) n.negate();
      n.multiplyScalar(1 - CANOPY_VOLUME.bend).addScaledVector(crown, CANOPY_VOLUME.bend);
      n.normalize();
      normal.setXYZ(i, n.x, n.y, n.z);
      const ao =
        (CANOPY_VOLUME.aoFloor + (1 - CANOPY_VOLUME.aoFloor) * smooth(0.12, 1.02, rho)) *
        (0.74 + 0.26 * smooth(-0.95, 0.45, dy));
      const edge = smooth(0.5, 1.05, rho);
      // Clumps about a fifth of the crown across, independent per variant.
      const clump =
        canopyNoise(p.x * 9 + 11.3, p.y * 7 + 3.1, p.z * 9 - 5.7, seed) * 1.4 +
        canopyNoise(p.x * 23, p.y * 19, p.z * 23, seed + 7) * 0.6 -
        1;
      canopy[i * 3] = ao;
      canopy[i * 3 + 1] = edge;
      canopy[i * 3 + 2] = Math.max(-1, Math.min(1, clump));
    }
  }
  normal.needsUpdate = true;
  return canopy;
}

const VERTEX = /* glsl */ `
attribute vec3 canopy;
#ifdef USE_INSTANCING
attribute vec3 treeCanopy;
#endif
varying vec3 vCanopy;`;
const VARY = /* glsl */ `
vCanopy = canopy;
#ifdef USE_INSTANCING
vCanopy = mix( canopy, treeCanopy, treeVariant );
#endif`;
const ALBEDO = /* glsl */ `{
	// Crown clumps: warm, sunlit yellow-green or cool blue-green, never one green.
	float clump = vCanopy.z * ${CANOPY_VOLUME.clump.toFixed(3)};
	diffuseColor.rgb *= clump > 0.0
		? mix( vec3( 1.0 ), vec3( 1.16, 1.08, 0.74 ), clump )
		: mix( vec3( 1.0 ), vec3( 0.78, 0.92, 1.0 ), - clump );
	diffuseColor.rgb *= mix( 1.0, vCanopy.x, ${CANOPY_VOLUME.aoAlbedo.toFixed(3)} );
}`;
const LIGHT = /* glsl */ `{
	// Crown occlusion on sky light: the interior and underside see little sky.
	// Sky light reaching a leaf has mostly passed through or bounced off other
	// leaves: the canopy filters its blue (multiple scattering), and the
	// neighbouring crowns hide part of the sky even on the rim.
	reflectedLight.indirectDiffuse *= vCanopy.x * vec3( ${CANOPY_VOLUME.skyFilter.map((v) => v.toFixed(3)).join(', ')} );
	reflectedLight.indirectSpecular *= vCanopy.x * vCanopy.x;
	#if NUM_DIR_LIGHTS > 0
	// Thin rim leaves on the side away from the sun glow with transmitted light.
	vec3 canopySun = normalize( ( viewMatrix * vec4( studioSunDir, 0.0 ) ).xyz );
	float canopyBack = saturate( - dot( normal, canopySun ) );
	reflectedLight.directDiffuse += ${CANOPY_VOLUME.backScatter.toFixed(3)} * canopyBack * vCanopy.y * vCanopy.y * diffuseColor.rgb * directionalLights[ 0 ].color;
	#endif
}`;
export const CANOPY_VOLUME_HOOK = 'canopy-volume-v1';
/** Crown occlusion, clumping and rim back-scatter on the A51-A54 leaf material.
 * Requires the `canopy` (and, instanced, `treeCanopy` + `treeVariant`) streams. */
export function installCanopyVolume(material: T.Material) {
  return chainShaderHook(material, CANOPY_VOLUME_HOOK, (shader) => {
    useStudioUniforms(shader, ['studioSunDir'], 'fragment');
    injectAfter(shader, 'common', VERTEX, 'vertex');
    injectAfter(shader, 'begin_vertex', VARY, 'vertex');
    injectAfter(shader, 'common', 'varying vec3 vCanopy;', 'fragment');
    injectAfter(shader, 'color_fragment', ALBEDO, 'fragment');
    injectAfter(shader, 'lights_fragment_end', LIGHT, 'fragment');
  });
}

/** Leaf species drawn into each atlas tile (glTF image space, v down). */
interface Species {
  /** Tile column/row in the 2x2 atlas. */
  tile: readonly [number, number];
  /** Leaf blade length range (tile units of 512) and width/length. */
  length: readonly [number, number];
  aspect: number;
  /** HSL base (h degrees, s, l) and lightness spread. */
  hsl: readonly [number, number, number];
  spread: number;
  /** Envelope half width (tile units), leaves per twig node, twig spacing. */
  width: number;
  cluster: number;
  spacing: number;
  /** Silvery underside share (olive), 0 for none. */
  silver: number;
}
const SPECIES: readonly Species[] = [
  // broadleaf-young: fresh mid-green, plane/lime-like blades.
  {
    tile: [0, 0],
    length: [20, 30],
    aspect: 0.56,
    hsl: [92, 0.42, 0.3],
    spread: 0.11,
    width: 150,
    cluster: 5,
    spacing: 26,
    silver: 0,
  },
  // columnar (poplar/cypress silhouettes): small, dense, darker leaves.
  {
    tile: [1, 0],
    length: [13, 19],
    aspect: 0.62,
    hsl: [104, 0.36, 0.22],
    spread: 0.09,
    width: 128,
    cluster: 6,
    spacing: 20,
    silver: 0,
  },
  // orchard (olive): narrow grey-green blades with silvery undersides.
  {
    tile: [0, 1],
    length: [24, 34],
    aspect: 0.24,
    hsl: [80, 0.2, 0.33],
    spread: 0.1,
    width: 150,
    cluster: 6,
    spacing: 22,
    silver: 0.2,
  },
  // broadleaf-mature: larger, deep summer green.
  {
    tile: [1, 1],
    length: [24, 34],
    aspect: 0.58,
    hsl: [98, 0.38, 0.24],
    spread: 0.11,
    width: 160,
    cluster: 5,
    spacing: 28,
    silver: 0,
  },
];
interface Leaf {
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  light: number;
  hue: number;
  tilt: readonly [number, number];
  silver: boolean;
  depth: number;
}
function leafPath(context: CanvasRenderingContext2D, leaf: Leaf, half: -1 | 0 | 1) {
  // Ovate blade along +x from the petiole, pointed tip; one half or both.
  const l = leaf.length,
    w = leaf.width / 2;
  context.save();
  context.translate(leaf.x, leaf.y);
  context.rotate(leaf.angle);
  context.beginPath();
  context.moveTo(0, 0);
  if (half <= 0) {
    context.bezierCurveTo(l * 0.18, -w * 1.15, l * 0.62, -w * 1.05, l, 0);
  } else context.lineTo(l, 0);
  if (half >= 0) context.bezierCurveTo(l * 0.62, w * 1.05, l * 0.18, w * 1.15, 0, 0);
  else context.lineTo(0, 0);
  context.closePath();
  context.restore();
}
const hsl = (h: number, s: number, l: number) =>
  `hsl(${h.toFixed(1)},${(Math.max(0, Math.min(1, s)) * 100).toFixed(1)}%,${(Math.max(0.02, Math.min(0.92, l)) * 100).toFixed(1)}%)`;
function encodeNormal(x: number, y: number) {
  const z = Math.sqrt(Math.max(0.05, 1 - x * x - y * y)),
    k = 1 / Math.hypot(x, y, z);
  return `rgb(${Math.round((x * k * 0.5 + 0.5) * 255)},${Math.round((-y * k * 0.5 + 0.5) * 255)},${Math.round((z * k * 0.5 + 0.5) * 255)})`;
}
function drawSpray(
  color: CanvasRenderingContext2D,
  normal: CanvasRenderingContext2D,
  species: Species,
  random: Random,
) {
  const unit = 512,
    baseY = 504,
    topY = 22,
    axis = 256;
  const envelope = (y: number) => {
    const t = Math.min(1, Math.max(0, (baseY - y) / (baseY - topY)));
    // Spray widest a little above mid-height, a short bare petiole at its base.
    return (
      species.width *
      Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.04)), 0.75) *
      smooth(0.0, 0.16, t)
    );
  };
  const stemX = (y: number) => axis + Math.sin((baseY - y) * 0.012) * 6;
  const leaves: Leaf[] = [];
  const twigs: [number, number, number, number, number][] = [];
  const addLeaf = (x: number, y: number, angle: number, scale: number, depth: number) => {
    const [h, s, l] = species.hsl;
    const length =
      (species.length[0] + random.next() * (species.length[1] - species.length[0])) * scale;
    const outward = Math.min(1, Math.abs(x - axis) / (species.width + 1));
    const height = (baseY - y) / (baseY - topY);
    const facing = random.next() * 2 - 1;
    leaves.push({
      x,
      y,
      angle,
      length,
      width: length * species.aspect * (0.85 + random.next() * 0.3),
      light:
        l + species.spread * (0.55 * facing + 0.55 * outward + 0.35 * height + 0.6 * depth - 0.7),
      hue: h + (random.next() - 0.5) * 14,
      tilt: [(random.next() - 0.5) * 0.7, (random.next() - 0.5) * 0.7],
      silver: random.next() < species.silver,
      depth,
    });
    void s;
  };
  // Alternate twigs climbing the stem; leaves at nodes and a terminal cluster.
  let side = random.next() < 0.5 ? -1 : 1;
  for (let y = baseY - 70; y > topY + 10; y -= species.spacing * (0.75 + random.next() * 0.5)) {
    side = -side;
    const reach = envelope(y) * (0.75 + random.next() * 0.35);
    if (reach < 12) continue;
    const rise = 0.45 + random.next() * 0.55,
      x0 = stemX(y),
      x1 = x0 + side * reach * Math.cos(rise * 0.6),
      y1 = y - reach * Math.sin(rise * 0.7);
    twigs.push([x0, y, x1, y1, side]);
    const nodes = Math.max(2, Math.round(reach / 16));
    for (let k = 1; k <= nodes; k++) {
      const t = k / nodes,
        nx = x0 + (x1 - x0) * t,
        ny = y + (y1 - y) * t - Math.sin(t * Math.PI) * 6,
        base = Math.atan2(y1 - y, x1 - x0);
      const count = k === nodes ? species.cluster + 2 : species.cluster;
      for (let c = 0; c < count; c++) {
        const spreadAngle = (c / Math.max(1, count - 1) - 0.5) * (k === nodes ? 2.8 : 2.2),
          angle = base + spreadAngle + (random.next() - 0.5) * 0.6;
        addLeaf(nx, ny, angle, 0.85 + 0.25 * t, 0.25 + 0.75 * t * random.next());
      }
    }
  }
  // A backdrop of deeper, shaded leaves fills the spray between its twigs, so
  // a card reads as a clump with depth rather than a pressed frond.
  const filler = Math.round(
    (species.width * (baseY - topY)) / (species.length[1] * species.length[1] * 0.55),
  );
  for (let i = 0; i < filler; i++) {
    const y = topY + 20 + random.next() * (baseY - topY - 110),
      reach = envelope(y) * 0.92,
      x = stemX(y) + (random.next() * 2 - 1) * reach;
    addLeaf(x, y, random.next() * Math.PI * 2, 0.9 + random.next() * 0.2, random.next() * 0.22);
  }
  // Leaves crowding the main stem and its tip.
  for (let y = baseY - 90; y > topY; y -= 9) {
    for (const s of [-1, 1]) {
      if (random.next() < 0.35) continue;
      const angle = -Math.PI / 2 + s * (0.5 + random.next() * 0.9);
      addLeaf(stemX(y), y, angle, 0.9, random.next() * 0.6);
    }
  }
  for (let c = 0; c < species.cluster + 3; c++)
    addLeaf(stemX(topY + 8), topY + 8, -Math.PI / 2 + (random.next() - 0.5) * 2.4, 1, 1);
  // Woody structure first; the leaves overlap it, deepest first.
  color.lineCap = 'round';
  color.strokeStyle = '#4a3f2c';
  color.lineWidth = 4;
  color.beginPath();
  color.moveTo(stemX(baseY + 8), baseY + 8);
  for (let y = baseY; y >= topY + 4; y -= 8) color.lineTo(stemX(y), y);
  color.stroke();
  color.lineWidth = 2.2;
  for (const [x0, y0, x1, y1] of twigs) {
    color.beginPath();
    color.moveTo(x0, y0);
    color.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - 8, x1, y1);
    color.stroke();
  }
  normal.fillStyle = encodeNormal(0, 0);
  normal.fillRect(0, 0, unit, unit);
  leaves.sort((a, b) => a.depth - b.depth);
  for (const leaf of leaves) {
    const [, s] = species.hsl,
      fold = 0.32;
    // Each blade is folded along its midrib: two halves, one turned to the light.
    for (const half of [-1, 1] as const) {
      const lift = half < 0 ? 0.035 : -0.03,
        silvered = leaf.silver && half > 0;
      color.fillStyle = hsl(
        leaf.hue + (silvered ? -18 : 0),
        s * (silvered ? 0.45 : 1) * (0.9 + leaf.depth * 0.2),
        leaf.light + lift + (silvered ? 0.07 : 0),
      );
      leafPath(color, leaf, half);
      color.fill();
      const px = -Math.sin(leaf.angle) * half * fold,
        py = Math.cos(leaf.angle) * half * fold;
      normal.fillStyle = encodeNormal(leaf.tilt[0] + px, leaf.tilt[1] + py);
      leafPath(normal, leaf, half);
      normal.fill();
    }
    // A pale midrib.
    color.strokeStyle = hsl(leaf.hue, s * 0.6, leaf.light + 0.1);
    color.lineWidth = 0.8;
    color.save();
    color.translate(leaf.x, leaf.y);
    color.rotate(leaf.angle);
    color.beginPath();
    color.moveTo(1, 0);
    color.lineTo(leaf.length * 0.86, 0);
    color.stroke();
    color.restore();
  }
}
/**
 * The original 2x2 leaf-cluster atlas in glTF image space (row 0 at the top,
 * matching the A51-A54 UVs: each card maps one whole tile, its petiole at the
 * bottom centre). Deterministic. Returns null without a DOM (unit tests).
 */
export function canopyLeafAtlas(size = 1024) {
  if (typeof document === 'undefined') return null;
  const make = () => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canopy atlas requires Canvas 2D');
    return { canvas, context };
  };
  const color = make(),
    normal = make();
  const tile = size / 2,
    gutter = (8 / 1024) * size;
  for (const species of SPECIES) {
    const random = new Random(0x51a5 + species.tile[0] * 977 + species.tile[1] * 4111);
    for (const target of [color.context, normal.context]) {
      target.save();
      target.translate(species.tile[0] * tile + gutter, species.tile[1] * tile + gutter);
      target.scale((tile - 2 * gutter) / 512, (tile - 2 * gutter) / 512);
      target.beginPath();
      target.rect(0, 0, 512, 512);
      target.clip();
    }
    drawSpray(color.context, normal.context, species, random);
    color.context.restore();
    normal.context.restore();
  }
  return { color: color.canvas, normal: normal.canvas };
}
