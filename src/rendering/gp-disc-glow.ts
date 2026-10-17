/** Carbon racing rotors do not radiate orange light at mild road temperatures.
 * The emissive term starts only once the carbon is very hot and rises as a
 * fourth-power-like curve. Pure state from the recorded disc temperature:
 * no frame counter or camera-dependent heat is introduced. */
export function gpDiscGlow(temperatureC: number): number {
  if (!Number.isFinite(temperatureC)) return 0;
  const t = Math.min(1, Math.max(0, (temperatureC - 620) / 460));
  return 0.58 * t * t * (3 - 2 * t);
}
