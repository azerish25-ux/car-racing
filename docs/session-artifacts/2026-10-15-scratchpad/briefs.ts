// Scratch: markdown brief list (brief, bands, sound, body, events) per id.
import { CATALOGUE_BANDS, CATALOGUE_BRIEFS } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/vehicle-catalogue/index.ts';
import { VEHICLES } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/vehicles.ts';
import { EVENTS } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/events.ts';
import { soundFamilyFor } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/audio/sound-profiles.ts';
import { BODY_SHEETS } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/rendering/vehicle-bodies/body-sheet.ts';

const ids = process.argv[2].split(',');
for (const id of ids) {
  const def = VEHICLES[id],
    b = CATALOGUE_BANDS[id],
    sheet = BODY_SHEETS[id];
  const body =
    sheet.kind === 'closed'
      ? `${sheet.style}${sheet.open ? ' (open)' : ''}, ${sheet.wing ? sheet.wing.kind + ' wing' : 'no wing'}, ${sheet.lamps.front}/${sheet.lamps.rear} lamps${sheet.extras.length ? ', ' + sheet.extras.join(', ') : ''}`
      : sheet.kind === 'open-wheel'
        ? `open-wheel ${sheet.era}${sheet.halo ? ', halo' : ''}${sheet.airbox ? ', airbox' : ''}`
        : sheet.kind === 'kart'
          ? `kart (${sheet.nose ?? 'full'} nose, ${sheet.pods ?? 'long'} pods, ${sheet.cooling ?? 'water'}-cooled, ${sheet.bumper ?? 'bar'} bumper)`
          : 'tube-frame buggy, exposed arms';
  const events = EVENTS.filter((e) => [e.vehicles].flat().includes(id)).map((e) => `\`${e.id}\``);
  const name = def.name
    .split(' ')
    .map((w, i) => (i === 0 ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
  console.log(
    `* **${name} (\`${id}\` v${def.version}, ${def.classId}).** ${CATALOGUE_BRIEFS[id]} Bands: 0–100 ${b.accel0to100.join('–')} s, top ${b.topSpeed.join('–')} km/h, 100–0 ${b.braking100Distance.join('–')} m, ${b.lateral80G.join('–')} g. Sound: \`${soundFamilyFor(def)}\`. Body: ${body}. Events: ${events.join(', ') || 'none (open-world only)'}.`,
  );
}
