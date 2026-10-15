import { Interface } from '../../src/ui/interface.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../../src/simulation/config.ts';
import { CareerController } from '../../src/career/controller.ts';
import { loanerVehicle } from '../../src/career/ladder.ts';
import { backupKey } from '../../src/storage/data.ts';

/** Production Interface and career screens with an in-memory save store; no
 * renderer, worker or session. Session starts are logged, not run. */
export function mountCareerHub() {
  const root = document.createElement('main');
  root.id = 'app';
  document.body.replaceChildren(root);
  const events = document.createElement('output');
  events.id = 'careerEvents';
  events.hidden = true;
  document.body.append(events);
  const record = (value: string) => {
    events.textContent += `${value};`;
  };
  const data = new Map<string, unknown>();
  const track = new Simulation(DEFAULT_OPTIONS).track;
  let career: CareerController | null = null;
  const ui: Interface = new Interface(root, track, {
    action: (name) => {
      record(name);
      if (name === 'career' || name.startsWith('career:')) career?.action(name);
      if (name === 'modalClose') ui.closeModal();
    },
    start: (options) => record(`menuStart:${options.mode}`),
    apply: () => {},
    seek: () => {},
    replaySpeed: () => {},
    exportSetup: () => {},
    importSetup: () => {},
  });
  career = new CareerController({
    store: {
      async read(key) {
        return structuredClone(data.get(key));
      },
      async write(key, value) {
        data.set(key, structuredClone(value));
      },
      async writeWithBackup(key, value) {
        if (data.has(key)) data.set(backupKey(key), data.get(key));
        data.set(key, structuredClone(value));
      },
    },
    modal: (html) => ui.modalContent(html),
    modalRoot: () => ui.get('modalContent'),
    toast: (message) => ui.toast(message),
    setResultsExtra: () => {},
    start: (options, session) =>
      record(
        `start:${options.mode}:${options.vehicles?.[0]}:${session.kind}:${options.opponents + 1}`,
      ),
    pause: () => {},
    state: () => 'menu',
    track: () => track,
    setup: () => ({ ...DEFAULT_SETUP }),
    assist: () => 'sport',
  });
  // The machine licences and the club meeting lend: the cheapest car of the
  // lowest circuit tier in whatever catalogue this build registers.
  events.dataset.loaner = loanerVehicle(career.registry, 'circuit-cars')?.id ?? '';
  void career.load({});
  ui.ready();
  ui.showMode('menu');
}
