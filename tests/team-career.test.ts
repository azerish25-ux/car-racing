import { foundingBriefing } from '../src/storage/team-career.ts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import {
  capacity,
  changeTeam,
  newTeam,
  researchSetup,
  rewardRace,
  validateTeam,
  weeklyBudget,
  type TeamState,
} from '../src/storage/team-career.ts';
const classified = {
  session: 'race-1',
  position: 2,
  cars: 8,
  classified: true,
  demonstration: false,
  penalties: 0,
};
describe('persistent original team transactions', () => {
  it('is immutable and books exactly the displayed weekly income and costs', () => {
    const team = newTeam(),
      old = structuredClone(team),
      budget = weeklyBudget(team);
    const next = changeTeam(team, { type: 'week' });
    expect(team).toEqual(old);
    expect(next.week).toBe(2);
    expect(next.balance).toBe(team.balance + budget.net);
    expect(next.ledger.slice(-3).map((x) => x.amount)).toEqual([
      budget.income,
      -budget.payroll,
      -budget.overhead,
    ]);
  });
  it('cannot complete an insolvent transaction or mutate the original on failure', () => {
    const team = { ...newTeam(), balance: 10 },
      old = structuredClone(team);
    expect(() => changeTeam(team, { type: 'research', id: 'aero' })).toThrow('Insufficient');
    expect(() => changeTeam(team, { type: 'driver', id: 'sato' })).toThrow('Insufficient');
    expect(team).toEqual(old);
  });
  it('enforces workforce limits and charges hiring/reassignment once', () => {
    let team = newTeam();
    team = changeTeam(team, { type: 'staff', department: 'engineering', delta: 2 });
    expect(team.workforce.engineering).toBe(10);
    expect(team.balance).toBe(157600);
    team = changeTeam(team, { type: 'staff', department: 'engineering', delta: 2 });
    expect(team.workforce.engineering).toBe(capacity(team, 'engineering'));
    expect(() => changeTeam(team, { type: 'staff', department: 'engineering', delta: 2 })).toThrow(
      'limit',
    );
    const next = changeTeam(team, { type: 'staff', department: 'engineering', delta: -2 });
    expect(next.balance).toBe(team.balance - 600);
    expect(() =>
      changeTeam(team, { type: 'staff', department: 'engineering', delta: 200 }),
    ).toThrow();
  });
  it('makes facility capacity, overhead and commercial staffing consequential', () => {
    const team = newTeam(),
      upgraded = changeTeam(team, { type: 'facility', department: 'commercial' });
    expect(upgraded.balance).toBe(team.balance - 26000);
    expect(capacity(upgraded, 'commercial')).toBe(20);
    expect(weeklyBudget(upgraded).overhead).toBe(weeklyBudget(team).overhead + 1700);
    const staffed = changeTeam(upgraded, { type: 'staff', department: 'commercial', delta: 2 });
    expect(weeklyBudget(staffed).income).toBe(weeklyBudget(upgraded).income + 3000);
  });
  it('unlocks a real setup only after research completes', () => {
    const team = newTeam();
    expect(() => researchSetup(team, 'traction')).toThrow('Complete');
    let next = changeTeam(team, { type: 'research', id: 'traction' });
    expect(next.balance).toBe(team.balance - 22000);
    expect(() => changeTeam(next, { type: 'research', id: 'aero' })).toThrow('active');
    next = changeTeam(next, { type: 'week' });
    expect(next.research[0].remaining).toBe(1);
    expect(() => researchSetup(next, 'traction')).toThrow('Complete');
    next = changeTeam(next, { type: 'week' });
    const setup = researchSetup(next, 'traction');
    expect(setup.diffPower).toBe(0.34);
    expect(setup.rearARB).toBe(16500);
    expect(setup.frontSpring).toBe(DEFAULT_SETUP.frontSpring);
    expect(() => changeTeam(next, { type: 'research', id: 'traction' })).toThrow('already');
    expect(next.briefing).toContain('completed');
  });
  it('accelerates active study progress only at the declared staffing threshold', () => {
    const team = newTeam();
    team.facilities.engineering = 2;
    team.workforce.engineering = 16;
    const next = changeTeam(changeTeam(team, { type: 'research', id: 'aero' }), { type: 'week' });
    expect(next.research[0].remaining).toBe(1);
  });
  it('signs an original driver, updates the race number and pays the agreed fee', () => {
    const team = newTeam(),
      next = changeTeam(team, { type: 'driver', id: 'sato' });
    expect(next.driver).toBe('sato');
    expect(next.livery.number).toBe(24);
    expect(next.balance).toBe(team.balance - 17000);
    expect(weeklyBudget(next).payroll - weeklyBudget(team).payroll).toBe(2000);
    expect(() => changeTeam(next, { type: 'driver', id: 'sato' })).toThrow('already');
  });
  it('credits a classified human race once and updates local rivalry/briefing', () => {
    const team = newTeam(),
      next = rewardRace(team, classified);
    expect(next.points).toBe(18);
    expect(next.rounds).toBe(1);
    expect(next.reputation).toBe(16);
    expect(next.balance).toBe(180000);
    expect(next.briefing).toContain('P2');
    expect(rewardRace(next, classified)).toBe(next);
  });
  it.each([
    { demonstration: true },
    { classified: false },
    { cars: 1 },
    { cars: 13 },
    { position: 0 },
    { position: 9 },
    { penalties: NaN },
    { session: '' },
  ])('does not reward invalid or unearned result %j', (overrides) => {
    const team = newTeam();
    expect(rewardRace(team, { ...classified, ...overrides })).toBe(team);
  });
  it('retains bounded ledgers and session keys and validates saved fields', () => {
    let team = newTeam();
    for (let i = 0; i < 150; i++) team = rewardRace(team, { ...classified, session: `round-${i}` });
    expect(team.ledger).toHaveLength(48);
    expect(team.paidSessions).toHaveLength(100);
    const recovered = validateTeam({
      ...team,
      balance: -999,
      workforce: { engineering: 1e8 },
      facilities: { engineering: 99 },
      driver: 'untrusted',
      livery: { sponsor: '<img src=x>' },
    });
    expect(recovered.balance).toBe(0);
    expect(recovered.workforce.engineering).toBe(36);
    expect(recovered.driver).toBe('river');
    expect(recovered.livery.sponsor).not.toContain('<');
    expect(() => validateTeam({ version: 99 })).toThrow('version');
    expect(validateTeam(null)).toEqual(newTeam());
  });
  it('can round-trip every valid field without altering the next transaction', () => {
    let team = newTeam();
    team = changeTeam(team, { type: 'research', id: 'rain' });
    team = changeTeam(team, { type: 'driver', id: 'vale' });
    const roundtrip = validateTeam(JSON.parse(JSON.stringify(team)) as TeamState);
    expect(roundtrip).toEqual(team);
    expect(changeTeam(roundtrip, { type: 'week' })).toEqual(changeTeam(team, { type: 'week' }));
  });
  it('escapes corrupted briefing and ledger strings at the HTML boundary', async () => {
    const { teamHub } = await import('../src/ui/team-hub.ts');
    const team = newTeam();
    team.briefing = '<img src=x onerror=alert(1)>';
    team.ledger[0].label = '<script>bad</script>';
    expect(teamHub(team, 'overview')).not.toContain('<img');
    expect(teamHub(team, 'finance')).not.toContain('<script>');
  });
});

describe('F11 data-driven onboarding text', () => {
  it('names every registered circuit instead of a stale count', () => {
    expect(foundingBriefing()).toBe(
      'A new team. 2 circuits: Aurel and Vellamar. Earn your first classified finish.',
    );
    expect(foundingBriefing(['AUREL'])).toMatch(/One circuit: Aurel\./);
  });
});
