import type { LightingMode } from '../rendering/daylight.ts';

/** The HUD surface the festival controls drive (FestivalHud). */
export interface FestivalMenus {
  readonly menuOpen: boolean;
  readonly mapOpen: boolean;
  readonly cardOpen: boolean;
  readonly resultsOpen: boolean;
  showMenu(open: boolean, state?: FestivalMenuState): void;
  showMap(open: boolean): void;
}
export interface FestivalMenuState {
  lighting: LightingMode;
  vehicle: string;
  discovered: readonly string[];
  autopilot: boolean;
  inEvent: boolean;
}
export interface FestivalControlHooks {
  /** Hold or release the simulation (the worker's pause). */
  pause(value: boolean): void;
  /** Driving input on or off (the application's InputController): off
   * while a menu is open, so Tab, Space and the arrows reach its buttons
   * instead of the car, as in the circuit pause. */
  driving?(on: boolean): void;
  /** What the pause menu shows. */
  menuState(): FestivalMenuState;
  /** The race card on screen (id), if any; Enter starts it. */
  card(): string | null;
  start(id: string): void;
  continue(): void;
}

/**
 * Pause and keyboard ownership of the festival session. While the festival
 * menu is open the driving input is off and the festival owns Escape (it
 * resumes, or closes the map first), so every menu action (resume, reset,
 * abandon, exit, time of day, machine, autopilot, travel) is reachable with
 * Tab and Space or Enter. While driving, Enter starts the race card or
 * continues from the results; a gamepad's pause button pauses and resumes.
 */
export class FestivalControls {
  paused = false;
  private readonly keydown = (e: KeyboardEvent) => {
    const menus = this.menus;
    if (e.code === 'Escape' && menus.menuOpen) {
      // Capture phase: before the driving input's own Escape handling, which
      // ignores a focused button while it is off.
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) this.togglePause();
      return;
    }
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    // In the menu, Enter activates the focused button.
    if (menus.menuOpen) return;
    const card = this.hooks.card();
    if (menus.cardOpen && card) {
      e.preventDefault();
      this.hooks.start(card);
    } else if (menus.resultsOpen) {
      e.preventDefault();
      this.hooks.continue();
    }
  };
  constructor(
    private readonly menus: FestivalMenus,
    private readonly hooks: FestivalControlHooks,
  ) {
    window.addEventListener('keydown', this.keydown, true);
  }
  openMenu() {
    this.menus.showMenu(true, this.hooks.menuState());
  }
  setPaused(value: boolean) {
    this.paused = value;
    this.hooks.pause(value);
    this.hooks.driving?.(!value);
    if (value) this.openMenu();
    else this.menus.showMenu(false);
    if (!value && this.menus.mapOpen) this.menus.showMap(false);
  }
  /** The pause action (Escape, a gamepad's pause button): the map closes
   * first, then the menu toggles. */
  togglePause() {
    if (this.menus.mapOpen) this.menus.showMap(false);
    else this.setPaused(!this.paused);
  }
  dispose() {
    window.removeEventListener('keydown', this.keydown, true);
  }
}
