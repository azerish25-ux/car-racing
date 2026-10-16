import styles from './race-day-hud.css?inline';
import { bikeReadout } from './bike-readout.ts';
import {
  F,
  H,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  WHEEL_NAMES,
  carBase,
} from '../simulation/protocol.ts';
import { COMPOUNDS, type Compound } from '../simulation/config.ts';

/** MFD pages in cycle order. STRATEGY and SETUP follow DAMAGE so ArrowRight
 * from ENERGY still lands on DAMAGE (e2e/52). */
export const MFD_PAGES = ['TYRES', 'ENERGY', 'DAMAGE', 'STRATEGY', 'SETUP'] as const;
/** STRATEGY page tyre choices for the next stop; AUTO leaves it to the engineer. */
export const PIT_CHOICES = ['auto', 'soft', 'medium', 'hard', 'intermediate', 'wet'] as const;
const CHOICE_LABEL: Record<(typeof PIT_CHOICES)[number], string> = {
  auto: 'AUTO',
  soft: 'S',
  medium: 'M',
  hard: 'H',
  intermediate: 'I',
  wet: 'W',
};
const BIKE_LABELS: Readonly<Record<string, string>> = {
  mfdBattery: 'FRONT LOAD',
  mfdMotor: 'REAR LOAD',
  mfdRegen: 'TRACTION / WHEELIE CONTROL',
  mfdBrakeBias: 'FRONT LEVER / REAR PEDAL',
  mfdFloor: 'FAIRING CONDITION',
  mfdRear: 'RIDER',
  mfdSetupBias: 'CHASSIS LEAN',
  mfdDiffPower: 'HANG-OFF',
  mfdDiffCoast: 'TUCK',
  mfdErsMode: 'TRACTION / WHEELIE CONTROL',
  mfdRide: 'FORK / SHOCK COMPRESSION',
};
/** The compound picked on the STRATEGY page for the next pit request, if any. */
export function selectedPitCompound(hud: HTMLElement): Compound | undefined {
  const value = hud.dataset.pitCompound;
  return value && value !== 'auto' && Object.hasOwn(COMPOUNDS, value)
    ? (value as Compound)
    : undefined;
}
const reading = (rows: readonly [string, string][]) =>
  `<dl class="vehicle-readings">${rows.map(([label, id]) => `<div><dt>${label}</dt><dd id="${id}">—</dd></div>`).join('')}</dl>`;

export function vehicleWarning(frame: Float32Array): string {
  const o = carBase(0);
  if (frame[H.PHASE] < 2 || frame[o + F.FINISH] > 0) return '';
  const bike = bikeReadout(frame);
  if (bike && bike.state !== 'RIDING') return `${bike.state} / WAIT FOR SAFE RECOVERY`;
  for (let wheel = 0; wheel < 4; wheel++)
    if (frame[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.PUNCTURED] > 0)
      return 'PUNCTURE / REQUEST PIT SERVICE';
  if (frame[o + F.FRONT_HEALTH] < 0.6 || frame[o + F.REAR_HEALTH] < 0.6)
    return bike ? 'FAIRING DAMAGE / REQUEST PIT SERVICE' : 'AERO DAMAGE / REQUEST PIT SERVICE';
  if (frame[o + F.FUEL] < 2) return 'LOW FUEL / UNDER 2 KG';
  for (let wheel = 0; wheel < 4; wheel++)
    if (frame[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.DISC_TEMP] > 1100)
      return 'BRAKE TEMPERATURE / OVER 1100°C';
  return '';
}

/** Reorganize the existing live UI, never clone telemetry or create a second
 * simulation reader. Every section remains keyboard-accessible on demand. */
export function installRaceDayHud(hud: HTMLElement) {
  if (hud.dataset.raceDay) throw new Error('Race-day HUD already installed');
  hud.dataset.raceDay = 'true';
  hud.dataset.vehicleOpen = 'false';
  const style = document.createElement('style');
  style.textContent = styles;
  hud.append(style);
  const panel = hud.querySelector<HTMLElement>('.car-status')!;
  panel.id = 'vehicleMfd';
  panel.setAttribute('aria-label', 'Vehicle information');
  const tabs = document.createElement('div');
  tabs.className = 'vehicle-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Vehicle information pages');
  const names = MFD_PAGES;
  const pages = names.map((name, index) => {
    const page = document.createElement('div');
    page.className = 'vehicle-page';
    page.id = `vehiclePage${index}`;
    page.setAttribute('role', 'tabpanel');
    page.setAttribute('aria-labelledby', `vehicleTab${index}`);
    const tab = document.createElement('button');
    tab.id = `vehicleTab${index}`;
    tab.type = 'button';
    tab.textContent = name;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', page.id);
    tabs.append(tab);
    panel.append(page);
    return page;
  });
  pages[0].append(panel.querySelector('#tires')!);
  pages[1].innerHTML =
    '<dl class="vehicle-readings"><div><dt>FUEL MASS</dt><dd id="mfdFuel">—</dd></div><div><dt>BATTERY</dt><dd id="mfdBattery">—</dd></div><div><dt>MOTOR OUTPUT</dt><dd id="mfdMotor">—</dd></div><div><dt>REGENERATION</dt><dd id="mfdRegen">—</dd></div><div><dt>FRONT BRAKE BIAS</dt><dd id="mfdBrakeBias">—</dd></div></dl>';
  pages[2].append(panel.querySelector('.health')!);
  const details = document.createElement('dl');
  details.className = 'vehicle-readings';
  details.innerHTML =
    '<div><dt>FLOOR HEALTH</dt><dd id="mfdFloor">—</dd></div><div><dt>REAR AERO</dt><dd id="mfdRear">—</dd></div><div><dt>PIT STOPS</dt><dd id="mfdStops">—</dd></div>';
  pages[2].append(details);
  pages[3].innerHTML = reading([
    ['CURRENT COMPOUND', 'mfdCompound'],
    ['TYRE LIFE · AVERAGE', 'mfdTyreLife'],
    ['MOST WORN TYRE', 'mfdTyreWorst'],
    ['PIT STOPS MADE', 'mfdStrategyStops'],
    ['LAPS ON THIS SET', 'mfdTyreAge'],
    ['NEXT SET', 'mfdNextSet'],
  ]);
  const choices = document.createElement('div');
  choices.className = 'pit-choices';
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', 'Tyres for the next pit stop');
  hud.dataset.pitCompound = 'auto';
  for (const choice of PIT_CHOICES) {
    const option = document.createElement('button');
    option.type = 'button';
    option.dataset.compound = choice;
    option.textContent = CHOICE_LABEL[choice];
    option.title = choice === 'auto' ? 'Engineer’s choice' : choice.toUpperCase();
    option.setAttribute('aria-pressed', String(choice === 'auto'));
    if (choice !== 'auto')
      option.style.setProperty(
        '--compound',
        `#${COMPOUNDS[choice].color.toString(16).padStart(6, '0')}`,
      );
    option.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
    option.addEventListener('click', () => {
      hud.dataset.pitCompound = choice;
      for (const other of choices.children)
        other.setAttribute('aria-pressed', String(other === option));
    });
    choices.append(option);
  }
  pages[3].append(choices);
  pages[4].innerHTML = reading([
    ['FRONT BRAKE BIAS', 'mfdSetupBias'],
    ['DIFFERENTIAL · ON THROTTLE', 'mfdDiffPower'],
    ['DIFFERENTIAL · OFF THROTTLE', 'mfdDiffCoast'],
    ['ERS MODE', 'mfdErsMode'],
    ['RIDE HEIGHT · FRONT / REAR', 'mfdRide'],
  ]);
  panel.insertBefore(tabs, pages[0]);
  const select = (index: number, focus = false) => {
    pages.forEach((page, i) => {
      page.hidden = index !== i;
      const tab = tabs.children[i] as HTMLButtonElement;
      tab.setAttribute('aria-selected', String(index === i));
      tab.tabIndex = index === i ? 0 : -1;
    });
    if (focus) (tabs.children[index] as HTMLButtonElement).focus();
  };
  for (let i = 0; i < names.length; i++)
    tabs.children[i].addEventListener('click', () => select(i));
  tabs.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const current = [...tabs.children].indexOf(document.activeElement!);
      const count = names.length;
      select(
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? count - 1
            : (current + (event.key === 'ArrowRight' ? 1 : count - 1)) % count,
        true,
      );
    }
  });
  select(0);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'vehicle-toggle';
  button.textContent = 'VEHICLE';
  button.setAttribute('aria-controls', panel.id);
  button.setAttribute('aria-expanded', 'false');
  hud.querySelector('.hud-top')!.insertBefore(button, hud.querySelector('.icon-button'));
  const close = () => {
    hud.dataset.vehicleOpen = 'false';
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
  });
  button.addEventListener('click', () => {
    const open = hud.dataset.vehicleOpen !== 'true';
    hud.dataset.vehicleOpen = String(open);
    button.setAttribute('aria-expanded', String(open));
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && hud.dataset.vehicleOpen === 'true') {
      event.preventDefault();
      event.stopPropagation();
      close();
      button.focus();
    }
  });
  // Exiting a mode does not leave an invisible information panel focused.
  hud.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-action]')) close();
  });
  const alert = document.createElement('div');
  alert.id = 'vehicleAlert';
  alert.className = 'vehicle-alert';
  alert.setAttribute('role', 'status');
  alert.setAttribute('aria-live', 'polite');
  alert.hidden = true;
  hud.querySelector('.instruments')!.prepend(alert);
}

export function updateRaceDayHud(hud: HTMLElement, frame: Float32Array) {
  const o = carBase(0);
  const write = (id: string, value: string) => {
    const node = hud.querySelector<HTMLElement>(`#${id}`)!;
    if (node.textContent !== value) node.textContent = value;
  };
  write('mfdFuel', `${frame[o + F.FUEL].toFixed(1)} KG`);
  write('mfdBattery', `${Math.round(frame[o + F.BATTERY] / 4e4)}%`);
  write('mfdMotor', `${Math.round(frame[o + F.MOTOR_POWER] / 1000)} KW`);
  write('mfdRegen', `${Math.round(frame[o + F.REGEN_POWER] / 1000)} KW`);
  write('mfdBrakeBias', `${Math.round(frame[o + F.BRAKE_BIAS] * 100)}%`);
  write('mfdFloor', `${Math.round(frame[o + F.FLOOR_HEALTH] * 100)}%`);
  write('mfdRear', `${Math.round(frame[o + F.REAR_HEALTH] * 100)}%`);
  write('mfdStops', String(Math.round(frame[o + F.PIT_STOPS])));
  const compound = Object.keys(COMPOUNDS)[Math.round(frame[o + F.COMPOUND])] ?? 'medium';
  write('mfdCompound', compound.toUpperCase());
  let total = 0,
    worst = 0;
  for (let wheel = 1; wheel < 4; wheel++)
    if (wear(frame, wheel) > wear(frame, worst)) worst = wheel;
  for (let wheel = 0; wheel < 4; wheel++) total += wear(frame, wheel);
  write('mfdTyreLife', `${Math.round(100 * (1 - total / 4))}%`);
  write('mfdTyreWorst', `${WHEEL_NAMES[worst]} · ${Math.round(100 * (1 - wear(frame, worst)))}%`);
  write('mfdStrategyStops', String(Math.round(frame[o + F.PIT_STOPS])));
  const age = Math.round(frame[o + RACE_BASE + R.TYRE_AGE_LAPS]);
  write(
    'mfdTyreAge',
    Number.isFinite(age) && age >= 0 ? `${age} ${age === 1 ? 'LAP' : 'LAPS'}` : '—',
  );
  const next = Object.keys(COMPOUNDS)[Math.round(frame[o + RACE_BASE + R.NEXT_COMPOUND])];
  write('mfdNextSet', next ? next.toUpperCase() : '—');
  write('mfdSetupBias', `${Math.round(frame[o + F.BRAKE_BIAS] * 100)}%`);
  write('mfdDiffPower', `${Math.round(frame[o + F.DIFF_POWER] * 100)}%`);
  write('mfdDiffCoast', `${Math.round(frame[o + F.DIFF_COAST] * 100)}%`);
  write('mfdErsMode', ['HARVEST', 'BALANCED', 'ATTACK'][Math.round(frame[o + F.ERS_MODE])] ?? '—');
  write(
    'mfdRide',
    `${Math.round(frame[o + F.FRONT_RIDE] * 1000)} / ${Math.round(frame[o + F.REAR_RIDE] * 1000)} MM`,
  );
  const bike = bikeReadout(frame);
  if (hud.dataset.mfdBike !== String(!!bike)) {
    hud.dataset.mfdBike = String(!!bike);
    for (const [id, label] of Object.entries(BIKE_LABELS)) {
      const node = hud.querySelector(`#${id}`)?.previousElementSibling as HTMLElement | null;
      if (!node) continue;
      node.dataset.originalLabel ??= node.textContent ?? '';
      node.textContent = bike ? label : node.dataset.originalLabel;
    }
    hud.querySelectorAll('.vehicle-tabs > button').forEach((node, i) => {
      node.textContent = bike ? ['TYRES', 'FUEL', 'BIKE', 'STRATEGY', 'RIDER'][i] : MFD_PAGES[i];
    });
  }
  if (bike) {
    write('mfdBattery', bike.frontLoad === null ? '—' : `${bike.frontLoad}%`);
    write('mfdMotor', bike.rearLoad === null ? '—' : `${bike.rearLoad}%`);
    write('mfdRegen', `${bike.intervention}%`);
    write('mfdBrakeBias', `${bike.frontBrake}% / ${bike.rearBrake}%`);
    // The motorcycle adapter simulates cosmetic fairing scrapes through its
    // front-health channel. It has no structural chassis-health channel.
    write('mfdFloor', `${Math.round(frame[o + F.FRONT_HEALTH] * 100)}%`);
    write('mfdRear', bike.state);
    write('mfdTyreLife', `${Math.round((bike.front.life + bike.rear.life) / 2)}%`);
    const worst = bike.front.life <= bike.rear.life ? 'FRONT' : 'REAR';
    write('mfdTyreWorst', `${worst} · ${Math.min(bike.front.life, bike.rear.life)}%`);
    write(
      'mfdSetupBias',
      `${Math.abs(bike.lean)}° ${bike.lean > 0 ? 'LEFT' : bike.lean < 0 ? 'RIGHT' : ''}`.trim(),
    );
    write('mfdDiffPower', `${Math.abs(bike.hangOff)} CM`);
    write('mfdDiffCoast', `${bike.tuck}%`);
    write('mfdErsMode', `${bike.intervention}%`);
    write('mfdRide', `${bike.fork} / ${bike.shock} MM`);
  }
  const warning = vehicleWarning(frame);
  write('vehicleAlert', warning);
  hud.querySelector<HTMLElement>('#vehicleAlert')!.hidden = !warning;
}

function wear(frame: Float32Array, wheel: number) {
  const value = frame[carBase(0) + WHEEL_BASE + wheel * WHEEL_STRIDE + W.WEAR];
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
