import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buyVehicle, savePreset } from '../src/career/economy.ts';
import { liveRegistry, venueKind, type CareerRegistry } from '../src/career/registry.ts';
import { newCareer } from '../src/career/save.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import {
  CAREER_PAGES,
  careerHub,
  licenceBriefing,
  payoutPanel,
  type CareerPage,
} from '../src/ui/career-hub.ts';
import { LICENCE_TESTS } from '../src/career/licences.ts';

const live = liveRegistry();
/** Every opening tag carrying data-action, with its element name. */
const actionTags = (html: string) =>
  [...html.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-action="([^"]*)"/g)].map((m) => ({
    tag: m[1],
    action: m[2],
  }));

describe('career screens (DOM markup, no renderer)', () => {
  const save = savePreset(
    buyVehicle(newCareer(), live, 'tc1'),
    live.vehicles.find((v) => v.id === 'tc1')!,
    DEFAULT_SETUP,
    'Baseline copy',
  );
  it('renders every page with button-only actions, one pressed section and a status line', () => {
    for (const [page] of CAREER_PAGES) {
      const html = careerHub(save, live, { page: page as CareerPage, discipline: 'circuit-cars' });
      const tags = actionTags(html);
      expect(tags.length).toBeGreaterThan(5);
      // Keyboard and controller focus: only native buttons act; no links or click-divs.
      expect(new Set(tags.map((t) => t.tag))).toEqual(new Set(['button']));
      expect(html).not.toMatch(/<a\s|onclick=|tabindex="-1"/);
      const nav = html.match(/<nav aria-label="Career sections">(.*?)<\/nav>/)![1];
      expect(nav.match(/aria-pressed="true"/g)).toHaveLength(1);
      expect(nav).toContain(`data-action="career:page:${page}" aria-pressed="true"`);
      expect(html).toContain('role="status" id="careerSaveStatus"');
      // No animation is authored into career markup (reduced motion has nothing to stop).
      expect(html).not.toMatch(/animation|transition/);
    }
  });
  it('lists the recovery series first on the events page and explains locked events', () => {
    const html = careerHub(newCareer(), live, { page: 'events', discipline: 'circuit-cars' });
    const first = html.indexOf('class="career-event"');
    expect(html.slice(first, first + 200)).toContain('data-kind="recovery"');
    expect(html).toContain('ENTER CLUB MEETING');
    expect(html).toContain('Requires:');
  });
  it('escapes registry-provided names', () => {
    const hostile: CareerRegistry = {
      ...live,
      vehicles: [
        ...live.vehicles,
        {
          id: 'x1',
          name: '<img src=x onerror=alert(1)>',
          classId: 'touring',
          dynamicsKind: 'four-wheel',
          setupKeys: [],
        },
      ],
    };
    const html = careerHub(newCareer(), hostile, {
      page: 'dealership',
      discipline: 'circuit-cars',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
  it('shows the itemised payment and the licence limits before a test', () => {
    const panel = payoutPanel(
      {
        lines: [{ label: 'Classified finish × 0.5', amount: 4500 }],
        total: 4500,
        reputation: 3,
        paid: true,
        reason: null,
        awarded: null,
      },
      'saved',
    );
    expect(panel).toContain('Classified finish × 0.5');
    expect(panel).toContain('¤4,500');
    expect(panel).toContain('Paid to your career wallet.');
    const brief = licenceBriefing(LICENCE_TESTS.cornering, 'TC-1 TOURING', 'Aurel', true);
    expect(brief).toContain('GOLD ≤ 0.75 m');
    expect(brief).toContain('loaned');
    expect(brief).toContain('data-action="career:licenceGo"');
  });
  it('lists unsellable machines with what is missing and no BUY button', () => {
    const registry: CareerRegistry = {
      ...live,
      venues: live.venues.filter((v) => venueKind(v) === 'circuit'),
      vehicles: [
        ...live.vehicles,
        {
          id: 'test-rx',
          name: 'TEST RX',
          classId: 'rallycross',
          dynamicsKind: 'four-wheel',
          setupKeys: [],
        },
      ],
    };
    const html = careerHub({ ...newCareer(), credits: 1e6 }, registry, {
      page: 'dealership',
      discipline: 'circuit-cars',
    });
    const card = html.slice(html.indexOf('data-vehicle="test-rx"'));
    const rx = card.slice(0, card.indexOf('</article>'));
    expect(rx).toContain('data-status="coming"');
    expect(rx).toContain('COMING');
    expect(rx).toContain('dirt or mixed-surface venue');
    expect(rx).not.toContain('career:buy:test-rx');
    expect(html).toContain('data-action="career:buy:tc1"');
  });
  it('shows a championship calendar and when the career is not being saved', () => {
    const html = careerHub(newCareer(), live, {
      page: 'events',
      discipline: 'circuit-cars',
      unsaved: {
        reason: 'This career was saved by a newer build (career version 2)',
        replaceable: true,
      },
    });
    expect(html).toContain('class="championship-calendar career-calendar"');
    expect(html).toMatch(/<b>R1<\/b> [^<]+ · (DRY|RAIN|CHANGEABLE) · \d+ LAPS/);
    expect(html).toContain('NOT SAVING');
    expect(html).toContain('data-action="career:replace"');
    expect(
      payoutPanel(
        { lines: [], total: 0, reputation: 0, paid: true, reason: null, awarded: null },
        'unsaved',
      ),
    ).toContain('this session only');
  });
  it('styles career screens with the existing menu tokens and no motion', () => {
    const css = readFileSync('src/ui/style.css', 'utf8');
    const career = css.slice(css.indexOf('/* Career (src/ui/career-hub.ts)'));
    expect(career).toContain('#modal:has(.career-hub)');
    expect(career).not.toMatch(/animation|transition|@keyframes/);
  });
});
