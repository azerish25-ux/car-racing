/** Circuit catalogue vocabulary (masterplan §14–§15, WP29–WP30). This module
 * has no runtime imports so the circuit registry, the track and the renderer
 * can all read it without an import cycle. */

/** Every catalogue layout id, in menu order. Aurel and Vellamar stay first in
 * the registry; these follow them. */
export const CATALOGUE_CIRCUIT_IDS = Object.freeze([
  'parco-reale',
  'ardennes',
  'northfield',
  'northfield-classic',
  'kansai',
  'kansai-east',
  'riviera',
  'texas-hill',
  'neon-city',
  'neon-city-reverse',
  'alpine-pass',
  'alpine-pass-reverse',
  'speedbowl',
  'speedbowl-infield',
  'desert-canyon',
  'desert-canyon-reverse',
  'coastal-cliff',
  'coastal-cliff-reverse',
  'dockyard',
  'dockyard-reverse',
] as const);
export type CatalogueCircuitId = (typeof CATALOGUE_CIRCUIT_IDS)[number];
/** Terrain venues (src/simulation/offroad/venues.ts), after the catalogue. */
export const OFFROAD_CIRCUIT_IDS = Object.freeze([
  'valley-ridge-mx',
  'arena-nord-sx',
  'kestrel-rx',
  'pinewood-stage',
] as const);
export type OffroadCircuitId = (typeof OFFROAD_CIRCUIT_IDS)[number];

/** Menu groups (§15): approximations of public real-world geometry, original
 * venues, and unconventional venues. */
export type CatalogueGroup = 'real-world' | 'original' | 'unconventional' | 'off-road';

/** Run-off beyond the 4 m paint band, as the physical surface reads it. */
export const RUNOFF = Object.freeze({ GRASS: 0, GRAVEL: 1, ASPHALT: 2 } as const);
export type RunoffCode = (typeof RUNOFF)[keyof typeof RUNOFF];
export type RunoffKind = 'grass' | 'gravel' | 'asphalt';

/** Barrier construction (rendering) at the physical boundary line. */
export const BARRIER_KINDS = Object.freeze(['armco', 'concrete', 'tyre', 'safer', 'rock'] as const);
export type BarrierKind = (typeof BARRIER_KINDS)[number];

/** Dressing family for the procedural venue kit. */
export type VenueTheme =
  | 'parkland'
  | 'forest'
  | 'airfield'
  | 'hills'
  | 'harbour-street'
  | 'prairie'
  | 'neon-city'
  | 'alpine'
  | 'oval'
  | 'desert'
  | 'coastal-cliff'
  | 'dockyard'
  | 'motocross'
  | 'stadium'
  | 'rallycross'
  | 'forest-stage';

/** A lap-distance span on one side (+1 right of travel, -1 left). `from` may
 * exceed `to` when the span wraps through the start line. */
export interface VenueSpan {
  readonly from: number;
  readonly to: number;
  readonly side: 1 | -1;
}
export interface BarrierSpan extends VenueSpan {
  readonly kind: BarrierKind;
}
export interface LapSpan {
  readonly from: number;
  readonly to: number;
}
/** Where two lap stations share a horizontal position on different layers. */
export interface RouteCrossing {
  /** Lap distance of the lower and upper road at the crossing. */
  readonly lower: number;
  readonly upper: number;
  readonly x: number;
  readonly z: number;
  /** Road-surface separation (m). */
  readonly clearance: number;
}
export interface CatalogueDressing {
  readonly barriers: readonly BarrierSpan[];
  /** Roofed road: tunnels and covered underpasses. */
  readonly tunnels: readonly LapSpan[];
  /** Street frontage (facades with windows) beside the barrier. */
  readonly facades: readonly VenueSpan[];
  /** Rock faces rising beside the road (cuttings, canyon walls). */
  readonly rock: readonly VenueSpan[];
  /** Open drops (cliff edge, harbour, embankment fall). */
  readonly drops: readonly VenueSpan[];
  /** Authored spectator stands (length in m). */
  readonly stands: readonly (VenueSpan & { readonly length: number })[];
  readonly crossings: readonly RouteCrossing[];
}
export interface CatalogueMeta {
  readonly group: CatalogueGroup;
  /** Venue family (shared by a venue's layouts). */
  readonly venue: string;
  readonly venueName: string;
  readonly layout: string;
  readonly description: string;
  /** Lap length (m) exactly as Track measures it. */
  readonly length: number;
  readonly theme: VenueTheme;
  /** Floodlit night venue: emissive facades, light towers. */
  readonly night: boolean;
  /** Real-world reference length (m) the layout was scaled to, when it is an
   * approximation of public geometry. */
  readonly referenceLength?: number;
  /** The layout this one reverses or re-routes. */
  readonly variantOf?: string;
  /** Sea level for coastal venues; null inland. */
  readonly seaLevel: number | null;
  readonly dressing: CatalogueDressing;
  /** Authoring diagnostics: straight-length closure adjustment and scale. */
  readonly authoring: {
    readonly authoredLength: number;
    readonly scale: number;
    readonly closureAdjustment: number;
    readonly controlPoints: number;
  };
}
