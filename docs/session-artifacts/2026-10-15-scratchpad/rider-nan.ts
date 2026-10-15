const root = '/home/user/Experiment-3/.claude/worktrees/agent-a726b8c5722e56270';
const T = await import('/home/user/Experiment-3/node_modules/three/build/three.module.js');
const { Rider } = await import(root + '/src/rendering/rider.ts');
const rider = new Rider({ primary: 0xff0000, secondary: 0x111111, accent: 0xffffff }, 'high');
for (const [lean, offset, steer] of [
  [0, 0, 0],
  [0.58, 0.28, 0.02],
  [-0.6, -0.28, -0.03],
]) {
  rider.ride({ lean, offset, tuck: 0, braking: 0, steer });
  rider.root.updateMatrixWorld(true);
  let bad = 0;
  const box = new T.Box3().setFromObject(rider.root);
  rider.root.traverse((o: any) => {
    if (o.isMesh && !o.matrixWorld.elements.every(Number.isFinite)) bad++;
  });
  console.log(lean, offset, 'nonfinite meshes', bad, 'box', box.min.toArray().map((x) => x.toFixed(2)), box.max.toArray().map((x) => x.toFixed(2)));
}
