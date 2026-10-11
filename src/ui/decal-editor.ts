import { DECAL_LIMIT, emptyDecal, validateDecals, type DecalSlot } from '../storage/livery.ts';
import { escapeHtml } from './team-hub.ts';

/** Independent, keyboard-operable slots. Browser controls edit bounded UV-space
 * transforms; FormulaCar.setLivery paints those exact transforms on the car. */
export class DecalEditor {
  private slots: DecalSlot[] = [];
  private selected = 1;
  private readonly events = new AbortController();
  private drag: {
    pointer: number;
    id: number;
    x: number;
    y: number;
    before: DecalSlot[];
    startX: number;
    startY: number;
  } | null = null;
  constructor(
    private root: HTMLElement,
    private change: () => void,
  ) {
    root.addEventListener('pointerdown', (event) => this.startDrag(event), {
      signal: this.events.signal,
    });
    root.addEventListener('pointermove', (event) => this.moveDrag(event), {
      signal: this.events.signal,
    });
    root.addEventListener('pointerup', (event) => this.finishDrag(event), {
      signal: this.events.signal,
    });
    root.addEventListener('pointercancel', () => this.cancelDrag(), { signal: this.events.signal });
    root.addEventListener('lostpointercapture', () => this.cancelDrag(), {
      signal: this.events.signal,
    });
    root.addEventListener('keydown', (event) => this.keyMove(event), {
      signal: this.events.signal,
    });
    root.addEventListener(
      'input',
      (event) => {
        const input = event.target as HTMLInputElement;
        if (!input.dataset.decal) return;
        if (input.dataset.decal === 'slot') {
          this.selected = Number(input.value);
          this.render();
          this.root.querySelector<HTMLSelectElement>('[data-decal="slot"]')?.focus();
          return;
        }
        const selected = this.current();
        const enabled =
          this.root.querySelector<HTMLInputElement>('[data-decal="enabled"]')!.checked;
        for (const key of ['text', 'color', 'side', 'x', 'y', 'scale', 'rotation'] as const) {
          const control = this.root.querySelector<HTMLInputElement>(`[data-decal="${key}"]`)!;
          Object.assign(selected, {
            [key]: ['x', 'y', 'scale', 'rotation'].includes(key)
              ? Number(control.value)
              : control.value,
          });
        }
        this.slots = validateDecals([
          ...this.slots.filter((row) => row.id !== this.selected),
          ...(enabled ? [selected] : []),
        ]);
        const output = this.root.querySelector<HTMLOutputElement>(
          `output[for="decal-${input.dataset.decal}"]`,
        );
        if (output) output.value = input.value;
        this.preview();
        this.change();
      },
      { signal: this.events.signal },
    );
  }
  private coordinates(event: PointerEvent) {
    const svg = this.root.querySelector<SVGSVGElement>('#decalMap svg');
    const matrix = svg?.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }
  private startDrag(event: PointerEvent) {
    if (event.button !== 0 || this.drag) return;
    const item = (event.target as Element).closest<SVGGElement>('[data-decal-id]');
    if (!item || !this.root.contains(item)) return;
    const p = this.coordinates(event);
    if (!p) return;
    const id = Number(item.dataset.decalId),
      slot = this.slots.find((r) => r.id === id);
    if (!slot) return;
    this.selected = id;
    this.drag = {
      pointer: event.pointerId,
      id,
      x: p.x,
      y: p.y,
      before: this.value(),
      startX: slot.x,
      startY: slot.y,
    };
    this.render();
    // Preview redraws replace the focused SVG nodes. Keep keyboard ownership on
    // the stable capture root so Escape still rolls back the entire drag.
    this.root.tabIndex = -1;
    this.root.focus({ preventScroll: true });
    this.root.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  private moveDrag(event: PointerEvent) {
    const drag = this.drag,
      p = this.coordinates(event);
    if (!drag || drag.pointer !== event.pointerId || !p) return;
    this.move(drag.startX + (p.x - drag.x) / 142, drag.startY + (p.y - drag.y) / 44);
    event.preventDefault();
  }
  private finishDrag(event: PointerEvent) {
    if (this.drag?.pointer !== event.pointerId) return;
    this.moveDrag(event);
    this.drag = null;
    if (this.root.hasPointerCapture(event.pointerId))
      this.root.releasePointerCapture(event.pointerId);
    this.root.querySelector<SVGGElement>(`[data-decal-id="${this.selected}"]`)?.focus();
  }
  private move(x: number, y: number) {
    this.slots = validateDecals(
      this.slots.map((r) => (r.id === this.selected ? { ...r, x, y } : r)),
    );
    const slot = this.current();
    for (const key of ['x', 'y'] as const) {
      this.root.querySelector<HTMLInputElement>(`[data-decal="${key}"]`)!.value = String(slot[key]);
      this.root.querySelector<HTMLOutputElement>(`output[for="decal-${key}"]`)!.value =
        slot[key].toFixed(2);
    }
    this.preview();
    this.change();
  }
  private keyMove(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.drag) {
      event.stopPropagation();
      event.preventDefault();
      this.cancelDrag();
      return;
    }
    const item = (event.target as Element).closest<SVGGElement>('[data-decal-id]');
    if (!item || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const id = Number(item.dataset.decalId);
    const slot = this.slots.find((r) => r.id === id);
    if (!slot) return;
    this.selected = id;
    const step = event.shiftKey ? 0.1 : 0.01;
    event.preventDefault();
    event.stopPropagation();
    this.render();
    this.move(
      slot.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      slot.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
    );
    this.root.querySelector<SVGGElement>(`[data-decal-id="${id}"]`)?.focus();
  }
  cancelDrag() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.slots = validateDecals(drag.before);
    if (this.root.hasPointerCapture(drag.pointer)) this.root.releasePointerCapture(drag.pointer);
    this.render();
    this.change();
  }
  dispose() {
    this.cancelDrag();
    this.events.abort();
  }
  load(value: unknown) {
    this.cancelDrag();
    this.slots = validateDecals(value);
    this.selected = 1;
    this.render();
  }
  value() {
    return validateDecals(this.slots);
  }
  private current() {
    return { ...(this.slots.find((row) => row.id === this.selected) ?? emptyDecal(this.selected)) };
  }
  private preview() {
    const slot = this.current(),
      rows = this.slots.filter((row) => row.side === slot.side);
    const node = this.root.querySelector('#decalMap');
    if (node)
      node.innerHTML = `<svg viewBox="0 0 400 150" role="img" aria-label="${slot.side} flank decal positions"><path d="M12 117L50 35L285 18L388 110L388 135H12Z" fill="#17242d" stroke="#64818e"/>${rows.map((r) => `<g data-decal-id="${r.id}" tabindex="0" role="button" aria-label="Move decal ${r.id}: ${escapeHtml(r.text)}" transform="translate(${200 + r.x * 142} ${77 + r.y * 44}) rotate(${r.rotation})"><rect x="-39" y="-12" width="78" height="24" rx="3" fill="${r.id === slot.id ? '#394a56' : '#17242d'}" stroke="#78919b"/><text text-anchor="middle" dominant-baseline="central" font-size="11" fill="${r.color}">${escapeHtml(r.text)}</text><text y="-16" text-anchor="middle" font-size="10" fill="#e9f5f4">${r.id}</text></g>`).join('')}</svg><small>${slot.side.toUpperCase()} FLANK · SCHEMATIC UV GUIDE · ${this.slots.length}/10 ACTIVE</small>`;
  }
  private render() {
    const slot = this.current();
    this.root.innerHTML = `<h4>Ten independent decal slots</h4><label>SLOT<select data-decal="slot" aria-label="Decal slot">${Array.from({ length: DECAL_LIMIT }, (_, i) => `<option value="${i + 1}" ${this.selected === i + 1 ? 'selected' : ''}>SLOT ${i + 1}${this.slots.some((r) => r.id === i + 1) ? ' / ACTIVE' : ''}</option>`).join('')}</select></label><label class="check"><input type="checkbox" data-decal="enabled" ${this.slots.some((r) => r.id === this.selected) ? 'checked' : ''}>ENABLE THIS SLOT</label><label>SURFACE<select data-decal="side" aria-label="Decal surface"><option value="left" ${slot.side === 'left' ? 'selected' : ''}>LEFT FLANK</option><option value="right" ${slot.side === 'right' ? 'selected' : ''}>RIGHT FLANK</option></select></label><label>DECAL WORDMARK<input data-decal="text" aria-label="Decal wordmark" maxlength="14" value="${escapeHtml(slot.text)}"></label><label>DECAL COLOUR<input data-decal="color" aria-label="Decal colour" type="color" value="${slot.color}"></label>${(
      [
        ['x', 'LONGITUDINAL', -1, 1, 0.01],
        ['y', 'VERTICAL', -1, 1, 0.01],
        ['scale', 'SCALE', 0.35, 1.75, 0.05],
        ['rotation', 'ROTATION', -90, 90, 1],
      ] as const
    )
      .map(
        ([key, label, min, max, step]) =>
          `<label for="decal-${key}">${label}<output for="decal-${key}">${slot[key]}</output></label><input id="decal-${key}" data-decal="${key}" aria-label="Decal ${key}" type="range" min="${min}" max="${max}" step="${step}" value="${slot[key]}">`,
      )
      .join(
        '',
      )}<div id="decalMap"></div><p class="photo-help">Drag a label on the UV guide, or focus it and use arrow keys (Shift: larger steps). Escape cancels a drag. Slots preview on the actual left or right body skin. Save livery to keep them.</p>`;
    this.preview();
  }
}
