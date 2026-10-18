import { isSeason, type Season } from './festival-season.ts';
import {
  festivalVehicles,
  festivalDefaultVehicle,
} from '../simulation/open-world/festival-machines.ts';

/** Persisted festival state (`festival:v1`): discovered events, best results,
 * the chosen machine and the ambient traffic setting. A light module so the
 * career reads discoveries without loading the festival session. */
export interface FestivalSave {
  version: 1;
  discovered: string[];
  best: Record<string, { stars: number; time: number | null; value: number | null }>;
  vehicle: string;
  /** Ambient traffic on (default) or off; absent in saves before it existed. */
  traffic?: boolean;
  /** Presentation season; absent in saves before seasons existed (summer). */
  season?: Season;
}
export const FESTIVAL_SAVE_KEY = 'festival:v1';
export function validateFestivalSave(value: unknown): FestivalSave | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<FestivalSave>;
  if (v.version !== 1 || !Array.isArray(v.discovered) || typeof v.vehicle !== 'string') return null;
  return {
    version: 1,
    discovered: v.discovered.filter((d): d is string => typeof d === 'string').slice(0, 256),
    best: v.best && typeof v.best === 'object' ? v.best : {},
    vehicle: v.vehicle,
    traffic: typeof v.traffic === 'boolean' ? v.traffic : true,
    season: isSeason(v.season) ? v.season : 'summer',
  };
}
/** The machine a festival session drives, and the one the festival save
 * keeps. A road machine chosen in the MACHINE menu (a car or a road
 * motorcycle) wins over the save; the Formula default falls back to the
 * saved festival machine. The career's loan is driven but never saved: the
 * save keeps the player's own choice. */
export function festivalMachineChoice(
  options: { vehicle?: string; loaner?: boolean },
  saved: string,
): { drive: string; save: string } {
  const vehicles = festivalVehicles();
  const chosen = vehicles.find((v) => v.id === options.vehicle && v.classId !== 'formula');
  const kept = vehicles.some((v) => v.id === saved) ? saved : festivalDefaultVehicle();
  const drive = chosen?.id ?? kept;
  return { drive, save: options.loaner ? kept : drive };
}
