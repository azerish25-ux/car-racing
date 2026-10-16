/** Cold boot includes the default-quality photographed ground/sky, supplied
 * vehicle and first shader compilation on CI's software GPU. In the actual
 * settings trace from run 38833685062 the menu appeared about 96 seconds
 * after navigation, just beyond the old 90-second deadline, without a page
 * error or failed asset request. This functional readiness allowance is not
 * a startup performance target; retain per-test deadlines and all subsequent
 * settings, race-state, frame-continuity and graphics assertions unchanged.
 */
export const MENU_STARTUP_TIMEOUT_MS = 180_000;
