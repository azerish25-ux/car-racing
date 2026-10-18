import * as T from 'three';

/** Painted Japanese road text (路面標示): white kana/kanji elongated about
 * 2.5:1 along the direction of travel, read far-to-near as the driver
 * approaches (止 nearest the stop line). Generic words only. One 1024x512
 * canvas atlas of 8x2 cells (128x256 px each), authored at runtime. */
export const ROAD_GLYPHS = [
  '止',
  'ま',
  'れ',
  '急',
  'カ',
  'ー',
  'ブ',
  '左',
  '右',
  'ス',
  'ピ',
  'ド',
  '落',
  'と',
  'せ',
  '注',
] as const;
export type RoadGlyph = (typeof ROAD_GLYPHS)[number];
export const ROAD_PHRASES = Object.freeze({
  stop: '止まれ',
  sharpBend: '急カーブ',
  leftBend: '左カーブ',
  rightBend: '右カーブ',
  slowDown: 'スピード落とせ',
});
const COLS = 8,
  ROWS = 2;
/** Painted size of one character (m): lane-width glyphs, 2.4 m long, 0.7 m
 * apart, measured against the 3.5 m mountain lanes of the touge references. */
export const GLYPH = Object.freeze({ width: 1.35, length: 2.4, gap: 0.7 });

/** Atlas UV rectangle [u0, v0, u1, v1] of a glyph (two-pixel guard band). */
export function glyphRect(glyph: string): [number, number, number, number] {
  const i = Math.max(0, ROAD_GLYPHS.indexOf(glyph as RoadGlyph)),
    col = i % COLS,
    row = Math.floor(i / COLS);
  const pu = 2 / 1024,
    pv = 2 / 512;
  return [col / COLS + pu, 1 - (row + 1) / ROWS + pv, (col + 1) / COLS - pu, 1 - row / ROWS - pv];
}

export function roadGlyphAtlas(): T.Texture {
  if (typeof document === 'undefined') {
    const t = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Road glyph atlas needs a 2D canvas context');
  ctx.clearRect(0, 0, 1024, 512);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font =
    '700 118px "Noto Sans JP", "Noto Sans CJK JP", "Hiragino Sans", "Yu Gothic", sans-serif';
  ROAD_GLYPHS.forEach((glyph, i) => {
    const x = (i % COLS) * 128 + 64,
      y = Math.floor(i / COLS) * 256 + 128;
    ctx.save();
    // Road text is stretched along the road so it reads foreshortened.
    ctx.translate(x, y);
    ctx.scale(1, 2.05);
    ctx.fillText(glyph, 0, 4);
    ctx.restore();
  });
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = T.LinearMipmapLinearFilter;
  return texture;
}
