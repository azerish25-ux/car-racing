import type { ScoreLine } from '../../core/scoring.ts';
import type { FestivalEventKind } from './region-data.ts';

/** The festival's typed result contract and event-kind vocabulary, without
 * the route planner (the career and the HUD import this module). */

/** Race formats start from a marker card with AI rivals; skill challenges
 * (traps, zones, drift zones) run whenever the player drives through them. */
export const RACE_KINDS: readonly FestivalEventKind[] = Object.freeze([
  'road-race',
  'circuit',
  'sprint',
  'showcase',
  'touge',
  'drag',
]);
export const isRace = (kind: FestivalEventKind) => RACE_KINDS.includes(kind);
export const EVENT_KIND_LABEL: Readonly<Record<FestivalEventKind, string>> = Object.freeze({
  'road-race': 'Road race',
  circuit: 'Circuit',
  sprint: 'Sprint',
  'speed-trap': 'Speed trap',
  'speed-zone': 'Speed zone',
  'drift-zone': 'Drift zone',
  showcase: 'Showcase',
  touge: 'Touge battle',
  drag: 'Drag race',
});

/** Result of a festival event: the typed object the career/progression
 * system consumes (FestivalSession forwards it to `onResult`; the career
 * validates it with `validateFestivalResult`). Version 2 added `runId`. */
export const FESTIVAL_RESULT_VERSION = 2;
export interface FestivalResult {
  kind: 'festival-result';
  version: typeof FESTIVAL_RESULT_VERSION;
  /** Unique per event run: `<session id>:<run number>`. A consumer pays or
   * records each run once, however often the result is delivered. */
  runId: string;
  regionId: string;
  eventId: string;
  eventName: string;
  eventKind: FestivalEventKind;
  vehicleId: string;
  completed: boolean;
  /** Abandoned by the player or off the route too long. */
  abandoned: boolean;
  /** Races: finishing position (1-based) and field size. */
  position: number | null;
  entrants: number;
  /** Elapsed event time (s) for races, zones and drift zones. */
  time: number | null;
  /** Speed trap: speed through the camera (km/h). */
  trapKmh: number | null;
  /** Speed zone: average speed through the zone (km/h). */
  averageKmh: number | null;
  /** Drift zone: total and the best scoring lines. */
  driftScore: number | null;
  driftLines: ScoreLine[];
  /** 0-3 stars against the authored targets (races: 3 win, 2 podium, 1 finish). */
  stars: number;
  /** Legal route distance credited by RouteProgress (m) and time off-route (s). */
  legalDistance: number;
  offRouteSeconds: number;
  standings: { car: number; name: string; vehicleId: string; time: number | null; progress: number }[];
  /** Simulation time the result was produced (s). */
  at: number;
  /** The AI drove the player's car for part of the event (not a record). */
  assisted: boolean;
  /** Times the player rewound during the run (allowed, but marked: the
   * career pays no clean-route bonus for a rewound run). */
  rewinds?: number;
  /** Touge battle: seconds ahead of the rival at the player's finish
   * (negative: behind). */
  margin?: number | null;
  /** Drag race timing slip (the player's run). */
  drag?: DragSlip | null;
}
/** A drag run's timing slip (s, km/h): reaction from green to leaving the
 * line (negative: a red light, disqualified), 18.3 m (60 ft) and 201 m
 * (eighth mile) times and the elapsed time over the measured distance from
 * leaving the line, and the trap speed over its last 20.1 m (66 ft). */
export interface DragSlip {
  lane: number;
  reaction: number | null;
  redLight: boolean;
  sixtyFoot: number | null;
  eighthMile: number | null;
  elapsed: number | null;
  trapKmh: number | null;
}
