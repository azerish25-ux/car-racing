import * as T from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { tagWeatherSurface } from './weather-presentation.ts';
import { canvasTexture } from './geometry.ts';
import type { BikeMaterials } from './bike.ts';
import type { RiderColours } from './rider.ts';

/** Original wordmarks; reference photographs are never shipped as textures. */
export function addGPIdentity(root: T.Group, materials: BikeMaterials) {
  const shell = root.children.find(
    (o) => o instanceof T.Mesh && o.name === 'GP bodywork / paint',
  ) as T.Mesh | undefined;
  if (!shell) return;
  const map = canvasTexture(1024, 384, (c) => {
    c.clearRect(0, 0, 1024, 384);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#e8edea';
    c.font = 'italic 900 111px "Saira Variable", sans-serif';
    c.fillText('MOTOBOUND', 512, 158, 965);
    c.fillRect(102, 244, 820, 5);
    c.font = '500 33px sans-serif';
    c.fillText('PROTOTYPE   /   RACING DIVISION', 512, 296, 930);
  });
  const material = new T.MeshPhysicalMaterial({
    map,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    roughness: 0.42,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
  });
  material.name = 'Original GP fairing identity';
  tagWeatherSurface(material, 'paint');
  materials.list.push(material);
  shell.updateMatrixWorld(true);
  for (const side of [-1, 1]) {
    const geometry = new DecalGeometry(
      shell,
      new T.Vector3(side * 0.206, -0.225, 0.13),
      new T.Euler(0, (side * Math.PI) / 2, 0),
      new T.Vector3(0.42, 0.157, 0.17),
    );
    const decal = new T.Mesh(geometry, material);
    decal.name = 'Conformal GP livery';
    decal.receiveShadow = true;
    root.add(decal);
  }
}

export function riderPanelTexture(colours: RiderColours, torso: boolean) {
  const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
  return canvasTexture(1024, 512, (c) => {
    c.fillStyle = css(colours.primary);
    c.fillRect(0, 0, 1024, 512);
    c.fillStyle = css(colours.secondary);
    // Deliberate cloth panel hierarchy; no false baked lighting.
    for (const x of [0, 512, 990]) c.fillRect(x, 0, 45, 512);
    c.beginPath();
    c.moveTo(30, 400);
    c.lineTo(225, 330);
    c.lineTo(425, 350);
    c.lineTo(495, 440);
    c.lineTo(495, 512);
    c.lineTo(30, 512);
    c.closePath();
    c.fill();
    c.fillStyle = css(colours.accent);
    c.fillRect(48, 24, 415, torso ? 30 : 21);
    c.fillRect(559, 24, 415, torso ? 30 : 21);
    c.fillRect(48, 448, 415, 9);
    c.fillRect(559, 448, 415, 9);
    if (torso) {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const x of [256, 768]) {
        c.font = 'italic 800 38px "Saira Variable", sans-serif';
        c.fillText('MOTOBOUND', x, 176, 380);
        c.font = '500 16px sans-serif';
        c.fillText('PROTOTYPE RACING', x, 211, 330);
      }
      // Front zipper: a narrow dark channel and repeated real-scale teeth.
      c.fillStyle = '#23272b';
      c.fillRect(253, 250, 6, 234);
      c.fillStyle = '#92969a';
      for (let y = 253; y < 480; y += 8) c.fillRect(252, y, 8, 2);
    }
  });
}

/** Paint laid out for helmetShell's azimuth/height UVs. Broad asymmetric
 * chevrons identify an entrant at riding distance; the smooth shell supplies
 * all lighting. This is original artwork, not an extracted racing livery. */
export function helmetLiveryTexture(colours: RiderColours) {
  const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
  return canvasTexture(1024, 512, (c) => {
    c.fillStyle = css(colours.primary);
    c.fillRect(0, 0, 1024, 512);
    const polygon = (points: readonly (readonly [number, number])[], colour: string) => {
      c.beginPath();
      points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fillStyle = colour;
      c.fill();
    };
    // Long crown lanes taper into the eye-port shoulders. The rear half has
    // the same panel cadence but different diagonal spacing for orientation.
    for (const x of [0, 512]) {
      polygon(
        [
          [x + 44, 0],
          [x + 162, 0],
          [x + 218, 168],
          [x + 171, 236],
          [x + 110, 202],
          [x + 67, 90],
        ],
        '#e5e9e7',
      );
      polygon(
        [
          [x + 56, 0],
          [x + 141, 0],
          [x + 196, 167],
          [x + 162, 208],
          [x + 123, 185],
          [x + 79, 78],
        ],
        css(colours.secondary),
      );
      polygon(
        [
          [x + 316, 0],
          [x + 407, 0],
          [x + 385, 94],
          [x + 312, 215],
          [x + 291, 169],
        ],
        css(colours.accent),
      );
      polygon(
        [
          [x + 360, 296],
          [x + 487, 216],
          [x + 512, 248],
          [x + 512, 439],
          [x + 292, 456],
          [x + 182, 423],
        ],
        css(colours.secondary),
      );
      polygon(
        [
          [x + 350, 312],
          [x + 501, 241],
          [x + 512, 259],
          [x + 369, 334],
          [x + 200, 441],
          [x + 182, 423],
        ],
        css(colours.accent),
      );
    }
    c.fillStyle = '#e5e9e7';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'italic 900 29px "Saira Variable", sans-serif';
    c.fillText('MB', 256, 187, 68);
    c.font = 'italic 800 40px "Saira Variable", sans-serif';
    c.fillText('MOTOBOUND', 768, 313, 282);
    c.font = '600 15px sans-serif';
    c.fillText('RACING EQUIPMENT', 768, 348, 256);
    // Fine lower edge trim follows the real neck-opening contour.
    c.fillStyle = css(colours.secondary);
    c.fillRect(0, 481, 1024, 31);
    c.fillStyle = css(colours.accent);
    c.fillRect(0, 475, 1024, 5);
  });
}
