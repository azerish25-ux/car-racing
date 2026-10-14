import type { RadioMessage } from '../core/radio.ts';

/** Captions for race communication (D085): speaker and text, announced
 * politely to assistive technology, readable without hearing a voice. */
export class RadioCaption {
  readonly element: HTMLElement;
  private shown: RadioMessage | null = null;
  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'radio-caption';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.element.dataset.on = 'false';
    this.element.innerHTML = '<b></b><span></span>';
    const style = document.createElement('style');
    style.textContent = `.radio-caption{position:absolute;left:50%;bottom:calc(14% + env(safe-area-inset-bottom));transform:translateX(-50%);max-width:min(92vw,46rem);padding:.55em .9em;background:rgba(8,10,14,.82);color:#fff;font:600 calc(15px * var(--ui-scale,1))/1.35 inherit;border-left:4px solid #f5c400;pointer-events:none;z-index:6;opacity:0;transition:opacity .2s}.radio-caption[data-on=true]{opacity:1}.radio-caption[data-speaker='RACE CONTROL']{border-left-color:#e2262f}.radio-caption b{display:block;font-size:.72em;letter-spacing:.12em;opacity:.8}@media (prefers-reduced-motion:reduce){.radio-caption{transition:none}}`;
    root.append(style, this.element);
  }
  /** Captions can be switched off in Accessibility; the arbiter still runs. */
  enabled = true;
  show(message: RadioMessage | null) {
    if (!this.enabled) message = null;
    if (message === this.shown) return;
    this.shown = message;
    this.element.dataset.on = String(!!message);
    if (!message) return;
    this.element.dataset.speaker = message.speaker;
    this.element.querySelector('b')!.textContent = message.speaker;
    this.element.querySelector('span')!.textContent = message.text;
  }
}
