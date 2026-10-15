ROOT = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/'
def patch(path, pairs):
    p = ROOT + path
    s = open(p).read()
    for old, new in pairs:
        if s.count(old) != 1:
            raise SystemExit(f'expected one match in {path}: {old[:90]!r} ({s.count(old)})')
        s = s.replace(old, new)
    open(p, 'w').write(s)

patch('src/main.ts', [
    ("""import type { GuideMode } from './rendering/driving-guide.ts';""",
     """import type { GuideMode } from './rendering/driving-guide.ts';
import type { FestivalSession } from './session/free-roam.ts';"""),
    ("""  private usedDemonstration = false;
  private programme = new PracticeProgramme();""",
     """  private usedDemonstration = false;
  /** Festival free roam: while set it owns input, frames and the canvas. */
  private festival: FestivalSession | null = null;
  private festivalStarting = false;
  private programme = new PracticeProgramme();"""),
    ("""      start: (options, holdOnGrid) => {
        // A session started from the paddock form is outside the championship.
        this.championshipRound = -1;""",
     """      start: (options, holdOnGrid) => {
        if ((options.mode as string) === 'festival') {
          void this.startFestival(options).catch((e) => this.fail(e));
          return;
        }
        // A session started from the paddock form is outside the championship.
        this.championshipRound = -1;"""),
    ("""    this.inputPump = new InputPump((dt) => {
      if (this.errorStopped || document.hidden) return;""",
     """    this.inputPump = new InputPump((dt) => {
      if (this.errorStopped || document.hidden) return;
      if (this.festival) {
        if (this.festival.isPaused) this.input.pollActions(['pause']);
        else {
          const input = this.input.update(dt);
          this.festival.input(input);
          input.shift = 0;
        }
        return;
      }"""),
    ("""      if (this.savingSettings) this.settingsResizePending = true;
      else this.renderer?.resize();""",
     """      if (this.savingSettings) this.settingsResizePending = true;
      else if (this.festival) this.festival.resize();
      else this.renderer?.resize();"""),
    ("""  private frame = (time: number) => {
    this.timer = requestAnimationFrame(this.frame);""",
     """  private frame = (time: number) => {
    this.timer = requestAnimationFrame(this.frame);
    if (this.festival) {
      this.festival.frame(time);
      return;
    }"""),
    ("""  private action(name: string) {
    // Do not replace a renderer or resume simulation while it owns a graphics""",
     """  private action(name: string) {
    if (this.festival?.action(name)) return;
    // Do not replace a renderer or resume simulation while it owns a graphics"""),
    ("""    this.inputPump.dispose();
    cancelAnimationFrame(this.timer);
    clearTimeout(this.initTimeout);""",
     """    this.inputPump.dispose();
    this.festival?.dispose();
    this.festival = null;
    cancelAnimationFrame(this.timer);
    clearTimeout(this.initTimeout);"""),
    ("""  private async start(options: SessionOptions, programme = false, holdOnGrid = false) {""",
     """  /** FESTIVAL (SESSION select): the open-world region on the same canvas
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
        { weather: options.weather, assist: options.assist, seed: options.seed },
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
  private async start(options: SessionOptions, programme = false, holdOnGrid = false) {"""),
])

patch('src/ui/interface.ts', [
    ("""<option value="endurance">Endurance · mandatory stop</option></select></label>""",
     """<option value="endurance">Endurance · mandatory stop</option><option value="festival">Festival · open world</option></select></label>"""),
    ("""      this.get('sessionRules').textContent = problems.length""",
     """      if (select('mode') === 'festival') {
        this.get('sessionRules').textContent =
          'Festival: free roam in the Solvane region, events found by driving to them. Weather and assists apply; pick a machine in the festival menu.';
        return;
      }
      this.get('sessionRules').textContent = problems.length"""),
])
print('ok')
