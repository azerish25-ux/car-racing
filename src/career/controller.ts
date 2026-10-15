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
import {
  CAREER_PAGES,
  careerHub,
  licenceBriefing,
  licenceResult,
  payoutPanel,
  type CareerPage,
  type CareerView,
} from '../ui/career-hub.ts';
import { ContactMeter } from './contact.ts';
import { licenceCourse } from './course.ts';
import {
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
  buildEvent,
  championshipCalendar,
  disciplineEvents,
  disciplineTiers,
  licenceAvailability,
  tierVehicles,
  vehiclePrice,
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
  disciplineStatus,
  liveRegistry,
  type CareerRegistry,
  type DisciplineId,
} from './registry.ts';
import {
  CAREER_KEY,
  careerFromLegacy,
  newCareer,
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
}
/** What the career needs from the application shell (main.ts). */
export interface CareerHost {
  store: {
    readRecovered<T>(
      key: string,
      validate: (value: unknown) => T | null,
    ): Promise<{ value: T | null; recovered: boolean; reason: string | null }>;
    writeWithBackup(key: string, value: unknown): Promise<void>;
  };
  modal(html: string): void;
  modalRoot(): HTMLElement;
  toast(message: string): void;
  setResultsExtra(html: string): void;
  start(options: SessionOptions, career: CareerSession): void;
  pause(): void;
  state(): string;
  track(): Track;
  setup(): Setup;
  assist(): Assist;
}
const pageOf = (value: string | undefined): CareerPage =>
  CAREER_PAGES.some(([id]) => id === value) ? (value as CareerPage) : 'hub';
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
  constructor(
    private readonly host: CareerHost,
    registry: CareerRegistry = liveRegistry(),
  ) {
    this.registry = registry;
  }
  /** Read the career, recovering from the backup, else seed from legacy saves. */
  async load(legacy: LegacySaves) {
    try {
      const saved = await this.host.store.readRecovered(CAREER_KEY, validateCareer);
      if (saved.value) {
        this.save = saved.value;
        if (saved.recovered)
          this.host.toast(
            `Career save was unreadable (${saved.reason}); restored the previous copy.`,
          );
        return;
      }
      this.save = careerFromLegacy(legacy);
      if (saved.reason)
        this.host.toast(
          `Career save was unreadable (${saved.reason}) and no backup could be used; a new career starts. The unreadable copy becomes the backup on the next save.`,
        );
    } catch (error) {
      this.save = careerFromLegacy(legacy);
      this.host.toast(
        `Career save unavailable: ${error instanceof Error ? error.message : String(error)}. Career progress will not be kept.`,
      );
    }
  }
  /** Apply `change` to the latest save and persist it (backup first). Writes
   * are serialized, so two quick transactions cannot lose each other. */
  transact(change: (save: CareerSave) => CareerSave): Promise<CareerSave> {
    const run = this.queue.then(async () => {
      const next = change(this.save);
      if (next !== this.save) {
        await this.host.store.writeWithBackup(CAREER_KEY, next);
        this.save = next;
      }
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  open(page: CareerPage = this.view.page, status?: string) {
    this.view = { ...this.view, page, status };
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
    const message = error instanceof Error ? error.message : String(error);
    this.host.toast(message);
    this.refresh(message);
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
      if (command === 'licence' && LICENCE_IDS.includes(a as LicenceId))
        return this.briefLicence(a as LicenceId);
      if (command === 'licenceGo') return this.startLicence();
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
    const event = this.findEvent(key);
    if (!event || event.status !== 'open' || !event.definition || !event.vehicle)
      return this.fail(
        new Error(
          event
            ? `${event.name}: ${event.reasons.join('; ') || 'not available'}`
            : 'Unknown career event.',
        ),
      );
    if (!this.canStart()) return;
    const player = this.vehicle(event.vehicle)!;
    let definition = event.definition,
      round = -1;
    if (event.kind === 'championship') {
      const tiers = disciplineTiers(this.registry, event.discipline),
        tierIndex = tiers.findIndex((t) => t.id === event.tier),
        tier = tiers[tierIndex],
        venues = disciplineStatus(this.registry, event.discipline).venues;
      const rounds = championshipCalendar(venues, tierIndex, tier);
      const saved = await this.transact((s) =>
        startChampionship(s, event.key, player.id, rounds, definition.opponents + 1),
      );
      const season = saved.championships[event.key].season;
      round = season.results.length;
      const spec = season.rounds[round];
      const venue = venues.find((v) => v.id === spec.circuit);
      const built = buildEvent(this.registry, {
        id: `career-${tier.id}-championship-r${round + 1}`,
        name: `${tier.name.toUpperCase()} CHAMPIONSHIP · ROUND ${round + 1}`,
        venue: spec.circuit,
        player,
        mode: 'race',
        laps: spec.laps,
        cars: season.cars,
        weather: spec.weather,
      });
      if (!built.definition || !venue)
        return this.fail(new Error(built.reason ?? 'Round venue missing.'));
      definition = built.definition;
    }
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
    const show = (state: 'saving' | 'saved' | 'failed') =>
      this.host.modal(licenceResult(test, outcome, payout, state));
    this.transact((s) => {
      const settled = settleLicence(s, outcome, session, ai);
      payout = settled.payout;
      return settled.save;
    })
      .then(() => show('saved'))
      .catch((error) => {
        show('failed');
        this.host.toast(`Licence result not saved: ${String(error)}`);
      });
    show('saving');
  }
  /** main.ts finish(): settle a career race. Returns true for a career
   * session (the team ledger does not also pay it). */
  finish(frame: Float32Array, grid: readonly number[] | undefined) {
    const career = this.active;
    if (!career) return false;
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
    const outcome = {
      session,
      position: Math.round(frame[o + F.RANK]),
      cars,
      classified: frame[o + F.FINISH] > 0 && frame[o + F.RETIRED] === 0,
      demonstration: ai,
      penalties: frame[o + F.PENALTY],
      contactEnergy: this.contact.energy,
      gridSlot: Math.max(0, startGrid.indexOf(0)),
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
    const render = (state: 'saving' | 'saved' | 'failed') => {
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
      .then(() => render('saved'))
      .catch((error) => {
        render('failed');
        this.host.toast(`Career payment not saved: ${String(error)}`);
      });
    return true;
  }
  /** Championship prize: the cheapest unowned machine of the next tier up. */
  private prizeFor(event: NonNullable<CareerSession['event']>) {
    if (event.kind !== 'championship') return null;
    const tiers = disciplineTiers(this.registry, event.discipline),
      index = tiers.findIndex((t) => t.id === event.tier);
    for (const t of tiers.slice(index + 1)) {
      const prize = tierVehicles(this.registry, t)
        .filter((v) => !this.save.owned.some((o) => o.id === v.id))
        .sort((a, b) => vehiclePrice(this.registry, a) - vehiclePrice(this.registry, b))[0];
      if (prize) return prize.id;
    }
    return null;
  }
}
