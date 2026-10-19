import type { CharlottetownDiscipline } from '../ui/charlottetown-map.ts';

export function cityLaunchRequested(search: string) {
  return new URLSearchParams(search).get('map') === 'charlottetown';
}
/** Only the three admitted disciplines are accepted; URL values never select
 * arbitrary modules, assets, files or saved machines. A click still starts play. */
export function cityLaunchDiscipline(search: string): CharlottetownDiscipline | null {
  const value = new URLSearchParams(search).get('discipline');
  return value === 'formula' || value === 'motogp' || value === 'horizon' ? value : null;
}
