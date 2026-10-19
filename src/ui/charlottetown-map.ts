import { VEHICLES } from '../simulation/vehicles.ts';
import './charlottetown-map.css';
export type CharlottetownDiscipline = 'formula' | 'motogp' | 'horizon';
/** Explicit mode selection must not silently replace an F1 car with the
 * saved festival road car. The map shares the production machine registry. */
export function charlottetownVehicle(mode: CharlottetownDiscipline, selected?: string) {
  const vehicle = selected ? VEHICLES[selected] : undefined;
  const admitted =
    mode === 'formula'
      ? vehicle?.classId === 'formula'
      : mode === 'motogp'
        ? vehicle?.classId === 'gp-bike'
        : !!vehicle &&
          ![
            'formula',
            'kart',
            'gp-bike',
            'superbike',
            'supersport',
            'classic-bike',
            'road-bike',
            'motocross',
            'enduro',
          ].includes(vehicle.classId);
  return admitted ? vehicle!.id : mode === 'formula' ? 'apx01' : mode === 'motogp' ? 'gpr1' : 'sc7';
}
/** No imagery embedded: the miniature illustrates the street alignment. */
export function charlottetownMapCard() {
  return `<section class="city-map-card" aria-labelledby="cityMapTitle">
    <div class="city-map-top"><span>NEW MAP · PRINCE EDWARD ISLAND</span><b>1.706 KM</b></div>
    <div class="city-map-description"><svg viewBox="0 0 155 94" aria-hidden="true"><path d="M13 17L32 9L88 77L145 37L137 29"/><circle cx="13" cy="17" r="4"/><rect x="133" y="25" width="8" height="8"/><text x="3" y="37">MALONEY</text><text x="87" y="16">CAMPUS</text></svg><div><h2 id="cityMapTitle">CHARLOTTETOWN</h2><p>Maloney Drive → Queen → Kent → Weymouth<br>Holland College · Point-to-point &amp; free drive</p></div></div>
    <div class="city-map-modes" role="group" aria-label="Drive Charlottetown"><button type="button" data-action="charlottetown:formula">F1 <span>FORMULA CAR</span></button><button type="button" data-action="charlottetown:motogp">MotoGP <span>GP MOTORCYCLE</span></button><button type="button" data-action="charlottetown:horizon">Horizon <span>ROAD CAR</span></button></div>
    <p class="city-map-evidence">Mapped streets &amp; building footprints. Procedural façades; not photo-verified. Uses the weather and assists selected below.</p>
  </section>`;
}
