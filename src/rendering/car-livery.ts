import {
  applyPaintFinish,
  installPaintFinish,
  installPaintFlakes,
  PAINT_FINISHES,
  type PaintFinish,
} from './paint-finish.ts';
import * as T from 'three';
import { canvasTexture } from './geometry.ts';
import type { DecalSlot, Livery } from '../storage/livery.ts';
import { LIVERIES } from '../simulation/config.ts';
import {
  BRAND_ART,
  drawMark,
  drawWordmark,
  fitHeight,
  type Brand,
  type MarkArt,
} from './studio/brand-atlas.ts';
import { chainShaderHook, injectBefore } from './studio/shader-hooks.ts';

/**
 * Team liveries (D06 vehicle-paint). Each team colour from `LIVERIES` gets a
 * dark secondary, a light accent, a paint finish, a flank pattern and fictional
 * sponsors (P19). Flank art is painted into the signed UV canvas of each sidepod;
 * nose, tub, engine cover and wings get the two-tone split, spear, chevrons and
 * wing tips from `installLiveryPattern` (object space, per-material uniforms).
 */
export type FlankPattern = 'sweep' | 'split' | 'arrow' | 'minimal';
export interface LiveryScheme {
  primary: string;
  secondary: string;
  accent: string;
  finish: PaintFinish;
  pattern: FlankPattern;
  title: Brand;
  partners: readonly [Brand, Brand];
}
const hex = (value: number) => `#${value.toString(16).padStart(6, '0')}`;
const SCHEME_DETAILS: readonly Omit<LiveryScheme, 'primary'>[] = [
  {
    secondary: '#1b1d22',
    accent: '#f4f1ea',
    finish: 'gloss',
    pattern: 'sweep',
    title: 'MERIDIAN OIL',
    partners: ['KESTREL TIME', 'AUREL BANK'],
  },
  {
    secondary: '#13294b',
    accent: '#8fd3ff',
    finish: 'gloss',
    pattern: 'arrow',
    title: 'NORTHLINE',
    partners: ['ORBITEL', 'VANTA'],
  },
  {
    secondary: '#06231e',
    accent: '#d7f25c',
    finish: 'metallic',
    pattern: 'sweep',
    title: 'HALCYON AIR',
    partners: ['NORDFIN', 'OBSIDIAN'],
  },
  {
    secondary: '#070c22',
    accent: '#f5c400',
    finish: 'metallic',
    pattern: 'split',
    title: 'ORBITEL',
    partners: ['MERIDIAN OIL', 'KESTREL TIME'],
  },
  {
    secondary: '#15233f',
    accent: '#36b4ff',
    finish: 'gloss',
    pattern: 'arrow',
    title: 'AUREL BANK',
    partners: ['HALCYON AIR', 'NORTHLINE'],
  },
  {
    secondary: '#0a1d4d',
    accent: '#ff8cc6',
    finish: 'metallic',
    pattern: 'sweep',
    title: 'VANTA',
    partners: ['ORBITEL', 'NORDFIN'],
  },
  {
    secondary: '#14287a',
    accent: '#ffffff',
    finish: 'gloss',
    pattern: 'split',
    title: 'NORDFIN',
    partners: ['KESTREL TIME', 'VANTA'],
  },
  {
    secondary: '#050607',
    accent: '#c9a227',
    finish: 'satin',
    pattern: 'arrow',
    title: 'OBSIDIAN',
    partners: ['AUREL BANK', 'MERIDIAN OIL'],
  },
  {
    secondary: '#0b3a35',
    accent: '#effaf7',
    finish: 'gloss',
    pattern: 'sweep',
    title: 'KESTREL TIME',
    partners: ['NORTHLINE', 'HALCYON AIR'],
  },
  {
    secondary: '#1c2126',
    accent: '#00d2be',
    finish: 'metallic',
    pattern: 'split',
    title: 'MERIDIAN OIL',
    partners: ['OBSIDIAN', 'ORBITEL'],
  },
  {
    secondary: '#10161a',
    accent: '#f6ffe6',
    finish: 'gloss',
    pattern: 'arrow',
    title: 'VANTA',
    partners: ['AUREL BANK', 'NORDFIN'],
  },
  {
    secondary: '#171717',
    accent: '#ffffff',
    finish: 'gloss',
    pattern: 'sweep',
    title: 'HALCYON AIR',
    partners: ['VANTA', 'KESTREL TIME'],
  },
];
/** One scheme per `LIVERIES` team colour (index = car id modulo the palette). */
export const LIVERY_SCHEMES: readonly LiveryScheme[] = Object.freeze(
  LIVERIES.map((primary, i) =>
    Object.freeze({ primary: hex(primary), ...SCHEME_DETAILS[i % SCHEME_DETAILS.length] }),
  ),
);
export function liveryScheme(id: number): LiveryScheme {
  if (!Number.isInteger(id) || id < 0) throw new Error('Invalid livery car id');
  return LIVERY_SCHEMES[id % LIVERY_SCHEMES.length];
}
/** The scheme a player's editable livery paints: its colours and pattern on the
 * team's finish, a darkened primary as secondary, and its own sponsor text. */
function playerScheme(livery: Livery, base: LiveryScheme): LiveryScheme & { sponsor: string } {
  const secondary = new T.Color(livery.primary).lerp(new T.Color('#0a0c10'), 0.72);
  return {
    ...base,
    primary: livery.primary,
    secondary: `#${secondary.getHexString()}`,
    accent: livery.accent,
    pattern:
      livery.pattern === 'split' ? 'split' : livery.pattern === 'minimal' ? 'minimal' : 'sweep',
    sponsor: livery.sponsor,
  };
}
/** Relative luminance of an sRGB colour (0..1). */
function luminance(colour: string) {
  const c = new T.Color(colour);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** The flank UV has a signed orientation on each side. Coordinates are in the
 * same rotated panel space as the original wordmark, not screen-space overlays. */
export function drawDecal(context: CanvasRenderingContext2D, decal: DecalSlot, side: number) {
  context.save();
  context.translate((side > 0 ? 0.25 : 0.75) * 1024, 440);
  context.rotate(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  context.translate(decal.x * 320, decal.y * 90);
  context.rotate((decal.rotation * Math.PI) / 180);
  context.strokeStyle = decal.color;
  const height = fitHeight(decal.text, 190 * decal.scale, 24 * decal.scale, { weight: 0.18 });
  drawWordmark(context, decal.text, 0, 0, height, { weight: 0.18 });
  context.restore();
}
const sourceCanvases = new WeakMap<T.Texture, HTMLCanvasElement>();

/**
 * Sidepod skin frame. The A61 pod (shared, unmirrored geometry at x = +-0.53)
 * maps its length to canvas y (0 at the inlet, 1024 at the rear) and its girth
 * to canvas x: outer face of the +X pod u 0.125-0.375 (bottom to top), pod top
 * u 0.375-0.625, outer face of the -X pod u 0.875-0.625 (bottom to top). Art is
 * authored in (s, h): s along the pod from the inlet, h up from the face centre
 * line (face -128..128, top 128..384), mirrored between the two sides; text is
 * turned so it reads left to right on each side. The corner below the floor
 * line (canvas x < 64 or the inner faces) keeps the base primary.
 */
class FlankFrame {
  constructor(
    readonly context: CanvasRenderingContext2D,
    readonly side: number,
  ) {}
  x(h: number) {
    return this.side > 0 ? 256 + h : 768 - h;
  }
  path(points: readonly (readonly [number, number])[]) {
    const c = this.context;
    c.beginPath();
    points.forEach(([s, h], i) => (i ? c.lineTo(this.x(h), s) : c.moveTo(this.x(h), s)));
    c.closePath();
  }
  fill(
    points: readonly (readonly [number, number])[],
    style: string | CanvasGradient | CanvasPattern | undefined,
  ) {
    this.path(points);
    if (style !== undefined) this.context.fillStyle = style;
    this.context.fill();
  }
  line(points: readonly (readonly [number, number])[], width: number, colour: string) {
    const c = this.context;
    c.beginPath();
    points.forEach(([s, h], i) => (i ? c.lineTo(this.x(h), s) : c.moveTo(this.x(h), s)));
    c.lineWidth = width;
    c.lineJoin = 'round';
    c.lineCap = 'butt';
    c.strokeStyle = colour;
    c.stroke();
  }
  /** A gradient running along the pod from s0 to s1. */
  along(s0: number, s1: number, h: number, stops: readonly [number, string][]) {
    const gradient = this.context.createLinearGradient(this.x(h), s0, this.x(h), s1);
    for (const [at, colour] of stops) gradient.addColorStop(at, colour);
    return gradient;
  }
  /** Run `draw` in a text frame centred on (s, h), reading along the pod. */
  text(s: number, h: number, draw: (context: CanvasRenderingContext2D) => void) {
    const c = this.context;
    c.save();
    if (this.side > 0) c.setTransform(0, 1, -1, 0, this.x(h), s);
    else c.setTransform(0, -1, 1, 0, this.x(h), s);
    draw(c);
    c.restore();
  }
  mark(art: MarkArt, s: number, h: number, width: number, height: number) {
    this.text(s, h, (c) => drawMark(c, art, -width / 2, -height / 2, width, height));
  }
}
/** A small 2x2 twill tile for exposed-carbon panels (two tows per 6 px). */
function carbonPattern(context: CanvasRenderingContext2D) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 12;
  const t = tile.getContext('2d');
  if (!t) return undefined;
  t.fillStyle = '#111316';
  t.fillRect(0, 0, 12, 12);
  t.fillStyle = '#23262b';
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) if ((i + j) % 4 < 2) t.fillRect(i * 3, (j * 3 + i * 3) % 12, 3, 3);
  return context.createPattern(tile, 'repeat') ?? undefined;
}
const inked = (art: MarkArt, ink: string): MarkArt => ({
  ...art,
  ink,
  accent: art.accent && art.kind === 'wordmark' ? art.accent : ink,
});

/** Paint into the original UV canvas so quality changes never restore a stale livery. */
function drawFlank(context: CanvasRenderingContext2D, side: number, id: number, livery?: Livery) {
  const size = 1024;
  const base = liveryScheme(id);
  const scheme = livery ? playerScheme(livery, base) : { ...base, sponsor: null };
  const f = new FlankFrame(context, side);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, size, size);
  context.fillStyle = scheme.primary;
  context.fillRect(0, 0, size, size);
  const { primary, secondary, accent } = scheme;
  const light = luminance(primary) > 0.5;
  const ink = light ? secondary : '#ffffff';
  const mixed = `#${new T.Color(primary).lerp(new T.Color(secondary), 0.45).getHexString()}`;
  // Pattern layer: a dark secondary field with a gradient sweep into it, and
  // a 2-3 px accent pinstripe pair along its edge.
  if (scheme.pattern === 'sweep') {
    const edge: [number, number][] = [
      [300, -180],
      [560, -60],
      [820, 70],
      [1024, 150],
    ];
    f.fill(
      [...edge, [1024, -180]],
      f.along(300, 1024, 0, [
        [0, mixed],
        [0.35, secondary],
        [1, secondary],
      ]),
    );
    f.fill(
      [
        [640, 384],
        [1024, 384],
        [1024, 150],
        [820, 70],
      ],
      f.along(640, 1024, 260, [
        [0, primary],
        [1, secondary],
      ]),
    );
    f.line(
      edge.map(([s, h]) => [s, h + 9] as [number, number]),
      5,
      accent,
    );
    f.line(
      edge.map(([s, h]) => [s, h + 20] as [number, number]),
      2.5,
      accent,
    );
  } else if (scheme.pattern === 'split') {
    f.fill(
      [
        [0, -180],
        [1024, -180],
        [1024, -18],
        [0, -18],
      ],
      f.along(0, 1024, -100, [
        [0, secondary],
        [0.6, mixed],
        [1, secondary],
      ]),
    );
    f.line(
      [
        [0, -10],
        [1024, -10],
      ],
      6,
      accent,
    );
    f.line(
      [
        [0, 4],
        [1024, 4],
      ],
      2.5,
      accent,
    );
    f.fill(
      [
        [700, 384],
        [1024, 384],
        [1024, 128],
        [860, 128],
      ],
      secondary,
    );
  } else if (scheme.pattern === 'arrow') {
    const arrow: [number, number][] = [
      [1024, 230],
      [430, 10],
      [1024, -210],
    ];
    f.fill(
      arrow,
      f.along(430, 1024, 0, [
        [0, mixed],
        [0.4, secondary],
        [1, secondary],
      ]),
    );
    f.line(arrow, 5, accent);
    f.line(
      arrow.map(([s, h]) => [s + 26, h * 0.94] as [number, number]),
      2.5,
      accent,
    );
  } else {
    f.line(
      [
        [60, -60],
        [1024, -60],
      ],
      3,
      accent,
    );
  }
  // Exposed-carbon diagonal along the lower front of the pod.
  const weave = carbonPattern(context);
  f.fill(
    [
      [90, -180],
      [600, -180],
      [600, -140],
      [90, -76],
    ],
    weave ?? '#16181b',
  );
  f.line(
    [
      [90, -74],
      [600, -138],
    ],
    3,
    accent,
  );
  // Pod top: forward chevrons in the accent.
  for (let k = 0; k < 3; k++) {
    const s = 170 + k * 46;
    f.fill(
      [
        [s, 160],
        [s + 28, 160],
        [s + 6, 256],
        [s + 28, 352],
        [s, 352],
        [s - 22, 256],
      ],
      accent,
    );
  }
  // Race number: 120 px condensed, upper front of the pod.
  const number = String(livery?.number ?? id + 7).padStart(2, '0');
  f.text(170, 34, (c) => {
    c.strokeStyle = secondary;
    drawWordmark(c, number, 0, 0, 120, { weight: 0.26, width: 0.8, tracking: 0.06 });
    c.strokeStyle = light ? secondary : '#ffffff';
    drawWordmark(c, number, 0, 0, 120, { weight: 0.17, width: 0.8, tracking: 0.06 });
  });
  // Sponsors: the title across the middle, two partners (at least three marks).
  const title: MarkArt = scheme.sponsor
    ? {
        kind: 'wordmark',
        lines: [scheme.sponsor],
        ink,
        style: { weight: 0.19, width: 1.04, slant: 0.14 },
      }
    : inked(BRAND_ART[scheme.title], ink);
  // The pod's flat flank runs from about s 100 to 750; behind that it turns
  // down and in (the coke-bottle), so every mark sits ahead of it.
  f.mark(title, 490, -6, 380, 96);
  f.mark(inked(BRAND_ART[scheme.partners[0]], ink), 690, 84, 190, 34);
  f.mark(inked(BRAND_ART[scheme.partners[1]], ink), 430, 86, 170, 30);
  context.restore();
  for (const decal of livery?.decals ?? [])
    if ((decal.side === 'left') === side > 0) drawDecal(context, decal, side);
}

/** Original marks on a UV-conforming skin, never extracted reference artwork. */
export function flankLivery(paint: T.MeshPhysicalMaterial, side: number, id: number) {
  const material = paint.clone();
  delete material.userData.aurelPaintFinish;
  installPaintFinish(material);
  const finish = (paint.userData.paintFinish as PaintFinish | undefined) ?? liveryScheme(id).finish;
  installPaintFlakes(material, PAINT_FINISHES[finish].flake, PAINT_FINISHES[finish].peel);
  material.color.set(0xffffff);
  // A CPU-backed skin. apexDiagnostics() reads a skin pixel back
  // (renderer.playerPaint) to prove a repaint reached the canvas; on an
  // accelerated canvas that getImageData waits for every GPU submission queued
  // ahead of it, so one diagnostics call during session loading on a software
  // rasterizer held the main thread (and the worker's first snapshot) ~30 s.
  // The skin is drawn once and on livery edits, then uploaded as a texture.
  material.map = canvasTexture(1024, 1024, (context) => drawFlank(context, side, id), {
    willReadFrequently: true,
  });
  sourceCanvases.set(material.map, material.map.image as HTMLCanvasElement);
  material.userData.liverySide = side;
  material.map.name = `Original APEX car ${id + 7} ${side > 0 ? 'left' : 'right'} skin`;
  material.name = 'Clear-coated UV-conforming original livery';
  return material;
}
export function repaintFlank(material: T.MeshPhysicalMaterial, id: number, livery: Livery) {
  if (!material.map) return;
  const canvas = sourceCanvases.get(material.map);
  const context = canvas?.getContext('2d');
  if (!context) return;
  drawFlank(context, material.userData.liverySide as number, id, livery);
  material.map.needsUpdate = true;
}

/** Body paint: finish, flakes and orange peel for team `id`. */
export function installTeamPaint(paint: T.MeshPhysicalMaterial, id: number) {
  const scheme = liveryScheme(id);
  applyPaintFinish(paint, scheme.finish);
  installPaintFlakes(
    paint,
    PAINT_FINISHES[scheme.finish].flake,
    PAINT_FINISHES[scheme.finish].peel,
  );
  installLiveryPattern(paint, scheme);
  return paint;
}

interface PatternUniforms {
  liverySecondary: T.IUniform<T.Color>;
  liveryAccent: T.IUniform<T.Color>;
}
const patterns = new WeakMap<T.Material, PatternUniforms>();
/** Body livery in car space (`vPaintPosition`): secondary below a split line
 * that runs low along the nose and rises along the engine cover, an accent
 * pinstripe on it, an accent spear down the nose, three chevrons on the engine
 * cover, accent front-wing tips and two-tone rear endplates. Filtered edges. */
const LIVERY_PATTERN_GLSL = `{
  vec3 lp = vPaintPosition;
  vec3 lpw = fwidth(lp) + 1e-5;
  float rearWing = step(lp.z, -1.74) * max(step(0.3, lp.y), step(0.35, abs(lp.x)));
  float frontWing = step(2.22, lp.z);
  float body = (1.0 - smoothstep(0.345, 0.36, abs(lp.x))) * (1.0 - rearWing) * (1.0 - frontWing);
  float split = mix(mix(-0.02, 0.4, smoothstep(-0.55, -1.95, lp.z)),
    mix(-0.035, -0.13, smoothstep(0.6, 2.3, lp.z)), smoothstep(-0.7, -0.3, lp.z));
  float lower = body * smoothstep(split + lpw.y, split - lpw.y, lp.y);
  float pin = body * (1.0 - smoothstep(0.004, 0.004 + lpw.y, abs(lp.y - split - 0.012)));
  float spearHalf = mix(0.075, 0.012, smoothstep(0.7, 2.2, lp.z));
  float spear = body * step(0.45, lp.z) * smoothstep(split + 0.03, split + 0.03 + lpw.y, lp.y) *
    (1.0 - smoothstep(spearHalf, spearHalf + lpw.x, abs(lp.x)));
  float chevron = (lp.z + 1.3 * abs(lp.x) + 0.78) / 0.12;
  float chevronW = fwidth(chevron) + 1e-4;
  float chevronF = fract(chevron);
  float chevrons = body * step(0.0, chevron) * step(chevron, 3.0) *
    smoothstep(split + 0.05, split + 0.05 + lpw.y, lp.y) *
    smoothstep(0.0, chevronW, chevronF) * (1.0 - smoothstep(0.4, 0.4 + chevronW, chevronF));
  float wingTip = frontWing * smoothstep(0.9, 0.9 + lpw.x, abs(lp.x));
  float plate = rearWing * smoothstep(0.74, 0.74 + lpw.x, abs(lp.x));
  float plateLow = plate * smoothstep(0.43 + lpw.y, 0.43 - lpw.y, lp.y);
  float platePin = plate * (1.0 - smoothstep(0.005, 0.005 + lpw.y, abs(lp.y - 0.445)));
  diffuseColor.rgb = mix(diffuseColor.rgb, liverySecondary, clamp(lower + plateLow, 0.0, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, liveryAccent, clamp(pin + spear + chevrons + wingTip + platePin, 0.0, 1.0));
}`;
/** Install the body livery on `material` with its own colour uniforms (the
 * zero-uniform pigment finish is untouched). Returns false when already present. */
export function installLiveryPattern(
  material: T.MeshPhysicalMaterial,
  colours: { secondary: string; accent: string },
) {
  installPaintFinish(material);
  let uniforms = patterns.get(material);
  if (!uniforms) {
    uniforms = {
      liverySecondary: { value: new T.Color() },
      liveryAccent: { value: new T.Color() },
    };
    patterns.set(material, uniforms);
  }
  setLiveryPattern(material, colours);
  const own = uniforms;
  return chainShaderHook(material, 'livery-pattern-v1', (shader) => {
    shader.uniforms.liverySecondary = own.liverySecondary;
    shader.uniforms.liveryAccent = own.liveryAccent;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform vec3 liverySecondary;\nuniform vec3 liveryAccent;',
    );
    injectBefore(shader, 'map_fragment', LIVERY_PATTERN_GLSL, 'fragment');
  });
}
/** Recolour an installed body livery (sRGB CSS colours). */
export function setLiveryPattern(
  material: T.Material,
  colours: { secondary: string; accent: string },
) {
  const uniforms = patterns.get(material);
  if (!uniforms) return false;
  uniforms.liverySecondary.value.set(colours.secondary);
  uniforms.liveryAccent.value.set(colours.accent);
  return true;
}
/** The secondary a player livery derives from its primary. */
export function playerSecondary(primary: string) {
  return `#${new T.Color(primary).lerp(new T.Color('#0a0c10'), 0.72).getHexString()}`;
}
