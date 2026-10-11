import {
  GRID_PRESENTATION_SECONDS,
  GridPresentationClock,
  gridPresentationStage,
} from '../core/grid-presentation.ts';

/** Television-style frame for the pre-race sequence: a clean picture with
 * a live bug, a lower third carrying the director's shot caption and compact
 * controls, instead of full-width gradient panels over the scene. */
const BROADCAST_STYLE = `
.grid-presentation.broadcast{background:linear-gradient(180deg,rgba(4,8,12,.38),transparent 16%,transparent 78%,rgba(4,8,12,.55));}
.grid-presentation.broadcast .grid-event{display:flex;align-items:center;gap:12px;}
.grid-presentation.broadcast .grid-event h1{font-size:clamp(15px,1.3vw,20px);letter-spacing:.08em;text-transform:uppercase;margin:0;}
.grid-presentation.broadcast .grid-event p{display:none;}
.grid-presentation.broadcast .grid-event .eyebrow{background:#d6232b;color:#fff;padding:3px 8px;border-radius:2px;font-weight:800;letter-spacing:.14em;}
.grid-presentation.broadcast .grid-stage{opacity:.85;}
.grid-presentation.broadcast .grid-stage p{display:none;}
.grid-lower-third{position:absolute;left:clamp(16px,4vw,64px);bottom:clamp(118px,15vh,160px);display:flex;align-items:stretch;
  max-width:min(620px,calc(100% - 32px));box-shadow:0 10px 30px rgba(0,0,0,.35);transform:translateX(0);opacity:1;transition:transform .45s cubic-bezier(.2,.8,.2,1),opacity .35s;}
.grid-lower-third[data-cut]{transform:translateX(-24px);opacity:0;transition:none;}
.grid-lower-third i{width:6px;background:#d6232b;}
.grid-lower-third div{background:rgba(8,12,18,.86);padding:9px 18px 10px 14px;}
.grid-lower-third b{display:block;font-size:clamp(15px,1.35vw,21px);letter-spacing:.02em;color:#fff;}
.grid-lower-third span{display:block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#c8ccd0;margin-top:3px;}
.grid-presentation.broadcast .grid-presentation-footer{align-self:flex-end;max-width:520px;text-align:right;}
.grid-presentation.broadcast .grid-presentation-actions{justify-content:flex-end;}
.grid-presentation.broadcast .grid-presentation-actions button{min-height:36px;padding:7px 12px;font-size:12px;}
.grid-presentation.broadcast .grid-timeline{opacity:0;margin:6px 0;font-size:9px;letter-spacing:.14em;transition:opacity .25s;}
.grid-presentation.broadcast .grid-presentation-footer:hover .grid-timeline,.grid-presentation.broadcast .grid-timeline:focus-within{opacity:1;}
.grid-presentation.broadcast .grid-presentation-actions{opacity:.55;transition:opacity .25s;}
.grid-presentation.broadcast .grid-presentation-footer:hover .grid-presentation-actions,.grid-presentation.broadcast .grid-presentation-actions:focus-within{opacity:1;}
@media (prefers-reduced-motion: reduce){.grid-lower-third{transition:none;}}
`;

export class GridPresentationPanel {
  readonly root = document.createElement('section');
  private readonly lowerThird = document.createElement('div');
  private captionText = '';
  private readonly heading: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly progress: HTMLInputElement;
  private readonly toggle: HTMLButtonElement;
  private readonly start: HTMLButtonElement;
  constructor(
    parent: HTMLElement,
    callbacks: { toggle(): void; seek(time: number): void; start(): void; back(): void },
  ) {
    this.root.id = 'gridPresentation';
    this.root.className = 'grid-presentation';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Pre-race presentation');
    this.root.innerHTML = `<header><div class="grid-event"><span class="eyebrow">LIVE</span><h1 id="gridEventTitle"></h1><p id="gridEventBrief"></p></div>
      <div class="grid-stage" role="status" aria-live="polite"><span class="eyebrow">CREW PREPARATION</span><h2 id="gridStage"></h2><p id="gridStageDetail"></p></div></header>
      <div class="grid-presentation-footer"><label class="grid-timeline">PRESENTATION POSITION <input id="gridPresentationSeek" type="range" min="0" max="${GRID_PRESENTATION_SECONDS}" step=".1" value="0" aria-label="Grid presentation position"></label>
      <div class="grid-presentation-actions"><button type="button" id="gridPresentationPlay" class="primary">PLAY PREPARATION</button><button type="button" id="gridPresentationStart">SKIP TO START LIGHTS</button><button type="button" id="gridPresentationBack">BACK TO GRID MENU</button></div></div>`;
    if (!document.getElementById('gridBroadcastStyle')) {
      const style = document.createElement('style');
      style.id = 'gridBroadcastStyle';
      style.textContent = BROADCAST_STYLE;
      document.head.append(style);
    }
    this.root.classList.add('broadcast');
    this.lowerThird.className = 'grid-lower-third';
    this.lowerThird.setAttribute('aria-hidden', 'true');
    this.lowerThird.innerHTML = '<i></i><div><b></b><span></span></div>';
    this.root.append(this.lowerThird);
    parent.append(this.root);
    this.heading = this.root.querySelector('#gridStage')!;
    this.detail = this.root.querySelector('#gridStageDetail')!;
    this.progress = this.root.querySelector('#gridPresentationSeek')!;
    this.toggle = this.root.querySelector('#gridPresentationPlay')!;
    this.start = this.root.querySelector('#gridPresentationStart')!;
    this.toggle.addEventListener('click', callbacks.toggle);
    this.start.addEventListener('click', callbacks.start);
    this.root.querySelector('#gridPresentationBack')!.addEventListener('click', callbacks.back);
    this.progress.addEventListener('input', () => callbacks.seek(Number(this.progress.value)));
    // The native slider controls the presentation, never a hidden driving action.
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') event.stopPropagation();
    });
  }
  show(circuit: string, brief: string, automatic = false) {
    this.root.dataset.automatic = String(automatic);
    (this.root.querySelector('.grid-timeline') as HTMLElement).hidden = automatic;
    this.root.querySelector('#gridPresentationBack')!.textContent = automatic
      ? 'BACK TO BRIEFING'
      : 'BACK TO GRID MENU';
    this.root.querySelector('#gridEventTitle')!.textContent = circuit;
    this.root.querySelector('#gridEventBrief')!.textContent = brief;
    this.root.hidden = false;
    this.toggle.focus();
  }
  update(clock: GridPresentationClock) {
    const stage = gridPresentationStage(clock.time);
    if (this.heading.textContent !== stage.title) {
      this.heading.textContent = stage.title;
      this.detail.textContent = stage.detail;
    }
    this.progress.value = String(clock.time);
    this.progress.setAttribute(
      'aria-valuetext',
      `${clock.time.toFixed(1)} seconds. ${stage.title}`,
    );
    this.toggle.textContent = clock.complete
      ? 'REPLAY PREPARATION'
      : clock.playing
        ? 'PAUSE PREPARATION'
        : 'PLAY PREPARATION';
    this.start.textContent = clock.complete ? 'BEGIN RACE' : 'SKIP TO START LIGHTS';
  }
  /** The live shot's caption; a new caption slides in after each cut. */
  caption(text: string, detail: string) {
    if (text === this.captionText) return;
    this.captionText = text;
    this.lowerThird.querySelector('b')!.textContent = text;
    this.lowerThird.querySelector('span')!.textContent = detail;
    this.lowerThird.dataset.cut = '';
    void this.lowerThird.offsetWidth;
    delete this.lowerThird.dataset.cut;
  }
  hide() {
    this.root.hidden = true;
  }
}
