import * as T from 'three';

/** Original roadside sign faces for the festival region, drawn at runtime on
 * one 1024x1024 canvas (4x4 cells of 256 px; the green expressway boards
 * take two cells). Japanese road-sign conventions (inverted red 止まれ
 * triangle, red-ringed speed limits with blue numerals, yellow diamond
 * warnings, yellow/black chevron boards, green expressway guide signs with
 * kanji over English), with invented place names only: no logos, brands or
 * real route numbers. */
export const SIGN = Object.freeze({
  chevron: 0,
  stop: 1,
  speed30: 2,
  speed40: 3,
  speed50: 4,
  curveLeft: 5,
  curveRight: 6,
  hazard: 7,
  /** Two-cell green guide boards (cells 8-9, 10-11, 12-13). */
  guide: [8, 10, 12] as const,
  exit: 14,
  banded: 15,
});
/** Invented Japanese names for the region's places, with the English the
 * region data already uses. */
export const PLACE_NAMES = Object.freeze([
  { ja: '伊瀬港', en: 'Port Ilse' },
  { ja: '葦谷', en: 'Ashvale' },
  { ja: '鷹野', en: 'Kestrel' },
  { ja: '茨森', en: 'Thornwood' },
  { ja: '春田峠', en: 'Varda Pass' },
  { ja: '灯台岬', en: 'Lighthouse' },
]);
const GUIDE_BOARDS = [
  [0, 4, 'left'],
  [1, 2, 'up'],
  [3, 5, 'right'],
] as const;

/** UV rectangle [u0, v0, u1, v1] of `cells` cells starting at `cell`, with
 * a 3-pixel guard band. `mirror` swaps u (a chevron pointing the other way). */
export function signRect(
  cell: number,
  cells = 1,
  mirror = false,
): [number, number, number, number] {
  const col = cell % 4,
    row = Math.floor(cell / 4),
    g = 3 / 1024,
    u0 = col / 4 + g,
    u1 = (col + cells) / 4 - g,
    v0 = 1 - (row + 1) / 4 + g,
    v1 = 1 - row / 4 - g;
  return mirror ? [u1, v0, u0, v1] : [u0, v0, u1, v1];
}

const JP = '"Noto Sans JP", "Noto Sans CJK JP", "Hiragino Sans", "Yu Gothic", sans-serif';

export function roadSignAtlas(): T.Texture {
  if (typeof document === 'undefined') {
    const t = new T.DataTexture(new Uint8Array([230, 190, 40, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Road sign atlas needs a 2D canvas context');
  ctx.fillStyle = '#7d8286';
  ctx.fillRect(0, 0, 1024, 1024);
  const cell = (i: number, draw: (x: number, y: number) => void) => {
    const x = (i % 4) * 256,
      y = Math.floor(i / 4) * 256;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, 256 * (i >= 8 && i < 14 ? 2 : 1), 256);
    ctx.clip();
    draw(x, y);
    ctx.restore();
  };
  const yellow = '#f2c31b',
    black = '#16171a',
    red = '#cf2a27',
    blue = '#1f4ea3',
    green = '#14774a';
  // Yellow board with a black chevron pointing left (矢羽根).
  cell(SIGN.chevron, (x, y) => {
    ctx.fillStyle = yellow;
    ctx.fillRect(x, y, 256, 256);
    ctx.fillStyle = black;
    ctx.beginPath();
    ctx.moveTo(x + 40, y + 128);
    ctx.lineTo(x + 150, y + 22);
    ctx.lineTo(x + 214, y + 22);
    ctx.lineTo(x + 104, y + 128);
    ctx.lineTo(x + 214, y + 234);
    ctx.lineTo(x + 150, y + 234);
    ctx.closePath();
    ctx.fill();
  });
  // Inverted red triangle with white border and 止まれ.
  cell(SIGN.stop, (x, y) => {
    ctx.fillStyle = '#7d8286';
    ctx.fillRect(x, y, 256, 256);
    const tri = (inset: number) => {
      ctx.beginPath();
      ctx.moveTo(x + 8 + inset * 1.73, y + 22 + inset);
      ctx.lineTo(x + 248 - inset * 1.73, y + 22 + inset);
      ctx.lineTo(x + 128, y + 230 - inset * 2);
      ctx.closePath();
    };
    ctx.fillStyle = '#f4f4f0';
    tri(0);
    ctx.fill();
    ctx.fillStyle = red;
    tri(9);
    ctx.fill();
    ctx.fillStyle = '#f7f7f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 52px ${JP}`;
    ctx.fillText('止まれ', x + 128, y + 86);
  });
  // Speed limits: white disc, red ring, blue numerals (最高速度).
  for (const [i, n] of [
    [SIGN.speed30, '30'],
    [SIGN.speed40, '40'],
    [SIGN.speed50, '50'],
  ] as const)
    cell(i, (x, y) => {
      ctx.fillStyle = '#7d8286';
      ctx.fillRect(x, y, 256, 256);
      ctx.beginPath();
      ctx.arc(x + 128, y + 128, 124, 0, Math.PI * 2);
      ctx.fillStyle = '#f6f6f2';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 128, y + 128, 104, 0, Math.PI * 2);
      ctx.lineWidth = 26;
      ctx.strokeStyle = red;
      ctx.stroke();
      ctx.fillStyle = blue;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 118px "Noto Sans", Arial, sans-serif';
      ctx.save();
      ctx.translate(x + 128, y + 134);
      ctx.scale(0.78, 1);
      ctx.fillText(n, 0, 0);
      ctx.restore();
    });
  // Yellow diamond warnings: bend to the left / right (警戒標識).
  for (const [i, dir] of [
    [SIGN.curveLeft, -1],
    [SIGN.curveRight, 1],
  ] as const)
    cell(i, (x, y) => {
      ctx.fillStyle = '#7d8286';
      ctx.fillRect(x, y, 256, 256);
      const diamond = (r: number) => {
        ctx.beginPath();
        ctx.moveTo(x + 128, y + 128 - r);
        ctx.lineTo(x + 128 + r, y + 128);
        ctx.lineTo(x + 128, y + 128 + r);
        ctx.lineTo(x + 128 - r, y + 128);
        ctx.closePath();
      };
      ctx.fillStyle = black;
      diamond(126);
      ctx.fill();
      ctx.fillStyle = yellow;
      diamond(114);
      ctx.fill();
      ctx.strokeStyle = black;
      ctx.lineWidth = 18;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(x + 128 - dir * 22, y + 200);
      ctx.lineTo(x + 128 - dir * 22, y + 128);
      ctx.quadraticCurveTo(x + 128 - dir * 22, y + 92, x + 128 + dir * 18, y + 80);
      ctx.stroke();
      ctx.fillStyle = black;
      ctx.beginPath();
      ctx.moveTo(x + 128 + dir * 56, y + 72);
      ctx.lineTo(x + 128 + dir * 10, y + 52);
      ctx.lineTo(x + 128 + dir * 18, y + 104);
      ctx.closePath();
      ctx.fill();
    });
  // Yellow/black diagonal hazard stripes (pole sleeves, pier guards).
  cell(SIGN.hazard, (x, y) => {
    ctx.fillStyle = yellow;
    ctx.fillRect(x, y, 256, 256);
    ctx.fillStyle = black;
    for (let k = -4; k < 8; k++) {
      ctx.beginPath();
      ctx.moveTo(x + k * 64, y + 256);
      ctx.lineTo(x + k * 64 + 32, y + 256);
      ctx.lineTo(x + k * 64 + 32 + 256, y);
      ctx.lineTo(x + k * 64 + 256, y);
      ctx.closePath();
      ctx.fill();
    }
  });
  // Green expressway guide boards (方面看板): two destinations over English.
  GUIDE_BOARDS.forEach(([a, b, arrow], k) =>
    cell(SIGN.guide[k], (x, y) => {
      ctx.fillStyle = green;
      ctx.fillRect(x, y, 512, 256);
      ctx.strokeStyle = '#eef3ef';
      ctx.lineWidth = 6;
      ctx.strokeRect(x + 10, y + 10, 492, 236);
      ctx.fillStyle = '#f4f7f4';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      [a, b].forEach((p, j) => {
        const cx = x + 150 + j * 210;
        ctx.font = `700 64px ${JP}`;
        ctx.fillText(PLACE_NAMES[p].ja, cx, y + 98);
        ctx.font = '600 28px "Noto Sans", Arial, sans-serif';
        ctx.fillText(PLACE_NAMES[p].en, cx, y + 152);
      });
      ctx.strokeStyle = '#f4f7f4';
      ctx.fillStyle = '#f4f7f4';
      ctx.lineWidth = 14;
      const ax = x + 256,
        ay = y + 206;
      ctx.beginPath();
      if (arrow === 'up') {
        ctx.moveTo(ax, ay + 30);
        ctx.lineTo(ax, ay - 18);
      } else {
        const d = arrow === 'left' ? -1 : 1;
        ctx.moveTo(ax - d * 60, ay);
        ctx.lineTo(ax + d * 40, ay);
      }
      ctx.stroke();
      ctx.beginPath();
      if (arrow === 'up') {
        ctx.moveTo(ax - 22, ay - 14);
        ctx.lineTo(ax + 22, ay - 14);
        ctx.lineTo(ax, ay - 40);
      } else {
        const d = arrow === 'left' ? -1 : 1;
        ctx.moveTo(ax + d * 36, ay - 22);
        ctx.lineTo(ax + d * 36, ay + 22);
        ctx.lineTo(ax + d * 64, ay);
      }
      ctx.closePath();
      ctx.fill();
    }),
  );
  // 出口 EXIT panel (yellow on green is the Japanese exit convention).
  cell(SIGN.exit, (x, y) => {
    ctx.fillStyle = green;
    ctx.fillRect(x, y, 256, 256);
    ctx.fillStyle = '#f2c31b';
    ctx.fillRect(x + 20, y + 40, 216, 176);
    ctx.fillStyle = black;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 80px ${JP}`;
    ctx.fillText('出口', x + 128, y + 106);
    ctx.font = '700 40px "Noto Sans", Arial, sans-serif';
    ctx.fillText('EXIT', x + 128, y + 180);
  });
  // Red/white bands (corner posts at junction mouths).
  cell(SIGN.banded, (x, y) => {
    for (let k = 0; k < 8; k++) {
      ctx.fillStyle = k % 2 ? '#f2f2ee' : red;
      ctx.fillRect(x, y + k * 32, 256, 32);
    }
  });
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
