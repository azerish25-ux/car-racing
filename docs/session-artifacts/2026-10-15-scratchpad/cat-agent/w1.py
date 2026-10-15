import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')
p = 'src/rendering/vehicle-bodies/wheel.ts'
s = open(p).read()
start = s.index('function rimGeometry(')
end = s.index('export class WheelAssembly')
new = open('/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/cat-agent/w1.ts.part').read()
s = s[:start] + new + s[end:]
open(p, 'w').write(s)
