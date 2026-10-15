import os, shutil, sys
src_root = '/home/user/Experiment-3/.claude/worktrees/wf_d5758f75-0bc-1'
base = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/wetfollow-d575'
for v in sys.argv[1:]:
    d = os.path.join(base, 'L' + v)
    if os.path.exists(d):
        shutil.rmtree(d)
    os.makedirs(d)
    shutil.copytree(os.path.join(src_root, 'src'), os.path.join(d, 'src'))
    shutil.copy(os.path.join(src_root, 'package.json'), d)
    os.symlink('/home/user/Experiment-3/node_modules', os.path.join(d, 'node_modules'))
    p = os.path.join(d, 'src/simulation/ai.ts')
    s = open(p).read()
    old = 'export const LAUNCH_MERGE_LENGTH = 50;'
    assert old in s
    open(p, 'w').write(s.replace(old, 'export const LAUNCH_MERGE_LENGTH = %s;' % v))
    print('made', d)
