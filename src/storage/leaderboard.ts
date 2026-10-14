/** Local time-trial leaderboard (D31): the ten fastest valid laps per circuit,
 * kept in the save store (IndexedDB) under `leaderboardKey(circuit)`. */
export const LEADERBOARD_SIZE = 10;
export interface LeaderboardEntry {
  lapTime: number;
  driver: string;
  assist: string;
  compound: string;
  weather: string;
  /** Session that set it. Equal times keep their earlier order (stable sort). */
  session: string;
}
/** One board per circuit, vehicle and physics version (masterplan §22.5).
 * The Formula APX-01 under physics v1 keeps the original key and entries. */
export const leaderboardKey = (circuit: string, vehicle = 'apx01', physics = 1) =>
  vehicle === 'apx01' && physics === 1
    ? `leaderboard:${circuit}`
    : `leaderboard:${circuit}:${vehicle}:p${physics}`;

function valid(entry: unknown): entry is LeaderboardEntry {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.lapTime === 'number' &&
    Number.isFinite(e.lapTime) &&
    e.lapTime > 0 &&
    ['driver', 'assist', 'compound', 'weather', 'session'].every(
      (key) => typeof e[key] === 'string',
    )
  );
}
/** A stored board, validated and sorted (a corrupt save reads as empty). */
export function readLeaderboard(value: unknown): LeaderboardEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(valid)
    .map((e) => ({ ...e, driver: e.driver.slice(0, 24) }))
    .sort((a, b) => a.lapTime - b.lapTime)
    .slice(0, LEADERBOARD_SIZE);
}
/** Insert a lap; returns the new board and its 1-based rank (0 if it missed the top ten). */
export function insertLeaderboard(value: unknown, entry: LeaderboardEntry) {
  if (!valid(entry)) throw new Error('Invalid leaderboard lap');
  const board = readLeaderboard([...readLeaderboard(value), entry]);
  const rank =
    board.findIndex(
      (e) =>
        e.lapTime === entry.lapTime && e.session === entry.session && e.driver === entry.driver,
    ) + 1;
  return { board, rank };
}
