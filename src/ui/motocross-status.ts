/** MX race information shares one flowing column. RadioCaption is created by
 * main outside Interface, so adopt that same live node when it becomes available.
 * Origin markers restore the exact existing layout when another discipline runs. */
export class MotocrossStatusStack {
  private stack: HTMLElement | null = null;
  private readonly origins = new Map<HTMLElement, Comment>();

  constructor(
    private readonly root: HTMLElement,
    private readonly hud: HTMLElement,
  ) {}

  update(active: boolean) {
    if (!active) {
      for (const [node, origin] of this.origins) origin.replaceWith(node);
      this.origins.clear();
      this.stack?.remove();
      this.stack = null;
      return;
    }
    if (!this.stack) {
      this.stack = this.hud.ownerDocument.createElement('div');
      this.stack.className = 'mx-status-stack';
      this.hud.append(this.stack);
    }
    // OffroadHud creates its panels on its first offroad snapshot. The radio
    // may also appear after Interface's constructor; no second instance is made.
    for (const selector of [
      '.f1-banner',
      '#raceMessage',
      '.mx-ride-hud',
      '.offroad-readout',
      '.radio-caption',
    ]) {
      const node = this.root.querySelector<HTMLElement>(selector);
      if (!node || node.parentElement === this.stack) continue;
      const origin = this.hud.ownerDocument.createComment('motocross-status-origin');
      node.before(origin);
      this.origins.set(node, origin);
      this.stack.append(node);
    }
  }
}
