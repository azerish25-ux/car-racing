import * as T from 'three';
import '@fontsource-variable/saira/wdth.css';
import './ui/style.css';
import './ui/charlottetown-launch.css';
import { charlottetownMapCard, charlottetownVehicle } from './ui/charlottetown-map.ts';
import type { CharlottetownDiscipline } from './ui/charlottetown-map.ts';
import { cityLaunchDiscipline } from './session/city-launch.ts';
import { FestivalSession } from './session/free-roam.ts';
import { InputController } from './input/controller.ts';
import { InputPump } from './input/pump.ts';
import { RacingAudio } from './audio/engine.ts';
import { DEFAULT_SETTINGS, SaveStore, validateSettings } from './storage/data.ts';
import { festivalSaveKey } from './simulation/open-world/regions.ts';
import { graphicsPreset, isQualityPreset } from './rendering/options.ts';
import type { Assist, WeatherPreset } from './simulation/config.ts';

declare const __APEX_SOURCE_FINGERPRINT__: string;

/** A lightweight host, not a second game: FestivalSession owns the same
 * workers, physics, events, scenery, cameras, audio frames and HUD as main.ts.
 * The original circuit host remains unchanged at the URL without ?map=. */
export class CharlottetownApp {
  private readonly canvas = document.getElementById('world') as HTMLCanvasElement;
  private readonly root = document.getElementById('app')!;
  private readonly store = new SaveStore();
  private settings = structuredClone(DEFAULT_SETTINGS);
  private readonly audio = new RacingAudio();
  private readonly listeners = new AbortController();
  private readonly input = new InputController(this.settings, (action) => {
    if (action === 'mute') this.audio.volume = this.audio.volume > 0 ? 0 : this.settings.volume;
    else this.session?.action(action);
  });
  private readonly pump = new InputPump((dt) => {
    if (!this.session || document.hidden) return;
    if (this.session.isPaused) this.input.pollActions(['pause']);
    else {
      const input = this.input.update(dt);
      this.session.input(input);
      input.shift = 0;
    }
  });
  private renderer: T.WebGLRenderer | null = null;
  private session: FestivalSession | null = null;
  private starting = false;
  private launchAbort: AbortController | null = null;
  private disposed = false;
  private animation = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private error: string | null = null;
  private generation = 0;
  private lastMode: CharlottetownDiscipline = cityLaunchDiscipline(location.search) ?? 'formula';

  constructor() {
    this.canvas.setAttribute('aria-label', 'Charlottetown road driving environment');
    this.root.innerHTML = `<main id="cityLauncher" class="city-launcher" aria-label="Charlottetown map launcher">
      <div class="city-launch-inner"><p class="city-launch-brand">MOTOBOUND / CANADA</p>
      ${charlottetownMapCard()}
      <fieldset class="city-launch-options" disabled><legend>Driving conditions</legend>
        <label>Graphics<select id="cityQuality"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select></label>
        <label>Weather<select id="cityWeather"><option value="clear">Clear</option><option value="changeable">Changeable</option><option value="rain">Rain</option></select></label>
        <label>Handling<select id="cityAssist"><option value="sport">Sport assists</option><option value="raw">Raw</option></select></label>
      </fieldset>
      <p class="city-launch-help">WASD / arrows to drive · C camera · T map · Escape pause.<br>Free drive, campus time trial, reverse run, Queen Street sprint and Kent Street flow.</p>
      <a class="city-launch-back" href="./">CIRCUIT &amp; FESTIVAL MENU →</a>
      <p class="city-launch-source">Map data © OpenStreetMap contributors · ODbL. Mapped road alignment; estimated façades and elevation, not a photo-exact reconstruction.</p></div></main>
      <section id="cityLoading" class="city-loading" role="status" aria-live="polite" aria-busy="false" hidden><p>CHARLOTTETOWN</p><h2 id="cityLoadingText"></h2></section>
      <div id="cityToast" class="city-toast" role="status" aria-live="polite" hidden></div>
      <nav id="cityTouch" class="city-touch" aria-label="Touch driving controls" hidden><div><button data-touch="left" aria-label="Steer left">←</button><button data-touch="right" aria-label="Steer right">→</button></div><div><button data-touch="brake">BRAKE</button><button data-touch="throttle">DRIVE</button><button data-city-pause>PAUSE</button></div></nav>`;
    this.buttons(true);
    this.root.addEventListener(
      'click',
      (event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>(
          '[data-action], [data-city-pause]',
        );
        if (target?.hasAttribute('data-city-pause')) this.session?.action('pause');
        const mode = target?.dataset.action?.split(':')[1];
        if (mode === 'formula' || mode === 'motogp' || mode === 'horizon') void this.start(mode);
      },
      { signal: this.listeners.signal },
    );
    for (const key of ['left', 'right', 'brake', 'throttle'] as const)
      this.input.bindTouch(this.root.querySelector<HTMLElement>(`[data-touch="${key}"]`)!, key);
    window.addEventListener('resize', () => this.session?.resize(), {
      signal: this.listeners.signal,
    });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.session?.setPaused(true);
      },
      { signal: this.listeners.signal },
    );
    this.canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        this.fail(new Error('Graphics context lost. Reload this page to restart the map.'));
      },
      { signal: this.listeners.signal },
    );
    window.addEventListener('pagehide', () => this.dispose(), { signal: this.listeners.signal });
    void this.load();
    this.pump.start();
    this.animation = requestAnimationFrame(this.frame);
  }
  private node(id: string) {
    return document.getElementById(id)!;
  }
  private buttons(disabled: boolean) {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.city-map-modes button'))
      button.disabled = disabled;
    this.root.querySelector<HTMLFieldSetElement>('fieldset')!.disabled = disabled;
  }
  private async load() {
    try {
      const saved = await this.store.read('settings');
      if (saved) this.settings = validateSettings(saved);
    } catch (error) {
      this.toast(`Preferences unavailable; using defaults. ${String(error)}`);
    }
    if (this.disposed) return;
    this.input.settings = this.settings;
    (this.node('cityQuality') as HTMLSelectElement).value = this.settings.quality;
    this.audio.volume = this.settings.volume;
    // Open-road audio uses the production engine/contact graph, not closed-circuit cue distances.
    this.buttons(false);
    this.root
      .querySelector<HTMLButtonElement>(`[data-action="charlottetown:${this.lastMode}"]`)
      ?.focus();
  }
  private loading(text: string) {
    this.node('cityLoadingText').textContent = text;
    this.node('cityLoading').hidden = false;
    this.node('cityLoading').setAttribute('aria-busy', 'true');
  }
  private loaded() {
    this.node('cityLoading').hidden = true;
    this.node('cityLoading').setAttribute('aria-busy', 'false');
  }
  private toast(message: string) {
    const toast = this.node('cityToast');
    toast.textContent = message;
    toast.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 9000);
  }
  private async start(mode: CharlottetownDiscipline) {
    if (this.starting || this.session || this.disposed) return;
    this.starting = true;
    this.error = null;
    this.lastMode = mode;
    const generation = ++this.generation;
    this.launchAbort = new AbortController();
    this.buttons(true);
    this.node('cityLauncher').hidden = true;
    this.loading('Preparing the mapped campus route…');
    // The user gesture unlocks audio before yielding to scene construction.
    void this.audio
      .start()
      .catch(() => this.toast('Audio could not start. Driving remains available.'));
    const selected = (this.node('cityQuality') as HTMLSelectElement).value;
    const quality = isQualityPreset(selected) ? selected : 'medium';
    const graphics =
      quality === this.settings.quality ? this.settings.graphics : graphicsPreset(quality);
    const weather = (this.node('cityWeather') as HTMLSelectElement).value as WeatherPreset;
    const assist = (this.node('cityAssist') as HTMLSelectElement).value as Assist;
    try {
      // Construction is lazy: the launcher itself allocates no GL context.
      this.renderer ??= new T.WebGLRenderer({
        canvas: this.canvas,
        antialias: false,
        powerPreference: 'high-performance',
      });
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;
      const session = await FestivalSession.start(
        {
          canvas: this.canvas,
          renderer: this.renderer,
          element: this.root,
          quality,
          graphics,
          lighting: 'day',
          loading: (text) => {
            if (!this.disposed) this.loading(text);
          },
          loaded: () => {
            if (!this.disposed) this.loaded();
          },
          toast: (text) => {
            if (!this.disposed) this.toast(text);
          },
          exit: () => this.exit(),
          driving: (on) => this.input.setEnabled(on),
          audio: {
            start: () => this.audio.start(),
            stop: () => this.audio.stop(),
            update: (frame, cockpit, playing, view, liveHuman) =>
              this.audio.update(frame, cockpit, playing, view, liveHuman),
          },
          load: () => this.store.read(festivalSaveKey('charlottetown')),
          save: (state) => this.store.write(festivalSaveKey('charlottetown'), state),
        },
        {
          signal: this.launchAbort.signal,
          region: 'charlottetown',
          vehicle: charlottetownVehicle(mode),
          weather,
          assist,
          session: crypto.randomUUID(),
        },
      );
      if (this.disposed || generation !== this.generation) {
        session.dispose();
        return;
      }
      this.session = session;
      this.node('cityTouch').hidden = false;
      this.input.setEnabled(true);
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.fail(error);
    } finally {
      this.starting = false;
    }
  }
  private exit() {
    this.generation++;
    this.launchAbort?.abort();
    this.launchAbort = null;
    this.session?.dispose();
    this.session = null;
    this.input.setEnabled(false);
    this.audio.stop();
    this.node('cityTouch').hidden = true;
    this.loaded();
    this.node('cityLauncher').hidden = false;
    this.buttons(false);
    this.root
      .querySelector<HTMLButtonElement>(`[data-action="charlottetown:${this.lastMode}"]`)
      ?.focus();
  }
  private fail(error: unknown) {
    this.error = error instanceof Error ? error.message : String(error);
    this.exit();
    this.toast(`Map could not continue: ${this.error}`);
    if (this.renderer?.getContext().isContextLost()) this.buttons(true);
  }
  private readonly frame = (time: number) => {
    if (this.disposed) return;
    this.animation = requestAnimationFrame(this.frame);
    if (document.hidden) return;
    try {
      this.session?.frame(time);
    } catch (error) {
      this.fail(error);
    }
  };
  diagnostics() {
    return {
      entry: 'charlottetown',
      sourceFingerprint: __APEX_SOURCE_FINGERPRINT__,
      starting: this.starting,
      state: this.session ? 'festival' : 'menu',
      error: this.error,
      inputPolls: this.pump.ticks,
      festival: this.session?.diagnostics() ?? null,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.launchAbort?.abort();
    this.launchAbort = null;
    this.listeners.abort();
    cancelAnimationFrame(this.animation);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.pump.dispose();
    this.input.dispose();
    this.session?.dispose();
    this.session = null;
    this.renderer?.dispose();
    void this.audio.dispose();
  }
}
const city = new CharlottetownApp();
Object.defineProperty(window, 'apexDiagnostics', {
  value: () => city.diagnostics(),
  writable: false,
});
