import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')


def rep(p, old, new, count=1):
    s = open(p).read()
    assert s.count(old) == count, (p, old, s.count(old))
    s = s.replace(old, new)
    open(p, 'w').write(s)


r = 'src/rendering/renderer.ts'
rep(r, """import { TouringShells } from './touring-shell.ts';""",
    """import { VehicleBodies } from './vehicle-bodies/index.ts';""")
rep(r, """  readonly touringShells = new TouringShells();""",
    """  /** Procedural exteriors of non-Formula definitions (WP30). */
  readonly vehicleBodies = new VehicleBodies();""")
rep(r, """    this.scene.add(this.debris.mesh, this.pitCrew.root, this.touringShells.root);""",
    """    this.scene.add(this.debris.mesh, this.pitCrew.root, this.vehicleBodies.root);
    // Catalogue bodies get the same material installers as the Formula cars.
    this.vehicleBodies.onBuild = (root) => {
      reflectInWetRoad(root);
      this.weatherPresentation.install(root);
      this.atmosphere.install(root);
      installSpecularIBL(root);
      this.textures.register(root);
    };""")
rep(r, """      ...this.circuit.startFinish.shadowSubstitutes(),
    ];""", """      ...this.circuit.startFinish.shadowSubstitutes(),
      ...this.vehicleBodies.shadowSubstitutes(),
    ];""")
rep(r, """    // Non-Formula definitions are drawn by their own (provisional) bodies.
    this.touringShells?.update(b, this.cars);""",
    """    // Non-Formula definitions are drawn by their own procedural bodies.
    this.vehicleBodies?.update(a, b, alpha, this.cars, illumination !== 'day');""")
