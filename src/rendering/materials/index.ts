/**
 * Public entry of the shared physically based material library.
 *
 *   import { materials } from '../rendering/materials/index.ts';
 *   materials.carPaint({ color: 0x1b4fd8, flake: 0.7 });
 *   materials.carbon({ finish: 'satin' });
 *   materials.rubber({ wear: 0.3 });
 *   materials.metal({ kind: 'brushed', metal: 'aluminium' });
 *   materials.glass({ tint: 0xa9bccc });
 *   materials.asphalt({ variant: 'patched' });
 *   materials.wetRoad({ wetness: 1 });
 *   materials.concrete({ variant: 'rough', horizontal: 0 });
 *   materials.vegetation({ translucency: 0.4, alphaMap });
 *   materials.soil({ tile: 1.4 });
 *
 * See library.ts for the shared conventions and docs/production/RENDERING_PIPELINE.md.
 */
import {
  asphalt,
  boxProjectUv,
  carbon,
  carPaint,
  concrete,
  glass,
  materialDiagnostics,
  metal,
  prepareMaterials,
  rubber,
  setSurfaceWeather,
  soil,
  vegetation,
  wetRoad,
} from './library.ts';

export const materials = Object.freeze({
  carPaint,
  carbon,
  rubber,
  metal,
  glass,
  asphalt,
  wetRoad,
  concrete,
  soil,
  vegetation,
  boxProjectUv,
  setSurfaceWeather,
  prepare: prepareMaterials,
  diagnostics: materialDiagnostics,
});
export type {
  AsphaltOptions,
  CarbonOptions,
  CarPaintOptions,
  ConcreteOptions,
  GlassOptions,
  MetalOptions,
  RubberOptions,
  SoilOptions,
  VegetationOptions,
} from './library.ts';
export { METAL_F0, surfaceWeather, wetSurfaceResponse } from './library.ts';
export { PROCEDURAL_RECIPES, ProceduralTextures } from './procedural.ts';
