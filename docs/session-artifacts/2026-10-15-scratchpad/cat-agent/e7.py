import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')


def rep(p, old, new, count=1):
    s = open(p).read()
    assert s.count(old) == count, (p, old, s.count(old))
    s = s.replace(old, new)
    open(p, 'w').write(s)


a = 'src/simulation/ai.ts'
rep(a, """    const width = 1 - 0.45 * wetness;""",
    """    // A wider or less agile machine keeps further from the edges (its envelope's
    // lineScale; absent: the full line).
    const width = (1 - 0.45 * wetness) * (c.definition.ai.lineScale ?? 1);""")
rep(a, """    let lookahead = clamp(6 + c.speed * 0.48, 8, 46);""",
    """    const preview = c.definition.ai.lookahead;
    let lookahead = clamp((preview?.[0] ?? 6) + c.speed * (preview?.[1] ?? 0.48), 8, 46);""")
v = 'src/simulation/vehicles.ts'
rep(v, """  /** Downforce reference (N at unit normalization) divided by mass at runtime. */
  downforceReference: number;
}""", """  /** Downforce reference (N at unit normalization) divided by mass at runtime. */
  downforceReference: number;
  /** Share of the racing line's lateral offset this machine uses (1 = all). */
  lineScale?: number;
  /** Steering preview distance base (m) and per m/s; absent: 6 + 0.48 v. */
  lookahead?: readonly [number, number];
}""")
