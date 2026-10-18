import * as T from 'three';
import { Random } from '../../core/math.ts';

/** Own all returned maps with the material's venue. Original canvas graphics,
 * stitching and wear: reference pixels and sponsor marks are never embedded. */
export function mxPaddingMaterial(pale = false) {
  let map: T.Texture | null = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('Motocross canvas padding requires a 2D canvas');
    c.fillStyle = pale ? '#c4bda7' : '#344541';
    c.fillRect(0, 0, 512, 256);
    const r = new Random(pale ? 1003 : 1002);
    // Low-frequency rubbed edges and dirt are separate from the fine weave.
    for (let i = 0; i < 500; i++) {
      const x = r.next() * 512,
        y = r.next() * 256;
      c.fillStyle = `rgba(55,39,24,${(0.03 + 0.12 * r.next()).toFixed(3)})`;
      c.beginPath();
      c.ellipse(x, y, 2 + r.next() * 18, 1 + r.next() * 5, r.next(), 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = pale ? '#8c8574' : '#72817a';
    c.lineWidth = 2;
    c.strokeRect(10, 12, 492, 232);
    c.setLineDash([3, 4]);
    c.lineWidth = 1;
    c.strokeRect(14, 16, 484, 224);
    c.setLineDash([]);
    c.fillStyle = pale ? '#39423d' : '#d8d4be';
    c.font = 'italic 700 42px sans-serif';
    c.textAlign = 'center';
    c.fillText('MOTOBOUND', 256, 137, 410);
    c.font = '600 12px sans-serif';
    c.fillText('OFFROAD / COURSE SAFETY', 256, 161, 280);
    // Folded end straps remain legible at close range, not a bold racing stripe.
    c.fillStyle = pale ? 'rgba(70,65,52,.22)' : 'rgba(8,16,13,.3)';
    for (const x of [28, 470]) c.fillRect(x, 18, 12, 220);
    map = new T.CanvasTexture(canvas);
    map.colorSpace = T.SRGBColorSpace;
    map.anisotropy = 4;
  }
  const size = 64,
    normal = new Uint8Array(size * size * 4),
    rough = new Uint8Array(size * size * 4);
  const r = new Random(814);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      normal.set([128 + (x % 2 ? 10 : -10), 128 + (y % 2 ? -8 : 8), 254, 255], i);
      const value = 218 + Math.floor(r.next() * 26);
      rough.set([value, value, value, 255], i);
    }
  const weave = new T.DataTexture(normal, size, size);
  const roughness = new T.DataTexture(rough, size, size);
  for (const texture of [weave, roughness]) {
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.set(6, 3);
    texture.magFilter = T.LinearFilter;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }
  return new T.MeshStandardMaterial({
    name: 'MX stitched and scuffed canvas padding',
    color: map ? 0xffffff : pale ? 0xc4bda7 : 0x344541,
    map,
    roughness: 1,
    roughnessMap: roughness,
    normalMap: weave,
    normalScale: new T.Vector2(0.14, 0.14),
  });
}
