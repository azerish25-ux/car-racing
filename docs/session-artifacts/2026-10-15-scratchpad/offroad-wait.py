import time, os
p='/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/offroad-suite-summary.log'
t0=time.time(); s=''
while time.time()-t0<580:
    s=open(p).read() if os.path.exists(p) else ''
    if 'ALL DONE' in s or ' exit 1' in s or ' exit 2' in s: break
    time.sleep(10)
print(s)
