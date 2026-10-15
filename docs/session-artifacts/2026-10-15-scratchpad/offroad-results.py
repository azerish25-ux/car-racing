p='src/ui/offroad-hud.ts'
s=open(p).read()
old="""  update(frame: Float32Array, track: Track, options: SessionOptions) {"""
new="""  /** The off-road part of the results card (WP42): the holeshot, joker laps
   * against the requirement, or each car's stage time; empty elsewhere. */
  results(frame: Float32Array, track: Track, options: SessionOptions, name: (id: number) => string) {
    if (!offroadCourse(track.circuit) || options.mode !== 'race') return '';
    const format = rulesetFor(options).format;
    if (!format) return '';
    const cars = Math.round(frame[H.CARS]),
      at = (id: number, field: number) => frame[carBase(id) + OFFROAD_BASE + field],
      ids = Array.from({ length: cars }, (_, id) => id);
    const escape = (text: string) =>
      text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const lines: string[] = [];
    if (format.start === 'gate') {
      const hole = ids.find((id) => at(id, O.FORMAT) > 0.5);
      lines.push(`Holeshot: ${hole === undefined ? '—' : escape(name(hole))}.`);
      const jumped = ids.filter((id) => at(id, O.START) > 2.5).map((id) => escape(name(id)));
      if (jumped.length) lines.push(`Jump start (penalised): ${jumped.join(', ')}.`);
    }
    if (format.kind === 'rallycross') {
      const required = format.joker?.required ?? 1;
      lines.push(
        `Joker laps (${required} required, ${format.joker?.penaltySeconds ?? 0} s per difference): ` +
          ids.map((id) => `${escape(name(id))} ${Math.round(at(id, O.JOKERS))}`).join(' · ') +
          '.',
      );
    }
    if (format.kind === 'stage')
      lines.push(
        'Stage times: ' +
          ids
            .map((id) => `${escape(name(id))} ${at(id, O.FORMAT) > 0 ? clock(at(id, O.FORMAT)) : '—'}`)
            .join(' · ') +
          '.',
      );
    return `<p class="offroad-results">${lines.join('<br>')}</p>`;
  }
  update(frame: Float32Array, track: Track, options: SessionOptions) {"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/ui/interface.ts'
s=open(p).read()
old="""</tbody></table>${this.championshipNote ? `<p class="championship-note">${escapeHtml(this.championshipNote)}</p>` : ''}${this.resultsExtra}<div class="dialog-buttons inline"><button class="primary" data-action="replay">WATCH REPLAY</button>"""
new="""</tbody></table>${this.offroadHud.results(frame, this.track, this.options, (id) => (id === 0 ? this.playerName : DRIVERS[id]))}${this.championshipNote ? `<p class="championship-note">${escapeHtml(this.championshipNote)}</p>` : ''}${this.resultsExtra}<div class="dialog-buttons inline"><button class="primary" data-action="replay">WATCH REPLAY</button>"""
assert s.count(old)==1; s=s.replace(old,new)
open(p,'w').write(s)
