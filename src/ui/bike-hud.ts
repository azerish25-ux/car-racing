import styles from './bike-hud.css?inline';
import { bikeReadout } from './bike-readout.ts';

/** Reflows the live speed/gear/controls into a peripheral GP cluster and adds
 * only motorcycle-specific channels. It shares Interface's snapshot clock. */
export class BikeHud {
  private readonly nodes: Record<string, HTMLElement> = {};
  constructor(private readonly hud: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = styles;
    const feedback = document.createElement('div');
    feedback.className = 'gp-feedback';
    feedback.setAttribute('aria-label', 'Motorcycle telemetry');
    feedback.innerHTML = `
      <div class="gp-lean"><span>LEAN</span><div class="gp-lean-track" aria-hidden="true"><i id="gpLeanMarker"></i></div><b id="gpLean">0°</b></div>
      <div class="gp-rear-brake" title="Independent rear-brake pedal input; combined braking assistance can also apply the rear brake"><span>REAR PEDAL</span><div aria-hidden="true"><i id="gpRearBrakeBar"></i></div><b id="gpRearBrake">0%</b></div>
      <div class="gp-tyres"><div><span>FRONT</span><b id="gpFrontTemp">—</b><small id="gpFrontLife">—</small></div><div><span>REAR</span><b id="gpRearTemp">—</b><small id="gpRearLife">—</small></div></div>
      <div class="gp-rider"><span id="gpRiderState">RIDING</span><span id="gpTuck">TUCK 0%</span><b id="gpElectronics" title="Combined traction and wheelie control intervention">TC/WC 0%</b></div>`;
    const heading = document.createElement('div');
    heading.className = 'gp-heading';
    heading.innerHTML = '<span id="gpSeries">GP / LIVE</span><b id="gpMachine">MOTORCYCLE</b>';
    const cluster = hud.querySelector('.instruments')!;
    cluster.prepend(heading);
    cluster.append(feedback);
    hud.append(style);
    for (const node of [
      ...feedback.querySelectorAll<HTMLElement>('[id]'),
      ...heading.querySelectorAll<HTMLElement>('[id]'),
    ])
      this.nodes[node.id] = node;
    this.nodes.gpWordmark = hud.querySelector('.f1-wordmark')!;
    hud.dataset.bike = 'false';
  }
  update(frame: Float32Array) {
    // MX has its own jump/landing status stack and tested instrument layout.
    // Keeping this flag exclusive prevents the GP stylesheet from replacing
    // that cluster or showing a second motorcycle telemetry panel.
    const readout = this.hud.dataset.motocross === 'true' ? null : bikeReadout(frame);
    const active = String(readout !== null);
    if (this.hud.dataset.bike !== active) {
      this.hud.dataset.bike = active;
      const labels = this.hud.querySelectorAll<HTMLElement>('#tires > div > label');
      labels.forEach((node, i) => {
        node.textContent = readout
          ? ['FRONT', 'FRONT', 'REAR', 'REAR'][i]
          : ['FR', 'FL', 'RR', 'RL'][i];
      });
      this.hud.querySelector('[data-touch="brake"]')!.textContent = readout
        ? 'FRONT BRAKE'
        : 'BRAKE';
      if (!readout) this.nodes.gpWordmark.textContent = 'APEX';
      for (const side of ['Left', 'Right'])
        this.hud.querySelector(`#proximity${side} > span`)!.textContent =
          `${readout ? 'RIDER' : 'CAR'} ${side.toUpperCase()}`;
    }
    if (!readout) return;
    const set = (id: string, text: string) => {
      if (this.nodes[id].textContent !== text) this.nodes[id].textContent = text;
    };
    set('gpMachine', readout.name);
    set('gpSeries', `${readout.discipline} / LIVE`);
    set('gpWordmark', readout.discipline);
    set(
      'gpLean',
      `${readout.lean > 0 ? 'L ' : readout.lean < 0 ? 'R ' : ''}${Math.abs(readout.lean)}°`,
    );
    this.nodes.gpLeanMarker.style.left = `${50 - (readout.lean / 90) * 46}%`;
    set('gpRearBrake', `${readout.rearBrake}%`);
    this.nodes.gpRearBrakeBar.style.width = `${readout.rearBrake}%`;
    for (const [key, tyre] of [
      ['Front', readout.front],
      ['Rear', readout.rear],
    ] as const) {
      set(`gp${key}Temp`, `${tyre.temperature}°C`);
      set(`gp${key}Life`, tyre.punctured ? 'PUNCTURE' : `${tyre.life}% LIFE`);
      this.nodes[`gp${key}Life`].dataset.punctured = String(tyre.punctured);
    }
    set('gpRiderState', readout.state);
    set('gpTuck', `TUCK ${readout.tuck}%`);
    set('gpElectronics', `TC/WC ${readout.intervention}%`);
    this.nodes.gpElectronics.dataset.active = String(readout.intervention > 0);
  }
}
