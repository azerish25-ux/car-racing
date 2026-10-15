import * as T from 'three';
import { ImportedTextureBudget } from './imported-texture-budget.ts';

/** Resample generated canvases and opted-in immutable supplied-player maps.
 * Dynamic cockpit displays,
 * simulation state textures and render targets must retain their own ownership.
 * Keep one source canvas so quality can be restored without accumulating copies. */
export class TextureBudget {
  private readonly imported = new ImportedTextureBudget();
  private assets = new Map<T.CanvasTexture, HTMLCanvasElement>();
  private detailData = new Set<T.DataTexture>();
  private limit = 512;
  private anisotropy = 8;
  register(root: T.Object3D) {
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) {
          if (
            value instanceof T.Texture &&
            (value.userData.suppliedPlayerTexture === true ||
              value.userData.immutableAssetTexture === true)
          ) {
            this.imported.register(value);
            continue;
          }
          // Tiny prefiltered fabric maps retain their fixed resolution but obey
          // the same user-selected filtering budget. Simulation data is excluded.
          if (value instanceof T.DataTexture && value.userData.surfaceDetail === true) {
            this.detailData.add(value);
            value.anisotropy = this.anisotropy;
            continue;
          }
          if (!(value instanceof T.CanvasTexture) || value.userData.dynamic) continue;
          if (this.assets.has(value)) continue;
          const source = value.image as HTMLCanvasElement;
          if (!(source instanceof HTMLCanvasElement)) continue;
          this.assets.set(value, source);
          this.apply(value, source);
        }
      }
    });
  }
  configure(limit: number, anisotropy: number) {
    if (limit === this.limit && anisotropy === this.anisotropy) return;
    this.limit = limit;
    this.anisotropy = anisotropy;
    this.imported.configure(limit, anisotropy);
    for (const [texture, source] of this.assets) this.apply(texture, source);
    for (const texture of this.detailData) {
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
    }
  }
  /** Repainted source assets keep their registered ownership and budget. */
  refresh(texture: T.Texture) {
    if (!(texture instanceof T.CanvasTexture)) return;
    const source = this.assets.get(texture);
    if (source) this.apply(texture, source);
  }
  private apply(texture: T.CanvasTexture, source: HTMLCanvasElement) {
    const factor = Math.min(1, this.limit / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * factor));
    const height = Math.max(1, Math.round(source.height * factor));
    const current = texture.image as HTMLCanvasElement;
    if (current.width !== width || current.height !== height) {
      let image = source;
      if (factor < 1) {
        image = document.createElement('canvas');
        image.width = width;
        image.height = height;
        // The presented copy of a skin that diagnostics read back stays
        // CPU-backed like its source (car-livery flankLivery): an accelerated
        // copy makes getImageData wait behind every queued GPU submission.
        const context = image.getContext(
          '2d',
          texture.userData.cpuReadback === true ? { willReadFrequently: true } : undefined,
        );
        if (!context) throw new Error('Texture resampling requires Canvas 2D');
        context.drawImage(source, 0, 0, width, height);
      }
      texture.dispose();
      texture.image = image;
    }
    // A same-size budget canvas still needs the new source pixels after editing.
    const image = texture.image as HTMLCanvasElement;
    if (image !== source) {
      const context = image.getContext('2d');
      if (!context) throw new Error('Texture repaint requires Canvas 2D');
      context.clearRect(0, 0, image.width, image.height);
      context.drawImage(source, 0, 0, image.width, image.height);
    }
    texture.anisotropy = this.anisotropy;
    texture.generateMipmaps = true;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
  }
  dispose() {
    this.imported.dispose();
    this.assets.clear();
    this.detailData.clear();
  }
}
