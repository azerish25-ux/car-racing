import type { LightingMode } from '../rendering/daylight.ts';
import type { GuideMode } from '../rendering/driving-guide.ts';
import type { PracticeProgress } from '../simulation/practice-programme.ts';
import { escapeHtml } from './team-hub.ts';
import { developerMode } from './dev-mode.ts';
export function programmeTime(seconds: number) {
  return Number.isFinite(seconds) && seconds > 0
    ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(3).padStart(6, '0')}`
    : '—';
}
export function drivingAcademy(
  progress: PracticeProgress,
  guide: GuideMode,
  night: boolean,
  illumination: LightingMode = night ? 'night' : 'day',
) {
  return `<section class="driving-academy"><header><div><span class="eyebrow">DRIVING ACADEMY</span><h2>Find your repeatable lap.</h2></div><button data-action="modalClose">CLOSE</button></header>
  <p>Five timed laps. Your first clean lap sets the target: match or beat it for gold, stay within 2% for silver or within 5% for bronze.</p>
  <div class="academy-controls"><fieldset><legend>ON-TRACK GUIDANCE</legend>${(['off', 'corners', 'full'] as const).map((mode) => `<button data-action="guide:${mode}" aria-pressed="${guide === mode}">${mode.toUpperCase()}</button>`).join('')}<p>Chevrons on the road mark suggested braking zones and ease off for yellow flags and wet track. Always race the cars around you.</p></fieldset><fieldset><legend>CIRCUIT LIGHTING</legend><button data-action="lighting:day" aria-pressed="${illumination === 'day'}">DAY</button><button data-action="lighting:sunset" aria-pressed="${illumination === 'sunset'}">SUNSET</button><button data-action="lighting:night" aria-pressed="${night}">NIGHT</button><p>Race at midday, under a low sunset or beneath the floodlights. Lighting is visual only and never changes grip or weather.</p></fieldset></div>
  <p class="academy-warning">Side arrows warn of cars alongside. A larger arrow means you are overlapping.</p>
  <div class="academy-score"><span>${progress.finished ? 'COMPLETE' : progress.active ? 'IN PROGRESS' : 'READY TO START'}</span><strong>${progress.attempts.length} / 5</strong><label>LOCKED TARGET <b>${programmeTime(progress.target)}</b></label></div>
  <ol class="academy-attempts">${Array.from({ length: 5 }, (_, index) => {
    const lap = progress.attempts[index];
    return `<li data-grade="${lap?.grade ?? 'pending'}"><span>ATTEMPT ${index + 1}</span><b>${lap ? programmeTime(lap.seconds) : '—'}</b><strong>${lap?.grade.toUpperCase() ?? 'WAITING'}</strong><small>${escapeHtml(lap?.reason ?? 'Complete the next measured lap.')}</small></li>`;
  }).join('')}</ol><p role="status">${escapeHtml(progress.message)}</p>
  <div class="team-actions"><button class="primary" data-action="academy:start">START NEW FIVE-ATTEMPT SESSION</button>${progress.active ? '<button data-action="academy:stop">STOP PROGRAMME</button>' : ''}${developerMode() ? '<button data-action="references">REFERENCE REVIEW</button>' : ''}</div>
  <p class="academy-warning">Starting replaces your current session with a solo, dry practice on medium tyres. Laps driven by the AI driver, with pit assistance or with track-limit violations do not earn medals.</p></section>`;
}
export function academyConfirmation() {
  return `<section class="driving-academy"><span class="eyebrow">NEW PRACTICE SESSION</span><h2>Replace the current session?</h2><p>Your current session and replay will end. Your livery, team, settings and research are kept. The programme starts solo on a dry circuit with medium tyres.</p><div class="team-actions"><button class="primary" data-action="academy:confirm">REPLACE & START</button><button data-action="academy">KEEP CURRENT SESSION</button></div></section>`;
}
export function programmeHud(progress: PracticeProgress, replay: boolean) {
  if (!progress.active) return '';
  if (replay) return 'REPLAY · PRACTICE AWARDS PAUSED';
  return `${progress.finished ? 'PROGRAMME COMPLETE' : 'CONSISTENCY'} · ${progress.attempts.length}/5 · ${progress.target ? `TARGET ${programmeTime(progress.target)}` : 'BANK A CLEAN LAP'}${progress.attempts.length ? ` · ${progress.attempts.at(-1)!.grade.toUpperCase()}` : ''}`;
}
