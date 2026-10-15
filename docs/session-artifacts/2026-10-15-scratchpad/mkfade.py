import os, shutil, sys
S = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad'
for length in sys.argv[1:]:
    d = os.path.join(S, 'fade' + length)
    if os.path.exists(d):
        shutil.rmtree(d)
    shutil.copytree(os.path.join(S, 'merged'), d)
    for probe in ['wetfollow.ts', 'seeds.ts']:
        shutil.copy(os.path.join(S, 'midfield', probe), os.path.join(d, 'scripts', probe))
    p = os.path.join(d, 'src/simulation/ai.ts')
    s = open(p).read()
    a = 'export const LAUNCH_MERGE_LENGTH = 12;'
    assert a in s
    open(p, 'w').write(s.replace(a, 'export const LAUNCH_MERGE_LENGTH = %s;' % length))
    print(d)
