import { CIRCUITS, CIRCUIT_IDS, type CircuitId } from '../simulation/circuits.ts';
import type { CatalogueGroup } from '../simulation/circuit-catalogue/venue-data.ts';

/** Circuit selection copy (WP29-WP30): grouped Original / Real-world /
 * Unconventional, each layout with its lap length, corner count and a short
 * description. Aurel and Vellamar keep their established labels. */
const ORIGINAL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  aurel: 'Aurel Grand Circuit · 2.97 km',
  vellamar: 'Vellamar Coast Circuit · 4.00 km',
});
const ORIGINAL_BLURBS: Readonly<Record<string, string>> = Object.freeze({
  aurel: 'The original compact grand circuit: quarry, orchard and works districts.',
  vellamar:
    'Original coastal-mountain circuit: a 45 m ridge, the Belvedere hairpin and the banked Lantern.',
});
export const CIRCUIT_GROUPS: readonly { group: CatalogueGroup; label: string }[] = Object.freeze([
  { group: 'original', label: 'Original' },
  { group: 'real-world', label: 'Real-world approximations' },
  { group: 'unconventional', label: 'Unconventional' },
]);
export function circuitGroup(id: CircuitId): CatalogueGroup {
  return CIRCUITS[id].catalogue?.group ?? 'original';
}
function catalogueLabel(id: CircuitId) {
  const meta = CIRCUITS[id].catalogue!;
  const name = meta.layout === 'Grand Prix' ? meta.venueName : `${meta.venueName} — ${meta.layout}`;
  return `${name} · ${(meta.length / 1000).toFixed(2)} km`;
}
export const CIRCUIT_MENU_LABELS: Readonly<Record<CircuitId, string>> = Object.freeze(
  Object.fromEntries(
    CIRCUIT_IDS.map((id) => [id, ORIGINAL_LABELS[id] ?? catalogueLabel(id)]),
  ) as Record<CircuitId, string>,
);
/** One line under the selector: group, corners, DRS zones and the brief. */
export function circuitBlurb(id: CircuitId) {
  const def = CIRCUITS[id],
    group = CIRCUIT_GROUPS.find((g) => g.group === circuitGroup(id))!.label,
    text = def.catalogue?.description ?? ORIGINAL_BLURBS[id] ?? '';
  return `${group} · ${def.corners.length} named corners · ${def.drsZones.length} DRS · ${text}`;
}
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** `<optgroup>`ed options for the CIRCUIT selector. */
export function circuitOptionsHtml() {
  return CIRCUIT_GROUPS.map(({ group, label }) => {
    const ids = CIRCUIT_IDS.filter((id) => circuitGroup(id) === group);
    return ids.length
      ? `<optgroup label="${escape(label)}">${ids.map((id) => `<option value="${id}">${escape(CIRCUIT_MENU_LABELS[id])}</option>`).join('')}</optgroup>`
      : '';
  }).join('');
}
