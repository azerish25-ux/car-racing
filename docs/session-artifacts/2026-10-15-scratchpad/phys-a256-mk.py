"""Fresh, uniquely named probe trees (src + scripts only) from the physics
worktree, with optional launch-merge lengths. Refuses to touch a directory
that is not one of ours (has a .git entry or lacks our marker)."""
import os, shutil, sys
S = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad'
WORK = '/home/user/Experiment-3/.claude/worktrees/agent-a256258307a3455a8'
MARK = '.phys-a256-probe'
probes = sys.argv[1].split(',')
for length in sys.argv[2:]:
    d = os.path.join(S, 'phys-a256-L' + length)
    if os.path.exists(d):
        if os.path.exists(os.path.join(d, '.git')) or not os.path.exists(os.path.join(d, MARK)):
            raise SystemExit('refusing to replace ' + d)
        shutil.rmtree(d)
    os.makedirs(os.path.join(d, 'scripts'))
    open(os.path.join(d, MARK), 'w').write('probe tree of the physics agent\n')
    shutil.copytree(os.path.join(WORK, 'src'), os.path.join(d, 'src'))
    for p in probes:
        shutil.copy(os.path.join(S, 'midfield', p), os.path.join(d, 'scripts', p))
    ai = os.path.join(d, 'src/simulation/ai.ts')
    s = open(ai).read()
    a = 'export const LAUNCH_MERGE_LENGTH = 50;'
    assert a in s
    open(ai, 'w').write(s.replace(a, 'export const LAUNCH_MERGE_LENGTH = %s;' % length))
    print(d)
