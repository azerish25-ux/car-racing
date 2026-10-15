root = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/'


def edit(path, pairs):
    p = root + path
    s = open(p).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:80])
        s = s.replace(a, b)
    open(p, 'w').write(s)


edit('src/career/controller.ts', [
    ("""  /** Championship round index this session races, or -1. */
  round: number;
}""", """  /** Championship round index this session races, or -1. */
  round: number;
  /** A session of a two-moto meeting (offroad/meeting.ts): the career pays
   * the meeting once, on its combined classification, after the final moto;
   * qualifying and the first moto ('part') are not settled on their own. */
  meeting?: 'part' | 'final';
}
/** The meeting's result for the final moto's settlement (finish()). */
export interface MeetingOutcome {
  /** Overall meeting position of the player (1-based) and the field size. */
  position: number;
  cars: number;
  /** The player scored in at least one moto. */
  classified: boolean;
  /** Qualifying position (0-based), the meeting's grid slot. */
  gridSlot: number;
}"""),
    ("""  start(options: SessionOptions, career: CareerSession): void;""",
     """  start(options: SessionOptions, career: CareerSession): void;
  /** Run a career event as a two-moto meeting (absent: not offered). */
  meeting?(options: SessionOptions, career: CareerSession, name: string): void;"""),
    ("""      if (command === 'start')
        return void this.startEvent(name.slice('career:start:'.length)).catch((error) =>
          this.fail(error),
        );""", """      if (command === 'start')
        return void this.startEvent(name.slice('career:start:'.length)).catch((error) =>
          this.fail(error),
        );
      if (command === 'meeting') return this.startMeeting(name.slice('career:meeting:'.length));"""),
    ("""  private briefLicence(id: LicenceId) {""", """  /** A career race event with a two-moto format, run as a full meeting: the
   * same field, venue and stakes; paid once on the combined result. */
  private startMeeting(key: string) {
    const event = this.findEvent(key);
    if (
      !event ||
      event.status !== 'open' ||
      !event.definition ||
      !event.vehicle ||
      event.kind === 'championship'
    )
      return this.fail(new Error('This event cannot run as a meeting.'));
    if (!this.host.meeting) return this.fail(new Error('Meetings are not available here.'));
    if (!this.canStart()) return;
    const player = this.vehicle(event.vehicle)!,
      definition = event.definition;
    const options = eventSession(definition, this.base());
    this.host.meeting(
      options,
      {
        kind: 'race',
        event: {
          key: event.key,
          kind: event.kind,
          discipline: event.discipline,
          tier: event.tier,
          name: `${definition.name} · MEETING`,
          stakes: event.stakes,
          objectives: event.objectives,
        },
        licence: null,
        vehicle: player.id,
        setup: careerSetup(this.save, player),
        round: -1,
        meeting: 'part',
      },
      `${definition.name} · TWO-MOTO MEETING`,
    );
  }
  private briefLicence(id: LicenceId) {"""),
    ("""  finish(frame: Float32Array, grid: readonly number[] | undefined) {
    const career = this.active;
    if (!career) return false;""", """  finish(
    frame: Float32Array,
    grid: readonly number[] | undefined,
    meeting?: MeetingOutcome,
  ) {
    const career = this.active;
    if (!career) return false;
    // A meeting's qualifying and first moto are settled with the meeting.
    if (career.meeting === 'part') {
      this.host.setResultsExtra('');
      return true;
    }"""),
    ("""    const outcome = {
      session,
      position: Math.round(frame[o + F.RANK]),
      cars,
      classified: frame[o + F.FINISH] > 0 && frame[o + F.RETIRED] === 0,
      demonstration: ai,
      penalties: frame[o + F.PENALTY],
      contactEnergy: this.contact.energy,
      gridSlot: Math.max(0, startGrid.indexOf(0)),""", """    const final = career.meeting === 'final' && meeting ? meeting : null;
    const outcome = {
      session,
      position: final ? final.position : Math.round(frame[o + F.RANK]),
      cars: final ? final.cars : cars,
      classified: final ? final.classified : frame[o + F.FINISH] > 0 && frame[o + F.RETIRED] === 0,
      demonstration: ai,
      penalties: frame[o + F.PENALTY],
      contactEnergy: this.contact.energy,
      gridSlot: final ? final.gridSlot : Math.max(0, startGrid.indexOf(0)),"""),
])
edit('src/ui/career-hub.ts', [
    ("""  const abandon =
    event.kind === 'championship' && running && season.season.results.length""", """  // A two-moto format also runs as a full meeting (qualifying, gate pick,
  // both motos), paid once on the combined points.
  const meeting =
    event.status === 'open' && def && event.kind !== 'championship' && meetingEvent(def)
      ? button('RUN TWO-MOTO MEETING', `career:meeting:${event.key}`)
      : '';
  const abandon =
    event.kind === 'championship' && running && season.season.results.length"""),
    ("""${event.status !== 'open' ? `<p class="career-needs">${event.status === 'coming' ? 'Coming — missing from this build:' : 'Requires:'}</p>${reasonsList(event.reasons)}` : ''}${action}${abandon}</article>`;""",
     """${event.status !== 'open' ? `<p class="career-needs">${event.status === 'coming' ? 'Coming — missing from this build:' : 'Requires:'}</p>${reasonsList(event.reasons)}` : ''}${action}${meeting}${abandon}</article>`;"""),
])
print('ok')
