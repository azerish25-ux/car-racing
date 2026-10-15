import { raceResult } from '../core/championship.ts';
import {
  DEFAULT_OPTIONS,
  type Assist,
  type SessionOptions,
  type Setup,
} from '../simulation/config.ts';
import { eventSession } from '../simulation/events.ts';
import { F, H, carBase } from '../simulation/protocol.ts';
import type { Track } from '../simulation/track.ts';
import { backupKey, recoverSave } from '../storage/data.ts';
import {
  CAREER_PAGES,
  abandonPrompt,
  careerHub,
  licenceBriefing,
  licenceResult,
  payoutPanel,
  replacePrompt,
  type CareerPage,
  type CareerView,
  type PaymentState,
} from '../ui/career-hub.ts';
import { ContactMeter } from './contact.ts';
import { licenceCourse } from './course.ts';
import {
  abandonChampionship,
  buyVehicle,
  careerSetup,
  deletePreset,
  savePreset,
  selectPreset,
  setActive,
  settleLicence,
  settleRace,
  startChampionship,
  type Payout,
} from './economy.ts';
import {
  championshipPrize,
  disciplineEvents,
  licenceAvailability,
  type CareerEvent,
} from './ladder.ts';
import {
  LICENCE_IDS,
  LICENCE_TESTS,
  LicenceAttempt,
  sampleFrame,
  type LicenceId,
  type LicenceOutcome,
} from './licences.ts';
import {
  DISCIPLINE_IDS,
  liveRegistry,
  type CareerRegistry,
  type DisciplineId,
} from './registry.ts';
import {
  CAREER_KEY,
  CAREER_NEWER_KEY,
  CAREER_UNREADABLE_KEY,
  careerFromLegacy,
  newCareer,
  newerCareerVersion,
  validateCareer,
  type CareerSave,
  type LegacySaves,
} from './save.ts';

/** The career context a session was started with; main.ts carries it so a
 * restart repeats the same career event. */
export interface CareerSession {
  kind: 'race' | 'licence';
  event: Pick<
    CareerEvent,
    'key' | 'kind' | 'discipline' | 'tier' | 'name' | 'stakes' | 'objectives'
  > | null;
  licence: LicenceId | null;
  vehicle: string;
  setup: Setup | null;
  /** Championship round index this session races, or -1. */
  round: number;
  /** A session of a two-moto meeting (offroad/meeting.ts): the career pays
   * the meeting once, on its combined classification, after the final moto;
   * qualifying and the first moto ('part') are not settled on their own. */
  meeting?: 'part' | 'final';
}
/** The meeting's result for the final moto's settlement (finish()). */
export interface MeetingOutcome {
  /** Overall meeting position of the player (1-based) and the field size. */
  position: number;
  cars: number;
  /** The player scored in at least one moto. */
  classified: boolean;
  /** Qualifying position (0-based), the meeting's grid slot. */
  gridSlot: number;
}
/** What the career needs from the application shell (main.ts). */
export interface CareerHost {
  /** The SaveStore: raw reads (recovery and other tabs' writes), a plain
   * write (copies kept aside) and the backup-before-overwrite write. */
  store: {
    read(key: string): Promise<unknown>;
    write(key: string, value: unknown): Promise<void>;
    writeWithBackup(key: string, value: unknown): Promise<void>;
  };
  modal(html: string): void;
  modalRoot(): HTMLElement;
  toast(message: string): void;
  setResultsExtra(html: string): void;
  start(options: SessionOptions, career: CareerSession): void;
  /** Run a career event as a two-moto meeting (absent: not offered). */
  meeting?(options: SessionOptions, career: CareerSession, name: string): void;
  pause(): void;
  state(): string;
  track(): Track;
  setup(): Setup;
  assist(): Assist;
}
const pageOf = (value: string | undefined): CareerPage =>
  CAREER_PAGES.some(([id]) => id === value) ? (value as CareerPage) : 'hub';
/** Writes are not made while the stored career cannot safely be replaced. */
type Persistence =
  | { saving: true }
  | {
      saving: false;
      reason: string;
      /** Copies to keep aside if the player chooses to save in this build. */
      keep: { key: string; value: unknown } | null;
    };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** One writer at a time across tabs, where the browser offers Web Locks. */
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as { locks?: LockManager } | undefined)?.locks;
  if (!locks) return fn();
  let result!: T;
  await locks.request('apex-career-save', async () => {
    result = await fn();
  });
  return result;
}
export class CareerController {
  save: CareerSave = newCareer();
  readonly registry: CareerRegistry;
  private view: CareerView = { page: 'hub', discipline: 'circuit-cars' };
  private queue: Promise<unknown> = Promise.resolve();
  private active: CareerSession | null = null;
  private sessionId = '';
  private attempt: LicenceAttempt | null = null;
  private attemptBuilt = false;
  private pendingLicence: LicenceId | null = null;
  private readonly contact = new ContactMeter(0);
  private aiUsed = false;
  private persistence: Persistence = { saving: true };
  /** An unreadable primary to keep aside before the first overwrite. */
  private quarantine: unknown = undefined;
  constructor(
    private readonly host: CareerHost,
    registry: CareerRegistry = liveRegistry(),
  ) {
    this.registry = registry;
  }
  /** Read the career, recovering from the backup, else seed from legacy
   * saves. A career this build cannot safely overwrite (written by a newer
   * build, or storage that could not be read) is played without saving. */
  async load(legacy: LegacySaves) {
    let primary: unknown, backup: unknown;
    try {
      primary = await this.host.store.read(CAREER_KEY);
      backup = await this.host.store.read(backupKey(CAREER_KEY));
    } catch (error) {
      this.save = careerFromLegacy(legacy);
      const reason = `Career storage could not be read (${message(error)})`;
      this.persistence = { saving: false, reason, keep: null };
      this.host.toast(
        `${reason}. You can play, but nothing is saved this session, so the stored career is left untouched.`,
      );
      return;
    }
    const saved = recoverSave(primary, backup, validateCareer);
    const newer = newerCareerVersion(primary) ?? newerCareerVersion(backup);
    if (newer !== null) {
      // Overwriting would rotate the newer career out of the backup within
      // two writes. Show what this build can read, and write nothing.
      this.save = saved.value ?? careerFromLegacy(legacy);
      const reason = `This career was saved by a newer build (career version ${newer})`;
      this.persistence = {
        saving: false,
        reason,
        keep: { key: CAREER_NEWER_KEY, value: newerCareerVersion(primary) ? primary : backup },
      };
      this.host.toast(
        `${reason}. This build shows ${saved.value ? 'the older copy it can read' : 'a new career'} and saves nothing, so the newer career is kept. Open CAREER to choose otherwise.`,
      );
      return;
    }
    if (saved.value) {
      this.save = saved.value;
      if (saved.recovered) {
        this.quarantine = primary;
        this.host.toast(
          `Career save was unreadable (${saved.reason}); restored the previous copy. The unreadable copy is kept aside.`,
        );
      }
      return;
    }
    this.save = careerFromLegacy(legacy);
    if (saved.reason) {
      this.quarantine = primary ?? backup;
      this.host.toast(
        `Career save was unreadable (${saved.reason}) and no backup could be used; a new career starts. The unreadable copy is kept aside under a separate key, not overwritten.`,
      );
    }
  }
  /** Whether career changes are being saved, and if not, why. */
  get saving() {
    return this.persistence.saving;
  }
  /** Apply `change` to the latest save and persist it (backup first). Writes
   * are serialized in this tab and, where the browser allows, across tabs;
   * a career another tab saved since is re-read and `change` is applied to
   * it, so neither tab's purchases, medals or rounds are lost. */
  transact(change: (save: CareerSave) => CareerSave): Promise<CareerSave> {
    const run = this.queue.then(async () => {
      if (!this.persistence.saving) {
        // Played without saving: the change lasts for this session only.
        this.save = change(this.save);
        return this.save;
      }
      return exclusive(async () => {
        const base = await this.latest();
        const next = change(base);
        if (next === base) return base;
        if (this.quarantine !== undefined) {
          await this.host.store.write(CAREER_UNREADABLE_KEY, this.quarantine);
          this.quarantine = undefined;
        }
        const written = { ...next, revision: base.revision + 1 };
        await this.host.store.writeWithBackup(CAREER_KEY, written);
        this.save = written;
        return written;
      });
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  /** The save to change: this tab's copy, unless another tab has written a
   * different revision since. A newer build's write stops saving here. */
  private async latest() {
    const stored = await this.host.store.read(CAREER_KEY);
    const newer = newerCareerVersion(stored);
    if (newer !== null) {
      const reason = `Another tab saved this career with a newer build (career version ${newer})`;
      this.persistence = { saving: false, reason, keep: { key: CAREER_NEWER_KEY, value: stored } };
      throw new Error(`${reason}; this build has stopped saving so it is not overwritten.`);
    }
    let fresh: CareerSave | null = null;
    try {
      fresh = stored === undefined ? null : validateCareer(stored);
    } catch {
      fresh = null; // Unreadable now: this tab's copy is the best there is.
    }
    if (fresh && fresh.revision !== this.save.revision) {
      this.save = fresh;
      this.host.toast('Career updated from another tab; your change was applied to that copy.');
    }
    return this.save;
  }
  /** The player chose to save in this build: keep the newer build's career
   * aside under its own key, then save this build's career. Queued like any
   * transaction, so no other write can interleave. */
  replaceStored(): Promise<void> {
    const run = this.queue.then(async () => {
      const p = this.persistence;
      if (p.saving) return;
      if (p.keep) await this.host.store.write(p.keep.key, p.keep.value);
      const written = { ...this.save, revision: this.save.revision + 1 };
      await this.host.store.writeWithBackup(CAREER_KEY, written);
      this.save = written;
      this.persistence = { saving: true };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  open(page: CareerPage = this.view.page, status?: string) {
    const p = this.persistence;
    this.view = {
      ...this.view,
      page,
      status,
      unsaved: p.saving ? undefined : { reason: p.reason, replaceable: !!p.keep },
    };
    this.host.modal(careerHub(this.save, this.registry, this.view));
    // Keep keyboard focus on the section the player is in after a re-render.
    this.host
      .modalRoot()
      .querySelector<HTMLElement>(`[data-action="career:page:${page}"]`)
      ?.focus();
  }
  private refresh(status?: string) {
    if (this.host.modalRoot().querySelector('.career-hub')) this.open(this.view.page, status);
  }
  private fail(error: unknown) {
    const text = message(error);
    this.host.toast(text);
    this.refresh(text);
  }
  /** Route a `career…` action. */
  action(name: string) {
    const state = this.host.state();
    if (state === 'loading' || state === 'photo' || state === 'replay') return;
    if (state === 'driving') this.host.pause();
    const [, command, a, b, c] = name.split(':');
    try {
      if (!command) return this.open();
      if (command === 'page') return this.open(pageOf(a));
      if (command === 'discipline' && DISCIPLINE_IDS.includes(a as DisciplineId)) {
        this.view.discipline = a as DisciplineId;
        return this.open(b ? pageOf(b) : 'events');
      }
      if (command === 'start')
        return void this.startEvent(name.slice('career:start:'.length)).catch((error) =>
          this.fail(error),
        );
      if (command === 'meeting') return this.startMeeting(name.slice('career:meeting:'.length));
      if (command === 'licence' && LICENCE_IDS.includes(a as LicenceId))
        return this.briefLicence(a as LicenceId);
      if (command === 'licenceGo') return this.startLicence();
      if (command === 'abandon' && this.save.championships[a]) {
        const entry = this.save.championships[a];
        return this.host.modal(
          abandonPrompt(
            a,
            this.findEvent(a)?.name ?? a,
            this.vehicle(entry.vehicle)?.name ?? entry.vehicle,
            entry.season.results.length,
            entry.season.rounds.length,
          ),
        );
      }
      if (command === 'abandonConfirm')
        return this.change((s) => abandonChampionship(s, a), 'events', 'Season abandoned.');
      if (command === 'replace' && !this.persistence.saving)
        return this.host.modal(replacePrompt(this.persistence.reason, !!this.persistence.keep));
      if (command === 'replaceConfirm')
        return void this.replaceStored()
          .then(() => this.open('hub', 'This build now saves the career.'))
          .catch((error) => this.fail(error));
      if (command === 'buy')
        return this.change(
          (s) => buyVehicle(s, this.registry, a),
          'dealership',
          'Bought. It is in your garage.',
        );
      if (command === 'active')
        return this.change(
          (s) => setActive(s, this.registry, a as DisciplineId, b),
          'garage',
          'Active machine changed.',
        );
      if (command === 'preset') {
        const vehicle = this.registry.vehicles.find((v) => v.id === b);
        if (a === 'save' && vehicle)
          return this.change(
            (s) =>
              savePreset(
                s,
                vehicle,
                this.host.setup(),
                `Preset ${(s.presets[vehicle.id]?.length ?? 0) + 1}`,
              ),
            'garage',
            'Preset saved from the current garage setup.',
          );
        if (a === 'use')
          return this.change(
            (s) => selectPreset(s, b, Number(c)),
            'garage',
            'Preset selected for career sessions.',
          );
        if (a === 'delete')
          return this.change((s) => deletePreset(s, b, Number(c)), 'garage', 'Preset deleted.');
      }
    } catch (error) {
      this.fail(error);
    }
  }
  private change(fn: (save: CareerSave) => CareerSave, page: CareerPage, done: string) {
    this.transact(fn)
      .then(() => this.open(page, done))
      .catch((error) => this.fail(error));
  }
  private findEvent(key: string) {
    const discipline = key.split('.')[0] as DisciplineId;
    if (!DISCIPLINE_IDS.includes(discipline)) return null;
    return (
      disciplineEvents(this.registry, this.save, discipline).find((e) => e.key === key) ?? null
    );
  }
  private canStart() {
    const state = this.host.state();
    return state === 'menu' || state === 'paused' || state === 'results';
  }
  private base(): SessionOptions {
    return { ...DEFAULT_OPTIONS, assist: this.host.assist(), setup: { ...this.host.setup() } };
  }
  private vehicle(id: string | null) {
    return this.registry.vehicles.find((v) => v.id === id) ?? null;
  }
  private async startEvent(key: string) {
    let event = this.findEvent(key);
    const unavailable = (e: CareerEvent | null) =>
      new Error(
        e ? `${e.name}: ${e.reasons.join('; ') || 'not available'}` : 'Unknown career event.',
      );
    if (!event || event.status !== 'open' || !event.definition || !event.vehicle)
      return this.fail(unavailable(event));
    if (!this.canStart()) return;
    if (event.kind === 'championship') {
      // The event already names the season's machine and next round (a
      // season in progress keeps both); this only creates a season when
      // none is running, and never replaces one with rounds recorded.
      const opened = event;
      await this.transact((s) =>
        startChampionship(
          s,
          opened.key,
          opened.vehicle!,
          opened.calendar,
          opened.definition!.opponents + 1,
        ),
      );
      event = this.findEvent(key);
      if (!event || event.status !== 'open' || !event.definition || !event.vehicle)
        return this.fail(unavailable(event));
    }
    const player = this.vehicle(event.vehicle)!;
    const definition = event.definition!,
      round = event.kind === 'championship' ? event.round : -1;
    const options = eventSession(definition, this.base());
    const cars = options.opponents + 1,
      slot = Math.min(event.startSlot, cars - 1),
      rivals = Array.from({ length: cars - 1 }, (_, i) => i + 1);
    options.grid = [...rivals.slice(0, slot), 0, ...rivals.slice(slot)];
    this.host.start(options, {
      kind: 'race',
      event: {
        key: event.key,
        kind: event.kind,
        discipline: event.discipline,
        tier: event.tier,
        name: definition.name,
        stakes: event.stakes,
        objectives: event.objectives,
      },
      licence: null,
      vehicle: player.id,
      setup: careerSetup(this.save, player),
      round,
    });
  }
  /** A career race event with a two-moto format, run as a full meeting: the
   * same field, venue and stakes; paid once on the combined result. */
  private startMeeting(key: string) {
    const event = this.findEvent(key);
    if (
      !event ||
      event.status !== 'open' ||
      !event.definition ||
      !event.vehicle ||
      event.kind === 'championship'
    )
      return this.fail(new Error('This event cannot run as a meeting.'));
    if (!this.host.meeting) return this.fail(new Error('Meetings are not available here.'));
    if (!this.canStart()) return;
    const player = this.vehicle(event.vehicle)!,
      definition = event.definition;
    const options = eventSession(definition, this.base());
    this.host.meeting(
      options,
      {
        kind: 'race',
        event: {
          key: event.key,
          kind: event.kind,
          discipline: event.discipline,
          tier: event.tier,
          name: `${definition.name} · MEETING`,
          stakes: event.stakes,
          objectives: event.objectives,
        },
        licence: null,
        vehicle: player.id,
        setup: careerSetup(this.save, player),
        round: -1,
        meeting: 'part',
      },
      `${definition.name} · TWO-MOTO MEETING`,
    );
  }
  private briefLicence(id: LicenceId) {
    const a = licenceAvailability(this.registry, this.save, id);
    if (a.status !== 'open')
      return this.fail(new Error(`${LICENCE_TESTS[id].name}: ${a.reasons.join(' ')}`));
    this.pendingLicence = id;
    const venue = this.registry.venues.find((v) => v.id === a.venue);
    this.host.modal(
      licenceBriefing(
        LICENCE_TESTS[id],
        this.vehicle(a.vehicle)?.name ?? '—',
        venue?.name ?? '—',
        a.loaner,
      ),
    );
  }
  private startLicence() {
    const id = this.pendingLicence;
    if (!id || !this.canStart()) return;
    const a = licenceAvailability(this.registry, this.save, id);
    if (a.status !== 'open' || !a.definition) return this.fail(new Error(a.reasons.join(' ')));
    const vehicle = this.vehicle(a.vehicle)!;
    const options = eventSession(a.definition, this.base());
    this.host.start(options, {
      kind: 'licence',
      event: null,
      licence: id,
      vehicle: vehicle.id,
      setup: a.loaner ? null : careerSetup(this.save, vehicle),
      round: -1,
    });
  }
  /** main.ts: a session started (career context or null for any other). */
  begin(career: CareerSession | null, sessionId: string) {
    this.active = career;
    this.sessionId = sessionId;
    this.attempt = null;
    this.attemptBuilt = false;
    this.contact.reset();
    this.aiUsed = false;
    this.host.setResultsExtra('');
  }
  restartContext() {
    return this.active;
  }
  sessionSetup() {
    return this.active?.setup ?? null;
  }
  get careerSession() {
    return this.active !== null;
  }
  hudText() {
    if (!this.active?.licence) return '';
    const test = LICENCE_TESTS[this.active.licence];
    return `LICENCE · ${test.name.toUpperCase()} · ${this.attempt?.message ?? 'PREPARING'}`;
  }
  /** Each received snapshot while driving. */
  observe(frame: Float32Array, aiDriving: boolean) {
    if (!this.active) return;
    if (aiDriving) this.aiUsed = true;
    this.contact.observe(frame);
    if (this.active.kind !== 'licence' || !this.active.licence) return;
    if (!this.attemptBuilt) {
      this.attemptBuilt = true;
      const test = LICENCE_TESTS[this.active.licence];
      this.attempt = new LicenceAttempt(
        test,
        licenceCourse(test, this.host.track(), this.vehicle(this.active.vehicle) ?? {}),
      );
    }
    const outcome = this.attempt?.observe(sampleFrame(frame, 0));
    if (outcome) this.completeLicence(outcome);
  }
  private completeLicence(outcome: LicenceOutcome) {
    const test = LICENCE_TESTS[outcome.test],
      session = this.sessionId,
      ai = this.aiUsed;
    this.host.pause();
    let payout: Payout = {
      lines: [],
      total: 0,
      reputation: 0,
      paid: false,
      reason: null,
      awarded: null,
    };
    const show = (state: PaymentState) =>
      this.host.modal(licenceResult(test, outcome, payout, state));
    this.transact((s) => {
      const settled = settleLicence(s, outcome, session, ai);
      payout = settled.payout;
      return settled.save;
    })
      .then(() => show(this.saving ? 'saved' : 'unsaved'))
      .catch((error) => {
        show('failed');
        this.host.toast(`Licence result not saved: ${message(error)}`);
      });
    show('saving');
  }
  /** main.ts finish(): settle a career race. Returns true for a career
   * session (the team ledger does not also pay it). */
  finish(frame: Float32Array, grid: readonly number[] | undefined, meeting?: MeetingOutcome) {
    const career = this.active;
    if (!career) return false;
    // A meeting's qualifying and first moto are settled with the meeting.
    if (career.meeting === 'part') {
      this.host.setResultsExtra('');
      return true;
    }
    if (career.kind === 'licence') {
      if (!this.attempt?.complete)
        this.host.setResultsExtra(
          payoutPanel(
            {
              lines: [],
              total: 0,
              reputation: 0,
              paid: false,
              reason: 'The session ended before a complete licence attempt was measured.',
              awarded: null,
            },
            'saved',
          ),
        );
      return true;
    }
    const event = career.event!;
    const o = carBase(0),
      cars = Math.round(frame[H.CARS]),
      startGrid = grid ?? Array.from({ length: cars }, (_, i) => i),
      session = this.sessionId,
      ai = this.aiUsed;
    const final = career.meeting === 'final' && meeting ? meeting : null;
    const outcome = {
      session,
      position: final ? final.position : Math.round(frame[o + F.RANK]),
      cars: final ? final.cars : cars,
      classified: final ? final.classified : frame[o + F.FINISH] > 0 && frame[o + F.RETIRED] === 0,
      demonstration: ai,
      penalties: frame[o + F.PENALTY],
      contactEnergy: this.contact.energy,
      gridSlot: final ? final.gridSlot : Math.max(0, startGrid.indexOf(0)),
      bestLap: frame[o + F.BEST_LAP],
      round:
        event.kind === 'championship' && career.round >= 0
          ? raceResult(frame, startGrid, ai, session)
          : undefined,
    };
    const settle = (save: CareerSave) => {
      // A restarted round that was already recorded pays as a race only.
      const season = save.championships[event.key]?.season;
      const recordable = !!season && season.results.length === career.round;
      return settleRace(
        save,
        event,
        recordable ? outcome : { ...outcome, round: undefined },
        this.prizeFor(event),
      );
    };
    let payout = settle(this.save).payout;
    const render = (state: PaymentState) => {
      const html = payoutPanel(payout, state, this.registry);
      this.host.setResultsExtra(html);
      const node = this.host.modalRoot().querySelector('.career-payout');
      if (node) node.outerHTML = html;
    };
    render('saving');
    this.transact((s) => {
      const settled = settle(s);
      payout = settled.payout;
      return settled.save;
    })
      .then(() => render(this.saving ? 'saved' : 'unsaved'))
      .catch((error) => {
        render('failed');
        this.host.toast(`Career payment not saved: ${message(error)}`);
      });
    return true;
  }
  /** Championship prize: the cheapest unowned, raceable machine of a tier up. */
  private prizeFor(event: NonNullable<CareerSession['event']>) {
    if (event.kind !== 'championship') return null;
    return championshipPrize(this.registry, event.discipline, event.tier, this.save.owned);
  }
}
