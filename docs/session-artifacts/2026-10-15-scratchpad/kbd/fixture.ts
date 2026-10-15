import { InputController } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/input/controller.ts';
import { DEFAULT_SETTINGS } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/storage/data.ts';
export function mount() {
  const actions: string[] = [];
  const input = new InputController(structuredClone(DEFAULT_SETTINGS), (n) => actions.push(n));
  // As in GameApp.startFestival: enabled for the whole festival, paused or not.
  input.setEnabled(true);
  const menu = document.createElement('div');
  menu.setAttribute('role', 'dialog');
  menu.innerHTML = '<button id="resume">RESUME</button><button id="reset">RESET TO ROAD</button><button id="exit">EXIT FESTIVAL</button>';
  document.body.appendChild(menu);
  let clicked = '';
  menu.addEventListener('click', (e) => (clicked = (e.target as HTMLElement).id));
  (document.getElementById('resume') as HTMLElement).focus();
  (window as any).probe = () => ({ active: document.activeElement?.id, clicked, actions });
}
