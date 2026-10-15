import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')


def rep(p, old, new, count=1):
    s = open(p).read()
    assert s.count(old) == count, (p, old, s.count(old))
    s = s.replace(old, new)
    open(p, 'w').write(s)


i = 'src/ui/interface.ts'
s = open(i).read()
start = s.index('/** Per-entry vehicles and the ruleset a MACHINE choice implies (WP22). */')
end = s.index('export class Interface {')
s = s[:start] + """/** Per-entry vehicles and the ruleset a MACHINE choice implies (WP22, WP30). */
export { machineOptions } from './machine-options.ts';
""" + s[end:]
s = s.replace("""import { installRaceDayHud, updateRaceDayHud } from './race-day-hud.ts';""",
              """import { installRaceDayHud, updateRaceDayHud } from './race-day-hud.ts';
import { machineOptions, machineSelectOptions } from './machine-options.ts';""", 1)
old = """<label>MACHINE<select id="vehicle"><option value="apx01" selected>APX-01 Formula</option><option value="tc1">TC-1 Touring · front drive</option><option value="mixed">Mixed exhibition · Formula + Touring</option></select></label>"""
assert s.count(old) == 1
s = s.replace(old, """<label>MACHINE<select id="vehicle">${machineSelectOptions()}</select></label>""")
open(i, 'w').write(s)
