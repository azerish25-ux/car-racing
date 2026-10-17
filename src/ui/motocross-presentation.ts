import { circuitDefinition, type CircuitId } from '../simulation/circuits.ts';
import type { SessionOptions } from '../simulation/config.ts';
import { offroadCourse } from '../simulation/offroad/venues.ts';
import { VEHICLES } from '../simulation/vehicles.ts';
import type { Track } from '../simulation/track.ts';
import { circuitBlurb } from './circuit-menu.ts';
import styles from './motocross.css?inline';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function motocrossKind(id: CircuitId | undefined) {
  const kind = circuitDefinition(id).offroad?.kind;
  return kind === 'motocross' || kind === 'supercross' ? kind : null;
}

export function motocrossSessionTitle(options: SessionOptions) {
  const kind = motocrossKind(options.circuit);
  if (!kind || options.mode !== 'race') return null;
  return kind === 'supercross' ? 'SUPERCROSS MOTO' : 'MOTOCROSS MOTO';
}

/** A compact outline of the authored layout, drawn from its control polygon.
 * It is a menu guide, not a substitute for the sampled in-race track map. */
export function motocrossLayout(id: CircuitId) {
  const def = circuitDefinition(id);
  const points = def.design;
  const xs = points.map((p) => p[0]),
    zs = points.map((p) => p[1]);
  const minX = Math.min(...xs),
    minZ = Math.min(...zs);
  const width = Math.max(...xs) - minX,
    depth = Math.max(...zs) - minZ;
  const scale = Math.min(192 / Math.max(width, 1), 104 / Math.max(depth, 1));
  const point = ([x, z]: readonly [number, number]) =>
    `${(110 + (x - minX - width / 2) * scale).toFixed(2)},${(66 - (z - minZ - depth / 2) * scale).toFixed(2)}`;
  const d = `M${points.map(point).join(' L')} Z`;
  return `<svg class="mx-layout" viewBox="0 0 220 132" role="img" aria-label="${escape(def.short)} layout outline"><path class="mx-layout-ground" d="${d}"/><path class="mx-layout-line" d="${d}"/></svg>`;
}

export function motocrossVenueCard(id: CircuitId) {
  const kind = motocrossKind(id);
  if (!kind) return '';
  const def = circuitDefinition(id),
    course = offroadCourse(def)!;
  const title = kind === 'supercross' ? 'UNDER THE LIGHTS' : 'THROUGH THE RIDGE';
  const ground = kind === 'supercross' ? 'PREPARED CLAY · INDOOR' : 'LOAM · SAND · CREEK MUD';
  return `<div class="mx-venue-card" data-venue="${kind}">${motocrossLayout(id)}<div><span class="mx-kicker">${ground}</span><strong>${title}</strong><p>${course.jumps.length} jump features · ${def.corners.length} named turns</p></div></div>`;
}

export const MOTOCROSS_RIDE_PRESETS = Object.freeze([
  {
    id: 'learn',
    title: 'Learn the jumps',
    detail: 'Solo practice · riding assists',
    mode: 'practice',
    opponents: 0,
    assist: 'sport',
  },
  {
    id: 'race',
    title: 'Race the pack',
    detail: 'Eight riders · riding assists',
    mode: 'race',
    opponents: 7,
    assist: 'sport',
  },
  {
    id: 'raw',
    title: 'Full control',
    detail: 'Eight riders · assists off',
    mode: 'race',
    opponents: 7,
    assist: 'raw',
  },
] as const);

/** These presets change existing, validated session controls. They do not
 * invent a new difficulty, alter saved settings or start a session by surprise. */
export function motocrossPreset(id: string) {
  return MOTOCROSS_RIDE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** A discipline-aware entry inside the existing paddock. Local DOM listeners
 * live with the Interface; no global listeners or extra animation loop. */
export function installMotocrossMenu(menu: HTMLElement, currentTrack: () => Track) {
  const knownLengths = new Map<CircuitId, number>();
  const select = (id: string) => menu.querySelector<HTMLSelectElement>(`#${id}`)!;
  const circuit = select('circuit'),
    vehicle = select('vehicle');
  const title = menu.querySelector('h1')!,
    intro = menu.querySelector<HTMLElement>('.intro')!;
  const originalTitle = title.innerHTML,
    originalIntro = intro.innerHTML;
  const machineLabel = menu.querySelector<HTMLElement>('.car-label')!;
  const originalLabel = machineLabel.innerHTML;
  const brandDiscipline = menu.querySelector<HTMLElement>('.brand span'),
    edition = menu.querySelector<HTMLElement>('.edition'),
    menuHint = menu.querySelector<HTMLElement>('.menu-hint');
  const originalBrandDiscipline = brandDiscipline?.textContent ?? '',
    originalEditionLabel = edition?.firstChild?.textContent ?? '',
    originalMenuHint = menuHint?.innerHTML ?? '';
  const rules = menu.querySelector<HTMLElement>('#circuitBlurb')!;
  const style = document.createElement('style');
  style.textContent = styles;
  menu.append(style);
  const shortcuts = document.createElement('nav');
  shortcuts.className = 'mx-entry';
  shortcuts.setAttribute('aria-label', 'Motocross venues');
  shortcuts.innerHTML =
    '<span>DIRT SERIES</span><button type="button" data-mx-venue="valley-ridge-mx">OUTDOOR MX</button><button type="button" data-mx-venue="arena-nord-sx">STADIUM SX</button>';
  menu.querySelector('#sessionForm')!.before(shortcuts);
  const panel = document.createElement('section');
  panel.className = 'mx-setup';
  panel.setAttribute('aria-label', 'Motocross ride setup');
  panel.hidden = true;
  panel.innerHTML = `<div class="mx-venue-preview"></div><fieldset class="mx-ride-presets"><legend>YOUR RIDE</legend>${MOTOCROSS_RIDE_PRESETS.map((p) => `<button type="button" data-mx-preset="${p.id}" aria-pressed="false"><b>${p.title}</b><span>${p.detail}</span></button>`).join('')}</fieldset><p class="mx-technique">Brake before the face. In flight, throttle lifts the nose and brake lowers it. Match the landing slope.</p>`;
  rules.after(panel);
  const body = menu.querySelector<HTMLElement>('.menu-body')!,
    form = menu.querySelector<HTMLFormElement>('#sessionForm')!,
    start = form.querySelector<HTMLButtonElement>('.enter.primary')!;
  const startOrigin = document.createComment('motocross start button origin'),
    originalForm = start.getAttribute('form'),
    originalTabIndex = body.tabIndex;
  const scroll = document.createElement('div');
  scroll.className = 'mx-menu-scroll';
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Motocross race setup and tools');
  const dock = document.createElement('div');
  dock.className = 'mx-start-dock';
  let docked = false;
  const dockStart = (active: boolean) => {
    if (active === docked) return;
    const focused = body.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
    if (active) {
      // Keep the real submitter and its native form semantics. A separate row
      // reserves space for it instead of laying a sticky button over fields.
      start.before(startOrigin);
      scroll.append(...body.childNodes);
      body.append(scroll, dock);
      dock.append(start);
      start.setAttribute('form', form.id);
      body.tabIndex = -1;
    } else {
      startOrigin.replaceWith(start);
      if (originalForm === null) start.removeAttribute('form');
      else start.setAttribute('form', originalForm);
      body.append(...scroll.childNodes);
      scroll.remove();
      dock.remove();
      body.tabIndex = originalTabIndex;
    }
    body.classList.toggle('mx-menu-layout', active);
    docked = active;
    focused?.focus({ preventScroll: true });
  };
  const set = (id: string, value: string | number) => {
    select(id).value = String(value);
    select(id).dispatchEvent(new Event('change', { bubbles: true }));
  };
  let lastVenue = '';
  const refresh = () => {
    const current = currentTrack();
    knownLengths.set(current.circuit.id, current.length);
    const kind = motocrossKind(circuit.value as CircuitId);
    menu.dataset.discipline = kind ?? 'circuit';
    dockStart(!!kind);
    if (brandDiscipline)
      brandDiscipline.textContent = kind ? 'DIRT SERIES' : originalBrandDiscipline;
    if (edition?.firstChild)
      edition.firstChild.textContent = kind ? 'RIDER ' : originalEditionLabel;
    if (menuHint)
      menuHint.innerHTML = kind
        ? '<kbd>WASD</kbd> / <kbd>ARROWS</kbd> RIDE · <kbd>G</kbd> AI RIDER · GAMEPAD READY'
        : originalMenuHint;
    panel.hidden = !kind;
    for (const button of shortcuts.querySelectorAll<HTMLButtonElement>('button'))
      button.setAttribute('aria-pressed', String(button.dataset.mxVenue === circuit.value));
    if (kind) {
      const def = circuitDefinition(circuit.value as CircuitId);
      title.innerHTML = kind === 'supercross' ? 'OWN THE<br>RHYTHM.' : 'FIND YOUR<br>FLOW.';
      intro.textContent =
        kind === 'supercross'
          ? 'Link the rhythm lanes. Carry speed through the bowl. Make every landing count.'
          : 'Read the ruts. Commit to the line. Ride the hillside from gate drop to the final jump.';
      menu.querySelector('#circuitEyebrow')!.textContent = def.name.replace(' / ', ' · ');
      rules.textContent = def.catalogue?.description ?? '';
      if (lastVenue !== circuit.value) {
        panel.querySelector('.mx-venue-preview')!.innerHTML = motocrossVenueCard(
          circuit.value as CircuitId,
        );
        lastVenue = circuit.value;
      }
    } else {
      title.innerHTML = originalTitle;
      intro.innerHTML = originalIntro;
      rules.textContent = circuitBlurb(circuit.value as CircuitId);
      menu.querySelector('#circuitEyebrow')!.textContent = circuitDefinition(
        circuit.value as CircuitId,
      ).name.replace(' / ', ' · ');
    }
    const machine = VEHICLES[vehicle.value];
    if (machine?.classId === 'motocross') {
      const spec = machine.spec;
      machineLabel.innerHTML = `<span>${escape(machine.id === 'mx250' ? 'MX–250' : 'MX–450')}</span><b>${machine.id === 'mx250' ? 'TWO-STROKE / MOTOCROSS' : 'FOUR-STROKE / MOTOCROSS'}</b><div>${Math.round(spec.dryMass - machine.bike!.riderMass)} KG MACHINE · ${spec.gearRatios.length - 2} SPEED · ${Math.round(machine.bike!.forkTravel * 1000)} MM TRAVEL</div>`;
    } else machineLabel.innerHTML = originalLabel;
    const riders = !!kind;
    const definition = circuitDefinition(circuit.value as CircuitId);
    const length =
      knownLengths.get(definition.id) ??
      definition.catalogue?.length ??
      offroadCourse(definition)?.length;
    if (length !== undefined)
      menu.querySelector('#circuitLength')!.textContent = (length / 1000).toFixed(3);
    menu.querySelector('#circuitTurns')!.textContent = String(definition.corners.length);
    const featureCount = menu.querySelector('#circuitDrs')!;
    featureCount.textContent = String(
      kind ? offroadCourse(definition)!.jumps.length : definition.drsZones.length,
    );
    featureCount.nextSibling!.textContent = kind
      ? ' JUMP FEATURES'
      : ` DRS ${definition.drsZones.length === 1 ? 'ZONE' : 'ZONES'}`;
    select('assist').querySelector('option[value="sport"]')!.textContent = kind
      ? 'Riding assists'
      : 'ABS + TC';
    for (const option of select('opponents').options)
      if (Number(option.value) > 0)
        option.textContent = `${Number(option.value) + 1} ${riders ? 'riders' : 'cars'}`;
    const race = select('mode').querySelector<HTMLOptionElement>('option[value="race"]')!;
    race.textContent = kind
      ? kind === 'supercross'
        ? 'Supercross moto'
        : 'Motocross moto'
      : 'Grand Prix';
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-mx-preset]')) {
      const p = motocrossPreset(button.dataset.mxPreset!)!;
      button.setAttribute(
        'aria-pressed',
        String(
          select('mode').value === p.mode &&
            Number(select('opponents').value) === p.opponents &&
            select('assist').value === p.assist,
        ),
      );
    }
  };
  shortcuts.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mx-venue]');
    if (!button) return;
    set('circuit', button.dataset.mxVenue!);
    if (VEHICLES[vehicle.value]?.classId !== 'motocross') set('vehicle', 'mx450');
    set('mode', 'race');
    set('opponents', 7);
    set('compound', 'medium');
    set('assist', 'sport');
    refresh();
  });
  panel.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mx-preset]');
    const preset = button && motocrossPreset(button.dataset.mxPreset!);
    if (!preset) return;
    set('mode', preset.mode);
    set('opponents', preset.opponents);
    set('assist', preset.assist);
    refresh();
  });
  for (const id of ['circuit', 'vehicle', 'mode', 'opponents', 'assist'])
    select(id).addEventListener('change', refresh);
  refresh();
  return refresh;
}
