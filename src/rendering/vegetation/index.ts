import type * as T from 'three';
import type { Track } from '../../simulation/track.ts';
import { skyPaletteFor } from '../assets/sky-catalogue.ts';
import type { QualityPreset } from '../options.ts';
import { VENUE_THEMES } from '../venue-kit/theme.ts';
import type { VenueKitContext } from '../venue-kit/context.ts';
import { photoVegetationEnabled, VegetationLibrary } from './library.ts';
import { speciesForPalette } from './species.ts';

export { VegetationLibrary, photoVegetationEnabled } from './library.ts';
export { PhotoForest, type PhotoPlant } from './forest.ts';
export { PhotoPlanting } from './planting.ts';
export { VEGETATION, vegetationUniforms } from './materials.ts';
export { SPECIES, speciesForPalette } from './species.ts';

/**
 * Load the photographic vegetation a circuit venue shows, or null (LOW,
 * nothing to plant, no browser, or every tree species failed): the caller
 * then builds the procedural planting.
 */
export async function loadVenueVegetation(
  renderer: T.WebGLRenderer,
  track: Track,
  preset: QualityPreset,
  kit: VenueKitContext | null,
): Promise<VegetationLibrary | null> {
  if (!photoVegetationEnabled(preset) || typeof document === 'undefined') return null;
  const style = track.circuit.catalogue ? VENUE_THEMES[track.circuit.catalogue.theme] : null;
  const trees = !style || !!style.planting || style.forestBelts;
  const grass = !style || style.ground === 'grass';
  const shrubs = !style || (style.scrub > 0 && !style.desertScrub) || grass;
  if (!trees && !grass && !shrubs) return null;
  const palette = skyPaletteFor(track.circuit);
  const ids = speciesForPalette(palette, shrubs, grass).filter(
    (id) => trees || id === 'shrub-flowering' || id === 'grass-meadow',
  );
  try {
    const library = await VegetationLibrary.load(renderer, ids);
    if (trees && !library.trees.length) {
      library.dispose();
      return null;
    }
    if (!library.species.size) return null;
    if (kit && shrubs) kit.photoShrubs = [];
    return library;
  } catch (error) {
    console.warn('Photographic vegetation unavailable, procedural planting kept:', error);
    return null;
  }
}
