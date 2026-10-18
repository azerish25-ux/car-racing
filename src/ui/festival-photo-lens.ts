import {
  FESTIVAL_PHOTO,
  type FestivalPhotoSettings,
} from '../rendering/open-world/festival-photo-lens.ts';
import { PHOTO_FILTERS, type PhotoFilter } from '../rendering/photo-camera.ts';

const STYLE_ID = 'fest-photo-lens-style';
const STYLE = `
.fest-photo-lens { display: grid; grid-template-columns: repeat(3, minmax(120px, 1fr)); gap: 8px 14px; align-self: center; }
.fest-photo-lens label { display: grid; gap: 3px; font-size: 9px; letter-spacing: 0.12em; color: #bfd0c4; }
.fest-photo-lens output { color: #e6f0e5; letter-spacing: 0.04em; }
.fest-photo-lens select, .fest-photo-lens input { width: 100%; font: inherit; font-size: 11px; color: #e6f0e5; background: rgba(255, 255, 255, 0.07); border: 1px solid var(--fest-line, #557); padding: 3px 4px; accent-color: #9fd4b8; }
.fest-photo-lens option { color: #10181c; }
@media (max-width: 900px) { .fest-photo-lens { grid-template-columns: repeat(2, minmax(110px, 1fr)); } }
`;

/** Manual focus slider: 0 = the car, 1..100 = 0.8 m .. 400 m (logarithmic). */
function focusMetres(step: number) {
  return step <= 0 ? null : 0.8 * Math.pow(500, (step - 1) / 99);
}
function focusStep(metres: number | null) {
  return metres === null ? 0 : Math.round(1 + (99 * Math.log(metres / 0.8)) / Math.log(500));
}

/** The festival photo overlay's lens controls (FH-style photo mode):
 * aperture, focus, zoom, exposure, filter and vignette. */
export class FestivalPhotoPanel {
  readonly root = document.createElement('div');
  private readonly inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  private readonly outputs: Record<string, HTMLOutputElement> = {};
  constructor(
    host: HTMLElement,
    private readonly change: (settings: Partial<FestivalPhotoSettings>) => void,
    settings: Readonly<FestivalPhotoSettings>,
  ) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLE;
      document.head.append(style);
    }
    this.root.className = 'fest-photo-lens';
    const select = (key: string, label: string, options: [string, string][]) => {
      const input = document.createElement('select');
      for (const [value, text] of options) input.append(new Option(text, value));
      this.field(key, label, input);
    };
    const range = (key: string, label: string, min: number, max: number, step: number) => {
      const input = document.createElement('input');
      Object.assign(input, {
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
      });
      this.field(key, label, input);
    };
    select(
      'fStop',
      'APERTURE',
      FESTIVAL_PHOTO.fStops.map((f) => [String(f), f === 0 ? 'OFF' : `f/${f}`]),
    );
    range('focus', 'FOCUS', 0, 100, 1);
    select('focalLength', 'ZOOM', [
      ['', 'DEFAULT'],
      ...FESTIVAL_PHOTO.focalLengths.map((f): [string, string] => [String(f), `${f} mm`]),
    ]);
    range('exposure', 'EXPOSURE', -2, 2, 0.1);
    select(
      'filter',
      'FILTER',
      PHOTO_FILTERS.map((f) => [f, f.toUpperCase()]),
    );
    range('vignette', 'VIGNETTE', 0, 0.6, 0.02);
    this.root.addEventListener('input', this.read);
    host.insertBefore(this.root, host.querySelector('nav'));
    this.sync(settings);
  }
  private field(key: string, label: string, input: HTMLInputElement | HTMLSelectElement) {
    const wrap = document.createElement('label'),
      head = document.createElement('span'),
      out = document.createElement('output');
    head.textContent = `${label} `;
    head.append(out);
    input.name = key;
    input.setAttribute('aria-label', label.toLowerCase());
    wrap.append(head, input);
    this.root.append(wrap);
    this.inputs[key] = input;
    this.outputs[key] = out;
  }
  private read = () => {
    const v = (key: string) => this.inputs[key].value;
    const settings: Partial<FestivalPhotoSettings> = {
      fStop: Number(v('fStop')),
      focus: focusMetres(Number(v('focus'))),
      focalLength: v('focalLength') ? Number(v('focalLength')) : null,
      exposure: Number(v('exposure')),
      filter: v('filter') as PhotoFilter,
      vignette: Number(v('vignette')),
    };
    this.change(settings);
    this.label(settings);
  };
  /** Show `settings` (e.g. after a reset). */
  sync(settings: Readonly<FestivalPhotoSettings>) {
    this.inputs.fStop.value = String(settings.fStop);
    this.inputs.focus.value = String(focusStep(settings.focus));
    this.inputs.focalLength.value =
      settings.focalLength === null ? '' : String(settings.focalLength);
    this.inputs.exposure.value = String(settings.exposure);
    this.inputs.filter.value = settings.filter;
    this.inputs.vignette.value = String(settings.vignette);
    this.label(settings);
  }
  private label(s: Partial<FestivalPhotoSettings>) {
    this.outputs.focus.value =
      s.focus == null ? 'CAR' : `${s.focus.toFixed(s.focus < 10 ? 1 : 0)} m`;
    const ev = s.exposure ?? 0;
    this.outputs.exposure.value = `${ev > 0 ? '+' : ''}${ev.toFixed(1)} EV`;
    this.outputs.vignette.value = `${Math.round((s.vignette ?? 0) * 100)}`;
  }
  dispose() {
    this.root.removeEventListener('input', this.read);
    this.root.remove();
  }
}
