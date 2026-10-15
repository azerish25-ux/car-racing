import type { CareerSession, MeetingOutcome } from '../career/controller.ts';
import { qualifyingGrid, raceResult } from '../core/championship.ts';
import type { SessionOptions, WeatherPreset } from '../simulation/config.ts';
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
} from '../simulation/offroad/meeting.ts';
import { gateSlots } from '../simulation/offroad/session.ts';
import { offroadCourse } from '../simulation/offroad/venues.ts';
import { F, H, carBase } from '../simulation/protocol.ts';
import type { Track } from '../simulation/track.ts';
import { meetingScreen } from './offroad-meeting.ts';

/** What the meeting needs from the application (main.ts). */
export interface MeetingHost {
  /** Replace the modal's content with this HTML. */
  modal(html: string): void;
  /** Focus the element matching this selector inside the modal, if any. */
  focus(selector: string): void;
  closeModal(): void;
  toast(message: string): void;
  /** Start one ordinary session (main.ts start()); it reports its own
   * failures. */
  start(options: SessionOptions, career: CareerSession | null): Promise<void>;
  /** Rider name by car id (the player is car 0). */
  riderName(id: number): string;
  /** Extra HTML under the combined classification (the career's payout). */
  resultsExtra(): string;
  /** A meeting opened: it is outside the legacy championship weekend. */
  opened?(): void;
}

/** The session main.ts just finished, as the meeting records it. */
export interface FinishedSession {
  mode: SessionOptions['mode'];
  grid: readonly number[] | undefined;
  demonstration: boolean;
  sessionId: string;
  track: Track;
}

/** What a `restart` request does while a meeting is open: rerun the
 * meeting's running session, return to the meeting screen (a recorded
 * session is never rerun outside the meeting), or restart an ordinary
 * session. */
export type MeetingRestart = 'rerun' | 'meeting' | 'session';

/** The two-moto meeting flow (WP42) between real sessions: its state, the
 * player's gate choice, the venue's gate preference, the career context it
 * settles into and which of its sessions is running. Any session the
 * meeting did not start itself ends it. While a meeting is open and none of
 * its sessions runs, the results state belongs to the meeting screen: every
 * way back to results (Escape, the replay, telemetry, the photo studio)
 * shows the meeting instead of the plain results card. */
export class MeetingFlow {
  private current: {
    state: MotoMeeting;
    playerSlot: number | null;
    preference: number[] | null;
    career: CareerSession | null;
    running: 'qualifying' | 'moto' | null;
  } | null = null;
  /** Set while the meeting starts its own session. */
  private starting = false;
  constructor(private readonly host: MeetingHost) {}
  /** The meeting's state (null: no meeting open). */
  get state(): MotoMeeting | null {
    return this.current?.state ?? null;
  }
  /** Is one of the meeting's sessions running? */
  get running() {
    return this.current?.running ?? null;
  }
  /** A meeting is open and waits on its own screen between sessions. */
  get waiting() {
    return !!this.current && !this.current.running;
  }
  /** main.ts start(): any session the meeting did not start ends it. */
  sessionStarting() {
    if (!this.starting) this.current = null;
    this.starting = false;
  }
  /** The session start finished or failed (the start flag is spent). */
  sessionStarted() {
    this.starting = false;
  }
  /** Leave the meeting (PADDOCK). */
  end() {
    this.current = null;
    this.starting = false;
  }
  /** Open a two-moto meeting over a moto event's race options. */
  open(
    name: string,
    race: SessionOptions,
    career: CareerSession | null,
    id = `${race.circuit}:meeting`,
    moto2Weather: WeatherPreset = race.weather,
  ) {
    try {
      this.current = {
        state: createMeeting(id, name, race, moto2Weather),
        playerSlot: null,
        preference: null,
        career,
        running: null,
      };
    } catch (error) {
      this.host.toast(error instanceof Error ? error.message : String(error));
      return;
    }
    this.host.opened?.();
    this.show();
  }
  /** Draw the meeting screen for its current stage. */
  show() {
    const m = this.current;
    if (!m) return false;
    this.host.modal(
      meetingScreen(m.state, {
        name: (id) => this.host.riderName(id),
        preference: m.preference,
        playerSlot: m.playerSlot,
        extra: m.state.stage === 'results' ? this.host.resultsExtra() : '',
      }),
    );
    return true;
  }
  /** Return to the results state (after a modal, the replay, telemetry or
   * the photo studio closes): true when the meeting screen was shown, false
   * when the plain results card belongs there. */
  showResults() {
    return this.waiting && this.show();
  }
  /** A `restart` request (RESTART SESSION, RACE AGAIN, TRY AGAIN). */
  restart(): MeetingRestart {
    const m = this.current;
    if (!m) return 'session';
    if (m.running) {
      // Restarting a meeting's session reruns that session of the meeting.
      this.starting = true;
      return 'rerun';
    }
    // A session the meeting already recorded cannot run again on its own
    // (it would race with the meeting's career context and pay nobody).
    this.show();
    return 'meeting';
  }
  /** `meeting:show`, `meeting:gate:N`, `meeting:qualifying`, `meeting:moto`
   * and `meeting:again` from the meeting screen. */
  action(name: string) {
    const [, command, arg] = name.split(':');
    const m = this.current;
    if (!m || m.running) return;
    try {
      if (command === 'show') this.show();
      else if (command === 'gate') {
        const slot = Number(arg);
        if (!Number.isInteger(slot) || slot < 0) return;
        m.playerSlot = slot;
        this.show();
        // The re-render replaced the pressed button: keep keyboard and
        // gamepad focus on the gate just chosen.
        this.host.focus(`[data-action="meeting:gate:${slot}"]`);
      } else if (command === 'qualifying' && m.state.stage === 'qualifying')
        this.run(qualifyingOptions(m.state), 'qualifying', 'part');
      else if (command === 'moto') {
        if (m.state.stage === 'gate-pick' && m.preference)
          m.state = confirmGates(
            m.state,
            pickMeetingGates(m.state, m.preference, m.playerSlot ?? undefined),
          );
        if (m.state.stage === 'moto')
          this.run(motoOptions(m.state), 'moto', m.state.motos.length === 1 ? 'final' : 'part');
      } else if (command === 'again' && m.state.stage === 'results')
        this.open(m.state.name, m.state.base, m.career, m.state.id, m.state.weather[1]);
    } catch (error) {
      this.host.toast(error instanceof Error ? error.message : String(error));
    }
  }
  /** Start one session of the meeting (a real, ordinary session). */
  private run(options: SessionOptions, running: 'qualifying' | 'moto', part: 'part' | 'final') {
    const m = this.current!;
    m.running = running;
    this.host.closeModal();
    this.starting = true;
    void this.host.start(options, m.career ? { ...m.career, meeting: part } : null).then(
      () => this.sessionStarted(),
      () => this.sessionStarted(),
    );
  }
  /** Record a finished meeting session; the final moto returns the combined
   * outcome the career settles. */
  record(
    frame: Float32Array,
    session: FinishedSession,
  ): { recorded: boolean; outcome: MeetingOutcome | null } {
    const m = this.current;
    if (!m || !m.running) return { recorded: false, outcome: null };
    const running = m.running;
    m.running = null;
    try {
      const cars = Math.round(frame[H.CARS]),
        ids = Array.from({ length: cars }, (_, id) => id);
      if (running === 'qualifying' && session.mode === 'qualifying') {
        m.state = recordQualifying(
          m.state,
          qualifyingGrid(frame),
          ids.map((id) => Math.max(0, frame[carBase(id) + F.BEST_LAP] || 0)),
        );
        const course = offroadCourse(session.track.circuit);
        m.preference = course?.spec.gate ? gateSlots(session.track, course, cars).preference : null;
        return { recorded: true, outcome: null };
      }
      if (running === 'moto' && session.mode === 'race') {
        const result = raceResult(
          frame,
          session.grid ?? ids,
          session.demonstration,
          session.sessionId,
        );
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
      this.host.toast(`Meeting result not recorded: ${String(error)}`);
    }
    return { recorded: false, outcome: null };
  }
}
