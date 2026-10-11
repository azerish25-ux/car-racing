import {
  BUTTON_ACTIONS,
  BUTTON_ACTION_LABELS,
  defaultButtonActions,
} from '../input/button-actions.ts';
import {
  readAxis,
  selectDevice,
  validatePedal,
  validateSteering,
  emptyCalibration,
} from '../input/calibration.ts';
import type { InputMapping } from '../storage/data.ts';

/** This editor owns its device polling and unsaved captures. Closing/replacing
 * the dialog cancels both, and never changes live input until Apply succeeds. */
export class DeviceCalibrationPanel {
  readonly draft: InputMapping;
  private events = new AbortController();
  private timer: ReturnType<typeof setInterval>;
  private captured = new Map<string, number>();
  private incomplete = new Set<string>();
  private identityList = '';
  private select: HTMLSelectElement;
  private monitor: HTMLOutputElement;
  private status: HTMLElement;
  constructor(
    private root: HTMLElement,
    private form: HTMLFormElement,
    mapping: InputMapping,
  ) {
    this.draft = structuredClone(mapping);
    root.innerHTML = `<h3>Wheel and pedal calibration</h3>
      <p class="small-note">Press any button on your wheel or pedals so the game can detect them, select the device, then capture each axis endpoint below.</p>
      <label>Active input device<select aria-label="Active input device"></select></label>
      <label class="check"><input type="checkbox" name="wheelSteering">Wheel steering: direct calibrated axis, without keyboard ramp</label>
      <label class="check"><input type="checkbox" name="manualClutch">Manual clutch (pedal or keyboard binding)</label>
      <label class="range-row">Steering saturation<input name="saturation" type="number" min="0.5" max="1" step="0.01"></label>
      <output aria-label="Device input monitor" class="small-note" style="display:block;overflow-wrap:anywhere"></output>
      <div class="binding-grid">${[
        ['steering:left', 'STEER LEFT'],
        ['steering:center', 'STEER CENTER'],
        ['steering:right', 'STEER RIGHT'],
        ['throttle:released', 'THROTTLE RELEASED'],
        ['throttle:pressed', 'THROTTLE FULL'],
        ['brake:released', 'BRAKE RELEASED'],
        ['brake:pressed', 'BRAKE FULL'],
        ['clutch:released', 'CLUTCH RELEASED'],
        ['clutch:pressed', 'CLUTCH FULL'],
      ]
        .map(([key, text]) => `<button type="button" data-capture="${key}">${text}</button>`)
        .join('')}</div>
      <p role="status" data-calibration-status class="small-note"></p>
      <button type="button" data-clear-calibration>RESET DEVICE CALIBRATION</button>`;
    this.select = root.querySelector('select')!;
    this.monitor = root.querySelector('output')!;
    this.status = root.querySelector('[data-calibration-status]')!;
    (form.elements.namedItem('wheelSteering') as HTMLInputElement).checked = mapping.wheelSteering;
    (form.elements.namedItem('manualClutch') as HTMLInputElement).checked = mapping.manualClutch;
    (form.elements.namedItem('saturation') as HTMLInputElement).value = String(mapping.saturation);
    this.select.addEventListener(
      'change',
      () => {
        const pad = this.pads().find((p) => p?.index === Number(this.select.value));
        this.draft.device = pad?.connected ? { index: pad.index, id: pad.id } : null;
        this.draft.calibration = emptyCalibration();
        this.captured.clear();
        this.incomplete.clear();
        this.resetLabels();
        // Do not silently impose Xbox button positions on an unmapped wheel.
        if (pad && pad.mapping !== 'standard') {
          for (const name of ['shiftUpButton', 'shiftDownButton'])
            (form.elements.namedItem(name) as HTMLInputElement).value = '-1';
        }
        const buttons = defaultButtonActions(!pad || pad.mapping === 'standard');
        for (const action of BUTTON_ACTIONS) {
          const field = form.elements.namedItem(`action_${action}`) as HTMLInputElement | null;
          if (field) field.value = String(buttons[action]);
        }
        this.status.textContent =
          'Device selected. Captures and action bindings remain unsaved until Apply.';
      },
      { signal: this.events.signal },
    );
    root.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-capture]');
        if (!button) return;
        try {
          this.capture(button);
        } catch (error) {
          this.status.textContent = String(error);
        }
      },
      { signal: this.events.signal },
    );
    root.querySelector('[data-clear-calibration]')!.addEventListener(
      'click',
      () => {
        this.draft.calibration = emptyCalibration();
        this.captured.clear();
        this.incomplete.clear();
        this.resetLabels();
        this.status.textContent = 'Endpoint calibration cleared; numeric mapping still applies.';
      },
      { signal: this.events.signal },
    );
    this.poll();
    this.timer = setInterval(() => this.poll(), 100);
  }
  private pads(): (Gamepad | null)[] {
    try {
      return navigator.getGamepads?.() ?? [];
    } catch (error) {
      this.status.textContent = `Device access unavailable: ${String(error)}`;
      return [];
    }
  }
  private resetLabels() {
    this.root.querySelectorAll<HTMLButtonElement>('[data-capture]').forEach((button) => {
      button.removeAttribute('data-captured');
      button.setAttribute('aria-pressed', 'false');
    });
  }
  private poll() {
    if (!this.root.isConnected) {
      this.dispose();
      return;
    }
    const pads = this.pads();
    const identity = pads
      .filter((p) => p?.connected)
      .map((p) => `${p!.index}:${p!.id}`)
      .join('|');
    if (identity !== this.identityList || !this.select.options.length) {
      this.identityList = identity;
      this.select.replaceChildren(new Option('Automatic standard gamepad / keyboard', '-1'));
      for (const pad of pads)
        if (pad?.connected) {
          this.select.add(
            new Option(
              `${pad.index}: ${pad.id} (${pad.axes.length} axes, ${pad.buttons.length} buttons)`,
              String(pad.index),
            ),
          );
        }
      const selected = this.draft.device;
      if (
        selected &&
        !pads.some((p) => p?.connected && p.index === selected.index && p.id === selected.id)
      )
        this.select.add(new Option(`Disconnected: ${selected.id}`, String(selected.index)));
      this.select.value = String(selected?.index ?? -1);
    }
    const pad = selectDevice(pads, this.draft.device);
    this.monitor.value = pad
      ? `Axes: ${pad.axes.map((v, i) => `${i}=${Number.isFinite(v) ? v.toFixed(3) : 'INVALID'}`).join(' ')} | Pressed buttons: ${
          pad.buttons
            .map((b, i) => (b.pressed ? String(i) : ''))
            .filter(Boolean)
            .join(', ') || 'none'
        }`
      : 'No selected device available. Connect it and press a device button; keyboard remains available.';
  }
  private capture(button: HTMLButtonElement) {
    const pad = selectDevice(this.pads(), this.draft.device);
    if (!pad) throw new Error('Select a connected device before capturing endpoints.');
    const [name, endpoint] = button.dataset.capture!.split(':');
    const field = name === 'steering' ? 'steerAxis' : `${name}Axis`;
    const axis = Number((this.form.elements.namedItem(field) as HTMLInputElement).value);
    const value = readAxis(pad, axis);
    if (value === undefined) throw new Error(`Axis ${axis} is not available on this device.`);
    const key = `${name}:${axis}`;
    this.incomplete.add(name);
    this.captured.set(`${key}:${endpoint}`, value);
    const get = (which: string) => this.captured.get(`${key}:${which}`);
    if (name === 'steering') {
      if (get('left') !== undefined && get('center') !== undefined && get('right') !== undefined)
        this.draft.calibration.steering = validateSteering({
          axis,
          left: get('left'),
          center: get('center'),
          right: get('right'),
        });
    } else {
      if (get('released') !== undefined && get('pressed') !== undefined)
        this.draft.calibration[name as 'throttle' | 'brake' | 'clutch'] = validatePedal({
          axis,
          released: get('released'),
          pressed: get('pressed'),
        });
    }
    if (
      name === 'steering'
        ? get('left') !== undefined && get('center') !== undefined && get('right') !== undefined
        : get('released') !== undefined && get('pressed') !== undefined
    )
      this.incomplete.delete(name);
    button.dataset.captured = value.toFixed(3);
    button.setAttribute('aria-pressed', 'true');
    this.status.textContent = `${name} ${endpoint}: ${value.toFixed(3)} on axis ${axis}. Capture all endpoints, then Apply.`;
  }
  apply(next: InputMapping) {
    if (this.incomplete.size)
      throw new Error(`Finish all endpoint captures for: ${[...this.incomplete].join(', ')}.`);
    next.device = this.draft.device;
    next.calibration = structuredClone(this.draft.calibration);
    for (const name of ['wheelSteering', 'manualClutch'] as const)
      next[name] = (this.form.elements.namedItem(name) as HTMLInputElement).checked;
    next.saturation = Number(
      (this.form.elements.namedItem('saturation') as HTMLInputElement).value,
    );
    for (const [name, calibration] of Object.entries(next.calibration)) {
      if (!calibration) continue;
      const axis =
        name === 'steering'
          ? next.steerAxis
          : next[`${name}Axis` as 'throttleAxis' | 'brakeAxis' | 'clutchAxis'];
      if (calibration.axis !== axis)
        throw new Error(`${name}: selected axis changed. Reset or recapture its calibration.`);
    }
    const pad = selectDevice(this.pads(), next.device);
    if (pad)
      for (const action of BUTTON_ACTIONS) {
        const field = this.form.elements.namedItem(`action_${action}`) as HTMLInputElement | null;
        if (field && Number(field.value) >= pad.buttons.length)
          throw new Error(
            `${BUTTON_ACTION_LABELS[action]}: selected device has no button ${field.value}.`,
          );
      }
    if (next.shiftDownButton >= 0 && next.shiftDownButton === next.shiftUpButton)
      throw new Error('Upshift and downshift need different buttons.');
  }
  dispose() {
    this.events.abort();
    clearInterval(this.timer);
  }
}
