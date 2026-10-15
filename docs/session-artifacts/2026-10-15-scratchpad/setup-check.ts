const W = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-2/src';
const { DEFAULT_SETUP } = await import(`${W}/simulation/config.ts`);
const { VEHICLES } = await import(`${W}/simulation/vehicles.ts`);
const S = await import(`${W}/ui/setup-screen.ts`);
let n = 0;
for (const def of Object.values(VEHICLES) as any[]) {
  for (const key of S.setupScreenKeys(def)) {
    const own = def.setupDefaults?.[key];
    if (own === undefined || own === DEFAULT_SETUP[key]) continue;
    const [min, max] = S.setupRange(def, key);
    const d = DEFAULT_SETUP[key];
    if (d < min || d > max) continue;
    const shown = S.setupScreenValues(def, DEFAULT_SETUP);
    const step = S.setupStep(def, key, shown[key]);
    const onGrid = step === 'any' || Math.abs((d - min) / step - Math.round((d - min) / step)) < 1e-6;
    const next = S.applySetupScreen(def, DEFAULT_SETUP, (k: string) => (k === key ? d : shown[k]));
    const after = S.setupScreenValues(def, next)[key];
    // Move away first then pick default
    const moved = { ...DEFAULT_SETUP, [key]: (min + max) / 2 };
    const next2 = S.applySetupScreen(def, moved, (k: string) => (k === key ? d : S.setupScreenValues(def, moved)[k]));
    const after2 = S.setupScreenValues(def, next2)[key];
    if (n++ < 12) console.log(def.id, key, 'own', own, 'shared', d, 'range', min, max, 'step', step, 'onGrid', onGrid, '-> pick shared: shown after save', after, '| from moved: saved', next2[key], 'shown', after2);
  }
}
console.log('cases', n);
