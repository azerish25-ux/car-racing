import * as T from 'three';
import { carvedGroundHeight } from '../../simulation/open-world/ground-height.ts';
import {
  insideFootprint,
  StructureGrid,
  type Structure,
} from '../../simulation/open-world/placement.ts';
import { trackPoint } from '../../simulation/track.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import type { QualityPreset } from '../options.ts';
import {
  isApartment,
  LOT,
  SKIN,
  visualStructure,
  type ArchitecturePlan,
} from './japan-architecture.ts';
import { LedScreens } from './led-screens.ts';

/** Japanese street signage of the festival towns, all original: generic
 * words (ラーメン, 居酒屋, 薬, 営業中, 駐車場, ...) and invented shop names on
 * one runtime-painted canvas atlas. Projecting vertical signs (0.6-0.9 m
 * wide, 2.4-8 m tall, >= 3.4 m above the pavement, projecting <= 0.95 m
 * into the 1.2 m town setback), rooftop and wall billboards, beverage
 * vending machines (1.0 x 1.83 x 0.75 m), nobori banners (0.45 x 1.7 m),
 * paper lanterns, noren curtains and two original convenience-store chains
 * with pole signs and a striped forecourt. Measured from refs 014, 030,
 * 038, 066, 069, 080-083, 086. Geometry merges into 512 m (large) and
 * 256 m (street-level) chunks sharing a single material; every base height
 * comes from the carved ground. Nothing here is a collider. */

const S = 2048;
const FONT =
  '"Noto Sans JP","Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","Meiryo","IPAGothic","WenQuanYi Zen Hei",sans-serif';
type Rect = readonly [number, number, number, number];
interface Vertical {
  text: string;
  bg: string;
  fg: string;
  /** Dark face with luminous letters (neon tube) instead of a lit box. */
  neon?: boolean;
  sub?: string;
}
/** 32 projecting signs: generic trades and invented names. */
const VERTICAL: readonly Vertical[] = [
  { text: 'ラーメン', bg: '#d42a1e', fg: '#ffffff' },
  { text: '居酒屋', bg: '#140d0b', fg: '#ff8a1e', neon: true },
  { text: '薬', bg: '#f7d117', fg: '#d01c1c', sub: 'くすり' },
  { text: 'カラオケ', bg: '#e0218a', fg: '#ffffff' },
  { text: '喫茶', bg: '#2f5a3a', fg: '#f4ead2', sub: 'COFFEE' },
  { text: '不動産', bg: '#f4f4ef', fg: '#1d2b6b' },
  { text: '焼肉', bg: '#0e0b0b', fg: '#ff3b2f', neon: true },
  { text: '寿司', bg: '#f6f3ea', fg: '#151515', sub: 'すし' },
  { text: '歯科', bg: '#bfe3f2', fg: '#163f78' },
  { text: '美容室', bg: '#f08bb4', fg: '#ffffff' },
  { text: '書店', bg: '#1f2f63', fg: '#ffffff' },
  { text: '酒', bg: '#6d1a16', fg: '#f0c95a', sub: 'さけ' },
  { text: 'うどん', bg: '#ffffff', fg: '#c81d1d' },
  { text: '餃子', bg: '#ffd400', fg: '#141414' },
  { text: 'ゲーム', bg: '#06090f', fg: '#2fe6ff', neon: true },
  { text: 'タイヤ', bg: '#ff7a00', fg: '#111111' },
  { text: '整備', bg: '#1f4fa3', fg: '#ffffff', sub: '車検' },
  { text: '中古車', bg: '#d81f26', fg: '#ffe23a' },
  { text: '古着', bg: '#0b070f', fg: '#c45bff', neon: true },
  { text: 'バー', bg: '#0b0709', fg: '#ff4fb0', neon: true },
  { text: 'まるや', bg: '#ffffff', fg: '#e3001b', sub: '電器' },
  { text: '龍軒', bg: '#a3161a', fg: '#fff2c4', sub: 'らーめん' },
  { text: '花月', bg: '#f3e6d0', fg: '#3a2a1d', sub: '和食' },
  { text: '大吉', bg: '#0b0a08', fg: '#ffd23a', neon: true },
  { text: 'たばこ', bg: '#ffffff', fg: '#d0121b' },
  { text: '営業中', bg: '#d81f26', fg: '#ffffff' },
  { text: '鈴の屋', bg: '#2b4b8f', fg: '#ffffff', sub: '甘味' },
  { text: 'みなと', bg: '#0a0c10', fg: '#3dff8c', neon: true },
  { text: '定食', bg: '#ffffff', fg: '#202020', sub: '港屋' },
  { text: '鮮魚', bg: '#1b5fae', fg: '#ffffff', sub: '浜市場' },
  { text: '眼鏡', bg: '#e8eef3', fg: '#1b3f8a' },
  { text: '麻雀', bg: '#0d4d2f', fg: '#ffffff' },
];
/** Stacked tenant boards (several small lit signs on one frame). */
const STACKS: readonly (readonly [string, string, string])[][] = [
  [
    ['スナック', '#ff4fb0', '#ffffff'],
    ['2F 喫茶', '#2f5a3a', '#ffffff'],
    ['3F 整体', '#ffffff', '#1d4b8f'],
    ['4F バー', '#140d0b', '#ffd23a'],
  ],
  [
    ['歯科', '#bfe3f2', '#163f78'],
    ['塾', '#ffd400', '#141414'],
    ['英会話', '#e3001b', '#ffffff'],
    ['不動産', '#ffffff', '#1d2b6b'],
  ],
  [
    ['焼鳥', '#a3161a', '#ffffff'],
    ['寿司', '#f6f3ea', '#151515'],
    ['カラオケ', '#e0218a', '#ffffff'],
    ['雀荘', '#0d4d2f', '#ffffff'],
  ],
  [
    ['美容室', '#f08bb4', '#ffffff'],
    ['ネイル', '#ffffff', '#c2185b'],
    ['整骨院', '#1b5fae', '#ffffff'],
    ['税理士', '#e8eef3', '#1b3f8a'],
  ],
];
// Six 512 x 256 ad faces fill the atlas band beside the stacked boards.
const BILLBOARDS = 6;
const VENDING = ['#c8161d', '#1b4fa0', '#f2f2ee', '#1f7a43'];
const NOBORI: readonly (readonly [string, string, string])[] = [
  ['営業中', '#d81f26', '#ffffff'],
  ['ラーメン', '#c81d1d', '#ffe23a'],
  ['生ビール', '#1b4fa0', '#ffffff'],
  ['からあげ', '#ffd400', '#c81d1d'],
  ['祭', '#f2f2ee', '#c81d1d'],
  ['大売出し', '#e3001b', '#ffffff'],
];
/** Tenant boxes stacked into columns, one tenant per floor (ref 014):
 * generic trades only. */
const TENANTS: readonly string[] = [
  '喫茶',
  'バー',
  'スナック',
  '麻雀',
  '整体',
  '歯科',
  '塾',
  '英会話',
  '寿司',
  '焼鳥',
  'カラオケ',
  'ネイル',
  '美容室',
  '不動産',
  '占い',
  '居酒屋',
  '中華',
  '焼肉',
  '餃子',
  'そば',
  'うどん',
  '天ぷら',
  'ラーメン',
  'カフェ',
  'パブ',
  '漫画',
  'ゲーム',
  '古着',
  '靴',
  '時計',
  '眼鏡',
  '薬',
  '医院',
  '内科',
  '眼科',
  '整骨院',
  '司法書士',
  '税理士',
  '保険',
  '旅行',
  '写真',
  '花',
  '酒',
  'パン',
  'ケーキ',
  '和菓子',
  '茶',
  '書道',
  'ヨガ',
  'ジム',
  'ダンス',
  '囲碁',
  '将棋',
  '金券',
  '質',
  '両替',
  '携帯',
  '電器',
  'ホテル',
  'サウナ',
  '銭湯',
  '鍵',
  '釣具',
  '模型',
];
const TENANT_COLORS: readonly (readonly [string, string])[] = [
  ['#d42a1e', '#ffffff'],
  ['#f7d117', '#141414'],
  ['#ffffff', '#d0121b'],
  ['#141414', '#ffd23a'],
  ['#1b4fa0', '#ffffff'],
  ['#1f7a43', '#ffffff'],
  ['#e0218a', '#ffffff'],
  ['#ff7a00', '#111111'],
  ['#6a2fa0', '#ffffff'],
  ['#18b0c8', '#ffffff'],
  ['#f2f2ee', '#1d2b6b'],
  ['#0b0a08', '#3dff8c'],
];
const NOREN = [
  ['そば', '#21305e'],
  ['酒', '#2a2a2a'],
  ['ゆ', '#7a1f2a'],
  ['茶', '#2f4a32'],
] as const;
/** Two original convenience-store chains: violet/lime and navy/amber. */
export const KONBINI_CHAINS = [
  { name: 'そよかぜ', latin: 'SOYOKAZE MART', main: '#5b3aa8', accent: '#8fcf3a' },
  { name: 'ほしぞら', latin: 'HOSHIZORA 24', main: '#1f3b7a', accent: '#f2a019' },
] as const;

/** Atlas layout in pixels (x, y, w, h); y down. */
const LAYOUT = {
  vertical: (i: number): Rect => [(i % 16) * 128, Math.floor(i / 16) * 512, 128, 512],
  stack: (i: number): Rect => [i * 128, 1024, 128, 512],
  billboard: (i: number): Rect => [512 + (i % 3) * 512, 1024 + Math.floor(i / 3) * 256, 512, 256],
  vending: (i: number): Rect => [i * 128, 1536, 128, 256],
  nobori: (i: number): Rect => [512 + i * 64, 1536, 64, 256],
  noren: (i: number): Rect => [896 + i * 128, 1536, 128, 128],
  lantern: [896, 1664, 128, 128] as Rect,
  kanban: [1024, 1664, 256, 128] as Rect,
  pole: (i: number): Rect => [1408 + i * 256, 1536, 256, 256],
  strip: (i: number): Rect => [1408 + i * 256, 1792, 256, 64],
  fascia: (i: number): Rect => [0, 1792 + i * 64, 1024, 64],
  white: [1920, 1536, 64, 64] as Rect,
  steel: [1984, 1536, 64, 64] as Rect,
  dark: [1920, 1600, 64, 64] as Rect,
  tenant: (i: number): Rect => [(i % 32) * 64, 1920 + Math.floor(i / 32) * 64, 64, 64],
  asphalt: [1984, 1600, 64, 64] as Rect,
  concrete: [1920, 1664, 64, 64] as Rect,
  // Village garden boundaries: split-bamboo fence (kenninji-gaki), clipped
  // hedge foliage and a dry-laid stone course, each ~1 m of real surface.
  bamboo: [1024, 1792, 128, 128] as Rect,
  hedge: [1152, 1792, 128, 128] as Rect,
  stones: [1280, 1792, 128, 128] as Rect,
};

function verticalText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  top: number,
  bottom: number,
  size: number,
) {
  const chars = [...text];
  const step = Math.min(size * 1.08, (bottom - top) / chars.length);
  const glyph = Math.min(size, step * 0.95);
  ctx.font = `900 ${glyph}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  chars.forEach((ch, k) => {
    const y = top + step * (k + 0.5);
    if (ch === 'ー') {
      ctx.save();
      ctx.translate(cx, y);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    } else ctx.fillText(ch, cx, y);
  });
}

/** One atlas painted at runtime; a 1x1 fallback keeps Node inspection. */
function paintAtlas(): T.Texture {
  if (typeof document === 'undefined') {
    const t = new T.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Festival signage atlas needs a 2D canvas context');
  ctx.fillStyle = '#7d8183';
  ctx.fillRect(0, 0, S, S);
  VERTICAL.forEach((v, i) => {
    const [x, y, w, h] = LAYOUT.vertical(i);
    ctx.fillStyle = v.bg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = v.neon ? v.fg : 'rgba(0,0,0,0.25)';
    ctx.lineWidth = v.neon ? 4 : 6;
    ctx.strokeRect(x + 8, y + 8, w - 16, h - 16);
    if (v.neon) {
      ctx.shadowColor = v.fg;
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = v.fg;
    verticalText(ctx, v.text, x + w / 2, y + 22, y + h - (v.sub ? 84 : 22), 92);
    ctx.shadowBlur = 0;
    if (v.sub) {
      ctx.font = `700 22px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(v.sub, x + w / 2, y + h - 48, w - 20);
    }
  });
  STACKS.forEach((stack, i) => {
    const [x, y, w, h] = LAYOUT.stack(i);
    ctx.fillStyle = '#2b2d2f';
    ctx.fillRect(x, y, w, h);
    stack.forEach(([text, bg, fg], k) => {
      const cy = y + 6 + k * (h / stack.length),
        ch = h / stack.length - 12;
      ctx.fillStyle = bg;
      ctx.fillRect(x + 6, cy, w - 12, ch);
      ctx.fillStyle = fg;
      const chars = [...text.replace(/^\dF /, '')];
      verticalText(ctx, chars.join(''), x + w / 2, cy + 6, cy + ch - 6, 40);
    });
  });
  const ads: [string, string, string, string][] = [
    ['モトバウンド', 'FESTIVAL 2026 · 祭', '#ff2f7a', '#2a0c3d'],
    ['サイダー', 'しゅわっと爽快 · 新発売', '#1f7fd1', '#e8f7ff'],
    ['汐浜温泉', '♨ 日帰り入浴 · 露天風呂', '#7a3a1d', '#f6e3c4'],
    ['新築マンション', '分譲中 · 駅徒歩5分', '#1d2b6b', '#ffffff'],
    ['龍軒', 'らーめん · 深夜営業', '#a3161a', '#ffe9a8'],
    ['デンキのまるや', '大型店 · ポイント10倍', '#141414', '#ffd400'],
  ];
  ads.slice(0, BILLBOARDS).forEach(([title, sub, a, b], i) => {
    const [x, y, w, h] = LAYOUT.billboard(i);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, a);
    g.addColorStop(1, i % 2 ? a : '#111');
    ctx.fillStyle = i === 3 ? b : g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = i === 3 ? a : b;
    if (i === 0) {
      // Festival poster: speed stripes and a car silhouette.
      for (let k = 0; k < 7; k++) {
        ctx.fillStyle = `hsla(${320 + k * 12},90%,60%,0.55)`;
        ctx.fillRect(x, y + 150 + k * 9, w, 4);
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x + 300, y + 210);
      ctx.quadraticCurveTo(x + 360, y + 160, x + 440, y + 175);
      ctx.lineTo(x + 490, y + 200);
      ctx.lineTo(x + 490, y + 215);
      ctx.lineTo(x + 300, y + 215);
      ctx.fill();
      ctx.fillStyle = b === '#2a0c3d' ? '#ffffff' : b;
    }
    if (i === 1)
      for (let k = 0; k < 24; k++) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x + 380 + ((k * 37) % 110), y + 40 + ((k * 53) % 180), 4 + (k % 4) * 3, 0, 7);
        ctx.stroke();
      }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let size = 78;
    do ctx.font = `900 ${size--}px ${FONT}`;
    while (ctx.measureText(title).width > w - 60 && size > 20);
    ctx.fillStyle = i === 3 ? a : i === 0 ? '#ffffff' : b;
    ctx.fillText(title, x + 30, y + 110);
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(sub, x + 32, y + 160, w - 60);
    ctx.fillRect(x + 32, y + 186, 120, 6);
  });
  VENDING.forEach((body, i) => {
    const [x, y, w, h] = LAYOUT.vending(i);
    ctx.fillStyle = body;
    ctx.fillRect(x, y, w, h);
    // Lit dummy display: three shelves of eight bottles and cans.
    ctx.fillStyle = '#e9f2f6';
    ctx.fillRect(x + 10, y + 14, w - 20, 120);
    for (let row = 0; row < 3; row++)
      for (let k = 0; k < 8; k++) {
        ctx.fillStyle = `hsl(${(k * 47 + row * 90 + i * 31) % 360},70%,${45 + ((k + row) % 3) * 10}%)`;
        ctx.fillRect(x + 14 + k * 13, y + 20 + row * 39, 9, 26);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 14 + k * 13, y + 48 + row * 39, 9, 5);
      }
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x + 16, y + 150, 46, 30);
    ctx.fillStyle = '#f7d117';
    ctx.fillRect(x + 72, y + 150, 38, 14);
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(x + 18, y + 206, w - 36, 30);
    ctx.fillStyle = body === '#f2f2ee' ? '#c8161d' : '#ffffff';
    ctx.font = `900 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('つめた〜い', x + w / 2, y + 197);
  });
  NOBORI.forEach(([text, bg, fg], i) => {
    const [x, y, w, h] = LAYOUT.nobori(i);
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fg;
    ctx.fillRect(x, y, 8, h);
    verticalText(ctx, text, x + w / 2 + 4, y + 10, y + h - 10, 46);
  });
  NOREN.forEach(([text, bg], i) => {
    const [x, y, w, h] = LAYOUT.noren(i);
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 1; k < 3; k++) ctx.fillRect(x + (k * w) / 3 - 1, y + 22, 3, h - 22);
    ctx.fillStyle = '#f2efe6';
    ctx.font = `900 64px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + 8);
  });
  {
    const [x, y, w, h] = LAYOUT.lantern;
    ctx.fillStyle = '#c3221c';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x, y, w, 12);
    ctx.fillRect(x, y + h - 12, w, 12);
    ctx.font = `900 54px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('祭', x + w / 4, y + h / 2);
    ctx.fillText('酒', x + (3 * w) / 4, y + h / 2);
  }
  {
    const [x, y, w, h] = LAYOUT.kanban;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#5a3d27');
    g.addColorStop(1, '#3d2818');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#e9cf8a';
    ctx.font = `900 64px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('御食事処', x + w / 2, y + h / 2 + 4, w - 20);
  }
  KONBINI_CHAINS.forEach((chain, i) => {
    let [x, y, w, h] = LAYOUT.pole(i);
    ctx.fillStyle = '#fbfbf8';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = chain.main;
    ctx.fillRect(x, y + h - 52, w, 30);
    ctx.fillStyle = chain.accent;
    ctx.fillRect(x, y + h - 22, w, 14);
    // Logo: a swirl (breeze) or a star (starry sky) in the chain colours.
    ctx.strokeStyle = chain.main;
    ctx.fillStyle = chain.accent;
    ctx.lineWidth = 14;
    ctx.beginPath();
    if (i === 0) {
      ctx.arc(x + w / 2, y + 80, 44, 0.3, Math.PI * 1.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + w / 2 + 10, y + 80, 18, 0, 7);
      ctx.fill();
    } else {
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5,
          r = k % 2 ? 22 : 52;
        ctx.lineTo(x + w / 2 + Math.cos(a) * r, y + 82 + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.stroke();
    }
    ctx.fillStyle = chain.main;
    ctx.font = `900 46px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(chain.name, x + w / 2, y + 160, w - 20);
    ctx.font = `800 20px ${FONT}`;
    ctx.fillText(chain.latin, x + w / 2, y + 190, w - 20);
    [x, y, w, h] = LAYOUT.strip(i);
    const cells = [
      ['24H', chain.main],
      ['P', '#1b4fa0'],
      ['ATM', chain.main],
    ];
    cells.forEach(([label, color], k) => {
      ctx.fillStyle = color;
      ctx.fillRect(x + (k * w) / 3 + 3, y + 3, w / 3 - 6, h - 6);
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 40px ${FONT}`;
      ctx.fillText(label, x + (k + 0.5) * (w / 3), y + h / 2 + 2);
    });
    [x, y, w, h] = LAYOUT.fascia(i);
    ctx.fillStyle = '#fbfbf8';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = chain.main;
    ctx.fillRect(x, y + 8, w, 14);
    ctx.fillStyle = chain.accent;
    ctx.fillRect(x, y + 26, w, 8);
    ctx.fillStyle = chain.main;
    ctx.fillRect(x, y + 38, w, 4);
    ctx.fillStyle = '#fbfbf8';
    ctx.fillRect(x + w / 2 - 110, y + 4, 220, h - 8);
    ctx.fillStyle = chain.main;
    ctx.font = `900 34px ${FONT}`;
    ctx.fillText(chain.name, x + w / 2, y + h / 2 + 2);
  });
  TENANTS.forEach((word, i) => {
    const [x, y, w, h] = LAYOUT.tenant(i);
    const [bg, fg] = TENANT_COLORS[(i * 7) % TENANT_COLORS.length];
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 11px ${FONT}`;
    ctx.fillText(`${1 + (i % 7)}F`, x + 12, y + 10);
    const n = [...word].length;
    const size = n <= 1 ? 34 : n === 2 ? 25 : n === 3 ? 18 : 14;
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.fillText(word, x + w / 2, y + h / 2 + 5, w - 6);
  });
  {
    // Split bamboo slats ~45 mm wide (6 px per 1.0 m tile of 128 px), nodes
    // staggered, dark gaps; three horizontal rails.
    const [x, y, w, h] = LAYOUT.bamboo;
    ctx.fillStyle = '#2a2316';
    ctx.fillRect(x, y, w, h);
    for (let k = 0; k < w / 6; k++) {
      const tone = 0.82 + 0.18 * (((k * 37) % 11) / 11);
      ctx.fillStyle = `rgb(${Math.round(186 * tone)},${Math.round(160 * tone)},${Math.round(98 * tone)})`;
      ctx.fillRect(x + k * 6 + 0.5, y, 5, h);
      ctx.fillStyle = 'rgba(70,52,26,0.55)';
      for (let n = ((k * 19) % 23) + 4; n < h; n += 31) ctx.fillRect(x + k * 6 + 0.5, y + n, 5, 2);
    }
    ctx.fillStyle = '#6e5a35';
    for (const r of [0.18, 0.5, 0.82]) ctx.fillRect(x, y + h * r - 3, w, 6);
  }
  {
    const [x, y, w, h] = LAYOUT.hedge;
    ctx.fillStyle = '#2c4422';
    ctx.fillRect(x, y, w, h);
    for (let k = 0; k < 700; k++) {
      const lx = (k * 53) % w,
        ly = (k * 97 + ((k * k) % 13)) % h,
        g = 60 + ((k * 31) % 70);
      ctx.fillStyle = `rgb(${Math.round(g * 0.55)},${g},${Math.round(g * 0.38)})`;
      ctx.beginPath();
      ctx.ellipse(x + lx, y + ly, 3 + (k % 3), 2 + (k % 2), (k % 7) * 0.45, 0, 7);
      ctx.fill();
    }
  }
  {
    // Dry-laid stones in uneven courses with dark joints.
    const [x, y, w, h] = LAYOUT.stones;
    ctx.fillStyle = '#3a3936';
    ctx.fillRect(x, y, w, h);
    let row = 0;
    for (let yy = 0; yy < h; row++) {
      const ch = 18 + ((row * 7) % 9);
      for (let xx = -((row * 23) % 30); xx < w; ) {
        const cw = 26 + ((row * 13 + xx * 3) % 22);
        const g = 120 + ((row * 31 + xx) % 40);
        ctx.fillStyle = `rgb(${g},${g - 4},${g - 12})`;
        ctx.fillRect(
          x + Math.max(0, xx) + 2,
          y + yy + 2,
          Math.min(cw, w - Math.max(0, xx)) - 4,
          Math.min(ch, h - yy) - 4,
        );
        xx += cw;
      }
      yy += ch;
    }
  }
  const patch = (r: Rect, color: string, noise = 0) => {
    ctx.fillStyle = color;
    ctx.fillRect(r[0], r[1], r[2], r[3]);
    for (let k = 0; k < noise; k++) {
      ctx.fillStyle = `rgba(${k % 2 ? 255 : 0},${k % 2 ? 255 : 0},${k % 2 ? 255 : 0},0.06)`;
      ctx.fillRect(r[0] + ((k * 37) % r[2]), r[1] + ((k * 61) % r[3]), 2, 2);
    }
  };
  patch(LAYOUT.white, '#ffffff');
  patch(LAYOUT.steel, '#8e9496');
  patch(LAYOUT.dark, '#1d1f21');
  patch(LAYOUT.asphalt, '#3b3c3d', 300);
  patch(LAYOUT.concrete, '#b7b4ab', 200);
  const texture = new T.CanvasTexture(canvas);
  texture.name = 'Original festival Japanese signage atlas';
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  return texture;
}

type V = T.Vector3;
class Batch {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly color: number[] = [];
  readonly signal: number[] = [];
  readonly index: number[] = [];
  private readonly c = new T.Color();
  /** Quad from bottom-left, bottom-right, top-right, top-left (CCW). */
  quad(p: readonly V[], n: V, rect: Rect, color: number, glow: number, phase: number) {
    const base = this.position.length / 3;
    const inset = 1.5;
    const u0 = (rect[0] + inset) / S,
      u1 = (rect[0] + rect[2] - inset) / S,
      v0 = 1 - (rect[1] + rect[3] - inset) / S,
      v1 = 1 - (rect[1] + inset) / S;
    const uvs = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    this.c.setHex(color);
    p.forEach((q, k) => {
      this.position.push(q.x, q.y, q.z);
      this.normal.push(n.x, n.y, n.z);
      this.uv.push(uvs[k][0], uvs[k][1]);
      this.color.push(this.c.r, this.c.g, this.c.b);
      this.signal.push(glow, phase);
    });
    this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  finish() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(this.color, 3));
    g.setAttribute('signal', new T.Float32BufferAttribute(this.signal, 2));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

const UP = new T.Vector3(0, 1, 0);
function mix(seed: number, a: number) {
  let h = (seed ^ Math.imul(a + 0x632be5ab, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A lit sign, machine or lantern whose light falls on the street (the town
 * life module paints its pool on the pavement; refs 014, 066, 069). */
export interface SignLight {
  x: number;
  y: number;
  z: number;
  /** Light colour (sRGB hex) and relative strength. */
  color: number;
  glow: number;
  /** Pool radius on the ground (m). */
  radius: number;
}
export class FestivalSignage {
  readonly root = new T.Group();
  /** Every lit fixture that throws light on the pavement. */
  readonly lights: SignLight[] = [];
  /** Ground footprints of free-standing fixtures (machines, banners). */
  readonly fixtures: { x: number; z: number; r: number }[] = [];
  readonly stats = {
    signs: 0,
    billboards: 0,
    vending: 0,
    nobori: 0,
    lanterns: 0,
    stores: 0,
    bays: 0,
    columns: 0,
    screens: 0,
    triangles: 0,
    chunks: 0,
  };
  readonly material: T.MeshStandardMaterial;
  private readonly atlas = paintAtlas();
  private readonly uniforms = {
    signNight: { value: 0 },
    signTime: { value: 0 },
  };
  /** Animated LED screens on a few tall central blocks (own material). */
  readonly screens = new LedScreens();
  private readonly batches = new Map<string, { batch: Batch; small: boolean }>();
  private readonly meshes: { mesh: T.Mesh; small: boolean }[] = [];
  private readonly eye = new T.Vector3();
  private small = false;
  // Scratch vectors for the structure frame.
  private readonly t = new T.Vector3();
  private readonly n = new T.Vector3();

  constructor(
    readonly world: OpenWorld,
    readonly structures: readonly Structure[],
    readonly plan: ArchitecturePlan,
  ) {
    this.root.name = 'Festival Japanese signage';
    this.material = new T.MeshStandardMaterial({
      map: this.atlas,
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.05,
    });
    this.material.name = 'Festival signage';
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.signNight = this.uniforms.signNight;
      shader.uniforms.signTime = this.uniforms.signTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec2 signal;\nvarying vec2 vSignal;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSignal = signal;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float signNight;\nuniform float signTime;\nvarying vec2 vSignal;',
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
{
  // Backlit faces and neon tubes: the lit albedo is the emitted colour.
  // About one sign in fourteen has a failing tube that stutters.
  float flicker = 1.0;
  if (vSignal.y > 0.93) {
    float k = floor(signTime * 7.0 + vSignal.y * 97.0);
    flicker = 0.25 + 0.75 * step(0.22, fract(sin(k * 12.9898) * 43758.5453));
  }
  totalEmissiveRadiance += diffuseColor.rgb * vSignal.x * (0.12 + signNight * 5.5) * flicker;
}`,
        );
    };
    this.material.customProgramCacheKey = () => 'festival-signage-v1';
    structures.forEach((s, i) => {
      const style = this.plan.style[i];
      if (style === 'urban') this.urban(s, i);
      else if (style === 'machiya' || style === 'minka') this.village(s, i, style);
      else if (style === 'konbini') this.konbini(s, i);
    });
    for (const [key, { batch, small }] of this.batches) {
      const g = batch.finish();
      const mesh = new T.Mesh(g, this.material);
      mesh.name = `Signage ${key}`;
      mesh.castShadow = !small;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.stats.triangles += batch.index.length / 3;
      this.root.add(mesh);
      this.meshes.push({ mesh, small });
    }
    this.stats.chunks = this.batches.size;
    this.batches.clear();
    const screens = this.screens.finish();
    if (screens) {
      this.root.add(screens);
      this.stats.screens = this.screens.count;
      this.stats.triangles += this.screens.triangles;
    }
  }

  private batch(x: number, z: number) {
    const size = this.small ? 256 : 512;
    const key = `${this.small ? 'street' : 'skyline'} ${Math.floor(x / size)},${Math.floor(z / size)}`;
    let entry = this.batches.get(key);
    if (!entry) this.batches.set(key, (entry = { batch: new Batch(), small: this.small }));
    return entry.batch;
  }
  /** Set the structure frame: t along the frontage, n toward its road. */
  private frame(s: Structure, front: number) {
    const c = Math.cos(s.heading),
      n = Math.sin(s.heading);
    this.t.set(c, 0, n);
    this.n.set(-n * front, 0, c * front);
  }
  /** World point at frontage offset x, height y, distance z out of the face. */
  private at(s: Structure, x: number, y: number, z: number, out = new T.Vector3()) {
    return out
      .set(s.x, y, s.z)
      .addScaledVector(this.t, x)
      .addScaledVector(this.n, s.hz + z);
  }
  /** A facade fixture `h` above the ground floor (s.base + 0.5), lifted
   * where the pavement in front of a hillside facade stands higher. */
  private attach(s: Structure, x: number, h: number, z: number) {
    const p = this.at(s, x, 0, z);
    p.y = Math.max(s.base + h, this.ground(p) + h - 0.5);
    return p;
  }
  private ground(p: V) {
    return carvedGroundHeight(this.world.carver, p.x, p.z);
  }
  /** A flat panel facing `normal`, u to the viewer's right. */
  private panel(
    centre: V,
    normal: V,
    w: number,
    h: number,
    rect: Rect,
    color = 0xffffff,
    glow = 0,
    phase = 0,
  ) {
    const right = new T.Vector3(normal.z, 0, -normal.x).normalize();
    const up = new T.Vector3().crossVectors(normal, right).normalize();
    const p = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) =>
      centre
        .clone()
        .addScaledVector(right, (a * w) / 2)
        .addScaledVector(up, (b * h) / 2),
    );
    this.batch(centre.x, centre.z).quad(p, normal, rect, color, glow, phase);
  }
  /** Box with optional textured faces on +/- `normal`; other faces solid. */
  private slab(
    centre: V,
    normal: V,
    w: number,
    h: number,
    d: number,
    front: Rect | null,
    back: Rect | null,
    color: number,
    glow = 0,
    phase = 0,
    faceColor = 0xffffff,
  ) {
    const right = new T.Vector3(normal.z, 0, -normal.x).normalize();
    const solid = LAYOUT.white;
    this.panel(
      centre.clone().addScaledVector(normal, d / 2),
      normal,
      w,
      h,
      front ?? solid,
      front ? faceColor : color,
      front ? glow : 0,
      phase,
    );
    this.panel(
      centre.clone().addScaledVector(normal, -d / 2),
      normal.clone().negate(),
      w,
      h,
      back ?? solid,
      back ? faceColor : color,
      back ? glow : 0,
      phase,
    );
    for (const side of [-1, 1]) {
      this.panel(
        centre.clone().addScaledVector(right, (side * w) / 2),
        right.clone().multiplyScalar(side),
        d,
        h,
        solid,
        color,
      );
    }
    // Top cap.
    const top = centre.clone().addScaledVector(UP, h / 2);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) =>
      top
        .clone()
        .addScaledVector(right, (a * w) / 2)
        .addScaledVector(normal, (-b * d) / 2),
    );
    this.batch(centre.x, centre.z).quad(corners, UP, solid, color, 0, 0);
  }
  /** Horizontal quad on the ground, wound to face up whatever the frame. */
  private flat(corners: V[], rect: Rect, color: number, glow = 0) {
    const a = corners[0],
      e1 = corners[1].clone().sub(a),
      e2 = corners[2].clone().sub(a);
    if (e1.cross(e2).y < 0) corners = [corners[1], corners[0], corners[3], corners[2]];
    this.batch(a.x, a.z).quad(corners, UP, rect, color, glow, 0);
  }
  /** Vertical member (pole, leg) as a thin square slab. */
  private post(base: V, height: number, size: number, color: number) {
    this.slab(
      base.clone().addScaledVector(UP, height / 2),
      new T.Vector3(1, 0, 0),
      size,
      height,
      size,
      null,
      null,
      color,
    );
  }

  private projecting(
    s: Structure,
    x: number,
    y0: number,
    y1: number,
    rect: Rect,
    seed: number,
    glow: number,
    light = 0xffffff,
  ) {
    // Faces point along the street both ways; depth 0.26 m on the facade.
    const width = 0.62 + (seed % 4) * 0.08;
    const centre = this.at(s, x, (y0 + y1) / 2, 0.24 + width / 2);
    this.light(this.at(s, x, y0, 1.6), light, glow, 2.6 + Math.min(1.6, (y1 - y0) * 0.12));
    this.slab(
      centre,
      this.t,
      width,
      y1 - y0,
      0.26,
      rect,
      rect,
      0x3c3f41,
      glow,
      (seed % 1000) / 1000,
    );
    // Two brackets back to the wall.
    for (const y of [y0 + 0.3, y1 - 0.3])
      this.slab(this.at(s, x, y, 0.12), this.n, 0.06, 0.06, 0.24, null, null, 0x4a4d4f);
    this.stats.signs++;
  }

  /** A column of tenant boxes (0.56 x 0.5 m faces, 0.3 m deep) stacked one
   * per tenant and projecting from the facade on brackets (ref 014). */
  private column(s: Structure, x: number, y0: number, y1: number, seed: number) {
    const boxH = 0.5,
      n = Math.floor((y1 - y0) / boxH),
      width = 0.56,
      depth = 0.3,
      out = 0.24 + width / 2;
    if (n < 3) return;
    this.slab(
      this.at(s, x, y0 + (n * boxH) / 2, out),
      this.t,
      width + 0.05,
      n * boxH + 0.08,
      depth,
      null,
      null,
      0x2b2d2f,
    );
    const back = this.t.clone().negate();
    for (let k = 0; k < n; k++) {
      const tenant = mix(seed, k) % TENANTS.length;
      const c = this.at(s, x, y0 + (k + 0.5) * boxH + 0.04, out);
      const glow = (mix(seed, k + 50) & 7) === 0 ? 1.4 : 0.6;
      for (const face of [this.t, back])
        this.panel(
          c.clone().addScaledVector(face, depth / 2 + 0.006),
          face,
          width - 0.04,
          boxH - 0.06,
          LAYOUT.tenant(tenant),
          0xffffff,
          glow,
          (mix(seed, k + 90) % 1000) / 1000,
        );
    }
    for (const y of [y0 + 0.25, y0 + n * boxH - 0.25])
      this.slab(this.at(s, x, y, 0.12), this.n, 0.06, 0.06, 0.24, null, null, 0x4a4d4f);
    const [bg] = TENANT_COLORS[((mix(seed, 0) % TENANTS.length) * 7) % TENANT_COLORS.length];
    this.light(
      this.at(s, x, y0, 1.6),
      new T.Color(bg).getHex(),
      0.6,
      2.6 + Math.min(1.6, (y1 - y0) * 0.12),
    );
    this.stats.columns++;
  }

  /** Highest visual roof among the buildings standing within 4 m of a
   * structure's side wall (local x = side * hx); -Infinity if none. */
  private neighbourTop(s: Structure, side: number) {
    this.grid ??= new StructureGrid(this.structures);
    const c = Math.cos(s.heading),
      n = Math.sin(s.heading);
    let top = -Infinity;
    for (const lz of [-s.hz * 0.8, 0, s.hz * 0.8])
      for (const out of [0.6, 2.5, 4]) {
        const lx = side * (s.hx + out),
          x = s.x + c * lx - n * lz,
          z = s.z + n * lx + c * lz;
        for (const j of this.grid.near(x, z)) {
          const o = this.structures[j];
          if (o === s || !insideFootprint(o, x, z, 0.3)) continue;
          top = Math.max(top, o.base + o.height + 3.2 * this.plan.extraFloors[j] + 1);
        }
      }
    return top;
  }

  /** World point on a side wall (local x = side * hx), `z` along the
   * frontage normal from the centre, `out` metres off the wall. */
  private side(s: Structure, side: number, z: number, y: number, out: number) {
    return new T.Vector3(s.x, y, s.z)
      .addScaledVector(this.t, side * (s.hx + out))
      .addScaledVector(this.n, z);
  }

  private vending(s: Structure, x: number, seed: number, face = 0.38) {
    const p = this.at(s, x, 0, face);
    const g = this.ground(p);
    this.light(this.at(s, x, g, face + 0.9), 0xe6f0ff, 0.9, 1.7);
    this.fixtures.push({ x: p.x, z: p.z, r: 0.75 });
    const body = VENDING[seed % VENDING.length];
    const color = new T.Color(body).getHex();
    p.y = g + 0.915;
    this.slab(
      p,
      this.n,
      1.0,
      1.83,
      0.74,
      LAYOUT.vending(seed % VENDING.length),
      null,
      color,
      0.7,
      0,
    );
    this.stats.vending++;
  }

  private nobori(s: Structure, x: number, seed: number) {
    const p = this.at(s, x, 0, 0.95);
    const g = this.ground(p);
    this.fixtures.push({ x: p.x, z: p.z, r: 0.35 });
    this.post(new T.Vector3(p.x, g, p.z), 2.7, 0.035, 0xb9bcbd);
    const banner = new T.Vector3(p.x, g + 1.65, p.z).addScaledVector(this.t, 0.25);
    const rect = LAYOUT.nobori(seed % NOBORI.length);
    this.panel(banner, this.n, 0.46, 1.72, rect, 0xffffff, 0.12, 0);
    this.panel(banner.clone(), this.n.clone().negate(), 0.46, 1.72, rect, 0xffffff, 0.12, 0);
    // Weighted water base.
    this.slab(new T.Vector3(p.x, g + 0.12, p.z), this.n, 0.36, 0.24, 0.36, null, null, 0x2c2e30);
    this.stats.nobori++;
  }

  private light(at: V, color: number, glow: number, radius: number) {
    this.lights.push({ x: at.x, y: at.y, z: at.z, color, glow, radius });
  }

  private lantern(centre: V) {
    this.light(centre, 0xff8a4a, 0.6, 1.6);
    // Octagonal chochin, 0.36 m diameter, 0.56 m tall; lit at night.
    const r = 0.18,
      h = 0.56,
      sides = 8;
    const [x, y, w, hh] = LAYOUT.lantern;
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2,
        a1 = ((k + 1) / sides) * Math.PI * 2;
      const p0 = new T.Vector3(Math.cos(a0) * r, 0, Math.sin(a0) * r).add(centre),
        p1 = new T.Vector3(Math.cos(a1) * r, 0, Math.sin(a1) * r).add(centre);
      const am = (a0 + a1) / 2;
      const rect: Rect = [x + (k / sides) * w, y, w / sides, hh];
      this.batch(centre.x, centre.z).quad(
        [
          p1.clone().addScaledVector(UP, -h / 2),
          p0.clone().addScaledVector(UP, -h / 2),
          p0.clone().addScaledVector(UP, h / 2),
          p1.clone().addScaledVector(UP, h / 2),
        ],
        new T.Vector3(Math.cos(am), 0, Math.sin(am)),
        rect,
        0xffffff,
        1.2,
        0,
      );
    }
    this.stats.lanterns++;
  }

  private urban(collider: Structure, i: number) {
    // Signs follow the building as drawn, including its visual storeys.
    const s = visualStructure(collider, this.plan.extraFloors[i]);
    const front = this.plan.front[i];
    this.frame(s, front);
    const h = mix(s.style, 11);
    const floors = Math.max(1, Math.floor(s.floors)),
      floorH = (s.height - 0.6) / floors,
      top = s.base + s.height;
    const store = this.plan.konbiniFloor.has(i);
    this.small = false;
    // Projecting signs and tenant-box columns from the first floor up
    // (refs 014, 030, 069): on blocks one per ~2.6 m of frontage (3-6),
    // on shops two or three, in slots >= 1.3 m apart along the frontage,
    // alternating faces so the street reads as a canyon of boards.
    const count = isApartment(s)
      ? 0
      : s.kind === 'block'
        ? Math.min(6, Math.max(3, Math.round((s.hx * 2) / 2.6)))
        : 2 + (h % 2);
    const span = s.hx * 2 - 1.1,
      slots = Math.min(count, Math.floor(span / 1.3) + 1);
    const columns = s.kind === 'block' && floors >= 4 ? 1 + ((h >>> 3) % 2) : 0;
    let signs = 0;
    for (let k = 0; k < slots; k++) {
      const seed = mix(s.style, 20 + k);
      const x = slots > 1 ? -s.hx + 0.55 + (k * span) / (slots - 1) : (seed % 2 ? 1 : -1) * 0.4;
      // Every third slot starts a storey higher; columns take the slots
      // nearest the middle of the frontage.
      const lift = k % 3 === 1 && floors >= 4 ? floorH : 0;
      const y0 = s.base + floorH + 0.35 + lift;
      const middle = Math.abs(k - (slots - 1) / 2) < columns / 2 + 0.01;
      if (middle && columns) {
        const y1 = Math.min(top - 0.5, y0 + Math.min(16, 0.5 * (6 + (seed % 12))));
        if (y1 - y0 > 2) this.column(s, x, y0, y1, seed);
        continue;
      }
      const tall = seed % 5 === 0 && floors >= 4;
      const y1 = Math.min(
        top - 0.4,
        y0 + (tall ? Math.min(16, floorH * (floors - 1.4)) : 2.4 + (seed % 3) * 1.2),
      );
      if (y1 - y0 < 1.8) continue;
      const stacked = seed % 4 === 0 && y1 - y0 > 4,
        sign = VERTICAL[(seed >>> 5) % VERTICAL.length];
      const rect = stacked
        ? LAYOUT.stack((seed >>> 3) % STACKS.length)
        : LAYOUT.vertical((seed >>> 5) % VERTICAL.length);
      // Backlit boxes stay just under the bloom threshold so their lettering
      // keeps its colour; neon tubes on dark faces bloom (refs 014, 066).
      this.projecting(
        s,
        x,
        y0,
        y1,
        rect,
        seed,
        stacked ? 0.55 : sign.neon ? 1.5 : 0.6,
        stacked ? 0xffe6c4 : new T.Color(sign.neon ? sign.fg : sign.bg).getHex(),
      );
      signs++;
    }
    // Flat lit boards on the facade between the window bands of busy
    // blocks: one per floor on two or three floors (ref 069).
    if (s.kind === 'block' && !isApartment(s) && h % 3 !== 2 && s.hx > 4.5) {
      const boards = Math.min(floors - 1, 2 + (h % 2));
      for (let k = 0; k < boards; k++) {
        const seed = mix(s.style, 60 + k);
        const y = s.base + (k + 1) * floorH + 0.42;
        const w = Math.min(4.2, s.hx * 0.8);
        const x = ((k % 2 ? 1 : -1) * (s.hx - w / 2 - 0.9)) / 2;
        this.slab(
          this.at(s, x, y, 0.1),
          this.n,
          w,
          0.62,
          0.16,
          LAYOUT.tenant(seed % TENANTS.length),
          null,
          0x2c2e30,
          0.55,
          (seed % 1000) / 1000,
        );
        this.stats.billboards++;
      }
    }
    // Side-wall billboards on tall blocks, high on the wall where they clear
    // the neighbours (ref 030), with lamp arms; a few central towers carry
    // an animated LED screen instead.
    if (floors >= 7 && !isApartment(s) && h % 2 === 0) {
      let side = (h >>> 5) % 2 ? 1 : -1;
      const w = Math.min(9, s.hz * 2 - 1.2),
        bh = w / 2;
      // A side whose neighbour rises past the board's foot is skipped.
      const foot = top - 1.2 - bh;
      if (this.neighbourTop(collider, side) > foot - 0.5) side = -side;
      if (w > 3 && this.neighbourTop(collider, side) <= foot - 0.5) {
        const centre = this.side(s, side, 0, top - 1.2 - bh / 2, 0.22);
        const out = this.t.clone().multiplyScalar(side);
        if (floors >= 9 && (h >>> 7) % 3 === 0) {
          this.screens.add(centre, out, w, bh * 1.1, mix(s.style, 99));
        } else {
          this.slab(
            centre,
            out,
            w,
            bh,
            0.2,
            LAYOUT.billboard((h >>> 9) % BILLBOARDS),
            null,
            0x50565a,
            0.35,
            0,
          );
          for (const lz of [-w / 4, w / 4])
            this.slab(
              this.side(s, side, lz, top - 1.0, 0.7),
              out,
              0.12,
              0.1,
              0.9,
              null,
              null,
              0x3a3f42,
            );
        }
        this.stats.billboards++;
      }
    }
    // Curtain-wall towers: a front LED screen high on one corner (ref 030).
    if (this.plan.skin[i] === SKIN.curtain && h % 3 === 1 && s.hx > 5) {
      const w = Math.min(10, s.hx * 1.2),
        bh = w * 0.5625,
        x = ((h >>> 11) % 2 ? 1 : -1) * (s.hx - w / 2 - 0.4);
      this.screens.add(this.at(s, x, top - 1.6 - bh / 2, 0.3), this.n, w, bh, mix(s.style, 98));
    }
    const count2 = signs;
    // Rooftop billboard facing the street on about a third of the blocks.
    if (s.kind === 'block' && h % 3 === 0 && s.hx > 6) {
      const w = Math.min(9, s.hx * 1.3),
        bh = w / 2;
      const legs = top + 0.9;
      const centre = this.at(s, 0, legs + bh / 2, -1.6);
      this.slab(
        centre,
        this.n,
        w,
        bh,
        0.25,
        LAYOUT.billboard((h >>> 4) % BILLBOARDS),
        null,
        0x50565a,
        0.35,
        0,
      );
      for (const lx of [-w / 2 + 0.4, 0, w / 2 - 0.4]) {
        const foot = this.at(s, lx, top, -1.75);
        this.post(foot, legs - top + 0.05, 0.14, 0x4c5357);
        const brace = this.at(s, lx, top, -3.2);
        this.post(brace, legs - top + bh * 0.6, 0.1, 0x4c5357);
      }
      // Two lamp arms that light the face at night.
      for (const lx of [-w / 4, w / 4])
        this.slab(
          this.at(s, lx, legs + bh + 0.15, -1.1),
          this.n,
          0.3,
          0.12,
          0.9,
          null,
          null,
          0x3a3f42,
        );
      this.stats.billboards++;
    }
    // Large wall banner over the side bays of tall blocks, on the side
    // away from the first projecting sign.
    if (floors >= 5 && h % 4 === 1 && count2 < 3 && !isApartment(s)) {
      const x = -(s.hx - 1.6);
      const y0 = s.base + floorH * 1.4,
        y1 = top - 0.8;
      const centre = this.at(s, x, (y0 + y1) / 2, 0.28);
      const w = Math.min(2.6, (y1 - y0) / 4);
      this.slab(
        centre,
        this.n,
        w,
        y1 - y0,
        0.12,
        LAYOUT.vertical((h >>> 6) % VERTICAL.length),
        null,
        0x3c3f41,
        0.45,
        0,
      );
      this.stats.billboards++;
    }
    this.small = true;
    if (store) {
      this.storeFront(s, i);
      return;
    }
    // Street level: vending machines, nobori and lanterns.
    if (h % 4 === 1) {
      const pair = 1 + ((h >>> 2) % 2);
      for (let k = 0; k < pair; k++) this.vending(s, s.hx - 1.6 - k * 1.05, (h >>> 7) + k);
    }
    if (s.kind === 'shop' && h % 5 === 2)
      for (let k = 0; k < 2 + (h % 2); k++) this.nobori(s, -s.hx + 2.4 + k * 1.15, (h >>> 9) + k);
    if (h % 7 === 3) for (const x of [-1.6, 1.6]) this.lantern(this.attach(s, x, 2.35, 0.32));
    // Lit stand signs on the pavement by a third of the doors (refs 014, 030).
    if (h % 3 === 2) this.standSign(s, -s.hx + 1.1 + ((h >>> 4) % 3) * 0.8, h >>> 6);
  }

  /** A 0.5 x 0.9 m lit stand sign on the pavement, faces along the street. */
  private standSign(s: Structure, x: number, seed: number) {
    // 0.9 m out clears the 0.72 m dressing planters; skip beside a banner
    // or machine already standing there.
    const p = this.at(s, x, 0, 0.9);
    if (this.fixtures.some((f) => Math.hypot(f.x - p.x, f.z - p.z) < f.r + 0.45)) return;
    const g = this.ground(p);
    this.fixtures.push({ x: p.x, z: p.z, r: 0.4 });
    this.light(new T.Vector3(p.x, g, p.z), 0xfff2e0, 0.35, 1.1);
    this.slab(
      new T.Vector3(p.x, g + 0.5, p.z),
      this.t,
      0.46,
      0.9,
      0.22,
      LAYOUT.tenant(seed % TENANTS.length),
      LAYOUT.tenant((seed >>> 6) % TENANTS.length),
      0x2b2d2f,
      0.45,
      0,
    );
    this.stats.signs++;
  }

  /** Ground-floor convenience store in a city building. */
  private storeFront(s: Structure, i: number) {
    const chain = this.plan.chain.get(i) ?? 0;
    this.small = false;
    const fascia = this.attach(s, 0, 3.0, 0.16);
    for (const x of [-s.hx * 0.5, s.hx * 0.5])
      this.light(this.at(s, x, fascia.y, 2.2), 0xf4f6ff, 1.1, 3.4);
    this.slab(
      fascia,
      this.n,
      s.hx * 2 - 0.4,
      0.62,
      0.3,
      LAYOUT.fascia(chain),
      null,
      0xe8e8e4,
      0.6,
      0,
    );
    this.small = true;
    this.vending(s, s.hx - 1.4, 1 + chain);
    this.vending(s, s.hx - 2.45, 2 + chain);
    this.nobori(s, -s.hx + 1.2, 4);
    this.stats.stores++;
  }

  private village(s: Structure, i: number, style: 'minka' | 'machiya') {
    const front = this.plan.front[i];
    this.frame(s, front);
    const h = mix(s.style, 3);
    this.small = true;
    if (style === 'machiya') {
      // Noren over the doorway and a timber kanban above the pent roof.
      const rect = LAYOUT.noren(h % NOREN.length);
      this.panel(this.attach(s, 0, 2.05, 0.1), this.n, 1.6, 0.85, rect, 0xffffff, 0.04, 0);
      if (h % 3 === 0)
        this.slab(
          this.attach(s, 0, 4.15, 0.18),
          this.n,
          2.6,
          0.62,
          0.08,
          LAYOUT.kanban,
          null,
          0x3d2818,
          0.15,
          0,
        );
      if (h % 4 === 1) for (const x of [-1.2, 1.2]) this.lantern(this.attach(s, x, 2.45, 0.35));
      if (h % 5 === 0) this.vending(s, s.hx - 1.2, h >>> 5);
      // Curved bamboo guards (inuyarai) along the wall base either side of
      // the door, a timber bench and potted plants (refs 020, 014).
      for (const side of [-1, 1]) {
        const x0 = side * 1.25,
          x1 = side * (s.hx - 0.5);
        if (Math.abs(x1) - Math.abs(x0) < 1) continue;
        if (h % 5 === 0 && side > 0) continue;
        this.inuyarai(s, Math.min(x0, x1), Math.max(x0, x1));
      }
      if ((h >>> 4) % 2 === 0) this.bench(s, -(s.hx * 0.5), 0.95);
      this.pots(s, 1.1, 2 + ((h >>> 6) % 3), h >>> 9);
    } else {
      if (h % 6 === 0) this.vending(s, s.hx - 1.0, h >>> 5, 0.42);
      this.garden(s, h);
    }
  }

  private grid: StructureGrid | null = null;
  private readonly roadPoint = trackPoint();
  /** Clearance (m) from (x, z) to the nearest road's usable edge. */
  private roadClear(x: number, z: number) {
    const net = this.world.network,
      lateral = net.nearest(x, z, this.roadPoint),
      e = net.edges[net.edgeOf[net.lastSegment]];
    return Math.abs(lateral) - (e.spec.halfWidth + e.spec.shoulder);
  }
  /** True where a garden piece at (x, z) stays off roads and buildings. */
  private open(x: number, z: number) {
    this.grid ??= new StructureGrid(this.structures);
    return this.roadClear(x, z) > 0.8 && !this.grid.blocks(x, z, 0.25);
  }

  /** Minka front garden (refs 020, 034, 056): a boundary 2.4-3.6 m in
   * front of the house along the frontage with a gate gap (clipped hedge on
   * a dry-stone course, a split-bamboo fence or a plastered wall with a
   * tiled cap), returns back to the house, a stone lantern, clipped shrubs,
   * stepping stones to the door and potted plants. Every piece stands on
   * the carved ground and keeps 0.8 m off the road edge. */
  private garden(s: Structure, h: number) {
    const type = h % 10;
    let zb = 0;
    for (const z of [3.6, 3.0, 2.4]) {
      let ok = true;
      for (let x = -s.hx; x <= s.hx + 1e-6 && ok; x += s.hx / 3) {
        const p = this.at(s, x, 0, z);
        ok = this.roadClear(p.x, p.z) > 0.8;
      }
      if (ok) {
        zb = z;
        break;
      }
    }
    if (!zb) return;
    // Hillside plots (more than 1.2 m of fall across the garden) keep their
    // natural slope: no walls, paths or pots.
    let high = -Infinity,
      low = Infinity;
    for (const x of [-s.hx, 0, s.hx])
      for (const z of [0.3, zb]) {
        const y = this.ground(this.at(s, x, 0, z));
        high = Math.max(high, y);
        low = Math.min(low, y);
      }
    if (high - low > 1.2) return;
    if (type < 9) {
      const gate = 1.25;
      const pieces: [number, number, number][] = [];
      // Front run in <= 1.1 m pieces either side of the gate, then returns.
      for (const side of [-1, 1]) {
        const a = gate,
          b = s.hx + 0.3,
          n = Math.max(1, Math.ceil((b - a) / 1.1));
        for (let k = 0; k < n; k++)
          pieces.push([side * (a + ((k + 0.5) * (b - a)) / n), zb, (b - a) / n]);
      }
      const returns: [number, number, number][] = [];
      for (const side of [-1, 1]) {
        const n = Math.max(1, Math.ceil((zb - 0.4) / 1.1));
        for (let k = 0; k < n; k++)
          returns.push([side * (s.hx + 0.3), 0.4 + ((k + 0.5) * (zb - 0.4)) / n, (zb - 0.4) / n]);
      }
      const place = (x: number, z: number, len: number, along: boolean) => {
        const c = this.at(s, x, 0, z);
        if (!this.open(c.x, c.z)) return;
        // Stand on the highest ground under the piece; skip slopes steeper
        // than ~40 % across it (a real wall would step there).
        let g = -Infinity,
          low = Infinity;
        for (const a of [-0.5, 0.5])
          for (const b of [-0.3, 0.3]) {
            const q = along ? this.at(s, x + a * len, 0, z + b) : this.at(s, x + b, 0, z + a * len);
            const y = this.ground(q);
            g = Math.max(g, y);
            low = Math.min(low, y);
          }
        if (g - low > 0.45) return;
        const face = along ? this.n : this.t;
        if (type < 4) {
          // Dry-stone course 0.5 m and a clipped hedge 0.9 m above it.
          this.slab(
            c.clone().setY(g + 0.22),
            face,
            len + 0.02,
            0.56,
            0.45,
            LAYOUT.stones,
            LAYOUT.stones,
            0x8a877e,
          );
          this.slab(
            c.clone().setY(g + 0.95),
            face,
            len + 0.04,
            0.9,
            0.62,
            LAYOUT.hedge,
            LAYOUT.hedge,
            0x3d5a2c,
          );
        } else if (type < 7) {
          this.slab(
            c.clone().setY(g + 0.78),
            face,
            len,
            1.56,
            0.06,
            LAYOUT.bamboo,
            LAYOUT.bamboo,
            0x8f7a4c,
          );
          this.slab(c.clone().setY(g + 1.6), face, len + 0.02, 0.07, 0.12, null, null, 0x5e4a2c);
        } else {
          const plaster = (h >>> 8) % 2 ? 0xe4dfd2 : 0xcfb48a;
          this.slab(
            c.clone().setY(g + 0.2),
            face,
            len + 0.01,
            0.4,
            0.34,
            LAYOUT.stones,
            LAYOUT.stones,
            0x8a877e,
          );
          this.slab(c.clone().setY(g + 0.95), face, len, 1.1, 0.26, null, null, plaster);
          this.slab(c.clone().setY(g + 1.58), face, len + 0.04, 0.16, 0.52, null, null, 0x3c4045);
        }
      };
      for (const [x, z, len] of pieces) place(x, z, len, true);
      for (const [x, z, len] of returns) place(x, z, len, false);
      // Gate posts.
      for (const side of [-1, 1]) {
        const c = this.at(s, side * (gate - 0.12), 0, zb);
        if (!this.open(c.x, c.z)) continue;
        this.post(
          c.setY(this.ground(c)),
          type < 4 ? 1.3 : 1.85,
          0.2,
          type < 4 ? 0x8d8a82 : 0x3a2c22,
        );
      }
    }
    // Stepping stones from the gate to the door.
    for (let k = 0; k < 4; k++) {
      const c = this.at(s, k % 2 ? 0.15 : -0.12, 0, zb - 0.55 - k * ((zb - 1.0) / 3.5));
      if (!this.open(c.x, c.z)) continue;
      const g = this.ground(c);
      this.slab(c.setY(g + 0.03), this.n, 0.55, 0.06, 0.42, null, null, 0x8e8b83);
    }
    // A stone lantern and clipped shrub mounds in the garden.
    const lx = ((h >>> 5) % 2 ? 1 : -1) * Math.min(s.hx - 0.8, 2.6 + ((h >>> 6) % 3) * 0.6);
    const lantern = this.at(s, lx, 0, zb * 0.5);
    if (this.open(lantern.x, lantern.z)) this.toro(lantern.setY(this.ground(lantern)));
    for (let k = 0; k < 3; k++) {
      const x = -lx * (0.4 + 0.25 * k) + (k - 1) * 0.6,
        z = zb * (0.3 + 0.18 * k);
      const c = this.at(s, x, 0, z);
      if (!this.open(c.x, c.z)) continue;
      const size = 0.7 + ((h >>> (k + 3)) % 3) * 0.2;
      this.slab(
        c.setY(this.ground(c) + size * 0.4),
        this.n,
        size * 1.2,
        size * 0.8,
        size,
        LAYOUT.hedge,
        LAYOUT.hedge,
        0x3f5e2d,
      );
    }
    this.pots(s, 0.6, 1 + ((h >>> 11) % 3), h >>> 13);
  }

  /** A granite toro (1.4 m): base, shaft, lit fire box, roof and finial. */
  private toro(base: T.Vector3) {
    const stone = 0x8d8a82;
    const at = (y: number) => base.clone().setY(base.y + y);
    this.slab(at(0.12), this.n, 0.5, 0.24, 0.5, null, null, stone);
    this.slab(at(0.55), this.n, 0.18, 0.62, 0.18, null, null, stone);
    this.slab(at(0.92), this.n, 0.42, 0.12, 0.42, null, null, stone);
    this.slab(at(1.1), this.n, 0.32, 0.26, 0.32, LAYOUT.white, LAYOUT.white, 0xe8c27a, 0.5, 0);
    this.slab(at(1.29), this.n, 0.62, 0.12, 0.62, null, null, 0x7f7b74);
    this.slab(at(1.42), this.n, 0.12, 0.14, 0.12, null, null, 0x7f7b74);
    this.light(base, 0xffb070, 0.3, 1.4);
    this.stats.lanterns++;
  }

  /** Inuyarai: a curved bamboo guard leaning from 0.9 m on the wall to the
   * ground 0.5 m out, between local x0 and x1 (in 1 m pieces). */
  private inuyarai(s: Structure, x0: number, x1: number) {
    const n = Math.max(1, Math.round(x1 - x0));
    for (let k = 0; k < n; k++) {
      const a = x0 + ((x1 - x0) * k) / n,
        b = x0 + ((x1 - x0) * (k + 1)) / n;
      const ga = this.ground(this.at(s, a, 0, 0.5)),
        gb = this.ground(this.at(s, b, 0, 0.5));
      const mid = this.at(s, (a + b) / 2, 0, 0.3);
      this.fixtures.push({ x: mid.x, z: mid.z, r: 0.6 });
      const corners = [
        this.at(s, a, ga + 0.02, 0.52),
        this.at(s, b, gb + 0.02, 0.52),
        this.at(s, b, gb + 0.9, 0.06),
        this.at(s, a, ga + 0.9, 0.06),
      ];
      const normal = this.n
        .clone()
        .multiplyScalar(0.9)
        .add(UP.clone().multiplyScalar(0.5))
        .normalize();
      // Wind the quad so it faces out along the frontage normal.
      const e1 = corners[1].clone().sub(corners[0]),
        e2 = corners[3].clone().sub(corners[0]);
      const ordered =
        e1.cross(e2).dot(normal) < 0 ? [corners[1], corners[0], corners[3], corners[2]] : corners;
      this.batch(corners[0].x, corners[0].z).quad(ordered, normal, LAYOUT.bamboo, 0xa08a5a, 0, 0);
    }
  }

  /** A low timber bench (shogi) against the front wall. */
  private bench(s: Structure, x: number, z: number) {
    const c = this.at(s, x, 0, z);
    if (!this.open(c.x, c.z)) return;
    const g = this.ground(c);
    this.fixtures.push({ x: c.x, z: c.z, r: 1.0 });
    this.slab(c.clone().setY(g + 0.43), this.n, 1.8, 0.06, 0.45, null, null, 0x6b4a2e);
    for (const side of [-1, 1])
      this.slab(
        this.at(s, x + side * 0.75, g + 0.2, z),
        this.n,
        0.08,
        0.4,
        0.4,
        null,
        null,
        0x4f3622,
      );
  }

  /** A row of glazed pots with clipped foliage by the door. */
  private pots(s: Structure, z: number, count: number, seed: number) {
    const glaze = [0x7a3b26, 0x2c4a6e, 0x3c3a36, 0x8a6a4a];
    const x0 = ((seed % 2) * 2 - 1) * 1.0;
    for (let k = 0; k < count; k++) {
      const x = x0 + Math.sign(x0) * k * 0.55;
      if (Math.abs(x) > s.hx - 0.3) break;
      const c = this.at(s, x, 0, z);
      if (!this.open(c.x, c.z)) continue;
      const g = this.ground(c);
      this.fixtures.push({ x: c.x, z: c.z, r: 0.35 });
      const size = 0.3 + ((seed >>> k) % 3) * 0.08;
      this.slab(
        c.clone().setY(g + size / 2),
        this.n,
        size,
        size,
        size,
        null,
        null,
        glaze[(seed + k) % glaze.length],
      );
      this.slab(
        c.clone().setY(g + size + 0.18),
        this.n,
        size + 0.1,
        0.36,
        size + 0.1,
        LAYOUT.hedge,
        LAYOUT.hedge,
        0x3f6a2d,
      );
    }
  }

  /** Stand-alone store: pole sign at the street corner of its side car
   * park, 2.5 x 5.0 m nose-in bays (two facing rows with a 6 m aisle where
   * the plot is deep enough), wheel stops, machines against the side wall
   * and banners along the pavement. The car park is the festival meet. */
  private konbini(s: Structure, i: number) {
    const front = this.plan.front[i];
    this.frame(s, front);
    const chain = this.plan.chain.get(i) ?? 0;
    const side = this.plan.lotSide.get(i) ?? 1;
    const lot0 = s.hx + LOT.offset,
      lot1 = lot0 + LOT.length,
      deep = s.hz * 2;
    this.small = false;
    // Pole sign: 9.7 m, lit 2.2 m box and a 24H/P/ATM strip below.
    const foot = this.at(s, side * (lot1 - 0.5), 0, 0.45);
    const g = this.ground(foot);
    foot.y = g;
    this.post(foot, 9.7, 0.36, 0xa9adaf);
    const faces = this.t;
    this.slab(
      foot.clone().setY(g + 8.5),
      faces,
      2.2,
      2.2,
      0.5,
      LAYOUT.pole(chain),
      LAYOUT.pole(chain),
      0xd9dbdc,
      0.75,
      0,
    );
    this.slab(
      foot.clone().setY(g + 6.95),
      faces,
      2.2,
      0.62,
      0.4,
      LAYOUT.strip(chain),
      LAYOUT.strip(chain),
      0xd9dbdc,
      0.7,
      0,
    );
    // Logo plaque on the fascia.
    this.slab(
      this.attach(s, 0, 3.52, 0.76),
      this.n,
      2.4,
      0.6,
      0.06,
      LAYOUT.pole(chain),
      null,
      0xf2f2ee,
      0.6,
      0,
    );
    this.small = true;
    // The glazed front and the lot floodlights light the forecourt (081/083).
    this.light(this.at(s, 0, g, 2.4), 0xf2f5ff, 1.3, 5.5);
    for (const f of [0.3, 0.75])
      this.light(this.at(s, side * (lot0 + LOT.length * f), g, -2.6), 0xfff2dc, 0.8, 5.5);
    // Asphalt apron over the whole car park, on the carved ground.
    const p = new T.Vector3();
    const stepsX = 8,
      stepsZ = Math.max(2, Math.round((deep + 1.2) / 2.5));
    for (let a = 0; a < stepsX; a++)
      for (let b = 0; b < stepsZ; b++) {
        const xa = lot0 + (a * LOT.length) / stepsX,
          xb = lot0 + ((a + 1) * LOT.length) / stepsX,
          za = 1.2 - (b * (deep + 1.2)) / stepsZ,
          zb = 1.2 - ((b + 1) * (deep + 1.2)) / stepsZ;
        const corners = [
          [xa, za],
          [xb, za],
          [xb, zb],
          [xa, zb],
        ].map(([x, z]) => {
          this.at(s, side * x, 0, z, p);
          return p.clone().setY(this.ground(p) + 0.03);
        });
        this.flat(corners, LAYOUT.asphalt, 0xffffff);
      }
    const bays = Math.floor((LOT.length - 1) / 2.5);
    const rows: [number, number][] = [[-0.4, -5.4]];
    if (deep >= 16.4) rows.push([-deep + 0.2, -deep + 5.2]);
    for (const [z0, z1] of rows)
      for (let k = 0; k <= bays; k++) {
        const x = lot0 + 0.5 + k * 2.5;
        const line = [
          [x - 0.06, z0],
          [x + 0.06, z0],
          [x + 0.06, z1],
          [x - 0.06, z1],
        ].map(([lx, z]) => {
          const q = this.at(s, side * lx, 0, z);
          return q.setY(this.ground(q) + 0.045);
        });
        this.flat(line, LAYOUT.white, 0xf2f2ee, 0.02);
        if (k === bays) continue;
        // Wheel stops at the head of each bay.
        const head = Math.abs(z0) < Math.abs(z1) ? z1 + 0.55 : z0 - 0.55;
        for (const off of [0.75, 1.75]) {
          const stop = this.at(s, side * (x + off), 0, head);
          stop.y = this.ground(stop) + 0.075;
          this.slab(stop, this.n, 0.62, 0.15, 0.12, null, null, 0xc9c6bd);
        }
        this.stats.bays++;
      }
    // Two machines against the store's side wall, facing the car park.
    for (const [k, z] of [
      [0, -1.4],
      [1, -2.45],
    ] as const) {
      const q = this.at(s, side * (s.hx + 0.38), 0, z);
      q.y = this.ground(q) + 0.915;
      const out = this.t.clone().multiplyScalar(side);
      this.slab(
        q,
        out,
        1.0,
        1.83,
        0.74,
        LAYOUT.vending(k),
        null,
        new T.Color(VENDING[k]).getHex(),
        0.7,
        0,
      );
      this.stats.vending++;
    }
    // Banners along the pavement edge of the car park and festival flags.
    for (let k = 0; k < 3; k++) this.nobori(s, side * (lot0 + 1.6 + k * 4.6), k === 1 ? 4 : 3);
    this.nobori(s, -side * (s.hx - 1.0), 0);
    this.stats.stores++;
  }

  update(time: number, night: number, camera: T.Camera, preset: QualityPreset) {
    this.uniforms.signTime.value = time;
    this.uniforms.signNight.value = night;
    this.screens.update(time, night);
    camera.getWorldPosition(this.eye);
    const range =
      preset === 'low' ? 420 : preset === 'medium' ? 650 : preset === 'high' ? 900 : 1200;
    const street =
      preset === 'low' ? 120 : preset === 'medium' ? 190 : preset === 'high' ? 260 : 340;
    for (const { mesh, small } of this.meshes) {
      const sphere = mesh.geometry.boundingSphere!;
      mesh.visible = this.eye.distanceTo(sphere.center) - sphere.radius < (small ? street : range);
    }
    const screens = this.screens.mesh;
    if (screens) {
      const sphere = screens.geometry.boundingSphere!;
      screens.visible = this.eye.distanceTo(sphere.center) - sphere.radius < range;
    }
  }

  dispose() {
    this.screens.dispose();
    for (const { mesh } of this.meshes) mesh.geometry.dispose();
    this.meshes.length = 0;
    this.material.dispose();
    this.atlas.dispose();
    this.root.clear();
    this.root.removeFromParent();
  }
}
