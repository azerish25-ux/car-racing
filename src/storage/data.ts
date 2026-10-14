import {
  DEFAULT_DRIVING_AUDIO,
  validateDrivingAudio,
  type DrivingAudioSettings,
} from '../audio/driving-cues.ts';
import {
  defaultButtonActions,
  validateButtonActions,
  type ButtonActions,
} from '../input/button-actions.ts';
import { DEFAULT_BINDINGS, validateBindings, type Bindings } from '../input/bindings.ts';
import {
  emptyCalibration,
  validateCalibration,
  validateDevice,
  type CalibrationSet,
  type DeviceSelection,
} from '../input/calibration.ts';
import { clamp } from '../core/math.ts';
import { DEFAULT_SETUP, validateSetup, type Setup } from '../simulation/config.ts';
import {
  graphicsPreset,
  validateGraphics,
  type GraphicsOptions,
  type Quality,
} from '../rendering/options.ts';
export interface InputMapping {
  buttonActions: ButtonActions;
  device: DeviceSelection | null;
  wheelSteering: boolean;
  saturation: number;
  calibration: CalibrationSet;
  clutchAxis: number;
  clutchButton: number;
  manualClutch: boolean;
  shiftUpButton: number;
  shiftDownButton: number;
  steerAxis: number;
  throttleAxis: number;
  brakeAxis: number;
  throttleButton: number;
  brakeButton: number;
  axisPedals: boolean;
  invertSteer: boolean;
  invertPedals: boolean;
  deadzone: number;
  exponent: number;
}
export interface Settings {
  version: 6;
  graphics: GraphicsOptions;
  colorblind: boolean;
  highContrast: boolean;
  /** Skip race-day briefing/preparation on ordinary race entry. */
  quickStart: boolean;
  quality: Quality;
  volume: number;
  drivingAudio: DrivingAudioSettings;
  shake: number;
  uiScale: number;
  mapping: InputMapping;
  setup: Setup;
  bindings: Bindings;
}
export const DEFAULT_SETTINGS: Settings = {
  version: 6,
  graphics: graphicsPreset('medium'),
  colorblind: false,
  highContrast: false,
  quickStart: false,
  quality: 'medium',
  volume: 0.45,
  drivingAudio: { ...DEFAULT_DRIVING_AUDIO },
  shake: 0.35,
  uiScale: 1,
  mapping: {
    buttonActions: defaultButtonActions(true),
    device: null,
    wheelSteering: false,
    saturation: 1,
    calibration: emptyCalibration(),
    clutchAxis: -1,
    clutchButton: -1,
    manualClutch: false,
    shiftUpButton: 5,
    shiftDownButton: 4,
    steerAxis: 0,
    throttleAxis: 2,
    brakeAxis: 5,
    throttleButton: 7,
    brakeButton: 6,
    axisPedals: false,
    invertSteer: false,
    invertPedals: false,
    deadzone: 0.08,
    exponent: 1.5,
  },
  setup: { ...DEFAULT_SETUP },
  bindings: { ...DEFAULT_BINDINGS },
};
export function validateSettings(v: unknown): Settings {
  if (!v || typeof v !== 'object') throw new Error('Settings data must be an object');
  const p = v as Partial<Settings>;
  const version = (v as { version: number }).version;
  if (![1, 2, 3, 4, 5, 6].includes(version)) throw new Error('Unsupported settings version');
  const finite = (x: unknown, f: number, a: number, b: number) =>
    typeof x === 'number' && Number.isFinite(x) ? clamp(x, a, b) : f;
  const m = p.mapping ?? DEFAULT_SETTINGS.mapping;
  const bindings = validateBindings(p.bindings);
  const quality = p.quality === 'low' || p.quality === 'high' ? p.quality : 'medium';
  const result: Settings = {
    version: 6,
    graphics: validateGraphics(version >= 4 ? p.graphics : undefined, quality),
    colorblind: p.colorblind === true,
    highContrast: p.highContrast === true,
    quickStart: p.quickStart === true,
    quality,
    volume: finite(p.volume, 0.45, 0, 1),
    drivingAudio: validateDrivingAudio(p.drivingAudio),
    shake: finite(p.shake, 0.35, 0, 1),
    uiScale: finite(p.uiScale, 1, 0.8, 1.35),
    setup: validateSetup(p.setup ?? DEFAULT_SETUP),
    bindings,
    mapping: {
      buttonActions: defaultButtonActions(),
      device: validateDevice(m.device),
      wheelSteering: !!m.wheelSteering,
      saturation: finite(m.saturation, 1, 0.5, 1),
      calibration: validateCalibration(m.calibration),
      clutchAxis: Math.round(finite(m.clutchAxis, -1, -1, 31)),
      clutchButton: Math.round(finite(m.clutchButton, -1, -1, 127)),
      manualClutch: !!m.manualClutch,
      shiftUpButton: Math.round(finite(m.shiftUpButton, 5, -1, 127)),
      shiftDownButton: Math.round(finite(m.shiftDownButton, 4, -1, 127)),
      steerAxis: Math.round(finite(m.steerAxis, 0, 0, 31)),
      throttleAxis: Math.round(finite(m.throttleAxis, 2, 0, 31)),
      brakeAxis: Math.round(finite(m.brakeAxis, 5, 0, 31)),
      throttleButton: Math.round(finite(m.throttleButton, 7, -1, 127)),
      brakeButton: Math.round(finite(m.brakeButton, 6, -1, 127)),
      axisPedals: !!m.axisPedals,
      invertSteer: !!m.invertSteer,
      invertPedals: !!m.invertPedals,
      deadzone: finite(m.deadzone, 0.08, 0, 0.35),
      exponent: finite(m.exponent, 1.5, 0.5, 3),
    },
  };
  result.mapping.buttonActions = validateButtonActions(
    version === 5 &&
      m.buttonActions &&
      typeof m.buttonActions === 'object' &&
      !Array.isArray(m.buttonActions)
      ? {
          ...m.buttonActions,
          reverse: m.buttonActions.reverse === undefined ? -1 : m.buttonActions.reverse,
        }
      : m.buttonActions,
    result.mapping,
    version < 5,
  );
  return result;
}
export class SaveStore {
  private db: Promise<IDBDatabase> | null = null;
  private open() {
    return (this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('IndexedDB unavailable; settings will last for this session only.'));
        return;
      }
      const request = indexedDB.open('apex-formula', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saved');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.db = null;
        reject(request.error ?? new Error('Storage unavailable'));
      };
      request.onblocked = () => reject(new Error('Close older APEX tabs to update local storage.'));
    }));
  }
  async read(key: string): Promise<unknown> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('saved', 'readonly'),
        r = tx.objectStore('saved').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  /** Keep the previous value as `key:backup` and write the new one in the
   * same transaction: an interrupted save leaves either the old pair or the
   * new pair, never a half-written profile without a recovery copy. */
  async writeWithBackup(key: string, value: unknown) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('saved', 'readwrite'),
        store = tx.objectStore('saved'),
        previous = store.get(key);
      previous.onsuccess = () => {
        if (previous.result !== undefined) store.put(previous.result, backupKey(key));
        store.put(value, key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Save aborted'));
    });
  }
  /** Read `key`, falling back to its backup when the primary is unusable. */
  async readRecovered<T>(key: string, validate: (value: unknown) => T | null) {
    const primary = await this.read(key);
    const needsBackup = (() => {
      try {
        return primary === undefined || validate(primary) === null;
      } catch {
        return true;
      }
    })();
    return recoverSave(
      primary,
      needsBackup ? await this.read(backupKey(key)) : undefined,
      validate,
    );
  }
  async write(key: string, value: unknown) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('saved', 'readwrite');
      tx.objectStore('saved').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Save aborted'));
    });
  }
}
/** Choose a usable save (WP24 / D099): the primary when it validates, else
 * the backup written before the last overwrite. `validate` may throw or
 * return null for unusable data. Never invents progress. */
export function recoverSave<T>(
  primary: unknown,
  backup: unknown,
  validate: (value: unknown) => T | null,
): { value: T | null; recovered: boolean; reason: string | null } {
  const attempt = (value: unknown): [T | null, string | null] => {
    if (value === undefined || value === null) return [null, 'missing'];
    try {
      const result = validate(value);
      return result === null ? [null, 'invalid'] : [result, null];
    } catch (error) {
      return [null, error instanceof Error ? error.message : String(error)];
    }
  };
  const [main, reason] = attempt(primary);
  if (main !== null) return { value: main, recovered: false, reason: null };
  const [old] = attempt(backup);
  return { value: old, recovered: old !== null, reason: primary === undefined ? null : reason };
}
export const backupKey = (key: string) => `${key}:backup`;
export function downloadBlob(data: Blob, name: string) {
  const url = URL.createObjectURL(data),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
