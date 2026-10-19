import * as T from 'three';
import type { SurveyBuilding } from '../../../simulation/open-world/survey.ts';
export interface BuildingLabel {
  text: string;
  named: boolean;
  index: number;
}
/** One generated, bounded atlas. Names/house numbers come from the snapshot;
 * plaque styling and placement are authored, not copied from photography. */
export class BuildingLabels {
  readonly entries = new Map<string, BuildingLabel>();
  readonly columns = 8;
  readonly rows: number;
  constructor(buildings: readonly SurveyBuilding[]) {
    for (const b of [...buildings].sort((a, b) => a.id.localeCompare(b.id))) {
      const text = b.tags.name?.trim() || b.tags['addr:housenumber']?.trim();
      if (text && this.entries.size < 256)
        this.entries.set(b.id, { text, named: !!b.tags.name?.trim(), index: this.entries.size });
    }
    this.rows = 2 ** Math.ceil(Math.log2(Math.max(1, Math.ceil(this.entries.size / this.columns))));
  }
  texture(): T.Texture {
    if (typeof document === 'undefined') {
      const texture = new T.DataTexture(new Uint8Array([220, 213, 191, 255]), 1, 1);
      texture.colorSpace = T.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    }
    const canvas = document.createElement('canvas');
    canvas.width = this.columns * 256;
    canvas.height = this.rows * 64;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Mapped building labels require Canvas2D');
    for (const entry of this.entries.values()) {
      const x = (entry.index % this.columns) * 256,
        y = Math.floor(entry.index / this.columns) * 64;
      g.fillStyle = entry.named ? '#22312f' : '#dfd7bd';
      g.fillRect(x, y, 256, 64);
      g.strokeStyle = entry.named ? '#b9b5a0' : '#3c4440';
      g.lineWidth = 1.5;
      g.strokeRect(x + 7, y + 7, 242, 50);
      g.fillStyle = entry.named ? '#f1ecd9' : '#25312c';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let size = entry.named ? 26 : 34;
      do {
        g.font = `600 ${size--}px sans-serif`;
      } while (g.measureText(entry.text).width > 232 && size > 11);
      g.fillText(entry.text, x + 128, y + 33, 232);
    }
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.name = 'Charlottetown / mapped names and addresses / generated lettering';
    return texture;
  }
}
