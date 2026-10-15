import { CIRCUITS } from '../simulation/circuits.ts';
import { RULESETS, type EventDefinition } from '../simulation/events.ts';
import { VEHICLES } from '../simulation/vehicles.ts';
import { gridDrs } from '../simulation/drs.ts';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** A concise event card (masterplan §11.3): venue, discipline, duration,
 * weather expectation, tyre/service rules, assists and scoring, stated before
 * the player commits, with a controller-reachable START button. */
export function eventCard(event: EventDefinition, index: number) {
  const rules = RULESETS[event.ruleset],
    circuit = CIRCUITS[event.circuit],
    vehicles = typeof event.vehicles === 'string' ? [event.vehicles] : [...new Set(event.vehicles)],
    machines = vehicles.map((id) => VEHICLES[id]?.name ?? id).join(' + '),
    riders = vehicles.every((id) => VEHICLES[id]?.dynamicsKind === 'bike');
  const length =
    rules.classification === 'timed'
      ? `${Math.round((event.durationSeconds ?? 0) / 60)} minutes + 1 lap`
      : `${event.laps} laps`;
  const weather = { clear: 'Dry', changeable: 'Dry, rain expected', rain: 'Wet' }[event.weather];
  // DRS per grid: the rules permit it and a car on the grid carries the flap.
  const drs = gridDrs(
    rules.drs,
    vehicles.map((id) => VEHICLES[id]),
  )
    ? 'on'
    : 'off';
  return `<article class="event-card"><header><span class="eyebrow">${escape(rules.name)}</span><h3>${escape(event.name)}</h3></header><dl><dt>Venue</dt><dd>${escape(circuit.name)}</dd><dt>Machine</dt><dd>${escape(machines)}</dd><dt>Length</dt><dd>${length} · ${event.opponents + 1} ${riders ? 'riders' : 'cars'}</dd><dt>Weather</dt><dd>${weather}</dd><dt>Tyres &amp; service</dt><dd>${rules.tires.mandatoryCompoundChange ? 'Two dry compounds required' : 'No mandatory stop'} · ${rules.tires.allowed.join(', ')}</dd><dt>Scoring</dt><dd>${rules.points.length ? `Top ${rules.points.length} score` : 'Not scored'}${rules.classScoring === 'per-class' ? ' in each class' : ''} · DRS ${drs}</dd></dl><button class="primary" data-action="event:${index}">START EVENT</button></article>`;
}
export function eventHub(events: readonly EventDefinition[]) {
  return `<header><div><span class="eyebrow">EVENTS</span><h2>Choose an event.</h2></div><button data-action="modalClose" aria-label="Close events">✕</button></header><p class="small-note">Each event states its rules before you start. Results here are outside the championship.</p><div class="event-cards">${events.map(eventCard).join('')}</div>`;
}
