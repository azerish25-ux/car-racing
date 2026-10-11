import { developerMode } from './dev-mode.ts';
import {
  capacity,
  DEPARTMENTS,
  DRIVERS,
  driverProfile,
  RESEARCH,
  weeklyBudget,
  type TeamState,
} from '../storage/team-career.ts';
export type HubPage = 'overview' | 'engineering' | 'personnel' | 'finance';
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const money = (value: number) => `${value < 0 ? '−' : ''}¤${Math.abs(value).toLocaleString('en')}`;
const button = (label: string, action: string, disabled = false) =>
  `<button data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
export function teamCalendar(team: TeamState): string {
  const budget = weeklyBudget(team),
    rate = team.workforce.engineering >= 16 ? 2 : 1;
  return `<section class="team-calendar" aria-label="Team operating calendar"><span class="eyebrow">NEXT FOUR WEEKS / CURRENT STAFFING FORECAST</span><div>${[
    1, 2, 3, 4,
  ]
    .filter((offset) => team.week + offset <= 10000)
    .map((offset) => {
      const studies = team.research.filter(
        (r) => r.remaining > 0 && Math.ceil(r.remaining / rate) === offset,
      );
      return `<article><b>WEEK ${team.week + offset}</b><span>Partnership ${money(budget.income)}</span><span>Payroll + facility ${money(-(budget.payroll + budget.overhead))}</span><strong>NET ${money(budget.net)}</strong>${studies.map((r) => `<small>${escapeHtml(RESEARCH.find((study) => study.id === r.id)!.name)} / DUE</small>`).join('')}</article>`;
    })
    .join(
      '',
    )}</div><p>Projection only, not an already booked transaction. Hiring, contracts and facility changes alter this forecast. Advance a week to commit actual income, costs and study progress.</p></section>`;
}
export function teamHub(team: TeamState, page: HubPage): string {
  const budget = weeklyBudget(team),
    driver = driverProfile(team);
  const navigation: [HubPage, string][] = [
    ['overview', 'Headquarters'],
    ['engineering', 'Engineering'],
    ['personnel', 'Personnel'],
    ['finance', 'Finance'],
  ];
  let content = '';
  if (page === 'overview')
    content = `
    <div class="team-hero"><div><span class="eyebrow">TEAM PRINCIPAL / WEEK ${team.week}</span><h3>Build something<br>worth racing.</h3><p>${escapeHtml(team.briefing)}</p></div><div class="team-identity" style="--team-paint:${team.livery.primary};--team-accent:${team.livery.accent}"><strong>${String(team.livery.number).padStart(2, '0')}</strong><span>${escapeHtml(team.livery.sponsor)}</span><small>${driver.name.toUpperCase()}</small></div></div>
    <div class="team-stats"><div><small>AVAILABLE FUNDS</small><strong>${money(team.balance)}</strong></div><div><small>NEXT WEEK / NET</small><strong>${money(budget.net)}</strong></div><div><small>REPUTATION</small><strong>${team.reputation}<em> / 100</em></strong></div></div>
    ${teamCalendar(team)}<section class="team-rival"><div><span class="eyebrow">LOCAL RIVALRY / ${team.rounds} CLASSIFIED ROUNDS</span><h4>${escapeHtml(team.livery.sponsor)} <b>${team.points}</b> <small>vs</small> MERIDIAN <b>${team.rivalPoints}</b></h4><p>Grand Prix finishes against at least one opponent earn points and workshop income. Laps driven by the AI driver and practice sessions do not. Meridian is your AI rival team.</p></div><meter min="0" max="${Math.max(1, team.points + team.rivalPoints)}" value="${team.points}" aria-label="Your share of rivalry points"></meter></section>
    <div class="team-actions">${button('ADVANCE ONE WEEK', 'team:week')}${button('EDIT LIVERY / PHOTO STUDIO', 'photo')}${developerMode() ? button('100-IMAGE REFERENCE REVIEW', 'references') : ''}</div>`;
  if (page === 'engineering')
    content = `<div class="team-heading"><h3>Make the next lap count.</h3><p>Studies unlock physics-backed setup presets, not invisible performance boosts. Only one study can run at a time. A staff of 16 or more engineers completes two research weeks per calendar week.</p></div><div class="team-cards">${RESEARCH.map(
      (study) => {
        const project = team.research.find((r) => r.id === study.id),
          pending = team.research.some((r) => r.remaining > 0);
        return `<article><span class="eyebrow">${project ? (project.remaining ? `${project.remaining} WEEKS REMAINING` : 'STUDY COMPLETE') : `${study.weeks} WEEKS / ${money(study.cost)}`}</span><h4>${study.name}</h4><p>${study.note}</p>${project?.remaining === 0 ? button('APPLY TO NEXT SESSION', `team:apply:${study.id}`) : button(project ? 'IN PROGRESS' : 'COMMISSION STUDY', `team:research:${study.id}`, !!project || pending || team.balance < study.cost)}</article>`;
      },
    ).join(
      '',
    )}</div><div class="team-actions">${button('ADVANCE ONE WEEK', 'team:week')}${button('INSPECT VEHICLE SETUP', 'settings')}</div>`;
  if (page === 'personnel')
    content = `<div class="team-heading"><h3>The people behind the pace.</h3><p>Recruit within capacity. Facility upgrades expand capacity; salaries and overhead are charged every calendar week. Driver identity changes your name and number, not the handling physics.</p></div><div class="team-cards">${DEPARTMENTS.map((d) => `<article><span class="eyebrow">${d.toUpperCase()} / FACILITY ${team.facilities[d]}</span><h4>${team.workforce[d]} <small>/ ${capacity(team, d)} STAFF</small></h4><meter min="0" max="${capacity(team, d)}" value="${team.workforce[d]}" aria-label="${d} staffing"></meter><div class="team-actions">${button('−2', `team:staff:${d}:-2`, team.workforce[d] <= 2)}${button('+2', `team:staff:${d}:2`, team.workforce[d] + 2 > capacity(team, d) || team.balance < 2400)}</div>${button(`UPGRADE / ${money(team.facilities[d] * 26000)}`, `team:facility:${d}`, team.facilities[d] >= 4 || team.balance < team.facilities[d] * 26000)}</article>`).join('')}</div><p>Recruit two: ¤2,400. Reassign two: ¤600. Commercial staff increase partnership income. Operations staff are a capacity and payroll choice; pit-stop speed is not currently linked to headcount.</p><div class="team-driver-grid">${DRIVERS.map(
      (d) =>
        `<article><span class="driver-monogram">${d.name
          .split(' ')
          .map((n) => n[0])
          .join(
            '',
          )}</span><div><span class="eyebrow">#${d.number} / ${d.style.toUpperCase()}</span><h4>${d.name}</h4><p>${d.detail}</p><small>${money(d.salary)} / WEEK · ${money(d.salary * 2)} SIGNING FEE</small></div>${button(d.id === team.driver ? 'YOUR DRIVER' : 'SIGN DRIVER', `team:driver:${d.id}`, d.id === team.driver || team.balance < d.salary * 2)}</article>`,
    ).join('')}</div>`;
  if (page === 'finance')
    content = `<div class="team-heading"><h3>Keep the workshop running.</h3><p>Every completed transaction below is saved locally before the balance changes on screen. The last 48 ledger entries are retained.</p></div><div class="team-stats"><div><small>AVAILABLE</small><strong>${money(team.balance)}</strong></div><div><small>WEEKLY INCOME</small><strong>${money(budget.income)}</strong></div><div><small>PAYROLL + FACILITIES</small><strong>${money(budget.payroll + budget.overhead)}</strong></div></div><table class="team-ledger"><thead><tr><th>Week</th><th>Transaction</th><th>Credits</th></tr></thead><tbody>${team.ledger
      .slice()
      .reverse()
      .map(
        (row) =>
          `<tr><td>${row.week}</td><td>${escapeHtml(row.label)}</td><td>${money(row.amount)}</td></tr>`,
      )
      .join(
        '',
      )}</tbody></table><div class="team-actions">${button(`ADVANCE WEEK / ${money(budget.net)} NET`, 'team:week')}</div>`;
  return `<div class="team-hub" data-team-page="${page}"><header><div><span class="eyebrow">APEX / TEAM OPERATIONS</span><h2>Headquarters</h2></div>${button('CLOSE', 'modalClose')}</header><nav aria-label="Team departments">${navigation.map(([id, label]) => `<button data-action="team:page:${id}" aria-pressed="${page === id}">${label}</button>`).join('')}</nav><div class="team-actions">${button('VISIT 3D WORKSHOP', 'workshop')}${button('WATCH TEAM BRIEFING', 'teamMedia')}</div><div class="team-content">${content}</div><p class="team-save" role="status" id="teamSaveStatus">LOCAL SAVE · WEEK ${team.week} · ${money(team.balance)}</p></div>`;
}
