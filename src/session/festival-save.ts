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
  };
}
