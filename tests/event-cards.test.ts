import { expect, it } from 'vitest';
import { EVENTS } from '../src/simulation/events.ts';
import { eventCard, eventHub } from '../src/ui/event-cards.ts';

it('§11.3 event cards state venue, machine, length, weather, rules and scoring before entry', () => {
  const touring = eventCard(EVENTS[0], 0),
    timed = eventCard(EVENTS[1], 1);
  expect(touring).toMatch(/AUREL \/ GRAND CIRCUIT/);
  expect(touring).toMatch(/TC-1 TOURING/);
  expect(touring).toMatch(/4 laps · 8 cars/);
  expect(touring).toMatch(/DRS off/);
  expect(timed).toMatch(/20 minutes \+ 1 lap/);
  expect(timed).toMatch(/rain expected/);
  expect(eventHub(EVENTS)).toContain('data-action="event:1"');
});
