import type { LightingMode } from '../rendering/sky-light.ts';

/** Festival time of day (presentation): the shared circuit lightings plus the
 * festival's own blue hour. Dusk runs on the shared night machinery (lamps,
 * windows, headlights, the night sky key and grade base) with festival
 * overrides (open-world/festival-dusk.ts); circuits never see it. A light
 * module (no renderer imports) shared by the save, the menu and the renderer. */
export type FestivalLighting = LightingMode | 'dusk';
export const FESTIVAL_LIGHTINGS: readonly FestivalLighting[] = Object.freeze([
  'day',
  'sunset',
  'dusk',
  'night',
]);
export const FESTIVAL_LIGHTING_LABEL: Readonly<Record<FestivalLighting, string>> = Object.freeze({
  day: 'Day',
  sunset: 'Golden hour',
  dusk: 'Dusk · blue hour',
  night: 'Night',
});
export function isFestivalLighting(value: unknown): value is FestivalLighting {
  return typeof value === 'string' && (FESTIVAL_LIGHTINGS as readonly string[]).includes(value);
}
/** The shared lighting a festival time of day runs on. */
export function festivalBaseLighting(value: FestivalLighting): LightingMode {
  return value === 'dusk' ? 'night' : value;
}
/** Night amount of a time of day: street lamps, lit windows, signs, neon and
 * headlights. At blue hour they are on, a little below full night (the sky
 * still outshines the dimmest of them). */
export const FESTIVAL_NIGHT = Object.freeze({ day: 0, sunset: 0.25, dusk: 0.8, night: 1 } as const);
export function festivalNightAmount(value: FestivalLighting) {
  return FESTIVAL_NIGHT[value];
}
