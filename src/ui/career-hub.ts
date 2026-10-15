import { standings, type RoundResult } from '../core/championship.ts';
import { RULESETS } from '../simulation/events.ts';
import { careerSetup, demonstrationRounds, presetEffects, type Payout } from '../career/economy.ts';
import {
  FESTIVAL_RULES,
  festivalEvents,
  festivalRoamKey,
  festivalSummary,
  starWords,
  type FestivalCareerEvent,
} from '../career/festival.ts';
import { EVENT_KIND_LABEL, isRace } from '../simulation/open-world/festival-result.ts';
import {
  disciplineEvents,
  disciplineTiers,
  licenceAvailability,
  purchaseReasons,
  tierVehicles,
  vehiclePrice,
  type CareerEvent,
} from '../career/ladder.ts';
import {
  LICENCE_IDS,
  LICENCE_TESTS,
  formatMetric,
  type LicenceOutcome,
  type LicenceTest,
} from '../career/licences.ts';
import {
  DISCIPLINES,
  DISCIPLINE_IDS,
  disciplineStatus,
  vehicleDiscipline,
  type CareerRegistry,
  type DisciplineId,
} from '../career/registry.ts';
import type { CareerSave, FestivalBest } from '../career/save.ts';
import { escapeHtml } from './team-hub.ts';

/** Career screens (GAME_DESIGN §3–§5): discipline hub, licences, events,
 * garage and dealership. Plain buttons with data-action, in reading order,
 * so keyboard and controller focus reach everything; no animation. */
export type CareerPage = 'hub' | 'events' | 'licences' | 'garage' | 'dealership';
export const CAREER_PAGES: readonly [CareerPage, string][] = [
  ['hub', 'Disciplines'],
  ['events', 'Events'],
  ['licences', 'Licences'],
  ['garage', 'Garage'],
  ['dealership', 'Dealership'],
];
export interface CareerView {
  page: CareerPage;
  discipline: DisciplineId;
  status?: string;
  /** Set while this build is not saving the career, with the reason. */
  unsaved?: { reason: string; replaceable: boolean };
  /** Festival discoveries (from the festival save) for the festival tab. */
  festival?: { discovered: readonly string[] };
}
/** Where a career payment stands: being written, written, refused by
 * storage, or counted for this session only because saving is off. */
export type PaymentState = 'saving' | 'saved' | 'failed' | 'unsaved';
export const credits = (value: number) =>
  `${value < 0 ? '−' : ''}¤${Math.abs(Math.round(value)).toLocaleString('en')}`;
const button = (label: string, action: string, primary = false) =>
  `<button${primary ? ' class="primary"' : ''} data-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`;
const reasonsList = (reasons: readonly string[]) =>
  reasons.length
    ? `<ul class="career-reasons">${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
    : '';
const stateTag = (state: 'open' | 'locked' | 'coming') =>
  `<span class="career-state" data-state="${state}">${state === 'open' ? 'OPEN' : state === 'locked' ? 'LOCKED' : 'COMING'}</span>`;
const vehicleName = (registry: Pick<CareerRegistry, 'vehicles'>, id: string | null) =>
  id ? (registry.vehicles.find((v) => v.id === id)?.name ?? `${id} (not in this build)`) : '—';
const venueName = (registry: Pick<CareerRegistry, 'venues'>, id: string | null) =>
  id ? (registry.venues.find((v) => v.id === id)?.name ?? id) : '—';
function hubPage(save: CareerSave, registry: CareerRegistry) {
  return `<div class="team-heading"><h3>Four disciplines. One driver.</h3><p>Each ladder is licence tests, then invitational events, then a championship. Reputation is earned per discipline and cannot be bought. A discipline without machines or venues in this build says exactly what is missing.</p></div><div class="team-cards career-disciplines">${DISCIPLINE_IDS.map(
    (id) => {
      const status = disciplineStatus(registry, id),
        def = DISCIPLINES[id];
      return `<article data-discipline="${id}"><header><span class="eyebrow">${def.short}</span>${stateTag(status.state)}</header><h4>${escapeHtml(def.name)}</h4><p>${escapeHtml(def.skill)}</p><dl class="career-facts"><dt>Reputation</dt><dd>${save.reputation[id]} / 100</dd><dt>Machines</dt><dd>${status.vehicles.length}</dd><dt>Venues</dt><dd>${status.venues.length}</dd></dl><meter min="0" max="100" value="${save.reputation[id]}" aria-label="${escapeHtml(def.name)} reputation"></meter>${reasonsList(status.reasons)}${status.caveat && status.state === 'open' ? `<p class="career-caveat">${escapeHtml(status.caveat)}</p>` : ''}${button(status.state === 'open' ? 'OPEN EVENTS' : 'VIEW STATUS', `career:discipline:${id}`)}</article>`;
    },
  ).join('')}</div>`;
}
function disciplineTabs(view: CareerView) {
  return `<div class="career-disciplines-nav" role="group" aria-label="Discipline">${DISCIPLINE_IDS.map(
    (id) =>
      `<button data-action="career:discipline:${id}:${view.page}" aria-pressed="${view.discipline === id}">${DISCIPLINES[id].short}</button>`,
  ).join('')}</div>`;
}
/** A championship's rounds with venue, weather and laps, and the player's
 * result in each recorded round (AI-driven rounds are marked). */
function calendarList(
  event: CareerEvent,
  recorded: readonly RoundResult[],
  registry: CareerRegistry,
) {
  if (event.kind !== 'championship' || !event.calendar.length) return '';
  const weather = (w: string) => (w === 'clear' ? 'DRY' : w === 'rain' ? 'RAIN' : 'CHANGEABLE');
  return `<ol class="championship-calendar career-calendar" aria-label="Season calendar">${event.calendar
    .map((r, i) => {
      const done = recorded[i];
      const status = done
        ? `P${done.order.indexOf(0) + 1}${done.retired.includes(0) ? ' (DNF)' : ''}${done.demonstration ? ' · AI DEMO' : ''}`
        : i === event.round
          ? 'NEXT'
          : '';
      return `<li${i === event.round ? ' class="next"' : ''}><b>R${i + 1}</b> ${escapeHtml(venueName(registry, r.circuit))} · ${weather(r.weather)} · ${r.laps} LAPS${status ? ` <span>${status}</span>` : ''}</li>`;
    })
    .join('')}</ol>`;
}
function eventCard(event: CareerEvent, save: CareerSave, registry: CareerRegistry) {
  const def = event.definition;
  const best = save.results[event.key];
  const season = save.championships[event.key];
  const running = !!season && season.season.results.length < season.season.rounds.length;
  let detail = '';
  if (def) {
    const rules = RULESETS[def.ruleset];
    detail = `<dl class="career-facts"><dt>Venue</dt><dd>${escapeHtml(venueName(registry, def.circuit))}</dd><dt>Machine</dt><dd>${escapeHtml(vehicleName(registry, event.vehicle))}${event.loaner ? ' · loaned' : ''}</dd><dt>Format</dt><dd>${def.laps} laps · ${def.opponents + 1} cars · start P${event.startSlot + 1}</dd><dt>Rules</dt><dd>${escapeHtml(rules?.name ?? def.ruleset)}</dd><dt>Pay rate</dt><dd>× ${event.stakes}</dd>${best ? `<dt>Your best</dt><dd>P${best.bestPosition} · ${best.starts} start${best.starts === 1 ? '' : 's'}</dd>` : ''}</dl>`;
  }
  const objectives = event.objectives.length
    ? `<p class="career-objectives">${event.objectives.map((o) => `${escapeHtml(o.label)} (${credits(Math.round((o.amount * event.stakes) / 10) * 10)})`).join(' · ')}</p>`
    : '';
  let championship = '';
  if (event.kind === 'championship') {
    if (season && season.season.results.length) {
      const table = standings(season.season),
        mine = table.findIndex((s) => s.id === 0),
        ai = demonstrationRounds(season.season);
      championship = `<p class="career-season">Round ${Math.min(season.season.results.length + 1, season.season.rounds.length)} of ${season.season.rounds.length} · P${mine + 1} on ${table[mine].points} pts · in the ${escapeHtml(vehicleName(registry, season.vehicle))}${running ? '' : ' · season complete'}</p>${ai.length ? `<p class="career-needs">The AI driver drove round${ai.length === 1 ? '' : 's'} ${ai.join(', ')}: those points count in the table, but this season cannot earn the title, bonus or prize.</p>` : ''}`;
    }
    // A season in progress lists its own rounds; otherwise the next calendar.
    championship += calendarList(event, running ? season.season.results : [], registry);
  }
  const action =
    event.status === 'open'
      ? button(
          event.kind === 'championship'
            ? season && season.season.results.length < season.season.rounds.length
              ? `START ROUND ${season.season.results.length + 1}`
              : 'START CHAMPIONSHIP'
            : event.kind === 'recovery'
              ? 'ENTER CLUB MEETING'
              : 'START EVENT',
          `career:start:${event.key}`,
          true,
        )
      : '';
  const abandon =
    event.kind === 'championship' && running && season.season.results.length
      ? button('ABANDON SEASON', `career:abandon:${event.key}`)
      : '';
  return `<article class="career-event" data-kind="${event.kind}" data-status="${event.status}"><header><span class="eyebrow">${event.kind === 'recovery' ? 'RECOVERY SERIES · ALWAYS OPEN' : event.kind.toUpperCase()}</span>${stateTag(event.status)}</header><h4>${escapeHtml(event.name)}</h4><p>${escapeHtml(event.description)}</p>${detail}${objectives}${championship}${event.status !== 'open' ? `<p class="career-needs">${event.status === 'coming' ? 'Coming — missing from this build:' : 'Requires:'}</p>${reasonsList(event.reasons)}` : ''}${action}${abandon}</article>`;
}
/** Star glyphs with a text alternative (as the festival results card). */
const starLine = (n: number) =>
  `<span class="career-stars" role="img" aria-label="${starWords(n)}">${'★'.repeat(n)}${'☆'.repeat(Math.max(0, 3 - n))}</span>`;
const clockText = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(2).padStart(5, '0')}`;
};
function festivalCard(e: FestivalCareerEvent, registry: CareerRegistry) {
  const ev = e.event,
    rec = e.record,
    race = isRace(ev.kind);
  const targets = ev.stars
    ? `<dt>Star targets</dt><dd>${ev.stars
        .map((t) =>
          ev.kind === 'showcase' ? clockText(t) : ev.kind === 'drift-zone' ? `${t} pts` : `${t} km/h`,
        )
        .join(' · ')}</dd>`
    : race
      ? '<dt>Stars</dt><dd>3 win · 2 podium · 1 finish</dd>'
      : '';
  const bestLine = (title: string, b: FestivalBest | undefined) =>
    b && b.runs > 0
      ? `<dt>${title}</dt><dd>${starLine(b.stars)}${b.bestPosition !== null ? ` · P${b.bestPosition}` : ''}${b.bestTime !== null && race ? ` · ${clockText(b.bestTime)}` : ''}${b.bestValue !== null ? ` · ${Math.round(b.bestValue)}${ev.kind === 'drift-zone' ? ' pts' : ' km/h'}` : ''} · ${b.runs} paid run${b.runs === 1 ? '' : 's'}</dd>`
      : '';
  // Your own machines' best, and the loaned machine's apart (its runs do not
  // count against the full-rate star and first-completion pay).
  const best = rec ? `${bestLine('Your best', rec)}${bestLine('Loaned machine best', rec.loaner)}` : '';
  const facts = `<dl class="career-facts"><dt>Format</dt><dd>${escapeHtml(EVENT_KIND_LABEL[ev.kind])}${race ? ` · ${ev.rivals} rival${ev.rivals === 1 ? '' : 's'}` : ''}${ev.laps > 1 ? ` · ${ev.laps} laps` : ''}</dd>${targets}<dt>Needs</dt><dd>${FESTIVAL_RULES[ev.kind].reputation} festival reputation · discovered</dd><dt>Machine</dt><dd>${escapeHtml(vehicleName(registry, e.vehicle))}${e.loaner ? ' · loaned' : ''}</dd><dt>Pay rate</dt><dd>× ${e.stakes}</dd>${best}</dl>`;
  const action =
    e.status === 'open' ? button('DRIVE TO EVENT', `career:start:${e.key}`, true) : '';
  return `<article class="career-event" data-kind="festival" data-festival-event="${escapeHtml(ev.id)}" data-status="${e.status}" data-discovered="${e.discovered}"><header><span class="eyebrow">${escapeHtml(EVENT_KIND_LABEL[ev.kind].toUpperCase())} · ${e.discovered ? 'DISCOVERED' : 'UNDISCOVERED'}</span>${stateTag(e.status)}</header><h4>${escapeHtml(ev.name)}</h4><p>${escapeHtml(ev.blurb)}</p>${facts}${e.status !== 'open' ? `<p class="career-needs">${e.status === 'coming' ? 'Coming — missing from this build:' : 'Requires:'}</p>${reasonsList(e.reasons)}` : ''}${action}</article>`;
}
/** The festival tab: the open-world region, discoveries, every event with
 * its unlock state and your best, and free roam (GAME_DESIGN §3). */
function festivalPage(save: CareerSave, registry: CareerRegistry, view: CareerView) {
  const discovered = new Set(view.festival?.discovered ?? []),
    status = disciplineStatus(registry, 'festival'),
    summary = festivalSummary(registry, save, discovered),
    events = festivalEvents(registry, save, discovered);
  const machine = summary.machine.vehicle;
  const roam = summary.regions
    .map(
      (r) =>
        `<article class="career-event" data-kind="festival-roam" data-status="${status.state === 'open' && machine ? 'open' : 'coming'}"><header><span class="eyebrow">FREE ROAM · ALWAYS OPEN</span>${stateTag(status.state === 'open' && machine ? 'open' : 'coming')}</header><h4>${escapeHtml(r.name.toUpperCase())}</h4><p>Drive the region, discover events and enter them at their markers. Every finished run in a machine from your garage is paid once to your career; the loaned machine pays at a quarter of the rate. Runs the autopilot drove pay nothing.</p><dl class="career-facts"><dt>Discovered</dt><dd>${summary.discovered} of ${summary.events} events</dd><dt>Machine</dt><dd>${escapeHtml(vehicleName(registry, machine?.id ?? null))}${summary.machine.loaner ? ' · loaned' : ''}</dd><dt>Pay rate</dt><dd>× ${summary.machine.stakes}</dd></dl>${status.state === 'open' && machine ? button('ENTER THE FESTIVAL', `career:start:${festivalRoamKey(r.id)}`, true) : reasonsList(status.reasons)}</article>`,
    )
    .join('');
  return `${disciplineTabs(view)}<div class="team-heading"><h3>Festival events.</h3><p>Events unlock by kind with festival reputation, and the career sends you only to events you have discovered in free roam. Reputation comes from new stars and first completions; repeating an event pays credits, never reputation.</p></div><div class="career-events">${roam}</div><section class="career-tier" aria-label="Festival events"><h4>${escapeHtml(summary.tier?.name ?? 'Festival')}</h4><p class="small-note">Discovered ${summary.discovered} of ${summary.events} · festival reputation ${save.reputation.festival}</p><div class="career-events">${events.map((e) => festivalCard(e, registry)).join('')}</div></section>`;
}
function eventsPage(save: CareerSave, registry: CareerRegistry, view: CareerView) {
  if (DISCIPLINES[view.discipline].venue === 'festival') return festivalPage(save, registry, view);
  const events = disciplineEvents(registry, save, view.discipline);
  const tiers = disciplineTiers(registry, view.discipline);
  const recovery = events.filter((e) => e.kind === 'recovery');
  const sections = tiers
    .map((t) => {
      const list = events.filter((e) => e.tier === t.id && e.kind !== 'recovery');
      const machines = tierVehicles(registry, t);
      return `<section class="career-tier" aria-label="${escapeHtml(t.name)}"><h4>${escapeHtml(t.name)}</h4><p class="small-note">Classes ${escapeHtml(t.classes.join(', '))} · ${machines.length ? escapeHtml(machines.map((m) => m.name).join(', ')) : 'no machine registered'} · licences ${t.licences.length ? escapeHtml(t.licences.map((l) => `${LICENCE_TESTS[l.id].name} ${l.medal}`).join(', ')) : 'none'} · reputation ${t.reputation}</p><div class="career-events">${list.map((e) => eventCard(e, save, registry)).join('')}</div></section>`;
    })
    .join('');
  return `${disciplineTabs(view)}<div class="career-events">${recovery.map((e) => eventCard(e, save, registry)).join('')}</div>${sections}`;
}
function thresholds(test: LicenceTest) {
  const sign = test.metric.better === 'lower' ? '≤' : '≥';
  return (['gold', 'silver', 'bronze'] as const)
    .map(
      (m) =>
        `<span data-medal="${m}">${m.toUpperCase()} ${sign} ${formatMetric(test, test.thresholds[m])}</span>`,
    )
    .join('');
}
function licencesPage(save: CareerSave, registry: CareerRegistry) {
  return `<div class="team-heading"><h3>One skill at a time.</h3><p>Each licence measures one thing from the session telemetry: distance from a braking marker, distance from the racing line, slide angle in the wet, braking while leaned, landing pitch. Finishing position never counts. Licences run solo on a loaned machine if you own none for the discipline.</p></div><div class="career-licences">${LICENCE_IDS.map(
    (id) => {
      const test = LICENCE_TESTS[id],
        a = licenceAvailability(registry, save, id),
        record = save.licences[id];
      return `<article class="career-licence" data-licence="${id}" data-status="${a.status}"><header><span class="eyebrow">${DISCIPLINES[test.discipline].short} · ${escapeHtml(test.skill.toUpperCase())}</span>${stateTag(a.status)}</header><h4>${escapeHtml(test.name)}</h4><p>${escapeHtml(test.brief)}</p><p class="career-thresholds" aria-label="Medal limits">${thresholds(test)}</p><dl class="career-facts"><dt>Measured</dt><dd>${escapeHtml(test.metric.label)}</dd><dt>Your medal</dt><dd>${record?.medal ? record.medal.toUpperCase() : 'None yet'}</dd><dt>Your best</dt><dd>${formatMetric(test, record?.best ?? null)}</dd><dt>Attempts</dt><dd>${record?.attempts ?? 0}</dd>${a.status === 'open' ? `<dt>Machine</dt><dd>${escapeHtml(vehicleName(registry, a.vehicle))}${a.loaner ? ' · loaned' : ''}</dd><dt>Venue</dt><dd>${escapeHtml(venueName(registry, a.venue))}</dd>` : ''}</dl>${a.status === 'open' ? button('START TEST', `career:licence:${id}`, true) : `<p class="career-needs">Coming — missing from this build:</p>${reasonsList(a.reasons)}`}</article>`;
    },
  ).join('')}</div>`;
}
function garagePage(save: CareerSave, registry: CareerRegistry) {
  if (!save.owned.length)
    return `<div class="team-heading"><h3>The garage is empty.</h3><p>Buy a machine in the Dealership, or win one in a championship. Licences and the club meeting lend you a machine until then.</p></div>${button('OPEN DEALERSHIP', 'career:page:dealership', true)}`;
  return `<div class="team-heading"><h3>Your machines.</h3><p>Choose the machine each discipline races with. Presets store only the setup parameters that machine exposes; edit values in GARAGE &amp; SETTINGS, then save them here as a preset. The selected preset is used for career sessions in that machine.</p></div><div class="career-garage">${save.owned
    .map((o) => {
      const vehicle = registry.vehicles.find((v) => v.id === o.id);
      if (!vehicle)
        return `<article class="career-vehicle" data-vehicle="${escapeHtml(o.id)}"><h4>${escapeHtml(o.id)}</h4><p>Not registered in this build; kept in your garage for a build that has it.</p></article>`;
      const discipline = vehicleDiscipline(vehicle),
        active = save.active[discipline] === vehicle.id,
        presets = save.presets[vehicle.id] ?? [],
        selected = save.selected[vehicle.id] ?? -1,
        setup = careerSetup(save, vehicle);
      const effects = setup ? presetEffects(vehicle, presets[selected]?.values ?? {}) : [];
      return `<article class="career-vehicle" data-vehicle="${escapeHtml(vehicle.id)}"><header><span class="eyebrow">${escapeHtml(vehicle.classId.toUpperCase())} · ${DISCIPLINES[discipline].short}${o.source === 'award' ? ' · AWARDED' : ''}</span>${active ? '<span class="career-state" data-state="open">ACTIVE</span>' : ''}</header><h4>${escapeHtml(vehicle.name)}</h4><div class="team-actions">${active ? '' : button(`RACE THIS IN ${DISCIPLINES[discipline].short}`, `career:active:${discipline}:${vehicle.id}`)}${button('SAVE CURRENT GARAGE SETUP AS PRESET', `career:preset:save:${vehicle.id}`)}</div><fieldset class="career-presets"><legend>SETUP PRESET · ${vehicle.setupKeys.length} PARAMETERS EXPOSED</legend><button data-action="career:preset:use:${escapeHtml(vehicle.id)}:-1" aria-pressed="${selected === -1}">GARAGE &amp; SETTINGS SETUP</button>${presets
        .map(
          (p, i) =>
            `<span class="career-preset"><button data-action="career:preset:use:${escapeHtml(vehicle.id)}:${i}" aria-pressed="${selected === i}">${escapeHtml(p.name.toUpperCase())}</button><button data-action="career:preset:delete:${escapeHtml(vehicle.id)}:${i}" aria-label="Delete preset ${escapeHtml(p.name)}">DELETE</button></span>`,
        )
        .join(
          '',
        )}</fieldset><ul class="career-effects" aria-label="Expected effect">${selected === -1 ? '<li>Uses your current GARAGE &amp; SETTINGS values for the parameters this machine exposes.</li>' : effects.length ? effects.map((e) => `<li>${escapeHtml(e)}</li>`).join('') : '<li>All exposed parameters at their defaults: the baseline balance.</li>'}</ul></article>`;
    })
    .join('')}</div>`;
}
function dealershipPage(save: CareerSave, registry: CareerRegistry) {
  const rows = DISCIPLINE_IDS.flatMap((d) =>
    registry.vehicles
      .filter((v) => vehicleDiscipline(v) === d)
      .map((v) => {
        const price = vehiclePrice(registry, v),
          owned = save.owned.some((o) => o.id === v.id),
          tier = disciplineTiers(registry, d).find((t) => t.classes.includes(v.classId)),
          blocked = purchaseReasons(registry, v);
        // A machine that cannot race in this build is shown, never sold.
        const offer = owned
          ? ''
          : blocked.length
            ? `<p class="career-needs">Not on sale until it can race — missing from this build:</p>${reasonsList(blocked)}`
            : save.credits >= price
              ? button(`BUY FOR ${credits(price)}`, `career:buy:${v.id}`, true)
              : `<p class="career-needs">Need ${credits(price - save.credits)} more. The club meeting always runs.</p>`;
        return `<article class="career-vehicle" data-vehicle="${escapeHtml(v.id)}" data-status="${owned ? 'owned' : blocked.length ? 'coming' : 'open'}"><header><span class="eyebrow">${DISCIPLINES[d].short} · ${escapeHtml(v.classId.toUpperCase())}${tier ? ` · ${escapeHtml(tier.name.toUpperCase())}` : ''}</span>${owned ? '<span class="career-state" data-state="open">OWNED</span>' : blocked.length ? stateTag('coming') : ''}</header><h4>${escapeHtml(v.name)}</h4><p class="career-price">${credits(price)}</p>${offer}</article>`;
      }),
  );
  return `<div class="team-heading"><h3>Machines by class.</h3><p>Prices follow class, not power. Credits come only from driving; nothing is sold for real money and nothing bought changes grip. Performance upgrades are not offered: an upgrade would have to create a new vehicle definition with its own record category.</p></div><div class="career-garage">${rows.join('')}</div>`;
}
export function careerHub(save: CareerSave, registry: CareerRegistry, view: CareerView) {
  const content =
    view.page === 'events'
      ? eventsPage(save, registry, view)
      : view.page === 'licences'
        ? licencesPage(save, registry)
        : view.page === 'garage'
          ? garagePage(save, registry)
          : view.page === 'dealership'
            ? dealershipPage(save, registry)
            : hubPage(save, registry);
  const medals = Object.values(save.licences).filter((l) => l?.medal).length;
  const unsaved = view.unsaved
    ? `<div class="career-unsaved" role="note"><p><b>NOT SAVING.</b> ${escapeHtml(view.unsaved.reason)}. Progress here lasts for this session only and the stored career is left untouched.</p>${view.unsaved.replaceable ? button('SAVE IN THIS BUILD INSTEAD', 'career:replace') : ''}</div>`
    : '';
  return `<div class="career-hub" data-career-page="${view.page}"><header><div><span class="eyebrow">CAREER / DRIVER</span><h2>Career</h2></div>${button('CLOSE', 'modalClose')}</header>${unsaved}<nav aria-label="Career sections">${CAREER_PAGES.map(([id, label]) => `<button data-action="career:page:${id}" aria-pressed="${view.page === id}">${label}</button>`).join('')}</nav><div class="team-stats"><div><small>CREDITS</small><strong>${credits(save.credits)}</strong></div><div><small>${DISCIPLINES[view.discipline].short} REPUTATION</small><strong>${save.reputation[view.discipline]}<em> / 100</em></strong></div><div><small>LICENCE MEDALS</small><strong>${medals}<em> / ${LICENCE_IDS.length}</em></strong></div></div><div class="team-content">${content}</div><p class="team-save" role="status" id="careerSaveStatus">${escapeHtml(view.status ?? `${view.unsaved ? 'NOT SAVING' : 'LOCAL SAVE'} · ${credits(save.credits)} · ${save.owned.length} MACHINE${save.owned.length === 1 ? '' : 'S'}`)}</p></div>`;
}
/** The itemised payment under a classification (or why nothing was paid). */
export function payoutPanel(
  payout: Payout,
  state: PaymentState,
  registry: Pick<CareerRegistry, 'vehicles'> = { vehicles: [] },
  actions = true,
) {
  const careerButton = actions
    ? `<div class="dialog-buttons inline">${button('CAREER', 'career')}</div>`
    : '';
  const status =
    state === 'saving'
      ? 'Saving to your career…'
      : state === 'saved'
        ? 'Paid to your career wallet.'
        : state === 'unsaved'
          ? 'Counted for this session only: this build is not saving the career (see CAREER).'
          : 'Not saved: storage refused the write. Nothing was paid.';
  if (!payout.paid && !payout.lines.length)
    return `<section class="career-payout" aria-label="Career payment"><span class="eyebrow">CAREER PAYMENT</span><p>${escapeHtml(payout.reason ?? 'No payment.')}</p>${careerButton}</section>`;
  return `<section class="career-payout" aria-label="Career payment"><span class="eyebrow">CAREER PAYMENT</span><table class="results"><tbody>${payout.lines.map((l) => `<tr><td>${escapeHtml(l.label)}</td><td>${credits(l.amount)}</td></tr>`).join('')}<tr class="you"><td>TOTAL · reputation +${payout.reputation}</td><td>${credits(payout.total)}</td></tr></tbody></table>${payout.awarded ? `<p>Prize machine: ${escapeHtml(vehicleName(registry, payout.awarded))} is now in your garage.</p>` : ''}<p class="small-note" role="status">${status}</p>${careerButton}</section>`;
}
export function licenceBriefing(
  test: LicenceTest,
  machine: string,
  venue: string,
  loaner: boolean,
) {
  return `<section class="career-briefing"><span class="eyebrow">LICENCE TEST / ${escapeHtml(test.skill.toUpperCase())}</span><h2>${escapeHtml(test.name)}</h2><p>${escapeHtml(test.brief)}</p><p class="career-thresholds">${thresholds(test)}</p><dl class="career-facts"><dt>Machine</dt><dd>${escapeHtml(machine)}${loaner ? ' · loaned' : ''}</dd><dt>Venue</dt><dd>${escapeHtml(venue)}</dd><dt>Conditions</dt><dd>${test.weather === 'rain' ? 'Heavy rain, full wet tyres' : 'Dry'} · solo</dd></dl><p class="small-note">The first complete attempt is measured. Laps driven by the AI driver earn nothing.</p><div class="dialog-buttons inline">${button('START TEST', 'career:licenceGo', true)}${button('BACK', 'career:page:licences')}</div></section>`;
}
export function licenceResult(
  test: LicenceTest,
  outcome: LicenceOutcome,
  payout: Payout,
  state: PaymentState,
) {
  const medal = outcome.valid ? outcome.medal : null;
  return `<section class="career-briefing"><span class="eyebrow">LICENCE RESULT / ${escapeHtml(test.skill.toUpperCase())}</span><h2>${medal ? `${medal.charAt(0).toUpperCase()}${medal.slice(1)}.` : outcome.valid ? 'Outside the bronze limit.' : 'Attempt not scored.'}</h2><p class="career-measure"><b>${escapeHtml(test.metric.label)}</b> ${formatMetric(test, outcome.value)}</p><p>${escapeHtml(outcome.detail)}</p><p class="career-thresholds">${thresholds(test)}</p>${payoutPanel(payout, state, undefined, false)}<div class="dialog-buttons inline">${button('TRY AGAIN', 'restart', true)}${button('LICENCES', 'career:page:licences')}${button('PADDOCK', 'menu')}</div></section>`;
}
/** Confirmation before a season in progress is discarded. */
export function abandonPrompt(
  key: string,
  name: string,
  machine: string,
  recorded: number,
  rounds: number,
) {
  return `<section class="career-briefing"><span class="eyebrow">CHAMPIONSHIP / ABANDON</span><h2>Abandon the season?</h2><p>${escapeHtml(name)}: ${recorded} of ${rounds} round${rounds === 1 ? '' : 's'} recorded in the ${escapeHtml(machine)}. Abandoning discards ${recorded === 1 ? 'that round' : `those ${recorded} rounds`} and the standings; payments already made stay paid. The next start begins a new season in your current machine.</p><div class="dialog-buttons inline">${button('KEEP SEASON', 'career:page:events', true)}${button(`ABANDON ${recorded} ROUND${recorded === 1 ? '' : 'S'}`, `career:abandonConfirm:${key}`)}</div></section>`;
}
/** Confirmation before this build starts saving over a career it cannot read. */
export function replacePrompt(reason: string, keeps: boolean) {
  return `<section class="career-briefing"><span class="eyebrow">CAREER / SAVE IN THIS BUILD</span><h2>Save the career in this build?</h2><p>${escapeHtml(reason)}. This build then saves the career you see here.${keeps ? ' The newer career is first copied aside under a separate key; it is not deleted, but this build cannot open it.' : ''}</p><div class="dialog-buttons inline">${button('KEEP NOT SAVING', 'career:page:hub', true)}${button('SAVE IN THIS BUILD', 'career:replaceConfirm')}</div></section>`;
}
