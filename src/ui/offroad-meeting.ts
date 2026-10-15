import { circuitDefinition } from '../simulation/circuits.ts';
import { RULESETS, type EventDefinition } from '../simulation/events.ts';
import {
  meetingClassification,
  meetingMotos,
  pickMeetingGates,
  playerGateChoices,
  type MotoMeeting,
} from '../simulation/offroad/meeting.ts';
import { VEHICLES } from '../simulation/vehicles.ts';

/** The two-moto meeting screen (WP42): one modal that walks the player
 * through the meeting — the field and the plan, the qualifying order and the
 * gate pick in that order (the player chooses a free gate at their turn),
 * each moto's points and the combined classification. It only renders the
 * meeting state; every session it starts is a real one (data-action
 * `meeting:*`, routed by the application). */
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const time = (seconds: number) => {
  if (!(seconds > 0)) return 'NO TIME';
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(3).padStart(6, '0')}`;
};
export interface MeetingView {
  /** Rider name by car id (the player is car 0). */
  name: (id: number) => string;
  /** Gate slot preference of the venue, best first (gateSlots); null before
   * the venue's start gate is known. */
  preference: readonly number[] | null;
  /** The gate the player has chosen so far (null: the best free one). */
  playerSlot: number | null;
  /** Extra HTML under the classification (the career's payout panel). */
  extra?: string;
}
const STEPS = ['Qualifying', 'Gate pick', 'Moto 1', 'Moto 2', 'Results'];
function progress(m: MotoMeeting) {
  const at =
    m.stage === 'qualifying'
      ? 0
      : m.stage === 'gate-pick'
        ? 1
        : m.stage === 'moto'
          ? 2 + m.motos.length
          : 4;
  return `<ol class="meeting-steps" aria-label="Meeting progress">${STEPS.map((s, i) => `<li${i === at ? ' aria-current="step"' : ''} data-done="${i < at}">${s}</li>`).join('')}</ol>`;
}
function field(m: MotoMeeting, view: MeetingView) {
  const vehicles = m.base.vehicles ?? [];
  return `<table class="results"><thead><tr><th>#</th><th>RIDER</th><th>MACHINE</th></tr></thead><tbody>${vehicles
    .map(
      (id, car) =>
        `<tr${car === 0 ? ' class="you"' : ''}><td>${car + 1}</td><td>${escape(view.name(car))}</td><td>${escape(VEHICLES[id]?.name ?? id)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}
function qualifyingTable(m: MotoMeeting, view: MeetingView) {
  const order = m.qualifying ?? [],
    times = m.qualifyingTimes ?? [];
  return `<table class="results"><thead><tr><th>Q</th><th>RIDER</th><th>BEST LAP</th></tr></thead><tbody>${order
    .map(
      (car, i) =>
        `<tr${car === 0 ? ' class="you"' : ''}><td>${i + 1}</td><td>${escape(view.name(car))}</td><td>${time(times[car])}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}
function gatePick(m: MotoMeeting, view: MeetingView) {
  if (!view.preference) return '<p>Gate slots are being read from the venue…</p>';
  const picks = pickMeetingGates(m, view.preference, view.playerSlot ?? undefined),
    choices = playerGateChoices(m, view.preference),
    mine = picks.find((p) => p.car === 0)!;
  const rank = new Map(view.preference.map((slot, i) => [slot, i + 1]));
  const list = picks
    .map(
      (p) =>
        `<li${p.car === 0 ? ' class="you"' : ''}><b>${p.turn}.</b> ${escape(view.name(p.car))} · gate ${p.slot + 1}${p.car === 0 ? ' (your pick)' : ''}</li>`,
    )
    .join('');
  const buttons = choices
    .map(
      (slot) =>
        `<button data-action="meeting:gate:${slot}" aria-pressed="${slot === mine.slot}">GATE ${slot + 1}${rank.get(slot) === 1 ? ' · INSIDE' : ''}</button>`,
    )
    .join('');
  return `<p>Riders pick their gate in qualifying order; you pick at turn ${mine.turn}. Gates are numbered across the start straight; the venue ranks them inside line first.</p><fieldset class="meeting-gates"><legend>YOUR GATE (FREE AT YOUR TURN)</legend>${buttons}</fieldset><ol class="meeting-picks">${list}</ol>`;
}
function motoTable(m: MotoMeeting, view: MeetingView, index: number) {
  const moto = m.motos[index],
    points = RULESETS[m.base.ruleset ?? '']?.format?.motoPoints ?? [];
  return `<table class="results"><caption>MOTO ${index + 1}</caption><thead><tr><th>POS</th><th>RIDER</th><th>PTS</th></tr></thead><tbody>${moto.order
    .map((car, i) => {
      const finished = moto.finished.includes(car);
      return `<tr${car === 0 ? ' class="you"' : ''}><td>${finished ? i + 1 : 'DNF'}</td><td>${escape(view.name(car))}</td><td>${finished ? (points[i] ?? 0) : 0}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}
function overall(m: MotoMeeting, view: MeetingView) {
  const rows = meetingClassification(m);
  return `<table class="results meeting-overall"><thead><tr><th>POS</th><th>RIDER</th>${m.motos.map((_, i) => `<th>M${i + 1}</th>`).join('')}<th>PTS</th></tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr${r.id === 0 ? ' class="you"' : ''}><td>${r.overall}</td><td>${escape(view.name(r.id))}</td>${r.results.map((x) => `<td>${x.position || 'DNF'} · ${x.points}</td>`).join('')}<td>${r.total}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}
/** The meeting modal for its current stage. */
export function meetingScreen(m: MotoMeeting, view: MeetingView) {
  const venue = circuitDefinition(m.base.circuit).name;
  const head = `<header><div><span class="eyebrow">OFF-ROAD MEETING · ${meetingMotos(m.base)} MOTOS</span><h2>${escape(m.name)}</h2></div></header><p class="small-note">${escape(venue)} · ${m.base.laps} laps a moto · ${m.base.opponents + 1} riders · moto points ${escape(RULESETS[m.base.ruleset ?? '']?.name ?? '')}</p>${progress(m)}`;
  const leave = '<button data-action="menu">PADDOCK · LEAVE MEETING</button>';
  const review =
    m.stage === 'qualifying'
      ? ''
      : '<button data-action="replay">WATCH REPLAY</button><button data-action="telemetry">TELEMETRY</button>';
  let body = '',
    next = '';
  if (m.stage === 'qualifying') {
    body = `<p>Timed qualifying sets the order riders pick their gates in. Two motos follow from those gates; each scores moto points and the meeting is decided on the total, ties to the better result in the last moto.</p>${field(m, view)}`;
    next = '<button class="primary" data-action="meeting:qualifying">START QUALIFYING</button>';
  } else if (m.stage === 'gate-pick') {
    body = `${qualifyingTable(m, view)}${gatePick(m, view)}`;
    next =
      '<button class="primary" data-action="meeting:moto">CONFIRM GATE · START MOTO 1</button>';
  } else if (m.stage === 'moto') {
    body = `${m.motos.map((_, i) => motoTable(m, view, i)).join('')}<h3>Standings after moto ${m.motos.length}</h3>${overall(m, view)}<p>Moto ${m.motos.length + 1} starts from the same gates.</p>`;
    next = `<button class="primary" data-action="meeting:moto">START MOTO ${m.motos.length + 1}</button>`;
  } else {
    const rows = meetingClassification(m),
      mine = rows.find((r) => r.id === 0);
    body = `<h3>${mine ? (mine.overall === 1 ? 'Overall winner.' : `P${mine.overall} overall.`) : 'Meeting complete.'}</h3>${overall(m, view)}${m.motos.map((_, i) => motoTable(m, view, i)).join('')}`;
    next = '<button class="primary" data-action="meeting:again">RUN THE MEETING AGAIN</button>';
  }
  return `<section class="offroad-meeting" data-stage="${m.stage}" data-motos="${m.motos.length}">${head}${body}${view.extra ?? ''}<div class="dialog-buttons inline">${next}${review}${leave}</div></section>`;
}
/** Is this event a two-moto format a meeting can run? */
export function meetingEvent(event: Pick<EventDefinition, 'ruleset' | 'mode'>) {
  return event.mode === 'race' && meetingMotos(event) >= 2;
}
/** A meeting's name and moto-2 weather from its moto-1 event: the sibling
 * "… · MOTO 2" event, when registered, sets moto 2's conditions. */
export function meetingFromEvent(event: EventDefinition, events: readonly EventDefinition[]) {
  const sibling = event.id.endsWith('-moto-1')
    ? events.find((e) => e.id === event.id.replace(/-moto-1$/, '-moto-2'))
    : undefined;
  const name = `${event.name.replace(/ · MOTO \d+$/, '')} · TWO-MOTO MEETING`;
  return { id: `${event.id}:meeting`, name, moto2Weather: sibling?.weather ?? event.weather };
}
