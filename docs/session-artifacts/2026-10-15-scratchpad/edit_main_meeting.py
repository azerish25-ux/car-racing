p = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/main.ts'
s = open(p).read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b)


# imports
rep("""import {
  controls,
  DEFAULT_OPTIONS,
  racingSession,
  validateSetup,
  type SessionOptions,
} from './simulation/config.ts';""", """import {
  controls,
  DEFAULT_OPTIONS,
  DRIVERS,
  racingSession,
  validateSetup,
  type SessionOptions,
} from './simulation/config.ts';
import {
  confirmGates,
  createMeeting,
  meetingClassification,
  motoOptions,
  pickMeetingGates,
  qualifyingOptions,
  recordMoto,
  recordQualifying,
  type MotoMeeting,
} from './simulation/offroad/meeting.ts';
import { gateSlots } from './simulation/offroad/session.ts';
import { offroadCourse } from './simulation/offroad/venues.ts';
import { meetingFromEvent, meetingScreen } from './ui/offroad-meeting.ts';""")
rep("""import { CareerController, type CareerSession } from './career/controller.ts';""",
    """import {
  CareerController,
  type CareerSession,
  type MeetingOutcome,
} from './career/controller.ts';""")
# fields: after `private career: CareerController;`
rep("""  private career: CareerController;""", """  private career: CareerController;
  /** A two-moto off-road meeting in progress (EVENTS or CAREER): its state,
   * the player's gate choice, the venue's gate preference, the career
   * context it settles into, and which of its sessions is running. */
  private meeting: {
    state: MotoMeeting;
    playerSlot: number | null;
    preference: number[] | null;
    career: CareerSession | null;
    running: 'qualifying' | 'moto' | null;
  } | null = null;
  /** Set while a meeting starts its own session (any other start ends it). */
  private meetingStarting = false;""")
# career host meeting callback
rep("""      start: (options, career) => {
        // A career session is outside the legacy championship weekend.
        this.championshipRound = -1;
        this.ui.championshipNote = '';
        void this.start(options, false, false, career).catch((e) => this.fail(e));
      },""", """      start: (options, career) => {
        // A career session is outside the legacy championship weekend.
        this.championshipRound = -1;
        this.ui.championshipNote = '';
        void this.start(options, false, false, career).catch((e) => this.fail(e));
      },
      meeting: (options, career, name) => this.openMeeting(name, options, career),""")
# start(): end a meeting when an unrelated session starts
rep("""    if (this.state === 'loading' && this.worker) return;
    this.gridClock.reset();""", """    if (this.state === 'loading' && this.worker) return;
    // Any session the meeting did not start itself ends the meeting.
    if (!this.meetingStarting) this.meeting = null;
    this.meetingStarting = false;
    this.gridClock.reset();""")
# finish(): record meeting before career settlement
rep("""    this.recordChampionshipRace(frame);
    // Career sessions are paid to the career wallet (itemised under the
    // classification); the team ledger pays every other racing session.
    const careerSession = this.career.finish(frame, this.options.grid);
    this.ui.results(frame);
    if (racingSession(this.options.mode) && !careerSession) {""", """    this.recordChampionshipRace(frame);
    const meeting = this.recordMeeting(frame);
    // Career sessions are paid to the career wallet (itemised under the
    // classification); the team ledger pays every other racing session.
    const careerSession = this.career.finish(frame, this.options.grid, meeting.outcome ?? undefined);
    this.ui.results(frame);
    // A meeting session continues on the meeting screen (gate pick, next
    // moto, combined classification) instead of the plain results card.
    if (meeting.recorded) this.showMeeting();
    if (racingSession(this.options.mode) && !careerSession) {""")
# menu leaves the meeting
rep("""      case 'menu':
        this.gridBriefingOpen = false;
        this.gridAutomatic = false;""", """      case 'menu':
        this.meeting = null;
        this.gridBriefingOpen = false;
        this.gridAutomatic = false;""")
# restart keeps a meeting session
rep("""      case 'restart':
        void this.start(this.options, false, false, this.career.restartContext()).catch((e) =>
          this.fail(e),
        );""", """      case 'restart':
        // Restarting a meeting's session reruns that session of the meeting.
        if (this.meeting?.running) this.meetingStarting = true;
        void this.start(this.options, false, false, this.career.restartContext()).catch((e) =>
          this.fail(e),
        );""")
# action routing: before `if (name.startsWith('event:') && this.state === 'menu') {`
rep("""    if (name.startsWith('event:') && this.state === 'menu') {""", """    if (name.startsWith('meeting:')) {
      this.meetingAction(name);
      return;
    }
    if (name.startsWith('event:') && this.state === 'menu') {""")
# methods: before `  /** The machine whose setup the garage shows`
rep("""  /** The machine whose setup the garage shows""", """  /** Open a two-moto meeting over a moto event's race options. */
  private openMeeting(
    name: string,
    race: SessionOptions,
    career: CareerSession | null,
    id = `${race.circuit}:meeting`,
    moto2Weather = race.weather,
  ) {
    try {
      this.meeting = {
        state: createMeeting(id, name, race, moto2Weather),
        playerSlot: null,
        preference: null,
        career,
        running: null,
      };
    } catch (error) {
      this.ui.toast(error instanceof Error ? error.message : String(error));
      return;
    }
    this.championshipRound = -1;
    this.ui.championshipNote = '';
    this.showMeeting();
  }
  private showMeeting() {
    const m = this.meeting;
    if (!m) return;
    this.ui.modalContent(
      meetingScreen(m.state, {
        name: (id) => (id === 0 ? this.ui.playerName : (DRIVERS[id] ?? `RIDER ${id + 1}`)),
        preference: m.preference,
        playerSlot: m.playerSlot,
        extra: m.state.stage === 'results' ? this.ui.resultsExtra : '',
      }),
    );
  }
  /** `meeting:…` actions from the EVENTS cards, the career and the meeting screen. */
  private meetingAction(name: string) {
    const [, command, arg] = name.split(':');
    if (command === 'event') {
      const event = EVENTS[Number(arg)];
      if (!event || this.state !== 'menu') return;
      try {
        const race = eventSession(event, { ...DEFAULT_OPTIONS, setup: this.settings.setup });
        const meeting = meetingFromEvent(event, EVENTS);
        this.openMeeting(meeting.name, race, null, meeting.id, meeting.moto2Weather);
      } catch (error) {
        this.ui.toast(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    const m = this.meeting;
    if (!m || m.running) return;
    try {
      if (command === 'show') this.showMeeting();
      else if (command === 'gate') {
        m.playerSlot = Number(arg);
        this.showMeeting();
      } else if (command === 'qualifying' && m.state.stage === 'qualifying')
        this.runMeeting(qualifyingOptions(m.state), 'qualifying', 'part');
      else if (command === 'moto') {
        if (m.state.stage === 'gate-pick' && m.preference)
          m.state = confirmGates(
            m.state,
            pickMeetingGates(m.state, m.preference, m.playerSlot ?? undefined),
          );
        if (m.state.stage === 'moto')
          this.runMeeting(
            motoOptions(m.state),
            'moto',
            m.state.motos.length === 1 ? 'final' : 'part',
          );
      } else if (command === 'again' && m.state.stage === 'results')
        this.openMeeting(
          m.state.name,
          m.state.base,
          m.career,
          m.state.id,
          m.state.weather[1],
        );
    } catch (error) {
      this.ui.toast(error instanceof Error ? error.message : String(error));
    }
  }
  /** Start one session of the meeting (a real, ordinary session). */
  private runMeeting(
    options: SessionOptions,
    running: 'qualifying' | 'moto',
    part: 'part' | 'final',
  ) {
    const m = this.meeting!;
    m.running = running;
    this.ui.closeModal();
    this.meetingStarting = true;
    void this.start(options, false, false, m.career ? { ...m.career, meeting: part } : null)
      .catch((e) => this.fail(e))
      .finally(() => {
        this.meetingStarting = false;
      });
  }
  /** Record a finished meeting session; the final moto returns the
   * combined outcome the career settles. */
  private recordMeeting(frame: Float32Array): {
    recorded: boolean;
    outcome: MeetingOutcome | null;
  } {
    const m = this.meeting;
    if (!m || !m.running) return { recorded: false, outcome: null };
    const running = m.running;
    m.running = null;
    try {
      const cars = Math.round(frame[H.CARS]),
        ids = Array.from({ length: cars }, (_, id) => id);
      if (running === 'qualifying' && this.options.mode === 'qualifying') {
        m.state = recordQualifying(
          m.state,
          qualifyingGrid(frame),
          ids.map((id) => Math.max(0, frame[carBase(id) + F.BEST_LAP] || 0)),
        );
        const course = offroadCourse(this.track.circuit);
        m.preference = course?.spec.gate ? gateSlots(this.track, course, cars).preference : null;
        return { recorded: true, outcome: null };
      }
      if (running === 'moto' && this.options.mode === 'race') {
        const result = raceResult(frame, this.options.grid ?? ids, this.usedDemonstration, this.sessionId);
        m.state = recordMoto(m.state, {
          order: result.order,
          finished: result.order.filter((id) => !result.retired.includes(id)),
        });
        if (m.state.stage !== 'results') return { recorded: true, outcome: null };
        const rows = meetingClassification(m.state),
          mine = rows.find((r) => r.id === 0)!;
        return {
          recorded: true,
          outcome: {
            position: mine.overall,
            cars: rows.length,
            classified: mine.results.some((r) => r.position > 0),
            gridSlot: Math.max(0, m.state.qualifying?.indexOf(0) ?? 0),
          },
        };
      }
    } catch (error) {
      this.ui.toast(`Meeting result not recorded: ${String(error)}`);
    }
    return { recorded: false, outcome: null };
  }
  /** The machine whose setup the garage shows""")
open(p, 'w').write(s)
print('ok')
