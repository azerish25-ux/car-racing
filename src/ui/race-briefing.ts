import { F, H, carBase } from '../simulation/protocol.ts';
import type { SessionOptions } from '../simulation/config.ts';
import { circuitDefinition } from '../simulation/circuits.ts';
import { COMPOUNDS } from '../simulation/config.ts';
import { weatherReadout } from './presentation.ts';
import { circuitTitle } from './interface.ts';
import { motocrossKind, motocrossVenueCard } from './motocross-presentation.ts';
import { O, OFFROAD_BASE } from '../simulation/protocol.ts';

export function raceBriefing(options: SessionOptions, frame: Float32Array) {
  const o = carBase(0);
  if (frame[H.TICK] !== 0) throw new Error('Race briefing requires the initialized grid');
  const circuit = circuitDefinition(options.circuit);
  const motocross = motocrossKind(options.circuit);
  const compound = Object.keys(COMPOUNDS)[Math.round(frame[o + F.COMPOUND])] ?? options.compound;
  if (motocross) {
    return `<section id="raceBriefing" class="mx-briefing" aria-label="Motocross race briefing"><span class="eyebrow">DIRT SERIES / ${motocross === 'supercross' ? 'SUPERCROSS' : 'MOTOCROSS'}</span><h2>${circuitTitle(circuit.id)}</h2><p>Choose your line into turn one. The race begins at the gate drop.</p>${motocrossVenueCard(circuit.id)}<dl class="race-briefing-grid"><div><dt>YOUR GATE</dt><dd>${Math.max(1, Math.round(frame[o + OFFROAD_BASE + O.SLOT]))}<small> / ${frame[H.CARS]} RIDERS</small></dd></div><div><dt>RACE DISTANCE</dt><dd>${options.laps}<small> LAPS</small></dd></div><div><dt>RIDE MODE</dt><dd>${options.assist === 'raw' ? 'FULL CONTROL' : 'ASSISTED'}</dd></div><div><dt>SURFACE</dt><dd>${motocross === 'supercross' ? 'PREPARED CLAY' : 'HILLSIDE LOAM'}</dd></div></dl><p class="mx-technique">Brake before the jump face. Throttle lifts the nose in flight; brake lowers it. Aim to meet the downslope with both wheels aligned.</p><div class="dialog-buttons"><button class="primary" data-action="raceDayPrepare">WATCH GATE PREPARATION</button><button data-action="raceDaySkip">GO TO THE GATE</button><button data-action="menu">BACK TO PADDOCK</button></div><label class="check"><input id="raceDayQuickStart" type="checkbox">Use Quick Start for future races</label></section>`;
  }
  // Circuit names are authored constants; all other values are numeric or validated enums.
  return `<section id="raceBriefing" aria-label="Race-day briefing">
    <span class="eyebrow">RACE DAY / ${options.mode === 'endurance' ? 'ENDURANCE' : 'GRAND PRIX'}</span>
    <h2>${circuitTitle(circuit.id)}</h2><p>The grid is formed. Lights out when you are ready.</p>
    <dl class="race-briefing-grid">
      <div><dt>STARTING POSITION</dt><dd>P${options.grid ? options.grid.indexOf(0) + 1 : 1} <small>/ ${frame[H.CARS]}</small></dd></div>
      <div><dt>RACE DISTANCE</dt><dd>${options.laps} <small>LAPS</small></dd></div>
      <div><dt>FITTED TYRES</dt><dd>${compound.toUpperCase()}</dd></div>
      <div><dt>FUEL ON BOARD</dt><dd>${frame[o + F.FUEL].toFixed(1)} <small>KG</small></dd></div>
    </dl>
    <p class="briefing-weather">${weatherReadout(frame[H.AMBIENT], frame[H.RAIN], frame[H.WATER])}</p>
    <p class="small-note">Your garage setup is fitted. To change tyres, weather or setup, return to the paddock.</p>
    <div class="dialog-buttons"><button class="primary" data-action="raceDayPrepare">WATCH GRID PREPARATION</button><button data-action="raceDaySkip">GO STRAIGHT TO LIGHTS</button><button data-action="menu">BACK TO PADDOCK</button></div>
    <label class="check"><input id="raceDayQuickStart" type="checkbox">Use Quick Start for future races</label>
  </section>`;
}
