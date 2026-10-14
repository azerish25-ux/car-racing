import { CIRCUITS, CIRCUIT_IDS } from '../simulation/circuits.ts';
import { DEFAULT_SETUP, validateSetup, type Setup } from '../simulation/config.ts';
import { DEFAULT_LIVERY, validateLivery, type Livery } from './livery.ts';
export const DEPARTMENTS = ['engineering', 'operations', 'commercial'] as const;
export type Department = (typeof DEPARTMENTS)[number];
export const DRIVERS = [
  {
    id: 'river',
    name: 'Alex River',
    number: 7,
    salary: 6500,
    style: 'Balanced',
    detail: 'A measured approach to changing conditions.',
  },
  {
    id: 'sato',
    name: 'Mika Sato',
    number: 24,
    salary: 8500,
    style: 'Precision',
    detail: 'A qualifying specialist who values a stable front end.',
  },
  {
    id: 'vale',
    name: 'Robin Vale',
    number: 61,
    salary: 7000,
    style: 'Endurance',
    detail: 'Patient in traffic. Protective of tires and machinery.',
  },
  {
    id: 'mercer',
    name: 'Jules Mercer',
    number: 88,
    salary: 11000,
    style: 'Veteran',
    detail: 'An experienced original driver profile, not a licensed icon.',
  },
] as const;
export type DriverId = (typeof DRIVERS)[number]['id'];
export const RESEARCH = [
  {
    id: 'traction',
    name: 'Traction study',
    cost: 22000,
    weeks: 2,
    note: 'Unlocks a starting setup: a gentler power differential and softer rear anti-roll bar.',
    setup: { diffPower: 0.34, rearARB: 16500 },
  },
  {
    id: 'aero',
    name: 'High-downforce study',
    cost: 28000,
    weeks: 3,
    note: 'Unlocks a setup preset with more wing. Extra grip has a drag cost in the existing physics.',
    setup: { frontWing: 0.7, rearWing: 0.74 },
  },
  {
    id: 'rain',
    name: 'Wet-weather study',
    cost: 24000,
    weeks: 2,
    note: 'Unlocks a raised, softer setup. Select wet tires separately for standing water.',
    setup: {
      frontRide: 0.085,
      rearRide: 0.095,
      frontSpring: 98000,
      rearSpring: 106000,
      diffPower: 0.3,
    },
  },
] as const;
export type ResearchId = (typeof RESEARCH)[number]['id'];
export interface TeamState {
  version: 1;
  week: number;
  balance: number;
  workforce: Record<Department, number>;
  facilities: Record<Department, number>;
  driver: DriverId;
  reputation: number;
  points: number;
  rivalPoints: number;
  rounds: number;
  research: { id: ResearchId; remaining: number }[];
  ledger: { week: number; label: string; amount: number }[];
  paidSessions: string[];
  livery: Livery;
  briefing: string;
}
/** Onboarding text is derived from the content registry (F11), so it cannot
 * drift behind the circuits that actually exist. */
export function foundingBriefing(
  circuits: readonly string[] = CIRCUIT_IDS.map((id) => CIRCUITS[id].short),
) {
  const names = circuits.map((n) => n.charAt(0) + n.slice(1).toLowerCase());
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
  return `A new team. ${names.length === 1 ? 'One circuit' : `${names.length} circuits`}: ${list}. Earn your first classified finish.`;
}
export function newTeam(): TeamState {
  return {
    version: 1,
    week: 1,
    balance: 160000,
    workforce: { engineering: 8, operations: 6, commercial: 4 },
    facilities: { engineering: 1, operations: 1, commercial: 1 },
    driver: 'river',
    reputation: 12,
    points: 0,
    rivalPoints: 0,
    rounds: 0,
    research: [],
    ledger: [{ week: 1, label: 'Founding budget', amount: 160000 }],
    paidSessions: [],
    livery: { ...DEFAULT_LIVERY },
    briefing: foundingBriefing(),
  };
}
function integer(v: unknown, fallback: number, min: number, max: number) {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(min, Math.min(max, Math.round(v)))
    : fallback;
}
/** Load only bounded known fields. A corrupt save cannot create negative costs or arbitrary setup keys. */
export function validateTeam(value: unknown): TeamState {
  const base = newTeam();
  if (!value || typeof value !== 'object') return base;
  const p = value as Partial<TeamState>;
  if (p.version !== 1) throw new Error('Unsupported team save version');
  base.week = integer(p.week, 1, 1, 10000);
  base.balance = integer(p.balance, 160000, 0, 1e9);
  base.reputation = integer(p.reputation, 12, 0, 100);
  base.points = integer(p.points, 0, 0, 1e7);
  base.rivalPoints = integer(p.rivalPoints, 0, 0, 1e7);
  base.rounds = integer(p.rounds, 0, 0, 100000);
  for (const d of DEPARTMENTS) {
    base.facilities[d] = integer(p.facilities?.[d], 1, 1, 4);
    base.workforce[d] = integer(p.workforce?.[d], base.workforce[d], 2, capacity(base, d));
  }
  if (DRIVERS.some((d) => d.id === p.driver)) base.driver = p.driver!;
  if (Array.isArray(p.research)) {
    const known = new Set<string>();
    base.research = p.research
      .filter((r) => {
        if (!r || !RESEARCH.some((x) => x.id === r.id) || known.has(r.id)) return false;
        known.add(r.id);
        return true;
      })
      .map((r) => ({ id: r.id, remaining: integer(r.remaining, 3, 0, 3) }));
  }
  if (Array.isArray(p.ledger))
    base.ledger = p.ledger
      .filter((x) => x && typeof x.label === 'string' && Number.isFinite(x.amount))
      .slice(-48)
      .map((x) => ({
        week: integer(x.week, base.week, 1, 10000),
        label: x.label.slice(0, 100),
        amount: integer(x.amount, 0, -1e9, 1e9),
      }));
  if (Array.isArray(p.paidSessions))
    base.paidSessions = p.paidSessions
      .filter((s): s is string => typeof s === 'string' && s.length <= 80)
      .slice(-100);
  base.livery = validateLivery(p.livery);
  if (typeof p.briefing === 'string') base.briefing = p.briefing.slice(0, 400);
  return base;
}
export function capacity(team: TeamState, department: Department) {
  return team.facilities[department] * 8 + 4;
}
export function driverProfile(team: TeamState) {
  return DRIVERS.find((d) => d.id === team.driver) ?? DRIVERS[0];
}
export function weeklyBudget(team: TeamState) {
  const payroll =
    DEPARTMENTS.reduce((sum, d) => sum + team.workforce[d] * (d === 'engineering' ? 650 : 500), 0) +
    driverProfile(team).salary;
  const overhead = DEPARTMENTS.reduce((sum, d) => sum + team.facilities[d] * 1700, 0);
  const income = 17000 + team.workforce.commercial * 1500 + team.reputation * 180;
  return { income, payroll, overhead, net: income - payroll - overhead };
}
function book(team: TeamState, label: string, amount: number) {
  if (team.balance + amount < 0)
    throw new Error('Insufficient team funds. Reduce costs or complete a race.');
  team.balance += amount;
  team.ledger.push({ week: team.week, label, amount });
  team.ledger = team.ledger.slice(-48);
}
export type TeamAction =
  | { type: 'week' }
  | { type: 'staff'; department: Department; delta: number }
  | { type: 'facility'; department: Department }
  | { type: 'driver'; id: DriverId }
  | { type: 'research'; id: ResearchId }
  | { type: 'livery'; value: Livery };
/** Pure transaction: caller persists next state before replacing the displayed state. */
export function changeTeam(current: TeamState, action: TeamAction): TeamState {
  const next = structuredClone(current);
  if (action.type === 'week') {
    if (next.week >= 10000) throw new Error('This save has reached its week limit.');
    const budget = weeklyBudget(next);
    if (next.balance + budget.net < 0)
      throw new Error('Cannot fund next week. Reduce workforce or earn race income.');
    next.week++;
    book(next, 'Partnership income', budget.income);
    book(next, 'Workforce and driver payroll', -budget.payroll);
    book(next, 'Facility operating costs', -budget.overhead);
    for (const r of next.research) {
      const wasPending = r.remaining > 0;
      if (wasPending)
        r.remaining = Math.max(0, r.remaining - (next.workforce.engineering >= 16 ? 2 : 1));
      if (wasPending && r.remaining === 0)
        next.briefing = `${RESEARCH.find((x) => x.id === r.id)!.name} completed. Apply its setup from Engineering before your next session.`;
    }
  } else if (action.type === 'staff') {
    if (!DEPARTMENTS.includes(action.department) || ![-2, 2].includes(action.delta))
      throw new Error('Invalid workforce change');
    const target = next.workforce[action.department] + action.delta;
    if (target < 2 || target > capacity(next, action.department))
      throw new Error('Workforce is at its facility limit.');
    book(
      next,
      `${action.department}: ${action.delta > 0 ? 'recruitment' : 'reassignment'}`,
      action.delta > 0 ? -2400 : -600,
    );
    next.workforce[action.department] = target;
  } else if (action.type === 'facility') {
    if (!DEPARTMENTS.includes(action.department)) throw new Error('Invalid department');
    const level = next.facilities[action.department];
    if (level >= 4) throw new Error('Facility is at maximum level.');
    book(next, `${action.department}: facility level ${level + 1}`, -level * 26000);
    next.facilities[action.department]++;
  } else if (action.type === 'driver') {
    const driver = DRIVERS.find((d) => d.id === action.id);
    if (!driver) throw new Error('Unknown driver');
    if (next.driver === action.id) throw new Error('This driver already has your seat.');
    book(next, `${driver.name}: signing fee`, -driver.salary * 2);
    next.driver = driver.id;
    next.livery.number = driver.number;
    next.briefing = `${driver.name} joins the team. ${driver.detail} The profile changes identity and payroll; your inputs still determine lap pace.`;
  } else if (action.type === 'research') {
    const research = RESEARCH.find((r) => r.id === action.id);
    if (!research || next.research.some((r) => r.id === action.id))
      throw new Error('Study unavailable or already commissioned.');
    if (next.research.some((r) => r.remaining > 0))
      throw new Error('Finish the active study before starting another.');
    book(next, research.name, -research.cost);
    next.research.push({ id: research.id, remaining: research.weeks });
  } else if (action.type === 'livery') next.livery = validateLivery(action.value);
  return next;
}
export function researchSetup(
  team: TeamState,
  id: ResearchId,
  setup: Setup = DEFAULT_SETUP,
): Setup {
  const study = RESEARCH.find((r) => r.id === id);
  if (!study || !team.research.some((r) => r.id === id && r.remaining === 0))
    throw new Error('Complete this engineering study first.');
  return validateSetup({ ...setup, ...study.setup });
}
export interface RaceReward {
  session: string;
  position: number;
  cars: number;
  classified: boolean;
  demonstration: boolean;
  penalties: number;
}
/** The visible calculation behind a race payment (masterplan §12.3):
 * completion, improvement over the field and clean racing, not only wins. */
export function rewardIncome(result: Pick<RaceReward, 'position' | 'cars' | 'penalties'>) {
  const lines = [
    { label: 'Classified finish', amount: 9000 },
    {
      label: `Cars beaten (${result.cars - result.position} × 1,500)`,
      amount: (result.cars - result.position) * 1500,
    },
    { label: 'Clean race (no penalties)', amount: result.penalties === 0 ? 2000 : 0 },
  ];
  return { lines, total: lines.reduce((sum, line) => sum + line.amount, 0) };
}
export function rewardRace(current: TeamState, result: RaceReward): TeamState {
  if (!result.classified || result.demonstration || current.paidSessions.includes(result.session))
    return current;
  if (
    !result.session ||
    result.session.length > 80 ||
    !Number.isInteger(result.position) ||
    !Number.isInteger(result.cars) ||
    result.cars < 2 ||
    result.cars > 12 ||
    result.position < 1 ||
    result.position > result.cars ||
    !Number.isFinite(result.penalties) ||
    result.penalties < 0
  )
    return current;
  const next = structuredClone(current);
  const scores = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0];
  next.rounds++;
  next.points += scores[result.position - 1];
  // Original local rival, not an online competitor. Opposite-half placing makes progress legible.
  next.rivalPoints += scores[Math.min(result.cars - 1, Math.floor(result.cars / 2))];
  next.reputation = Math.min(100, next.reputation + (result.position <= 3 ? 4 : 2));
  next.paidSessions.push(result.session);
  next.paidSessions = next.paidSessions.slice(-100);
  book(next, `Round ${next.rounds}: P${result.position} classified`, rewardIncome(result).total);
  next.briefing = `Round ${next.rounds}: P${result.position}. ${result.penalties === 0 ? 'A clean result. The workshop can build on this.' : 'Points on the board, but race-control penalties cost us. Review the telemetry.'} ${next.points >= next.rivalPoints ? 'We are matching or leading Meridian in the local rivalry.' : 'Meridian still leads the local rivalry.'}`;
  return next;
}
