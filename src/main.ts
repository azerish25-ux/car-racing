import {
  graphicsSettingsChanged,
  runSettingsChange,
  yieldBrowserTask,
  type SettingsPhase,
} from './core/settings-transition.ts';
import { raceBriefing } from './ui/race-briefing.ts';
import { GridPresentationClock } from './core/grid-presentation.ts';
import { GridPresentationPanel } from './ui/grid-presentation.ts';
import './ui/grid-presentation.css';
import { menuPreview, shouldDrawMenu } from './rendering/menu-preview.ts';
import { shouldDrawReplay } from './rendering/replay-presentation.ts';
import { TabEvidence } from './ui/tab-evidence.ts';
import { ReferenceSessionReview, referenceSessionPanel } from './ui/reference-session.ts';
import { escapeHtml } from './ui/team-hub.ts';
import { SessionReview } from './core/session-review.ts';
import { ReviewInputEvidence, type ReviewHardware } from './ui/review-hardware.ts';
import {
  PresentationReview,
  matchesReviewWeather,
  reviewFrame,
  reviewBudget,
  type ReviewWorkload,
} from './rendering/presentation-review.ts';
import { ReviewVideo } from './ui/review-video.ts';
import { ReferenceEvidenceStore, referenceCapture } from './ui/reference-evidence.ts';
import {
  isEngineeringSample,
  PauseHandshake,
  type ClientMessage,
  type WorkerMessage,
} from './workers/diagnostics.ts';
import PhysicsWorker from './workers/physics.worker.ts?worker&inline';
import '@fontsource-variable/saira/wdth.css';
import '@fontsource-variable/saira/wdth-italic.css';
import './ui/style.css';
import { PerformanceCapture, type FrameMetrics } from './core/performance.ts';
declare const __APEX_SOURCE_FINGERPRINT__: string;
declare const __APEX_SOURCE_COMMIT__: string | null;
import { Track } from './simulation/track.ts';
import { circuitDefinition, type CircuitId } from './simulation/circuits.ts';
import {
  controls,
  DEFAULT_OPTIONS,
  racingSession,
  validateSetup,
  type SessionOptions,
} from './simulation/config.ts';
import { vehicleDefinition } from './simulation/vehicles.ts';
import { F, H, carBase } from './simulation/protocol.ts';
import { safetyCarPose } from './rendering/studio/safety-car.ts';
import { RacingRenderer } from './rendering/renderer.ts';
import { Interface, shortTime } from './ui/interface.ts';
import { ghostPose } from './core/ghost-lap.ts';
import { selectedPitCompound } from './ui/race-day-hud.ts';
import { ReplayDirector, ReplayHud } from './ui/replay-hud.ts';
import { FlashbackPanel, flashbackAllowed } from './ui/flashback.ts';
import { FLASHBACK } from './core/flashback.ts';
import { TimeTrialRecords } from './session/time-trial-records.ts';
import { ReplayClock } from './session/replay-clock.ts';
import {
  CHAMPIONSHIP_KEY,
  complete,
  newChampionship,
  nextRound,
  qualifyingGrid,
  raceResult,
  recordRound,
  standings,
  validateChampionship,
  type Championship,
} from './core/championship.ts';
import { InputController } from './input/controller.ts';
import { InputPump } from './input/pump.ts';
import { RacingAudio } from './audio/engine.ts';
import {
  SaveStore,
  DEFAULT_SETTINGS,
  validateSettings,
  downloadBlob,
  type Settings,
} from './storage/data.ts';
import { TelemetryExport } from './storage/telemetry-export.ts';
import { SessionReplay } from './storage/replay-pages.ts';
import { RadioArbiter } from './core/radio.ts';
import { Rumble, rumbleFrom } from './input/rumble.ts';
import { EVENTS, eventSession } from './simulation/events.ts';
import { eventHub } from './ui/event-cards.ts';
import { RadioCaption } from './ui/radio-caption.ts';
import { TelemetryRecorder } from './storage/recorders.ts';
import { clamp } from './core/math.ts';
import {
  changeTeam,
  driverProfile,
  newTeam,
  researchSetup,
  rewardIncome,
  rewardRace,
  validateTeam,
  type TeamAction,
  type TeamState,
  type ResearchId,
  type Department,
  type DriverId,
} from './storage/team-career.ts';
import { TeamMediaView } from './ui/team-media.ts';
import { teamHub, type HubPage } from './ui/team-hub.ts';
import { PhotoStudio } from './ui/photo-studio.ts';
import { referenceReview, bindReferenceReview } from './ui/reference-review.ts';
import { REFERENCES } from './ui/reference-catalogue.ts';
import { referenceRoute } from './ui/reference-routes.ts';
import { drivingAcademy, academyConfirmation, programmeHud } from './ui/driving-academy.ts';
import { LiveSky, liveSkyPreferred, setLiveSkyPreferred } from './rendering/live-sky.ts';
import { requestObserver, storedObserver } from './rendering/sky-ephemeris.ts';
import { PracticeProgramme } from './simulation/practice-programme.ts';
import { CareerController, type CareerSession } from './career/controller.ts';
import type { GuideMode } from './rendering/driving-guide.ts';
import type { FestivalSession } from './session/free-roam.ts';
type State = 'menu' | 'loading' | 'driving' | 'paused' | 'results' | 'replay' | 'photo' | 'pregame';
export class GameApp {
  private readonly gridClock = new GridPresentationClock();
  private gridPanel: GridPresentationPanel | null = null;
  private gridAutomatic = false;
  private gridBriefingOpen = false;
  private track = new Track();
  private ui: Interface;
  private photoStudio: PhotoStudio;
  private team: TeamState = newTeam();
  private teamPage: HubPage = 'overview';
  private mediaView: TeamMediaView | null = null;
  private teamBusy = false;
  private sessionId = '';
  private usedDemonstration = false;
  /** Festival free roam: while set it owns input, frames and the canvas. */
  private festival: FestivalSession | null = null;
  private festivalStarting = false;
  private programme = new PracticeProgramme();
  /** Driver career (src/career): licences, events, garage and payments. */
  private career: CareerController;
  private inspectedReference: number | null = null;
  private referenceEvidence = ReferenceEvidenceStore.browser();
  private referenceSession: ReferenceSessionReview;
  private photoReturn: State = 'menu';
  private photoReturnHub = false;
  private frozenPhoto: Float32Array | null = null;
  private captureRequested = false;
  private capturingPhoto = false;
  private renderer: RacingRenderer | null = null;
  /** LIVE lighting: the real sky over the player's location. */
  private liveSky = new LiveSky();
  private liveSkyChecked = -Infinity;
  private input: InputController;
  private audio = new RacingAudio();
  private store = new SaveStore();
  /** Time Trial: records the player's laps and plays the saved PB as a ghost. */
  private readonly records = new TimeTrialRecords({
    store: this.store,
    toast: (message) => this.ui.toast(message),
    playerName: () => this.ui.playerName,
  });
  /** Saved championship, and the calendar round the current weekend belongs to. */
  private championship: Championship | null = null;
  private championshipRound = -1;
  private exporter = new TelemetryExport();
  private exporting = false;
  private presentationReview = new PresentationReview();
  private reviewMetrics = reviewFrame();
  private reviewVideo = new ReviewVideo();
  private sessionReview = new SessionReview();
  private tabEvidence = new TabEvidence(__APEX_SOURCE_FINGERPRINT__);
  private reviewInputs = new ReviewInputEvidence();
  private reviewMachineEvidence: ReviewHardware | null = null;
  private performanceCapture = new PerformanceCapture();
  private profileMachine = '';
  private profileWorkload = '';
  private profileMetrics: FrameMetrics = {
    renderCPUms: 0,
    physicsMs: 0,
    drawCalls: 0,
    triangles: 0,
    gpuMs: null,
    gpuSequence: 0,
  };
  private savingSettings = false;
  private settingsPhase: SettingsPhase = 'idle';
  private settingsResizePending = false;
  private disposed = false;
  private settings: Settings = structuredClone(DEFAULT_SETTINGS);
  private worker: Worker | null = null;
  private current: Float32Array | null = null;
  private previous: Float32Array | null = null;
  private receivedAt = 0;
  private state: State = 'loading';
  private options: SessionOptions = { ...DEFAULT_OPTIONS };
  private auto = false;
  private ers: 0 | 1 | 2 = 1;
  /** One-shot DRS and ERS overtake presses, sent with the next input sample. */
  private drsPress = false;
  private overtakePress = false;
  private replayHud!: ReplayHud;
  private readonly replayDirector = new ReplayDirector();
  private readonly radio = new RadioArbiter();
  private readonly rumble = new Rumble();
  private radioCaption: RadioCaption;
  /** D31 flashback: used this session, choosing a point, waiting for the worker. */
  private flashbacks = 0;
  private flashbackMode = false;
  private flashbackPending = false;
  private flashbackPanel!: FlashbackPanel;
  private safetyCarScratch = ghostPose();
  private inputPump: InputPump;
  private previousTime = 0;
  private renderedAt = 0;
  private renderedState: State | null = null;
  private menuCovered = false;
  private viewportRedrawPending = false;
  private presentationFrames = 0;
  private timer = 0;
  private generation = 0;
  private replay: SessionReplay | null = null;
  private telemetry: TelemetryRecorder | null = null;
  private replayA: Float32Array | null = null;
  private replayB: Float32Array | null = null;
  private readonly replayClock = new ReplayClock();
  /** Replay-clock witness (F01): callbacks that could not advance playback. */
  private replayStall = { buffering: 0, gpuDeferred: 0, lastBufferedTarget: -1 };
  private replayReturn: State = 'paused';
  private comparison = false;
  private liveSurface: {
    water: Float32Array;
    rubber: Float32Array;
    marbles: Float32Array;
    time: number;
  } | null = null;
  private appliedReplaySurfaceTime = -Infinity;
  private recordingWarnings: string[] = [];
  private graphClock = 0;
  private telemetryReturn: State = 'paused';
  private errorStopped = false;
  private readyResolve: (() => void) | null = null;
  private initTimeout = 0;
  constructor() {
    window.addEventListener('keydown', this.reviewKeyboard);
    const element = document.getElementById('app')!;
    this.ui = new Interface(element, this.track, {
      action: (name) => this.action(name),
      start: (options, holdOnGrid) => {
        if ((options.mode as string) === 'festival') {
          void this.startFestival(options).catch((e) => this.fail(e));
          return;
        }
        // A session started from the paddock form is outside the championship.
        this.championshipRound = -1;
        this.ui.championshipNote = '';
        void this.start(options, false, holdOnGrid).catch((e) => this.fail(e));
      },
      apply: (s) => this.applySettings(s),
      seek: (value) => {
        this.seekReplay(value);
      },
      replaySpeed: (value) => {
        this.replayClock.setRate(value);
      },
      previewAudio: (settings) => {
        void this.audio
          .previewDriving(settings)
          .catch((error) => this.ui.toast(`Audio preview unavailable: ${String(error)}`));
      },
      exportSetup: () =>
        downloadBlob(
          new Blob([JSON.stringify({ version: 1, setup: this.settings.setup }, null, 2)], {
            type: 'application/json',
          }),
          'apex-setup.json',
        ),
      importSetup: (file) => void this.importSetup(file),
    });
    this.replayHud = new ReplayHud(element);
    this.radioCaption = new RadioCaption(element);
    this.career = new CareerController({
      store: this.store,
      modal: (html) => this.ui.modalContent(html),
      modalRoot: () => this.ui.get('modalContent'),
      toast: (message) => this.ui.toast(message),
      setResultsExtra: (html) => {
        this.ui.resultsExtra = html;
      },
      start: (options, career) => {
        // A career session is outside the legacy championship weekend.
        this.championshipRound = -1;
        this.ui.championshipNote = '';
        void this.start(options, false, false, career).catch((e) => this.fail(e));
      },
      pause: () => this.pause(),
      state: () => this.state,
      track: () => this.track,
      setup: () => this.settings.setup,
      assist: () => this.ui.options.assist,
    });
    this.flashbackPanel = new FlashbackPanel(this.ui.get('replayBar'));
    const identity = this.ui.get('buildIdentity');
    identity.textContent = __APEX_SOURCE_COMMIT__
      ? `BUILD / ${__APEX_SOURCE_COMMIT__.slice(0, 7)}`
      : `SOURCE / ${__APEX_SOURCE_FINGERPRINT__.slice(0, 7)}`;
    identity.title = __APEX_SOURCE_COMMIT__ ?? __APEX_SOURCE_FINGERPRINT__;
    this.referenceSession = new ReferenceSessionReview(
      element,
      __APEX_SOURCE_FINGERPRINT__,
      this.referenceEvidence,
    );
    this.photoStudio = new PhotoStudio(element, {
      change: (value) => this.renderer?.setPhoto(value, this.frozenPhoto?.[H.CARS] ?? 1),
      preview: (value) => this.renderer?.setLivery(value),
      save: async (value) => {
        await this.saveTeam(changeTeam(this.team, { type: 'livery', value }));
      },
      capture: () => {
        if (this.state !== 'photo' || this.capturingPhoto || this.captureRequested) return;
        this.captureRequested = true;
        this.photoStudio.captureBusy(true);
      },
      unlinkReference: () => {
        this.inspectedReference = null;
      },
      close: () => this.closePhoto(),
    });
    // The studio is not a dialog: own Escape even when a slider/button has focus.
    element.addEventListener('keydown', (event) => {
      if (this.state === 'photo' && event.code === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closePhoto();
      }
    });
    this.input = new InputController(this.settings, (name) => this.action(name));
    this.inputPump = new InputPump((dt) => {
      if (this.errorStopped || document.hidden) return;
      if (this.festival) {
        if (this.festival.isPaused) this.input.pollActions(['pause']);
        else {
          const input = this.input.update(dt);
          this.festival.input(input);
          input.shift = 0;
        }
        return;
      }
      if (this.state !== 'driving') {
        if (this.state === 'replay' && !this.ui.telemetryModal.open && !this.ui.modal.open)
          this.input.pollActions(['pause', 'camera', 'replay', 'mute', 'debug']);
        else if (
          this.state === 'paused' &&
          !this.ui.telemetryModal.open &&
          document.querySelector('#modal [data-action="resume"]')
        )
          this.input.pollActions(['pause']);
        else this.input.pollActions('off');
        return;
      }
      const input = this.input.update(dt);
      // A device fault may have paused the session during update().
      if (this.state !== 'driving') return;
      input.ers = this.ers;
      input.drs = this.drsPress;
      input.overtake = this.overtakePress;
      this.drsPress = this.overtakePress = false;
      this.post({ type: 'input', input: { ...input } });
      input.shift = 0;
    });
    this.inputPump.start();
    element
      .querySelectorAll<HTMLElement>('[data-touch]')
      .forEach((e) =>
        this.input.bindTouch(e, e.dataset.touch as 'left' | 'right' | 'throttle' | 'brake'),
      );
    window.addEventListener('resize', () => {
      this.performanceCapture.interrupt('Viewport changed');
      this.interruptReview('Viewport changed');
      // Quality preparation owns render targets until its save settles. Apply
      // the latest viewport once afterward, not concurrently with compilation.
      if (this.savingSettings) this.settingsResizePending = true;
      else if (this.festival) this.festival.resize();
      else this.renderer?.resize();
      this.viewportRedrawPending = true;
      this.renderedState = null; // Restore a resized backdrop once, including behind an editor.
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.suspendPlayback();
    });
    const canvas = document.getElementById('world') as HTMLCanvasElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fail(
        new Error(
          'The graphics context was lost. Reload to recover; reduce rendering quality if this repeats.',
        ),
      );
    });
    canvas.addEventListener('dblclick', () => {
      if (this.state === 'driving' && this.renderer?.mode === 'cockpit')
        void canvas
          .requestPointerLock()
          ?.catch((e) => this.ui.toast(`Mouse look unavailable: ${String(e)}`));
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement && this.renderer) {
        this.renderer.lookX = clamp(this.renderer.lookX - e.movementX * 0.002, -1.3, 1.3);
        this.renderer.lookY = clamp(this.renderer.lookY - e.movementY * 0.002, -0.45, 0.6);
      }
    });
    window.addEventListener('pagehide', () => this.dispose());
    window.addEventListener('unhandledrejection', (e) => this.fail(e.reason));
    window.addEventListener('error', (e) => {
      if (e.error) this.fail(e.error);
    });
    void this.boot(canvas).catch((e) => this.fail(e));
  }
  private canvas: HTMLCanvasElement | null = null;
  /** Build (or rebuild for another circuit) the complete presentation. */
  private async buildRenderer(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = await RacingRenderer.create(
      canvas,
      this.track,
      (progress) => this.ui.loading(`${Math.floor(progress.fraction * 100)}% · ${progress.label}…`),
      () => this.disposed || this.errorStopped,
      { quality: this.settings.quality, graphics: this.settings.graphics },
    );
    if (!this.renderer || this.disposed || this.errorStopped) return false;
    this.renderer.setQuality(this.settings.quality, this.settings.graphics);
    this.applyMotion(this.renderer, this.settings);
    this.renderer.colorblind = this.settings.colorblind;
    this.renderer.setLivery(this.team.livery);
    if (!this.liveSky.active && liveSkyPreferred()) this.liveSky.start(storedObserver());
    if (this.liveSky.active) this.renderer.lighting = this.liveSky.update() ?? 'day';
    this.audio.configureDriving(this.track, this.settings.drivingAudio);
    this.ui.setTrack(this.track);
    return true;
  }
  /** Circuits own their venue geometry, so a change rebuilds the presentation
   * once, while loading; the simulation worker builds its own matching Track. */
  private async switchCircuit(id: CircuitId) {
    if (this.track.circuit.id === id || !this.canvas) return true;
    this.ui.loading(`Building ${circuitDefinition(id).name}…`);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    this.renderer?.dispose();
    this.renderer = null;
    this.track = new Track('clear', false, undefined, circuitDefinition(id));
    return this.buildRenderer(this.canvas);
  }
  /** Reduced motion removes camera vibration and motion blur (§21.5). */
  private applyMotion(renderer: RacingRenderer, settings: Settings) {
    renderer.shake = settings.reducedMotion ? 0 : settings.shake;
    renderer.reducedMotion = settings.reducedMotion;
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
  }
  private applyCommunication(settings: Settings) {
    this.radio.options.engineer = settings.engineerRadio;
    this.radioCaption.enabled = settings.captions;
  }
  private async boot(canvas: HTMLCanvasElement) {
    let teamLoaded = false;
    try {
      const saved = await this.store.read('settings');
      if (saved) this.settings = validateSettings(saved);
    } catch (e) {
      this.ui.toast(`Local preferences unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const saved = await this.store.readRecovered('team:v1', (v) =>
        v && typeof v === 'object' ? validateTeam(v) : null,
      );
      if (saved.value) this.team = saved.value;
      teamLoaded = !!saved.value;
      if (saved.recovered)
        this.ui.toast(`Team save was unreadable (${saved.reason}); restored the previous copy.`);
    } catch (e) {
      this.ui.toast(
        `Team save unavailable: ${e instanceof Error ? e.message : String(e)}. Starting a temporary team.`,
      );
    }
    try {
      const saved = await this.store.readRecovered(CHAMPIONSHIP_KEY, validateChampionship);
      this.championship = saved.value;
      if (saved.recovered)
        this.ui.toast(`Championship save was unreadable; restored the previous copy.`);
    } catch (e) {
      this.ui.toast(`Championship save unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
    // The career seeds itself from these saves the first time; it never rewrites them.
    await this.career.load({
      team: teamLoaded ? this.team : null,
      championship: this.championship,
      setup: this.settings.setup,
      vehicles: this.career.registry.vehicles,
    });
    if (this.disposed) return;
    this.ui.playerName = driverProfile(this.team).name;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.settings.shake = 0;
    this.input.settings = this.settings;
    this.ui.applyBindings(this.settings.bindings);
    this.ui.loading('Building original bodywork, materials and Aurel circuit…');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!(await this.buildRenderer(canvas))) return;
    this.audio.volume = this.settings.volume;
    document.documentElement.style.setProperty('--ui-scale', String(this.settings.uiScale));
    document.documentElement.dataset.colorblind = String(this.settings.colorblind);
    document.documentElement.dataset.highContrast = String(this.settings.highContrast);
    this.applyCommunication(this.settings);
    const preview = menuPreview(this.track);
    this.current = preview;
    this.previous = preview;
    this.state = 'menu';
    // The loading screen stays up until the first menu frame is drawn: the
    // menu never appears over an undrawn canvas, and what it reports about the
    // scene (LODs, diagnostics) describes a drawn frame.
    this.revealMenu = true;
    this.timer = requestAnimationFrame(this.frame);
  }
  private revealMenu = false;
  private workerPause = new PauseHandshake();
  private post(message: ClientMessage, transfer: Transferable[] = []) {
    if (!this.worker) return;
    this.worker.postMessage(
      message.type === 'pause' ? this.workerPause.request(message.value) : message,
      transfer,
    );
  }
  /** FESTIVAL (SESSION select): the open-world region on the same canvas
   * and GL context. The circuit presentation stays loaded and idle; the
   * festival module and its workers load on demand. */
  private async startFestival(options: SessionOptions) {
    if (this.festival || this.festivalStarting || !this.renderer || !this.canvas) return;
    this.festivalStarting = true;
    const renderer = this.renderer;
    try {
      const { FestivalSession, FESTIVAL_SAVE_KEY } = await import('./session/free-roam.ts');
      this.ui.showMode('loading');
      this.festival = await FestivalSession.start(
        {
          canvas: this.canvas,
          renderer: renderer.renderer,
          element: document.getElementById('app')!,
          quality: this.settings.quality,
          graphics: this.settings.graphics,
          lighting: renderer.lighting,
          loading: (text) => this.ui.loading(text),
          loaded: () => {
            const screen = this.ui.get('loading');
            screen.hidden = true;
            screen.setAttribute('aria-busy', 'false');
          },
          toast: (message) => this.ui.toast(message),
          exit: () => this.exitFestival(),
          // Driving input off while a festival menu is open (keyboard focus
          // reaches its buttons), as in the circuit pause.
          driving: (on) => this.input.setEnabled(on),
          audio: {
            start: () => this.audio.start(),
            stop: () => this.audio.stop(),
            update: (frame, cockpit, playing, view, liveHuman) =>
              this.audio.update(frame, cockpit, playing, view, liveHuman),
          },
          // Career hook: a typed FestivalResult per finished/abandoned event.
          onResult: (result) => window.dispatchEvent(new CustomEvent('festival-result', { detail: result })),
          load: () => this.store.read(FESTIVAL_SAVE_KEY),
          save: (state) => this.store.write(FESTIVAL_SAVE_KEY, state),
        },
        { vehicle: options.vehicles?.[0], weather: options.weather, assist: options.assist, seed: options.seed },
      );
      this.input.setEnabled(true);
    } catch (error) {
      this.festival = null;
      this.exitFestival();
      throw error;
    } finally {
      this.festivalStarting = false;
    }
  }
  private exitFestival() {
    this.festival?.dispose();
    this.festival = null;
    this.input.setEnabled(false);
    this.audio.stop();
    // The festival shared the GL context: restore the circuit presentation.
    this.renderer?.setQuality(this.settings.quality, this.settings.graphics);
    this.state = 'menu';
    this.renderedState = null;
    this.ui.ready();
    this.ui.showMode('menu');
  }
  private async start(
    options: SessionOptions,
    programme = false,
    holdOnGrid = false,
    career: CareerSession | null = null,
  ) {
    if (this.savingSettings) {
      this.ui.toast(
        'Preferences are still being applied. Start the session after saving completes.',
      );
      return;
    }
    if (this.state === 'loading' && this.worker) return;
    this.gridClock.reset();
    this.gridAutomatic = false;
    this.gridBriefingOpen = false;
    this.gridPanel?.hide();
    this.renderer?.gridPerformance.reset();
    this.ui.gridPresentationAvailable = false;
    if (this.renderer) {
      this.renderer.gridPresentationTime = null;
      this.renderer.gridPrepared = false;
    }
    if (programme) this.programme.start();
    else this.programme.stop();
    this.renderer?.setPhoto(null);
    this.photoStudio.close();
    this.frozenPhoto = null;
    this.captureRequested = false;
    this.sessionId = crypto.randomUUID();
    this.career.begin(career, this.sessionId);
    this.radio.reset();
    this.radioCaption.show(null);
    this.usedDemonstration = false;
    this.ui.closeModal();
    this.ui.telemetryModal.close();
    this.performanceCapture.interrupt('Session restarted');
    this.interruptReview('Session restarted');
    this.state = 'loading';
    this.ui.showMode('loading');
    this.ui.loading('Preparing grid, race timing and recording buffers…');
    this.ui.loadingSession(options);
    this.input.setEnabled(false);
    this.audio.stop();
    try {
      await this.audio.start();
    } catch (e) {
      this.ui.toast(
        `Audio unavailable: ${e instanceof Error ? e.message : String(e)}. Racing remains available.`,
      );
    }
    if (this.disposed) return;
    const circuit = circuitDefinition(options.circuit).id;
    if (!(await this.switchCircuit(circuit)) || this.disposed) return;
    this.options = {
      ...options,
      circuit,
      // Time Trial is a solo session: the worker validates the same rule.
      opponents: options.mode === 'time-trial' ? 0 : options.opponents,
      // A career session may race a saved per-vehicle preset (src/career/economy.ts).
      setup: { ...(this.career.sessionSetup() ?? this.settings.setup) },
    };
    this.ui.options = this.options;
    this.auto = false;
    this.ers = 1;
    this.exporter.cancel();
    if (this.replay) void this.replay.dispose();
    this.replay = null;
    this.flashbacks = 0;
    this.flashbackMode = this.flashbackPending = false;
    this.liveSurface = null;
    this.recordingWarnings = [];
    this.telemetry = null;
    this.replayA = null;
    this.replayB = null;
    this.comparison = false;
    this.current = null;
    this.previous = null;
    this.renderer?.reset();
    this.worker?.terminate();
    if (this.renderer) this.renderer.engineering = null;
    const generation = ++this.generation;
    this.workerPause = new PauseHandshake();
    this.worker = new PhysicsWorker({ name: 'apex-physics' });
    this.worker.onerror = (e) => this.fail(new Error(`Physics worker: ${e.message}`));
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (generation !== this.generation) return;
      const message = event.data;
      if (message.type === 'pauseState') {
        try {
          this.workerPause.accept(message, this.current?.[H.TICK]);
        } catch (error) {
          this.fail(error);
        }
        return;
      }
      if (message.type === 'engineering') {
        if (!isEngineeringSample(message.sample)) {
          this.fail(new Error('Invalid engineering response'));
          return;
        }
        if (this.renderer) this.renderer.engineering = message.sample;
        return;
      }
      if (message.type === 'error') {
        this.fail(new Error(message.message));
        return;
      }
      if (message.type === 'telemetry') {
        this.telemetry?.appendBatch(new Float32Array(message.buffer), message.rows);
        this.post({ type: 'recycleTelemetry', buffer: message.buffer }, [message.buffer]);
        return;
      }
      if (message.type === 'recordingWarning') {
        this.recordingWarnings.push(message.message);
        this.ui.toast(message.message);
        return;
      }
      if (message.type === 'replayFrames') {
        const data = new Float32Array(message.buffer);
        if (this.replay) {
          const stride = this.replay.stride;
          if (
            !Number.isInteger(message.rows) ||
            message.rows < 0 ||
            message.rows * stride > data.length
          ) {
            this.fail(new Error('Invalid replay batch'));
          } else
            for (let i = 0; i < message.rows; i++)
              this.replay.append(data.subarray(i * stride, (i + 1) * stride));
        }
        this.post({ type: 'recycleReplay', buffer: message.buffer }, [message.buffer]);
        return;
      }
      if (message.type === 'surface') {
        this.liveSurface = {
          water: message.water,
          rubber: message.rubber,
          marbles: message.marbles,
          time: message.time,
        };
        this.replay?.recordSurface(message.water, message.rubber, message.time, message.marbles);
        if (this.state !== 'replay')
          this.renderer?.circuit.updateSurface(message.water, message.rubber, message.marbles);
        // Terrain venues: rut keyframes, kept for replays (WP41).
        this.renderer?.circuit.offroad?.record(message.terrain, message.time, this.state !== 'replay');
        return;
      }
      if (message.type === 'flashback') {
        this.completeFlashback(message.time);
        return;
      }
      this.accept(message.buffer);
    };
    const ready = new Promise<void>((resolve) => (this.readyResolve = resolve));
    // Count only time the main thread was free to receive the worker's first
    // snapshot: shader compilation on a slow GPU can block it for longer than
    // the worker needs, which is not a worker failure.
    let waited = 0,
      checked = performance.now();
    const checkWorker = () => {
      if (generation !== this.generation || this.state !== 'loading' || !this.readyResolve) return;
      const now = performance.now();
      waited += Math.min(now - checked, 6000);
      checked = now;
      if (waited < 45000) this.initTimeout = window.setTimeout(checkWorker, 5000);
      else
        this.fail(
          new Error(
            'Physics worker did not initialize. Check that module workers are supported by the browser.',
          ),
        );
    };
    this.initTimeout = window.setTimeout(checkWorker, 5000);
    this.post({ type: 'init', options: this.options });
    this.post({ type: 'engineering', enabled: this.renderer?.debug ?? false });
    await ready;
    clearTimeout(this.initTimeout);
    if (this.errorStopped || this.disposed || generation !== this.generation) return;
    if (!this.renderer || !this.current)
      throw new Error('Session initialization has no render state');
    const warmed = await this.renderer.prepare(
      this.current,
      (message) => this.ui.loading(message),
      () => this.errorStopped || this.disposed || generation !== this.generation,
    );
    if (!warmed || this.errorStopped || this.disposed || generation !== this.generation) return;
    const cars = this.options.opponents + 1;
    this.replay = new SessionReplay(cars, undefined, (message) => {
      if (generation !== this.generation) return;
      this.recordingWarnings.push(message);
      this.ui.toast(message);
    });
    // The initial surface is retained even before the first full recording batch.
    const initialTrack = new Track(this.options.weather, false, undefined, this.track.circuit);
    this.liveSurface = {
      water: initialTrack.water,
      rubber: initialTrack.rubber,
      marbles: initialTrack.marbles,
      time: 0,
    };
    this.replay.recordSurface(initialTrack.water, initialTrack.rubber, 0, initialTrack.marbles);
    this.telemetry = new TelemetryRecorder();
    this.replayA = this.replay.makeFrame();
    this.replayB = this.replay.makeFrame();
    this.renderer.setLivery(this.team.livery);
    await this.prepareTimeTrial(generation);
    if (this.errorStopped || this.disposed || generation !== this.generation) return;
    this.state = 'driving';
    const referenceCamera = this.referenceSession.beginSession(this.sessionId);
    if (referenceCamera) this.renderer.changeCamera(referenceCamera);
    this.ui.get('loading').hidden = true;
    this.ui.showMode('driving');
    // Retain the real paused grid snapshot before the worker is released.
    // A slow first rendered frame must not erase the start-light phase.
    this.observeSession();
    // A normal paddock action lets the player prepare cameras, controls and
    // recording before the real countdown. The initialized worker stays paused;
    // no elapsed race time, injected snapshot or alternate simulation is used.
    if (holdOnGrid || (racingSession(this.options.mode) && !this.settings.quickStart)) {
      this.pause();
      if (!holdOnGrid) this.openRaceBriefing();
      return;
    }
    this.input.setEnabled(true);
    (document.activeElement as HTMLElement)?.blur();
    this.post({ type: 'pause', value: false });
    this.inputPump.poll();
  }
  /** Load this circuit's saved personal-best ghost for a Time Trial session. */
  private async prepareTimeTrial(generation: number) {
    this.ui.timeTrial = null;
    this.renderer?.setGhost(null);
    await this.records.prepare(this.options, this.track, () => generation === this.generation);
    if (generation === this.generation) this.ui.timeTrial = this.records.trial;
  }
  /** Pose the ghost at the presented lap time (same interpolation as the car). */
  private presentGhost(a: Float32Array, b: Float32Array, alpha: number) {
    if (!this.renderer) return;
    this.renderer.setGhost(
      this.state === 'driving' || this.state === 'paused' ? this.records.ghostAt(a, b, alpha) : null,
    );
  }
  private accept(buffer: ArrayBuffer) {
    const next = new Float32Array(buffer);
    if (this.current) {
      if (this.previous && this.previous !== this.current) {
        const old = this.previous.buffer as ArrayBuffer;
        this.post({ type: 'recycle', buffer: old }, [old]);
      }
      this.previous = this.current;
    } else this.previous = next;
    this.current = next;
    this.receivedAt = performance.now();
    if (this.state === 'driving') {
      this.radioCaption.show(this.radio.observe(next, this.options.laps));
      this.rumble.update(
        this.input.activePad(),
        rumbleFrom(next, this.settings.rumble),
        performance.now(),
      );
      this.programme.observe(next);
      this.career.observe(next, this.auto || this.usedDemonstration);
      this.records.observe(next, !this.auto, this.options, this.sessionId);
      this.observeSession();
      if (next[H.PHASE] === 3) this.finish(next);
    }
    if (this.state !== 'driving' && this.state !== 'paused') this.radioCaption.show(null);
    if (this.state !== 'driving') this.rumble.stop(this.input.activePad());
    if (this.readyResolve) {
      this.readyResolve();
      this.readyResolve = null;
    }
  }
  private observeSession() {
    // Evidence tooling costs nothing per frame until it is armed.
    if (!this.sessionReview.active) return;
    this.sessionReview.observe(performance.now(), {
      state: this.state,
      sessionId: this.sessionId,
      sessionMode: this.options.mode,
      autopilot: this.auto || this.usedDemonstration,
      camera: this.renderer?.mode ?? null,
      telemetryOpen: this.ui.telemetryModal.open,
      visible: !document.hidden,
      frame: this.current,
    });
  }
  private frame = (time: number) => {
    this.timer = requestAnimationFrame(this.frame);
    if (this.festival) {
      this.festival.frame(time);
      return;
    }
    this.observeSession();
    // LIVE sky: the moon and stars move every few seconds; the lighting
    // follows the real sun across sunrise and sunset.
    if (this.liveSky.active && this.renderer && time - this.liveSkyChecked >= 5000) {
      this.liveSkyChecked = time;
      const lighting = this.liveSky.update();
      if (lighting && lighting !== this.renderer.lighting) this.renderer.lighting = lighting;
    }
    if (
      this.errorStopped ||
      this.state === 'loading' ||
      !this.renderer ||
      !this.current ||
      !this.previous
    )
      return;
    const previousTime = this.previousTime;
    const wallDelta = Math.max(0.001, (time - (previousTime || time - 16)) / 1000),
      dt = clamp(wallDelta, 0.001, 0.08);
    this.previousTime = time;
    // Editors hold their last completed background from the first callback.
    // Academy previews and real viewport resizes may each request one redraw,
    // not a continuous orbit. Never draw during a settings transaction.
    this.menuCovered = this.state === 'menu' && this.ui.modal.open;
    if (
      !shouldDrawMenu({
        covered: this.menuCovered,
        preview: this.menuCovered && !!this.ui.modal.querySelector('.driving-academy'),
        invalidated: this.renderedState !== this.state,
        resizePending: this.viewportRedrawPending,
        settingsBusy: this.savingSettings,
      })
    )
      return;
    // Telemetry/settings own a replay's last presented frame immediately, even
    // on the first callback after opening. Paused replay redraws only for a seek
    // or explicit camera/resize invalidation; keep the wall clock current above.
    if (
      this.state === 'replay' &&
      !shouldDrawReplay({
        playing: this.replayClock.playing,
        seekPending: this.replayClock.seekPending,
        covered: this.ui.telemetryModal.open || this.ui.modal.open,
        invalidated: this.renderedState !== this.state,
      })
    )
      return;
    // Do not queue seconds of obsolete full-quality frames on a slow GPU.
    // Leave the worker/input pump independent, and retain elapsed presentation
    // time while a draw is deferred. Covered replay/menu returns above still
    // refresh the wall clock so closing a dialog cannot catch up hidden time.
    try {
      if (!this.renderer.canSubmitFrame()) {
        if (this.state === 'replay') this.replayStall.gpuDeferred++;
        this.previousTime = previousTime;
        return;
      }
    } catch (error) {
      this.fail(error);
      return;
    }
    // Menus and paused telemetry do not need a continuously saturated GPU.
    // Input and worker clocks above remain independent of this presentation cap.
    const idle =
      this.state === 'menu' ||
      this.state === 'paused' ||
      this.state === 'results' ||
      this.state === 'photo' ||
      this.ui.telemetryModal.open;
    if (idle && this.renderedState === this.state && time - this.renderedAt < 1000 / 15) return;
    this.renderedAt = time;
    this.renderedState = this.state;
    let a = this.previous,
      b = this.current,
      alpha = clamp((time - this.receivedAt) / Math.max(8, (b[H.TIME] - a[H.TIME]) * 1000), 0, 1);
    if (this.state === 'replay' && this.replay && this.replayA && this.replayB) {
      const targetTime = this.replayClock.target(
        wallDelta,
        this.replay.duration,
        !this.ui.telemetryModal.open && !this.ui.modal.open && !document.hidden,
      );
      const fraction = this.replay.sample(targetTime, this.replayA, this.replayB);
      if (fraction === null) {
        this.replayStall.buffering++;
        this.replayStall.lastBufferedTarget = targetTime;
        this.ui.setText('replayTime', this.replay.error ?? 'BUFFERING RECORDED LAP…');
        this.audio.stop();
        return;
      }
      this.replayClock.presented(targetTime, this.replay.duration);
      alpha = fraction;
      const surface = this.replay.surfaceState;
      if (surface.water.length && surface.time !== this.appliedReplaySurfaceTime) {
        this.renderer.circuit.updateSurface(surface.water, surface.rubber, surface.marbles);
        this.appliedReplaySurfaceTime = surface.time;
      }
      this.renderer.circuit.offroad?.showAt(this.replayB[H.TIME]);
      a = this.replayA;
      b = this.replayB;
      // Attribute writes mutate the DOM even when unchanged; write only changes.
      const seek = this.ui.get('replaySeek') as HTMLInputElement,
        seekMax = String(this.replay.duration),
        seekMin = String(this.replayFloor()),
        seekValue = String(this.replayClock.position);
      if (seek.max !== seekMax) seek.max = seekMax;
      if (seek.min !== seekMin) seek.min = seekMin;
      if (seek.value !== seekValue) seek.value = seekValue;
      this.ui.setText(
        'replayTime',
        `${shortTime(this.replayClock.position)} / ${shortTime(this.replay.duration)}`,
      );
      this.ui.setText('replayPlay', this.replayClock.playing ? 'PAUSE' : 'PLAY');
    }
    if (this.state === 'photo' && this.frozenPhoto) {
      a = this.frozenPhoto;
      b = this.frozenPhoto;
      alpha = 0;
    }
    if (this.state === 'pregame') {
      this.gridClock.advance(wallDelta, !document.hidden);
      this.renderer.gridPresentationTime = this.gridClock.time;
      this.gridPanel?.update(this.gridClock);
      this.gridPanel?.caption(this.renderer.gridShot.caption, this.track.circuit.name);
    }
    this.presentGhost(a, b, alpha);
    const scPhase = b[H.SC_PHASE];
    this.renderer.setSafetyCar(
      scPhase >= 2 && scPhase <= 3 && this.state !== 'menu'
        ? safetyCarPose(this.track, b[H.SC_S], b[H.SC_SPEED], this.safetyCarScratch)
        : null,
    );
    this.renderer.draw(
      a,
      b,
      alpha,
      dt,
      this.state === 'menu',
      this.state === 'replay' || (this.state === 'photo' && this.photoReturn === 'replay'),
      wallDelta,
    );
    // Consume only after a real submission; busy graphics and covered replay
    // keep the latest viewport request pending without creating extra frames.
    this.viewportRedrawPending = false;
    // Finish the visible clearance frame before handing input and timing back.
    if (this.state === 'pregame' && this.gridAutomatic && this.gridClock.complete)
      this.endGridPresentation(true);
    if (this.revealMenu && this.state === 'menu') {
      this.revealMenu = false;
      this.ui.ready();
      this.ui.showMode('menu');
    }
    if (
      (this.state === 'driving' || this.state === 'replay') &&
      !document.hidden &&
      !this.ui.modal.open &&
      !this.ui.telemetryModal.open
    )
      this.referenceSession.sample(
        this.renderer,
        this.sessionId,
        this.state === 'replay',
        this.usedDemonstration || this.auto,
      );
    this.presentationFrames++;
    if (this.presentationReview.active) {
      if (this.state !== 'driving' || document.hidden)
        this.interruptReview('Capture left visible live driving');
      else {
        this.renderer.readReviewMetrics(this.reviewMetrics);
        this.presentationReview.record(performance.now(), this.reviewMetrics);
        this.reviewInputs.sample(performance.now(), () => navigator.getGamepads?.() ?? []);
        this.reviewVideo.frame();
        if (!this.presentationReview.active) {
          this.reviewVideo.stop();
          this.ui.toast(
            `Visual review ${this.presentationReview.state}. Pause → Full-lap visual review → Export evidence.`,
          );
        }
      }
    }
    // Read pixels in the same task as rendering; no permanent preserveDrawingBuffer cost.
    if (this.state === 'photo' && this.captureRequested) {
      this.captureRequested = false;
      this.capturingPhoto = true;
      // Freeze identity in the same task as the rendered pixels. Later async
      // encoding/digest work cannot attach a different frame or selected image.
      const referenceId = this.inspectedReference;
      const filename =
        referenceId === null
          ? `apex-photo-${Date.now()}.png`
          : `apex-reference-${String(referenceId).padStart(3, '0')}-${__APEX_SOURCE_FINGERPRINT__.slice(0, 12)}-${Date.now()}.png`;
      const captureMeta = {
        source: __APEX_SOURCE_FINGERPRINT__,
        imageFile: filename,
        capturedAt: new Date().toISOString(),
        simulationTime: this.renderer.presented.value[H.TIME],
        width: this.renderer.canvas.width,
        height: this.renderer.canvas.height,
        view: JSON.stringify({
          photo: this.renderer.photo,
          night: this.renderer.night,
          lighting: this.renderer.lighting,
          cloud: this.renderer.presented.value[H.CLOUD],
          rain: this.renderer.presented.value[H.RAIN],
          cameraPosition: this.renderer.camera.position.toArray(),
          cameraQuaternion: this.renderer.camera.quaternion.toArray(),
          replay: this.photoReturn === 'replay',
          sourceState: this.photoReturn,
        }),
      };
      void this.renderer
        .capturePhoto()
        .then(async (blob) => {
          downloadBlob(blob, filename);
          if (referenceId !== null) {
            this.referenceEvidence.capture(
              referenceId,
              await referenceCapture(blob, referenceId, captureMeta),
            );
            this.photoStudio.status(
              this.referenceEvidence.persistenceError ??
                `PNG exported and hashed for reference ${referenceId}. Visual acceptance remains a separate comparison.`,
            );
          } else this.photoStudio.status('PNG exported from the rendered scene.');
        })
        .catch((error) => this.photoStudio.status(`Export failed: ${String(error)}`))
        .finally(() => {
          this.capturingPhoto = false;
          this.photoStudio.captureBusy(false);
        });
    }
    if (this.state !== 'menu' && this.state !== 'photo')
      this.ui.update(
        this.state === 'replay' ? this.renderer.presented.value : b,
        this.renderer,
        this.auto,
        this.ers,
      );
    const shown = this.state === 'replay' ? this.renderer.presented.value : b;
    this.renderer.setBroadcastFollow(
      this.state === 'replay' && this.renderer.mode === 'trackside'
        ? this.replayDirector.follow(shown, shown[H.TIME], this.track.length)
        : null,
    );
    this.replayHud.update(
      shown,
      { active: this.state === 'replay', ...this.renderer.broadcastShot },
      shown[H.TIME],
    );
    // Write HUD nodes only when their content changes: an unchanged write still
    // costs a DOM mutation, and progress() copies every attempt.
    const programmeText = this.programme.running
      ? programmeHud(this.programme.progress(), this.state === 'replay')
      : this.state === 'replay'
        ? ''
        : this.career.hudText();
    const programmeNode = this.ui.get('programmeHud');
    if (programmeNode.hidden !== !programmeText) programmeNode.hidden = !programmeText;
    this.ui.setText('programmeHud', programmeText);
    const guide = this.renderer.guide;
    const guideNode = this.ui.get('guideReadout');
    const guideHidden = guide.mesh.count === 0 || this.state === 'photo';
    if (guideNode.hidden !== guideHidden) guideNode.hidden = guideHidden;
    if (!guideHidden || guideNode.textContent === '')
      this.ui.setText(
        'guideReadout',
        `ADVISORY · ${guide.cue.toUpperCase()} · ${Math.round(guide.targetSpeed * 3.6)} KM/H`,
      );
    this.audio.update(
      this.renderer.presented.value,
      this.renderer.mode === 'cockpit',
      !this.ui.telemetryModal.open &&
        !this.ui.modal.open &&
        !document.hidden &&
        (this.state === 'driving' || (this.state === 'replay' && this.replayClock.playing)),
      this.renderer.audioView.value,
      this.state === 'driving' && !this.auto,
    );
    if (this.ui.telemetryModal.open && this.telemetry) {
      this.graphClock += dt;
      if (this.graphClock > 0.2) {
        this.telemetry.draw(
          this.ui.graph,
          this.comparison,
          this.ui.telemetryView,
          this.track.length,
        );
        this.graphClock = 0;
      }
    }
    if (this.performanceCapture.active) {
      if (this.state !== 'driving' || document.hidden) {
        this.performanceCapture.interrupt('Capture left visible live driving');
        this.interruptReview('Capture left visible live driving');
      } else {
        this.renderer.readPerformanceMetrics(this.profileMetrics);
        this.profileMetrics.physicsMs = b[H.STEP_MS];
        this.performanceCapture.record(performance.now(), this.profileMetrics);
        if (this.performanceCapture.state === 'complete')
          this.ui.toast('Performance capture complete. Pause → Performance capture → Export JSON.');
      }
    }
  };
  private suspendPlayback() {
    if (this.state === 'pregame') {
      this.gridClock.pause();
      this.gridPanel?.update(this.gridClock);
    }
    this.referenceSession.interrupt('Playback suspended.');
    if (this.state === 'driving') this.pause();
    else if (this.state === 'replay') {
      this.replayClock.playing = false;
      this.audio.stop();
      this.ui.setText('replayPlay', 'PLAY');
    }
  }
  private seekReplay(value: number) {
    if (this.state !== 'replay' || !this.replay || !Number.isFinite(value)) return;
    // Draw the requested position once before advancing, including after an
    // asynchronous page read. A seek is not a catch-up interval for effects.
    this.replayClock.seek(value, this.replayFloor(), this.replay.duration);
    this.renderer?.reset();
    this.audio.stop();
  }
  private async saveTeam(next: TeamState) {
    if (this.teamBusy) throw new Error('A team transaction is already saving.');
    this.teamBusy = true;
    try {
      await this.store.writeWithBackup('team:v1', next);
      this.team = next;
      this.renderer?.setLivery(next.livery);
      this.ui.playerName = driverProfile(next).name;
    } finally {
      this.teamBusy = false;
    }
  }
  private openMedia() {
    if (this.state === 'loading' || this.state === 'photo') return;
    this.suspendPlayback();
    this.mediaView?.dispose();
    this.mediaView = null;
    this.ui.modalContent('<div id="teamMediaMount"></div>');
    try {
      this.mediaView = new TeamMediaView(
        this.ui.get('modalContent').querySelector<HTMLElement>('#teamMediaMount')!,
        this.team,
        this.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches,
      );
    } catch (error) {
      this.ui.modalContent(
        `<section class="reference-event-config"><h2>Briefing unavailable</h2><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p><p>Your race and saved team have not changed.</p><button data-action="team">RETURN TO TEAM HQ</button></section>`,
      );
    }
  }
  private async saveChampionship(next: Championship) {
    await this.store.writeWithBackup(CHAMPIONSHIP_KEY, next);
    this.championship = next;
  }
  /** Qualifying for the next calendar round, with the championship field. */
  private startChampionshipRound() {
    const c = this.championship,
      round = c ? nextRound(c) : null;
    if (!c || !round) {
      this.ui.toast('No championship round remains. Start a new championship.');
      return;
    }
    this.championshipRound = c.results.length;
    this.ui.championshipNote = `CHAMPIONSHIP · ROUND ${this.championshipRound + 1} OF ${c.rounds.length} · QUALIFYING SETS THE GRID`;
    void this.start({
      ...DEFAULT_OPTIONS,
      assist: this.ui.options.assist,
      compound: round.weather === 'rain' ? 'wet' : this.ui.options.compound,
      circuit: round.circuit,
      weather: round.weather,
      laps: round.laps,
      opponents: c.cars - 1,
      mode: 'qualifying',
      seed: 7919 * (this.championshipRound + 1),
    }).catch((e) => this.fail(e));
  }
  /** Race from the grid the qualifying session just classified. */
  private startWeekendRace() {
    if (this.state !== 'results' || this.options.mode !== 'qualifying' || !this.current) return;
    const grid = qualifyingGrid(this.current);
    if (this.championshipRound >= 0 && this.championship)
      this.ui.championshipNote = `CHAMPIONSHIP · ROUND ${this.championshipRound + 1} OF ${this.championship.rounds.length} · RACE FROM P${grid.indexOf(0) + 1}`;
    void this.start({ ...this.options, mode: 'race', grid }).catch((e) => this.fail(e));
  }
  /** Score a finished championship race from its actual classification. */
  private recordChampionshipRace(frame: Float32Array) {
    const c = this.championship;
    if (
      this.options.mode !== 'race' ||
      !c ||
      this.championshipRound < 0 ||
      this.championshipRound !== c.results.length ||
      nextRound(c)?.circuit !== this.options.circuit
    )
      return;
    const cars = Math.round(frame[H.CARS]);
    const grid = this.options.grid ?? Array.from({ length: cars }, (_, i) => i);
    let next: Championship;
    try {
      next = recordRound(c, raceResult(frame, grid, this.usedDemonstration, this.sessionId));
    } catch (error) {
      this.ui.toast(`Championship result not recorded: ${String(error)}`);
      return;
    }
    const before = standings(c).find((s) => s.id === 0)!.points;
    const table = standings(next);
    const mine = table.findIndex((s) => s.id === 0);
    this.ui.championshipNote = `CHAMPIONSHIP · ROUND ${next.results.length} OF ${next.rounds.length} · +${table[mine].points - before} PTS · P${mine + 1} IN STANDINGS${complete(next) ? ' · SEASON COMPLETE' : ''}`;
    this.championshipRound = -1;
    void this.saveChampionship(next).catch((error) =>
      this.ui.toast(`Championship not saved: ${String(error)}`),
    );
  }
  private openTeam(page: HubPage = this.teamPage) {
    if (this.state === 'loading' || this.state === 'photo') return;
    this.suspendPlayback();
    this.teamPage = page;
    this.ui.modalContent(teamHub(this.team, page));
  }
  private async teamAction(name: string) {
    const [, command, id, delta] = name.split(':');
    if (command === 'page') {
      if (['overview', 'engineering', 'personnel', 'finance'].includes(id))
        this.openTeam(id as HubPage);
      return;
    }
    if (this.teamBusy || !document.querySelector('.team-hub')) return;
    const root = document.querySelector<HTMLElement>('.team-hub')!;
    root.setAttribute('aria-busy', 'true');
    root
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((button) => (button.disabled = true));
    const status = root.querySelector('#teamSaveStatus');
    if (status) status.textContent = 'SAVING TRANSACTION…';
    try {
      if (command === 'apply') {
        const setup = researchSetup(this.team, id as ResearchId, this.settings.setup);
        const settings = validateSettings({ ...this.settings, setup });
        await this.store.write('settings', settings);
        this.settings = settings;
        this.input.settings = settings;
        this.ui.toast('Study setup saved for the next session. Inspect it in Garage & Settings.');
      } else {
        let action: TeamAction;
        if (command === 'week') action = { type: 'week' };
        else if (command === 'staff')
          action = { type: 'staff', department: id as Department, delta: Number(delta) };
        else if (command === 'facility')
          action = { type: 'facility', department: id as Department };
        else if (command === 'driver') action = { type: 'driver', id: id as DriverId };
        else if (command === 'research') action = { type: 'research', id: id as ResearchId };
        else throw new Error('Unknown team action');
        await this.saveTeam(changeTeam(this.team, action));
      }
      if (root.isConnected) this.openTeam(this.teamPage);
    } catch (error) {
      if (root.isConnected) this.openTeam(this.teamPage);
      this.ui.toast(`Team unchanged: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  private openPhoto() {
    if (!this.renderer || !this.current || this.state === 'loading' || this.state === 'photo')
      return;
    this.photoReturnHub = !!document.querySelector('.team-hub');
    if (this.state === 'driving') this.pause();
    this.suspendPlayback();
    this.photoReturn = this.state;
    this.performanceCapture.interrupt('Photo studio opened');
    this.interruptReview('Photo studio opened');
    // Own a copy: queued worker snapshots and replay-page recycling cannot alter the held moment.
    const displayed = this.renderer.presented.value;
    this.frozenPhoto = new Float32Array(displayed[H.CARS] > 0 ? displayed : this.current);
    this.state = 'photo';
    this.ui.closeModal();
    this.ui.telemetryModal.close();
    this.input.setEnabled(false);
    this.audio.stop();
    this.post({ type: 'pause', value: true });
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showMode('photo');
    this.photoStudio.open(this.team.livery, this.frozenPhoto[H.CARS]);
    this.photoStudio.reference(this.inspectedReference);
  }
  private closePhoto() {
    if (this.state !== 'photo') return;
    this.captureRequested = false;
    this.photoStudio.close();
    this.renderer?.setPhoto(null);
    this.renderer?.setLivery(this.team.livery);
    this.frozenPhoto = null;
    this.state = this.photoReturn;
    this.ui.showMode(this.state);
    if (this.state === 'paused') this.ui.pause();
    else if (this.state === 'results' && this.current) this.ui.results(this.current);
    else if (this.state === 'replay') {
      this.replayClock.playing = false;
      this.input.setEnabled(true);
      this.ui.setText('replayPlay', 'PLAY');
    }
    if (this.photoReturnHub) this.openTeam();
  }
  private pause() {
    if (this.state !== 'driving') return;
    this.referenceSession.interrupt('Session paused or focus lost.');
    this.performanceCapture.interrupt('Session paused or focus lost');
    this.interruptReview('Session paused or focus lost');
    this.state = 'paused';
    this.post({ type: 'pause', value: true });
    this.input.setEnabled(false);
    this.audio.stop();
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showMode('paused');
    this.ui.gridPresentationAvailable =
      !!this.current && this.current[H.TICK] === 0 && racingSession(this.options.mode);
    this.ui.pause();
  }
  private openRaceBriefing() {
    if (this.state !== 'paused' || !this.current || this.current[H.TICK] !== 0) return;
    this.gridBriefingOpen = true;
    this.ui.modalContent(raceBriefing(this.options, this.current));
    const preference = this.ui.get('raceDayQuickStart') as HTMLInputElement;
    preference.checked = this.settings.quickStart;
    preference.addEventListener('change', () => {
      this.settings.quickStart = preference.checked;
      void this.store
        .write('settings', this.settings)
        .catch(() => this.ui.toast('Quick Start applies to this session; storage is unavailable.'));
    });
  }
  private beginGridPresentation(automatic = false) {
    if (
      this.state !== 'paused' ||
      !this.current ||
      this.current[H.TICK] !== 0 ||
      !racingSession(this.options.mode) ||
      !this.renderer
    )
      return;
    this.ui.closeModal();
    this.ui.telemetryModal.close();
    this.state = 'pregame';
    this.gridAutomatic = automatic;
    this.gridBriefingOpen = false;
    this.input.setEnabled(false);
    this.post({ type: 'pause', value: true });
    this.audio.stop();
    this.gridClock.reset();
    if (automatic) this.gridClock.play();
    this.renderer.gridPresentationTime = 0;
    this.renderer.gridPrepared = false;
    this.renderer.gridReducedMotion =
      this.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer.reset();
    this.gridPanel ??= new GridPresentationPanel(this.ui.element, {
      toggle: () => {
        if (this.state !== 'pregame') return;
        if (this.gridClock.complete) this.gridClock.reset();
        if (this.gridClock.playing) this.gridClock.pause();
        else this.gridClock.play();
        this.gridPanel?.update(this.gridClock);
      },
      seek: (time) => {
        if (this.state === 'pregame') {
          this.gridClock.seek(time);
          this.gridPanel?.update(this.gridClock);
        }
      },
      start: () => this.endGridPresentation(true),
      back: () => this.endGridPresentation(false),
    });
    this.ui.showMode('pregame');
    this.gridPanel.show(
      this.track.circuit.name,
      `${this.options.laps} LAPS / ${this.options.opponents + 1} CARS / ${this.options.weather.toUpperCase()} / ${this.options.compound.toUpperCase()}`,
      automatic,
    );
    this.gridPanel.update(this.gridClock);
  }
  private endGridPresentation(startRace: boolean) {
    if (this.state !== 'pregame' || !this.renderer) return;
    this.gridClock.pause();
    this.gridPanel?.hide();
    this.renderer.gridPresentationTime = null;
    // Prevent the legacy 1.8-second staff and blankets from reappearing after
    // they have already been carried away. No worker snapshot is edited.
    this.renderer.gridPrepared = startRace;
    if (startRace && this.current) this.renderer.gridPerformance.park(this.current);
    else this.renderer.gridPerformance.reset();
    this.renderer.reset();
    this.state = 'paused';
    this.ui.showMode('paused');
    if (startRace) this.resume();
    else if (this.gridAutomatic) this.openRaceBriefing();
    else this.ui.pause();
  }
  private resume() {
    if (this.savingSettings || this.state !== 'paused' || this.ui.telemetryModal.open) return;
    this.ui.closeModal();
    this.state = 'driving';
    this.gridBriefingOpen = false;
    this.ui.gridPresentationAvailable = false;
    this.ui.showMode('driving');
    // Retain the real paused grid snapshot before the worker is released.
    // A slow first rendered frame must not erase the start-light phase.
    this.observeSession();
    this.input.setEnabled(true);
    this.post({ type: 'input', input: controls() });
    this.post({ type: 'pause', value: false });
    (document.activeElement as HTMLElement)?.blur();
  }
  private finish(frame: Float32Array) {
    this.performanceCapture.interrupt('Session finished');
    this.interruptReview('Session finished');
    this.state = 'results';
    this.post({ type: 'pause', value: true });
    this.input.setEnabled(false);
    this.audio.stop();
    this.ui.showMode('results');
    this.recordChampionshipRace(frame);
    // Career sessions are paid to the career wallet (itemised under the
    // classification); the team ledger pays every other racing session.
    const careerSession = this.career.finish(frame, this.options.grid);
    this.ui.results(frame);
    if (racingSession(this.options.mode) && !careerSession) {
      const next = rewardRace(this.team, {
        session: this.sessionId,
        position: Math.round(frame[carBase(0) + F.RANK]),
        cars: Math.round(frame[H.CARS]),
        classified: frame[carBase(0) + F.FINISH] > 0,
        demonstration: this.usedDemonstration,
        penalties: frame[carBase(0) + F.PENALTY],
      });
      if (next !== this.team)
        void this.saveTeam(next)
          .then(() => {
            const income = rewardIncome({
              position: Math.round(frame[carBase(0) + F.RANK]),
              cars: Math.round(frame[H.CARS]),
              penalties: frame[carBase(0) + F.PENALTY],
            });
            this.ui.toast(
              `Team HQ +${income.total.toLocaleString()}: ${income.lines
                .filter((line) => line.amount)
                .map((line) => `${line.label} ${line.amount.toLocaleString()}`)
                .join(' · ')}`,
            );
          })
          .catch((error) => this.ui.toast(`Race income not saved: ${String(error)}`));
    }
    const best = frame[carBase(0) + F.BEST_LAP];
    if (best > 0) {
      // Per-circuit key; Aurel keeps its original key so earlier bests remain.
      const circuit = circuitDefinition(this.options.circuit).short;
      const key = `best:${circuit}:${this.options.assist}:${this.options.compound}:${this.options.weather}`;
      void this.store
        .read(key)
        .then((old) => {
          if (typeof old !== 'number' || best < old) return this.store.write(key, best);
        })
        .catch((e) => this.ui.toast(`Best lap could not be saved: ${String(e)}`));
    }
  }
  private enterReplay() {
    if (!this.replay || this.replay.duration < 1) {
      this.ui.toast('Drive for at least one second before opening replay.');
      return;
    }
    if (this.state === 'replay') {
      this.exitReplay();
      return;
    }
    if (this.state === 'driving') this.pause();
    this.replayReturn = this.state;
    this.ui.closeModal();
    this.ui.telemetryModal.close();
    this.state = 'replay';
    this.appliedReplaySurfaceTime = -Infinity;
    this.replayClock.playing = true;
    this.seekReplay(0);
    // Set the real range before exposing the controls. The first GPU frame
    // may be deferred; the HTML default max=1 would clamp early seeks.
    const seek = this.ui.get('replaySeek') as HTMLInputElement;
    seek.max = String(this.replay.duration);
    seek.value = '0';
    this.ui.setText('replayPlay', 'PAUSE');
    this.ui.showMode('replay');
    this.input.setEnabled(true);
  }
  /** Earliest replay position: the flashback window while choosing a point. */
  private replayFloor() {
    return this.flashbackMode && this.replay
      ? Math.max(0, this.replay.duration - FLASHBACK.window)
      : 0;
  }
  /** D31: choose a point in the last 30 s to resume from (KeyX / gamepad action). */
  private openFlashback() {
    if (this.flashbackPending || this.state === 'replay') return;
    if (this.state !== 'driving' && this.state !== 'paused') return;
    if (!flashbackAllowed(this.options.mode, this.flashbacks)) {
      this.ui.toast(
        this.flashbacks >= FLASHBACK.perRace
          ? 'No flashbacks left this session.'
          : 'Flashback is available in races and free practice.',
      );
      return;
    }
    if (!this.replay || this.replay.duration < 1) return;
    this.enterReplay();
    if ((this.state as State) !== 'replay') return;
    this.flashbackMode = true;
    this.replayClock.playing = false;
    this.seekReplay(this.replay.duration);
    this.flashbackPanel.show(true, FLASHBACK.perRace - this.flashbacks);
  }
  /** RESUME FROM HERE: rewind the simulation to the shown replay frame. */
  private resumeFlashback() {
    if (!this.flashbackMode || this.flashbackPending || !this.replay || !this.replayA) return;
    const frame = this.replayA,
      tick = Math.round(frame[H.TICK]),
      time = frame[H.TIME];
    if (!this.replay.canTruncate(time)) {
      this.ui.toast('That moment is no longer held in memory. Choose a later point.');
      return;
    }
    this.flashbackPending = true;
    this.flashbackPanel.busy(true);
    this.post({ type: 'flashback', tick });
  }
  /** The worker stands at the flashback tick: cut the recordings and drive on. */
  private completeFlashback(time: number) {
    if (!this.flashbackPending) return;
    this.flashbackPending = false;
    this.flashbacks++;
    this.replay?.truncate(time);
    this.telemetry?.truncate(time);
    this.flashbackMode = false;
    this.flashbackPanel.show(false);
    this.exitReplay();
    this.ui.toast(`FLASHBACK · ${FLASHBACK.perRace - this.flashbacks} LEFT`);
    if (this.state === 'paused') this.resume();
  }
  private exitReplay() {
    if (this.state !== 'replay') return;
    if (this.flashbackMode && !this.flashbackPending) {
      this.flashbackMode = false;
      this.flashbackPanel.show(false);
    }
    this.replayClock.playing = false;
    this.audio.stop();
    this.state = this.replayReturn === 'results' ? 'results' : 'paused';
    if (this.liveSurface)
      this.renderer?.circuit.updateSurface(
        this.liveSurface.water,
        this.liveSurface.rubber,
        this.liveSurface.marbles,
      );
    this.renderer?.circuit.offroad?.showAt(null);
    this.input.setEnabled(false);
    this.renderer?.reset();
    this.ui.showMode(this.state);
    if (this.state === 'results' && this.current) this.ui.results(this.current);
    else this.ui.pause();
  }
  private openAcademy() {
    this.suspendPlayback();
    this.ui.closeModal();
    this.ui.modalContent(
      drivingAcademy(
        this.programme.progress(),
        this.renderer?.guide.mode ?? 'off',
        this.renderer?.night ?? false,
        this.renderer?.lighting ?? 'day',
        this.liveSky.observer,
      ),
    );
  }
  private inspectReference(id: number) {
    const entry = REFERENCES.find((item) => item.id === id);
    if (!entry) return;
    const route = referenceRoute(entry);
    if (!route) return;
    this.inspectedReference = id;
    if (route.night !== undefined && this.renderer) this.renderer.night = route.night;
    if (route.destination === 'media') this.openMedia();
    else if (route.destination === 'event') {
      this.suspendPlayback();
      this.ui.modalContent(
        referenceSessionPanel(id, this.state === 'paused' || this.state === 'replay'),
      );
    } else if (route.destination === 'gap') {
      this.suspendPlayback();
      this.ui.modalContent(
        `<section class="reference-event-config"><span class="eyebrow">REFERENCE ${id} / OPEN REQUIREMENT</span><h2>${escapeHtml(entry.title)}</h2><p>${escapeHtml(route.instruction)}</p><p>${escapeHtml(entry.gap)}</p><button data-action="references">RETURN TO ALL 100 FINDINGS</button></section>`,
      );
    } else if (route.destination === 'photo') {
      this.openPhoto();
      if (this.state === 'photo') {
        this.photoStudio.compose(route.photo ?? {});
        this.photoStudio.status(
          `REFERENCE ${String(id).padStart(3, '0')} · ${entry.title}. ${route.instruction}`,
        );
      }
    } else if (route.destination === 'academy') this.openAcademy();
    else if (route.destination === 'team') this.openTeam(route.hub);
    else {
      this.suspendPlayback();
      if (route.destination === 'settings') this.ui.settings(this.settings, this.setupVehicle());
      else this.ui.controls(this.settings.bindings);
    }
    this.ui.toast(`Reference ${String(id).padStart(3, '0')}: ${route.instruction}`);
  }
  /** The machine whose setup the garage shows: the session's own machine
   * while one runs, else (undefined) the menu's MACHINE choice. */
  private setupVehicle() {
    return this.state === 'menu' || this.state === 'loading'
      ? undefined
      : vehicleDefinition(this.options.vehicles?.[0]);
  }
  private action(name: string) {
    if (this.festival?.action(name)) return;
    // Do not replace a renderer or resume simulation while it owns a graphics
    // transition. Closing the editor, muting, losing focus and reload remain
    // available; closing does not cancel an already submitted preference save.
    if (
      this.savingSettings &&
      !['modalClose', 'mute', 'blur', 'deviceLost', 'reload'].includes(name)
    ) {
      this.ui.toast('Applying preferences…');
      return;
    }
    if (this.state === 'pregame') {
      if (name === 'pause' || name === 'blur' || name === 'deviceLost') {
        this.gridClock.pause();
        this.gridPanel?.update(this.gridClock);
      } else if (name === 'menu') {
        this.endGridPresentation(false);
        this.action('menu');
      }
      return;
    }
    if (name === 'raceDayPrepare') {
      this.beginGridPresentation(true);
      return;
    }
    if (name === 'raceDaySkip') {
      if (this.state === 'paused' && this.current?.[H.TICK] === 0 && this.renderer) {
        this.gridBriefingOpen = false;
        this.renderer.gridPrepared = true;
        this.renderer.gridPerformance.park(this.current);
        this.resume();
      }
      return;
    }
    if (name === 'gridPresentation') {
      this.beginGridPresentation();
      return;
    }
    // Modal-owned GPU scenes never outlive a navigation or native Escape.
    this.mediaView?.dispose();
    this.mediaView = null;
    // Names are application action identifiers, not typed widget contents.
    this.sessionReview.event(performance.now(), 'action', name);
    this.tabEvidence.observe('action', name);
    // Team transactions only change modal DOM and next-session data. They must
    // not restart the expensive covered backdrop after every saved transaction.
    if (
      !(
        this.state === 'menu' &&
        this.ui.modal.open &&
        (name.startsWith('team:') || name.startsWith('career:'))
      )
    )
      this.renderedState = null;
    if (this.state === 'photo') {
      if (name === 'pause') this.closePhoto();
      else if (name === 'deviceLost') this.ui.toast(this.input.deviceStatus);
      return;
    }
    if (name.startsWith('event:') && this.state === 'menu') {
      const event = EVENTS[Number(name.slice(6))];
      if (!event) return;
      try {
        const options = eventSession(event, { ...DEFAULT_OPTIONS, setup: this.settings.setup });
        this.ui.closeModal();
        this.championshipRound = -1;
        this.ui.championshipNote = '';
        void this.start(options).catch((e) => this.fail(e));
      } catch (error) {
        this.ui.toast(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (name.startsWith('eventReview:')) {
      const [, command, rawId] = name.split(':');
      try {
        if (command === 'arm' && this.renderer) {
          const active = this.state === 'paused' || this.state === 'replay';
          const camera = this.referenceSession.arm(
            Number(rawId),
            active ? this.sessionId : null,
            this.state === 'replay',
          );
          this.renderer.changeCamera(camera);
          this.ui.closeModal();
          if (this.state === 'paused') this.resume();
          else if (this.state === 'replay') {
            this.replayClock.playing = true;
            this.input.setEnabled(true);
          } else
            this.ui.toast(
              'Reference watch armed for the next session. Choose its actual weather and opponents.',
            );
        } else if (command === 'image') this.referenceSession.exportImage();
        else if (command === 'export') this.referenceSession.exportReport();
        else if (command === 'close') this.referenceSession.clear();
      } catch (error) {
        this.ui.toast(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (name.startsWith('eventReference:')) {
      const id = Number(name.slice('eventReference:'.length));
      try {
        const panel = referenceSessionPanel(
          id,
          this.state === 'paused' || this.state === 'replay' || this.state === 'driving',
        );
        this.inspectedReference = id;
        this.suspendPlayback();
        this.ui.modalContent(panel);
      } catch (error) {
        this.ui.toast(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (name.startsWith('reference:')) {
      this.inspectReference(Number(name.slice(10)));
      return;
    }
    if (name.startsWith('guide:')) {
      const mode = name.slice(6);
      if (this.renderer && ['off', 'corners', 'full'].includes(mode)) {
        this.performanceCapture.interrupt('Driving guide changed');
        this.interruptReview('Driving guide changed');
        this.renderer.guide.mode = mode as GuideMode;
        this.openAcademy();
      }
      return;
    }
    if (name === 'lighting:live') {
      if (this.renderer) {
        this.performanceCapture.interrupt('Circuit lighting changed');
        this.interruptReview('Circuit lighting changed');
        setLiveSkyPreferred(true);
        // The device position may need the player's permission; until it
        // answers, the stored fix or the time zone stands in.
        this.renderer.lighting = this.liveSky.start(storedObserver());
        this.renderer.reset();
        this.openAcademy();
        void requestObserver().then((observer) => {
          if (!this.renderer || !this.liveSky.active || observer.source === 'timezone') return;
          this.renderer.lighting = this.liveSky.start(observer);
          // Refresh the academy's location line if it is still on screen.
          if (document.querySelector('.driving-academy [data-action="lighting:live"]'))
            this.openAcademy();
        });
      }
      return;
    }
    if (name === 'lighting:day' || name === 'lighting:sunset' || name === 'lighting:night') {
      if (this.renderer) {
        setLiveSkyPreferred(false);
        this.liveSky.stop();
        this.performanceCapture.interrupt('Circuit lighting changed');
        this.interruptReview('Circuit lighting changed');
        this.renderer.lighting =
          name === 'lighting:sunset' ? 'sunset' : name === 'lighting:night' ? 'night' : 'day';
        this.renderer.reset();
        this.openAcademy();
      }
      return;
    }
    if (name.startsWith('team:')) {
      void this.teamAction(name);
      return;
    }
    if (name === 'career' || name.startsWith('career:')) {
      this.career.action(name);
      return;
    }
    // Native modal cancellation owns Escape. Background replay/drive actions
    // cannot also handle that same key and resume or dismiss the parent state.
    if (
      this.ui.telemetryModal.open &&
      ['pause', 'resume', 'replay', 'replayExit', 'replayPlay', 'camera'].includes(name)
    )
      return;
    switch (name) {
      case 'academy':
        this.openAcademy();
        break;
      case 'academy:start':
        this.suspendPlayback();
        this.ui.modalContent(academyConfirmation());
        break;
      case 'academy:confirm':
        if (this.renderer) this.renderer.guide.mode = 'full';
        void this.start(
          {
            ...this.options,
            mode: 'practice',
            opponents: 0,
            weather: 'clear',
            compound: 'medium',
            laps: 5,
          },
          true,
        ).catch((error) => this.fail(error));
        break;
      case 'academy:stop':
        this.programme.stop();
        this.openAcademy();
        break;
      case 'teamMedia':
        this.openMedia();
        break;
      case 'team':
        this.openTeam();
        break;
      case 'events':
        if (this.state !== 'menu') break;
        this.ui.modalContent(eventHub(EVENTS));
        break;
      case 'championship':
        if (this.state === 'loading') break;
        this.suspendPlayback();
        this.ui.championship(this.championship);
        break;
      case 'championship:new':
        void this.saveChampionship(newChampionship(8))
          .then(() => this.ui.championship(this.championship))
          .catch((error) => this.ui.toast(`Championship not saved: ${String(error)}`));
        break;
      case 'championship:start':
        this.startChampionshipRound();
        break;
      case 'weekendRace':
        this.startWeekendRace();
        break;
      case 'references':
        this.suspendPlayback();
        this.ui.closeModal();
        this.ui.modalContent(
          referenceReview({ source: __APEX_SOURCE_FINGERPRINT__, store: this.referenceEvidence }),
        );
        bindReferenceReview(this.ui.get('modalContent'), {
          source: __APEX_SOURCE_FINGERPRINT__,
          store: this.referenceEvidence,
        });
        break;
      case 'workshop':
        this.openPhoto();
        if (!this.photoStudio.element.hidden)
          this.photoStudio.compose({
            backdrop: 'headquarters',
            azimuth: 28,
            elevation: 17,
            distance: 17,
            focalLength: 30,
          });
        break;
      case 'photo':
        this.openPhoto();
        break;
      case 'pause':
        if (this.state === 'driving') this.pause();
        else if (this.state === 'paused') this.resume();
        else if (this.state === 'replay') this.exitReplay();
        break;
      case 'deviceLost':
        this.suspendPlayback();
        this.ui.toast(this.input.deviceStatus);
        break;
      case 'blur':
        this.suspendPlayback();
        break;
      case 'resume':
        this.resume();
        break;
      case 'menu':
        this.gridBriefingOpen = false;
        this.gridAutomatic = false;
        this.renderer?.gridPerformance.reset();
        this.referenceSession.interrupt('Returned to the paddock.');
        this.performanceCapture.interrupt('Returned to paddock');
        this.interruptReview('Returned to paddock');
        this.ui.closeModal();
        this.ui.telemetryModal.close();
        this.state = 'menu';
        this.programme.stop();
        this.post({ type: 'pause', value: true });
        this.input.setEnabled(false);
        this.audio.stop();
        this.ui.showMode('menu');
        this.renderer?.reset();
        this.renderer?.setLivery(this.team.livery);
        break;
      case 'restart':
        void this.start(this.options, false, false, this.career.restartContext()).catch((e) =>
          this.fail(e),
        );
        break;
      case 'settings':
        if (this.state === 'driving') this.pause();
        this.ui.settings(this.settings, this.setupVehicle());
        break;
      case 'controls':
        this.ui.controls(this.settings.bindings);
        break;
      case 'modalClose':
        this.gridBriefingOpen = false;
        this.ui.closeModal();
        if (this.state === 'paused') this.ui.pause();
        else if (this.state === 'results' && this.current) this.ui.results(this.current);
        break;
      case 'camera':
        this.referenceSession.interrupt('Camera changed.');
        this.performanceCapture.interrupt('Camera changed');
        this.interruptReview('Camera changed');
        this.renderer?.changeCamera();
        break;
      case 'pit':
        if (this.state === 'driving') {
          this.post({ type: 'pit', compound: selectedPitCompound(this.ui.hud) });
          this.ui.toast(
            'Pit request toggled. Pit assist drives to the box, services the car, then returns control after the exit.',
          );
        }
        break;
      case 'ers':
        this.performanceCapture.interrupt('Deployment mode changed');
        this.ers = ((this.ers + 1) % 3) as 0 | 1 | 2;
        break;
      case 'drs':
        if (this.state === 'driving') this.drsPress = true;
        break;
      case 'overtake':
        if (this.state === 'driving') {
          this.performanceCapture.interrupt('Deployment mode changed');
          this.overtakePress = true;
        }
        break;
      case 'mute':
        this.performanceCapture.interrupt('Audio workload changed');
        this.interruptReview('Audio workload changed');
        this.audio.muted = !this.audio.muted;
        this.ui.toast(this.audio.muted ? 'Audio muted.' : 'Audio enabled.');
        break;
      case 'debug':
        this.performanceCapture.interrupt('Debug workload changed');
        this.interruptReview('Debug workload changed');
        if (this.renderer) {
          this.renderer.debug = !this.renderer.debug;
          this.renderer.engineering = null;
          this.post({ type: 'engineering', enabled: this.renderer.debug });
        }
        break;
      case 'autopilot':
        this.performanceCapture.interrupt('Driver changed');
        this.interruptReview('Driver changed');
        if (this.state === 'driving' || this.state === 'paused') {
          this.auto = !this.auto;
          this.usedDemonstration ||= this.auto;
          this.post({ type: 'autopilot', value: this.auto });
          this.ui.toast(
            this.auto ? 'AI demonstration enabled. Press G to take control.' : 'You have control.',
          );
        }
        break;
      case 'replay':
        this.enterReplay();
        break;
      case 'replayExit':
        if (this.flashbackPending) break;
        this.exitReplay();
        break;
      case 'flashback':
        this.openFlashback();
        break;
      case 'flashbackResume':
        this.resumeFlashback();
        break;
      case 'replayPlay':
        if (this.state !== 'replay') break;
        if (this.replay && this.replayClock.position >= this.replay.duration)
          this.seekReplay(0);
        this.replayClock.playing = !this.replayClock.playing;
        if (!this.replayClock.playing) this.audio.stop();
        break;
      case 'telemetry':
        if (this.ui.telemetryModal.open) break;
        if (!this.telemetry) {
          this.ui.toast('Start a session to record telemetry.');
          return;
        }
        this.suspendPlayback();
        this.telemetryReturn = this.state;
        this.ui.closeModal();
        this.input.setEnabled(false);
        this.audio.stop();
        this.ui.telemetryModal.showModal();
        this.telemetry.draw(
          this.ui.graph,
          this.comparison,
          this.ui.telemetryView,
          this.track.length,
        );
        break;
      case 'telemetryClose':
        if (!this.ui.telemetryModal.open) break;
        this.ui.telemetryModal.close();
        if (this.telemetryReturn === 'results' && this.current) this.ui.results(this.current);
        else if (this.telemetryReturn === 'replay') {
          this.input.setEnabled(true);
          (document.activeElement as HTMLElement)?.blur();
        } else this.ui.pause();
        break;
      case 'compare':
        this.comparison = !this.comparison;
        this.telemetry?.draw(
          this.ui.graph,
          this.comparison,
          this.ui.telemetryView,
          this.track.length,
        );
        break;
      case 'csv':
        void this.exportTelemetry();
        break;
      case 'sessionReview':
        if (this.state === 'driving') this.pause();
        this.ui.sessionReview(
          `${this.sessionReview.state.toUpperCase()} · ${this.sessionReview.count} worker snapshots · ${this.sessionReview.reason}`,
          this.sessionReview.active,
          this.state === 'menu',
          !!this.sessionReview.report(),
        );
        this.tabEvidence.mount(this.ui.get('modalContent'));
        break;
      case 'sessionReviewStart':
        try {
          this.sessionReview.start(
            {
              source: __APEX_SOURCE_FINGERPRINT__,
              machine: (this.ui.get('sessionReviewMachine') as HTMLInputElement).value.trim(),
              reviewer: (this.ui.get('sessionReviewer') as HTMLInputElement).value.trim(),
              startedAt: new Date().toISOString(),
            },
            performance.now(),
            this.state,
          );
          this.ui.closeModal();
          this.ui.toast(
            'Session evidence armed. Choose a race and drive. This does not record startup or certify Section 146.',
          );
        } catch (error) {
          this.ui.toast(error instanceof Error ? error.message : String(error));
        }
        break;
      case 'sessionReviewStop':
        this.sessionReview.stop('Reviewer stopped observations');
        this.action('sessionReview');
        break;
      case 'sessionReviewExport': {
        const report = this.sessionReview.report();
        if (report)
          downloadBlob(
            new Blob([JSON.stringify(report) + '\n'], { type: 'application/json' }),
            `apex-session146-${report.identity.source.slice(0, 12)}.json`,
          );
        break;
      }
      case 'visualReview':
        if (this.state === 'driving') this.pause();
        if (this.state !== 'paused') break;
        this.ui.presentationReview(
          `${this.presentationReview.state.toUpperCase()} · ${this.presentationReview.count} frames · ${Math.round(this.presentationReview.progressM)} m${this.presentationReview.reason ? ` · ${this.presentationReview.reason}` : ''} · VIDEO ${this.reviewVideo.state}${this.reviewVideo.reason ? ` · ${this.reviewVideo.reason}` : ''}`,
          this.profileMachine,
          !this.presentationReview.active && this.presentationReview.count > 0,
          !!this.reviewVideo.blob,
        );
        break;
      case 'reviewStart':
        this.startPresentationReview();
        break;
      case 'reviewExport': {
        const report = this.presentationReview.report();
        if (report)
          downloadBlob(
            new Blob(
              [
                JSON.stringify({
                  ...report,
                  budget: reviewBudget(report),
                  video: this.reviewVideo.diagnostics(),
                  hardware: this.reviewMachineEvidence,
                  inputObservations: this.reviewInputs.report(),
                }) + '\n',
              ],
              { type: 'application/json' },
            ),
            `apex-review-${report.context.workload}-${report.context.camera}-${report.context.source.slice(0, 12)}.json`,
          );
        break;
      }
      case 'reviewVideoExport':
        if (this.reviewVideo.blob)
          downloadBlob(
            this.reviewVideo.blob,
            `apex-review-${__APEX_SOURCE_FINGERPRINT__.slice(0, 12)}.webm`,
          );
        break;
      case 'performance':
        if (this.state === 'driving') this.pause();
        if (this.state !== 'paused') break;
        this.ui.performance(
          `${this.performanceCapture.state.toUpperCase()} · ${this.performanceCapture.count} measured frames${this.performanceCapture.reason ? ` · ${this.performanceCapture.reason}` : ''}`,
          this.profileMachine,
          this.profileWorkload,
          !!this.performanceCapture.report(),
        );
        break;
      case 'profileStart':
        this.startPerformanceCapture();
        break;
      case 'profileExport': {
        const report = this.performanceCapture.report();
        if (report)
          downloadBlob(
            new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }),
            'apex-performance.json',
          );
        break;
      }
      case 'reload':
        location.reload();
        break;
    }
  }
  private readonly reviewKeyboard = (event: KeyboardEvent) => {
    if (this.presentationReview.active && this.state === 'driving' && !this.ui.modal.open)
      this.reviewInputs.keyboard(event.isTrusted);
  };
  private interruptReview(reason: string) {
    this.presentationReview.interrupt(reason);
    this.reviewVideo.stop();
  }
  private startPresentationReview() {
    if (this.state !== 'paused' || !this.renderer) return;
    try {
      if (this.reviewVideo.state === 'stopping')
        throw new Error('Video is finalizing; refresh its status before starting another review');
      const machine = (this.ui.get('reviewMachine') as HTMLInputElement).value.trim();
      const workload = (this.ui.get('reviewWorkload') as HTMLSelectElement).value as ReviewWorkload;
      const mode = (this.ui.get('reviewMode') as HTMLSelectElement).value as
        | 'full-lap'
        | 'timed-scene';
      const videoRequested = (this.ui.get('reviewVideo') as HTMLInputElement).checked;
      const audioRequested = (this.ui.get('reviewAudio') as HTMLInputElement).checked;
      if (audioRequested && !videoRequested) throw new Error('Enable video to include game audio');
      const stats = this.renderer.stats(),
        frame = this.renderer.presented.value;
      if (!matchesReviewWeather(workload, frame[H.RAIN], frame[H.CLOUD], this.renderer.lighting))
        throw new Error('The workload label does not match the current weather/night state');
      const followedCar = this.renderer.reviewCar(),
        b = carBase(followedCar);
      this.renderer.readReviewMetrics(this.reviewMetrics);
      this.reviewInputs.clear();
      this.reviewMachineEvidence = this.renderer.reviewHardware();
      this.presentationReview.start(
        {
          source: __APEX_SOURCE_FINGERPRINT__,
          machine,
          browser: navigator.userAgent,
          workload,
          mode,
          videoRequested,
          racingEvidence: 1,
          camera: this.renderer.mode,
          trackLength: this.track.length,
          startS: frame[b + F.S],
          startLaps: frame[b + F.LAPS],
          startTime: frame[H.TIME],
          followedCar,
          configuration: JSON.stringify({
            session: this.options,
            auto: this.auto,
            ers: this.ers,
            graphics: stats.graphics,
            width: stats.renderWidth,
            height: stats.renderHeight,
            pixelRatio: devicePixelRatio,
            night: this.renderer.night,
            lighting: this.renderer.lighting,
            shake: this.settings.shake,
            debug: this.renderer.debug,
            guide: stats.guide,
            sound: { volume: this.settings.volume, muted: this.audio.muted },
            gpuTiming: stats.gpuTimerSupported,
            videoRequested,
            audioRequested,
          }),
        },
        performance.now(),
        this.reviewMetrics.gpuSequence,
      );
      this.performanceCapture.interrupt('Presentation review started; separate benchmark required');
      this.reviewVideo.dispose();
      if (videoRequested)
        this.reviewVideo.start(
          this.renderer.canvas,
          audioRequested ? this.audio.captureOutput() : undefined,
        );
      this.profileMachine = machine;
      this.resume();
      this.ui.toast(
        this.reviewVideo.reason ??
          'Review recording: complete the traversal and selected racing event; timed scenes run for at least 30 seconds.',
      );
    } catch (error) {
      this.interruptReview('Review setup failed');
      this.ui.toast(error instanceof Error ? error.message : String(error));
    }
  }
  private startPerformanceCapture() {
    if (this.state !== 'paused' || !this.renderer) return;
    const machine =
      (document.getElementById('profileMachine') as HTMLInputElement | null)?.value.trim() ?? '';
    const workload =
      (document.getElementById('profileWorkload') as HTMLInputElement | null)?.value.trim() ?? '';
    const stats = this.renderer.stats();
    try {
      this.interruptReview('Independent performance benchmark started');
      this.performanceCapture.start(
        {
          machine,
          workload,
          source: __APEX_SOURCE_FINGERPRINT__,
          browser: navigator.userAgent,
          configuration: JSON.stringify({
            session: this.options,
            camera: stats.camera,
            auto: this.auto,
            ers: this.ers,
            graphics: stats.graphics,
            width: stats.renderWidth,
            height: stats.renderHeight,
            pixelRatio: devicePixelRatio,
            debug: this.renderer.debug,
            sound: { volume: this.settings.volume, muted: this.audio.muted },
            shake: this.settings.shake,
            uiScale: this.settings.uiScale,
            gpuTiming: stats.gpuTimerSupported,
          }),
        },
        performance.now(),
      );
      this.profileMachine = machine;
      this.profileWorkload = workload;
      this.resume();
      this.ui.toast('Performance warm-up: 5 seconds, followed by 30 seconds of measured driving.');
    } catch (error) {
      this.ui.toast(error instanceof Error ? error.message : String(error));
    }
  }
  private async exportTelemetry() {
    if (!this.telemetry || this.exporting) return;
    const generation = this.generation;
    this.exporting = true;
    const button = document.querySelector<HTMLButtonElement>('[data-action="csv"]');
    if (button) {
      button.disabled = true;
      button.textContent = 'EXPORTING…';
    }
    try {
      const blob = await this.exporter.export(this.telemetry.snapshot(), this.telemetry.count);
      if (generation === this.generation) downloadBlob(blob, 'apex-telemetry.csv');
    } catch (error) {
      if (generation === this.generation) this.ui.toast(`Export failed: ${String(error)}`);
    } finally {
      this.exporting = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'EXPORT CSV';
      }
    }
  }
  private async applySettings(settings: Settings) {
    if (this.savingSettings || this.disposed || this.errorStopped) return;
    const form = document.querySelector<HTMLFormElement>('#settingsForm');
    const submit = form?.querySelector<HTMLButtonElement>('[type="submit"]');
    const renderer = this.renderer;
    const generation = this.generation;
    const cancelled = () =>
      this.disposed ||
      this.errorStopped ||
      this.generation !== generation ||
      this.renderer !== renderer;
    const graphicsChanged = graphicsSettingsChanged(this.settings, settings);
    this.savingSettings = true;
    form?.setAttribute('aria-busy', 'true');
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'SAVING…';
    }
    this.performanceCapture.interrupt('Settings changed');
    this.interruptReview('Settings changed');
    try {
      const outcome = await runSettingsChange({
        cancelled,
        phase: (phase) => {
          this.settingsPhase = phase;
        },
        prepare: async () =>
          !renderer ||
          !graphicsChanged ||
          renderer.prepareQuality(settings.quality, settings.graphics, cancelled, yieldBrowserTask),
        apply: () => {
          this.settings = settings;
          this.input.settings = settings;
          this.ui.applyBindings(settings.bindings);
          this.renderedState = null;
          if (renderer) {
            this.applyMotion(renderer, settings);
            renderer.colorblind = settings.colorblind;
          }
          this.audio.volume = settings.volume;
          this.audio.configureDriving(this.track, settings.drivingAudio);
          document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
          document.documentElement.dataset.colorblind = String(settings.colorblind);
          document.documentElement.dataset.highContrast = String(settings.highContrast);
          this.applyCommunication(settings);
        },
        save: () => this.store.write('settings', settings),
      });
      if (!outcome || cancelled()) return;
      // The transaction, not a successful put request, is the durable completion
      // signal. Never close a replacement editor or another application's view.
      if (form?.isConnected && document.querySelector('#settingsForm') === form)
        this.action('modalClose');
      this.ui.toast(
        outcome.saved
          ? 'Preferences saved. Vehicle setup applies to the next session.'
          : `Applied for this session, but saving failed: ${outcome.error}`,
      );
    } catch (error) {
      // A partially applied graphics failure cannot safely be labeled "saved".
      // Use the existing recoverable fatal panel instead of resuming bad GPU state.
      if (!cancelled()) this.fail(error);
    } finally {
      this.savingSettings = false;
      form?.removeAttribute('aria-busy');
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'APPLY & SAVE';
      }
      if (this.settingsResizePending) {
        this.settingsResizePending = false;
        if (!cancelled()) {
          try {
            renderer?.resize();
          } catch (error) {
            this.fail(error);
          }
        }
      }
    }
  }
  private async importSetup(file: File) {
    try {
      if (file.size > 100000) throw new Error('Setup file is too large.');
      const value = JSON.parse(await file.text()) as { version: unknown; setup: unknown };
      if (value.version !== 1) throw new Error('Unsupported setup version.');
      this.settings.setup = validateSetup(value.setup);
      this.ui.settings(this.settings, this.setupVehicle());
      this.ui.toast('Setup imported. Apply & Save to retain it.');
    } catch (e) {
      this.ui.toast(`Import rejected: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  private fail(error: unknown) {
    this.referenceSession?.interrupt('Application error.');
    if (this.errorStopped) return;
    this.sessionReview.stop('Application error', true);
    this.tabEvidence.observe(
      'application-error',
      error instanceof Error ? error.message : String(error),
    );
    this.performanceCapture.interrupt('Application error');
    this.interruptReview('Application error');
    this.errorStopped = true;
    clearTimeout(this.initTimeout);
    this.worker?.terminate();
    this.input.setEnabled(false);
    this.audio.stop();
    console.error(error);
    this.ui.error(error instanceof Error ? error.message : String(error));
  }
  diagnostics(visual = false) {
    return {
      buildIdentity: { commit: __APEX_SOURCE_COMMIT__, fingerprint: __APEX_SOURCE_FINGERPRINT__ },
      state: this.state,
      gridPresentation: {
        time: this.gridClock.time,
        playing: this.gridClock.playing,
        complete: this.gridClock.complete,
        automatic: this.gridAutomatic,
        briefing: this.gridBriefingOpen,
      },
      workerPause: this.workerPause.status(),
      team: structuredClone(this.team),
      photoTime: this.frozenPhoto?.[H.TIME] ?? null,
      teamBusy: this.teamBusy,
      settingsTransition: { busy: this.savingSettings, phase: this.settingsPhase },
      usedDemonstration: this.usedDemonstration,
      flashback: {
        used: this.flashbacks,
        choosing: this.flashbackMode,
        pending: this.flashbackPending,
      },
      practiceProgramme: this.programme.progress(),
      inspectedReference: this.inspectedReference,
      audio: this.audio.diagnostics(),
      engineering: this.renderer?.engineering ?? null,
      presentation: this.renderer
        ? {
            time: this.renderer.presented.value[H.TIME] ?? 0,
            frames: this.presentationFrames,
            menuCovered: this.menuCovered,
            engineeringVisible: this.renderer.engineeringView.group.visible,
            elapsed: this.renderer.effectPlayback.elapsed,
            resets: this.renderer.effectPlayback.resets,
            boundedCatchups: this.renderer.effectPlayback.boundedCatchups,
            omittedSeconds: this.renderer.effectPlayback.omittedSeconds,
            listener: { ...this.renderer.audioView.value },
            particles: this.renderer.effects.diagnostics(),
          }
        : null,
      sessionReview: {
        state: this.sessionReview.state,
        snapshots: this.sessionReview.count,
        reason: this.sessionReview.reason,
      },
      tabEvidence: this.tabEvidence.report(),
      referenceEvent: this.referenceSession.watch.report(),
      presentationReview: {
        racing: this.presentationReview.racing,
        state: this.presentationReview.state,
        frames: this.presentationReview.count,
        progressM: this.presentationReview.progressM,
        reason: this.presentationReview.reason,
        video: this.reviewVideo.diagnostics(),
      },
      performanceCapture: {
        state: this.performanceCapture.state,
        frames: this.performanceCapture.count,
        elapsedMs: this.performanceCapture.elapsedMs,
        reason: this.performanceCapture.reason,
      },
      auto: this.auto,
      timeTrial: {
        ghostLap: this.records.player?.lap.lapTime ?? 0,
        ghostVisible: this.renderer?.ghostVisible() ?? false,
        delta: this.ui.timeTrial?.delta ?? null,
      },
      options: this.options,
      frame: this.current ? Array.from(this.current) : null,
      renderer: this.renderer?.stats(),
      visual: visual ? this.renderer?.visualDiagnostics() : null,
      replaySeconds: this.replay?.duration ?? 0,
      replayStart: this.replay?.start ?? 0,
      replaySamples: this.replay?.count ?? 0,
      replayResidentBytes: this.replay?.bytes ?? 0,
      replayError: this.replay?.error ?? null,
      replayPosition: this.replayClock.position,
      replayPlaying: this.replayClock.playing,
      replaySeekPending: this.replayClock.seekPending,
      replayStall: { ...this.replayStall },
      replayPages: this.replay?.diagnostics() ?? null,
      replaySurfaceTime: this.replay?.surfaceState.time ?? -1,
      telemetryOpen: this.ui.telemetryModal.open,
      recordingWarnings: [...this.recordingWarnings],
      telemetrySamples: this.telemetry?.count ?? 0,
      inputPolls: this.inputPump.ticks,
    };
  }
  dispose() {
    window.removeEventListener('keydown', this.reviewKeyboard);
    this.sessionReview.stop('Application disposed', true);
    this.tabEvidence.dispose();
    if (this.disposed) return;
    this.performanceCapture.interrupt('Application disposed');
    this.interruptReview('Application disposed');
    this.reviewVideo.dispose();
    this.disposed = true;
    this.generation++;
    this.exporter.cancel();
    if (this.replay) void this.replay.dispose();
    this.inputPump.dispose();
    this.festival?.dispose();
    this.festival = null;
    cancelAnimationFrame(this.timer);
    clearTimeout(this.initTimeout);
    this.worker?.terminate();
    this.mediaView?.dispose();
    this.referenceSession.dispose();
    this.input.dispose();
    this.renderer?.dispose();
    void this.audio.dispose().catch((e) => console.warn('Audio cleanup:', e));
  }
}
const app = new GameApp();
// Read-only diagnostics are useful to automated browser tests and hardware profiling.
Object.defineProperty(window, 'apexDiagnostics', {
  value: (visual = false) => app.diagnostics(visual),
  writable: false,
});
declare global {
  interface Window {
    apexDiagnostics: (visual?: boolean) => ReturnType<GameApp['diagnostics']>;
  }
}
