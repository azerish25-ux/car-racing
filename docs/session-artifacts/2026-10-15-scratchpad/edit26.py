p='src/ui/interface.ts'
s=open(p).read()
def rep(old,new):
    global s
    assert s.count(old)==1, (s.count(old), old[:70])
    s=s.replace(old,new,1)
rep("""import { type RacingRenderer } from '../rendering/renderer.ts';""","""import { type RacingRenderer } from '../rendering/renderer.ts';
import { OffroadHud } from './offroad-hud.ts';""")
rep("""    this.hud = this.get('hud');
""","""    this.hud = this.get('hud');
    this.offroadHud = new OffroadHud(this.hud);
""")
rep("""  readonly hud: HTMLElement;""","""  readonly hud: HTMLElement;
  /** Terrain venues: gate, holeshot, joker and stage readout (WP42). */
  private readonly offroadHud: OffroadHud;""")
rep("""    this.setText('cameraLabel', renderer.mode.toUpperCase());
    this.setText('health',""","""    this.setText('cameraLabel', renderer.mode.toUpperCase());
    this.offroadHud.update(frame, this.track, this.options);
    this.setText('health',""")
open(p,'w').write(s)
