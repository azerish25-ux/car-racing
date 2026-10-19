import './charlottetown-navigation.css';
import {
  CampusNavigator,
  type CampusDirection,
} from '../simulation/open-world/charlottetown/navigation.ts';
import type { StreetSurvey } from '../simulation/open-world/survey.ts';

const metres = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(2)} km` : `${Math.round(n / 5) * 5} m`;
/** Free-drive guidance is separate from the competitive pace coach. */
export class CampusGuide {
  private readonly navigator: CampusNavigator;
  private direction: CampusDirection = 'forward';
  private readonly title: HTMLElement;
  private readonly instruction: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly reverse: HTMLButtonElement;
  private readonly listeners = new AbortController();
  private lastPosition: [number, number, number, number] | null = null;
  constructor(
    private readonly root: HTMLElement,
    survey: StreetSurvey,
  ) {
    this.navigator = new CampusNavigator(survey.route, survey.stations);
    root.classList.add('city-guide');
    root.setAttribute('aria-label', 'Campus route navigation');
    root.innerHTML = `<span class="fest-eyebrow" data-city-guide="destination"></span>
      <b data-city-guide="instruction"></b><small data-city-guide="detail"></small>
      <div class="city-guide-progress" aria-hidden="true"><i data-city-guide="progress"></i></div>
      <button type="button" data-city-guide="reverse" aria-label="Reverse campus navigation direction">Reverse route</button>`;
    this.title = root.querySelector('[data-city-guide="destination"]')!;
    this.instruction = root.querySelector('[data-city-guide="instruction"]')!;
    this.detail = root.querySelector('[data-city-guide="detail"]')!;
    this.progress = root.querySelector('[data-city-guide="progress"]')!;
    this.reverse = root.querySelector('[data-city-guide="reverse"]')!;
    this.reverse.addEventListener(
      'click',
      (event) => {
        event.stopPropagation();
        this.direction = this.direction === 'forward' ? 'return' : 'forward';
        if (this.lastPosition) this.update(...this.lastPosition);
      },
      { signal: this.listeners.signal },
    );
  }
  update(x: number, z: number, heading: number, speedKmh: number) {
    this.lastPosition = [x, z, heading, speedKmh];
    const cue = this.navigator.sample(x, z, heading, speedKmh, this.direction);
    const text = (node: HTMLElement, value: string) => {
      if (node.textContent !== value) node.textContent = value;
    };
    text(this.title, `TO ${cue.destination.toUpperCase()}`);
    this.root.dataset.state = !cue.valid
      ? 'unavailable'
      : cue.offRoute
        ? 'off-route'
        : cue.wrongWay
          ? 'wrong-way'
          : cue.arrived
            ? 'arrived'
            : 'guiding';
    text(
      this.instruction,
      !cue.valid
        ? 'Waiting for vehicle position'
        : cue.offRoute
          ? `Rejoin ${cue.street}`
          : cue.wrongWay
            ? 'Turn around safely'
            : cue.arrived
              ? 'You have arrived'
              : cue.turn === 'arrive'
                ? `Continue to ${cue.destination}`
                : `${cue.turn === 'right' ? '↱ Right' : '↰ Left'} onto ${cue.nextStreet}`,
    );
    text(
      this.detail,
      !cue.valid
        ? 'Navigation will resume automatically.'
        : cue.offRoute
          ? `${metres(cue.routeDistance)} FROM CAMPUS ROUTE · ${metres(cue.remaining)} REMAINING`
          : cue.arrived
            ? `ROUTE REFERENCE ${cue.reference}/100 · FREE DRIVE CONTINUES`
            : `${cue.wrongWay ? 'OPPOSITE DIRECTION' : `IN ${metres(cue.distanceToTurn).toUpperCase()}`} · ${metres(cue.remaining).toUpperCase()} LEFT · REF ${cue.reference}/100`,
    );
    this.progress.style.transform = `scaleX(${cue.progress.toFixed(4)})`;
    this.reverse.setAttribute('aria-pressed', String(this.direction === 'return'));
  }
  dispose() {
    this.listeners.abort();
  }
}
