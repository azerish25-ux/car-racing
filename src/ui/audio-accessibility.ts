import { validateDrivingAudio, type DrivingAudioSettings } from '../audio/driving-cues.ts';
const switches = [
  ['enabled', 'Enable live driving tones (off by default)'],
  ['brake', 'Braking advisory'],
  ['turns', 'Stereo turn direction'],
  ['gears', 'Upshift / downshift'],
  ['trackLimits', 'Track-limit warning'],
  ['wrongWay', 'Wrong-way warning'],
  ['invertStereo', 'Invert left / right stereo'],
] as const;
export function audioAccessibility(value: DrivingAudioSettings) {
  const settings = validateDrivingAudio(value);
  return `<fieldset class="audio-accessibility"><legend>AUDIO DRIVING CUES</legend>${switches.map(([key, label]) => `<label class="check"><input type="checkbox" name="cue_${key}" ${settings[key] ? 'checked' : ''}>${label}</label>`).join('')}<label class="range-row">Cue volume<output>${settings.volume}</output><input type="range" name="cue_volume" min="0" max="1" step="0.01" value="${settings.volume}"></label><label class="range-row">Turn lookahead (metres)<output>${settings.lookahead}</output><input type="range" name="cue_lookahead" min="8" max="80" step="1" value="${settings.lookahead}"></label><button type="button" id="previewDrivingAudio">PREVIEW LEFT / BRAKE / RIGHT</button><p class="small-note">Preview uses these unsaved volume/stereo values. Apply to retain them. Tones never steer, brake, shift or award laps. Live human driving only: silent in replay, AI demonstration, pit service, pause and hidden tabs. Geometric guidance is advisory, not blind-driving certification.</p></fieldset>`;
}
export function readDrivingAudio(form: HTMLFormElement): DrivingAudioSettings {
  const row: Record<string, unknown> = {};
  for (const [key] of switches)
    row[key] = (form.elements.namedItem(`cue_${key}`) as HTMLInputElement).checked;
  for (const key of ['volume', 'lookahead'])
    row[key] = Number((form.elements.namedItem(`cue_${key}`) as HTMLInputElement).value);
  return validateDrivingAudio(row);
}
