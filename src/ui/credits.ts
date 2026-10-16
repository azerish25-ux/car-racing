import { creditLines, type CreditLine } from '../rendering/assets/third-party.ts';

const KIND_LABEL: Record<CreditLine['kind'], string> = {
  hdri: 'Photographed skies (HDRI)',
  texture: 'Scanned material textures',
  mesh: 'Models',
  vegetation: 'Trees, shrubs and grass',
};

function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** "Credits & licences" modal body: every third-party manifest entry with its
 * attribution, licence and source, grouped by kind. Plain links; the list is
 * a focusable scroll region (arrow keys, Page Up/Down, gamepad). */
export function creditsHtml(lines: readonly CreditLine[] = creditLines()) {
  const groups = (['hdri', 'texture', 'mesh', 'vegetation'] as const)
    .map((kind) => ({ kind, items: lines.filter((l) => l.kind === kind) }))
    .filter((g) => g.items.length);
  const body = groups
    .map(
      (g) =>
        `<section class="credits-group"><h3>${KIND_LABEL[g.kind]}</h3><ul>${g.items
          .map(
            (l) =>
              `<li><b>${escape(l.title)}</b><span>${escape(l.attribution)}</span><small><a href="${escape(l.licenceUrl)}" target="_blank" rel="noopener noreferrer">${escape(l.licenceName)}</a> · <a href="${escape(l.homepage ?? l.sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a></small></li>`,
          )
          .join('')}</ul></section>`,
    )
    .join('');
  return `<span class="eyebrow">PADDOCK / CREDITS</span><h2>Credits &amp; licences.</h2><p>The circuits, cars, riders, interface and sound are original work of this project. The photographed and scanned material below is used under its authors' licences; thank you to everyone who shares their work freely.</p><div class="credits-list" id="creditsList" tabindex="0" role="region" aria-label="Third-party credits">${
    body || '<p>No third-party assets are shipped in this build.</p>'
  }<p class="small-note">Full text: <a href="assets/third-party/CREDITS.txt" target="_blank" rel="noopener">CREDITS.txt</a>. Runtime libraries keep their own licences (three.js MIT; the Basis Universal transcoder Apache-2.0).</p></div><div class="dialog-buttons"><button class="primary" data-action="modalClose">CLOSE</button></div>`;
}

/**
 * Gamepad access for the credits modal (the paddock menu itself is driven by
 * keyboard and pointer): D-pad / left stick scrolls the list, A activates
 * the focused control, B or Start closes. Polls only while the modal is open.
 */
export class CreditsGamepad {
  private frame = 0;
  private previous = new Set<number>();
  private disposed = false;
  constructor(
    private readonly list: HTMLElement,
    private readonly close: () => void,
  ) {
    // Buttons held while the modal opened are not new presses.
    this.previous = this.pressed();
    this.frame = requestAnimationFrame(() => this.poll());
  }
  private pad() {
    try {
      return (
        [...(navigator.getGamepads?.() ?? [])].find((p): p is Gamepad => !!p?.connected) ?? null
      );
    } catch {
      return null;
    }
  }
  private pressed() {
    const pad = this.pad(),
      set = new Set<number>();
    pad?.buttons.forEach((b, i) => b.pressed && set.add(i));
    return set;
  }
  private poll() {
    if (this.disposed) return;
    const pad = this.pad();
    if (pad) {
      const now = this.pressed(),
        edge = (i: number) => now.has(i) && !this.previous.has(i);
      const stick = Math.abs(pad.axes[1] ?? 0) > 0.25 ? (pad.axes[1] ?? 0) : 0;
      const step = (now.has(13) ? 1 : 0) - (now.has(12) ? 1 : 0) + stick;
      if (step) this.list.scrollBy({ top: step * 14 });
      this.previous = now;
      if (edge(1) || edge(9)) return this.close();
      if (edge(0) && document.activeElement instanceof HTMLElement) document.activeElement.click();
    }
    this.frame = requestAnimationFrame(() => this.poll());
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
  }
}
