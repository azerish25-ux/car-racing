import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Track } from '../src/simulation/track.ts';
import { F, carBase } from '../src/simulation/protocol.ts';
import { MENU_CAR_DATUM, SHOWROOM, menuPreview } from '../src/rendering/menu-preview.ts';
import {
  SPEED_TUNNEL,
  SPEED_TUNNEL_STYLE_ID,
  installSpeedTunnel,
  speedTunnelBackground,
  speedTunnelStreaks,
} from '../src/rendering/studio/speed-tunnel.ts';

describe('front-end showroom and speed tunnel', () => {
  it('frames the menu car from a low eye with a long lens (AB-B 4.2)', () => {
    expect(SHOWROOM.height).toBe(1.2);
    expect(SHOWROOM.fov).toBe(32);
    expect(SHOWROOM.rate).toBeLessThan(0.07); // slower than the old orbit
    const track = new Track();
    const frame = menuPreview(track);
    const o = carBase(0);
    const road = track.at(frame[o + F.S], { s: 0 } as never).y;
    expect(frame[o + F.Y] - road).toBeCloseTo(MENU_CAR_DATUM, 6);
  });

  it('paints a deterministic streak tunnel converging on (0.62, 0.45)', () => {
    expect(SPEED_TUNNEL.base).toBe('#07060a');
    expect([SPEED_TUNNEL.streakFrom, SPEED_TUNNEL.streakTo]).toEqual(['#c8203c', '#ff4a6a']);
    expect(SPEED_TUNNEL.floor).toBe('#1e5a5a');
    const streaks = speedTunnelStreaks();
    expect(streaks).toHaveLength(SPEED_TUNNEL.streaks);
    expect(streaks).toEqual(speedTunnelStreaks());
    for (const { at, width } of streaks) {
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(360);
      expect(width).toBeGreaterThan(0.3);
      expect(width).toBeLessThan(1.5);
    }
    const css = speedTunnelBackground();
    expect(css).toContain('conic-gradient(from 0deg at 62% 45%');
    expect(css).toContain('#1e5a5a73 0%');
    expect(css.trim().endsWith('#07060a')).toBe(true);
  });

  it('installs one menu-only backdrop rule, leaving the pause menu over the live race', () => {
    const appended: { id: string; textContent: string }[] = [];
    const doc = {
      getElementById: (id: string) => appended.find((e) => e.id === id) ?? null,
      createElement: () => ({ id: '', textContent: '' }),
      head: { append: (e: { id: string; textContent: string }) => appended.push(e) },
    } as unknown as Document;
    expect(installSpeedTunnel(doc)).toBe(true);
    expect(installSpeedTunnel(doc)).toBe(false);
    expect(appended).toHaveLength(1);
    expect(appended[0].id).toBe(SPEED_TUNNEL_STYLE_ID);
    expect(appended[0].textContent.startsWith("[data-mode='menu'] dialog::backdrop")).toBe(true);
    expect(appended[0].textContent).toContain(`blur(${SPEED_TUNNEL.blurPx}px)`);
  });

  it('styles the menu list as F1 25 pills with player actions only; dev tools stay behind ?dev', () => {
    const css = readFileSync('src/ui/style.css', 'utf8');
    expect(css).toContain('.menu-actions button:is(:hover, :focus-visible)');
    expect(css).toContain('--apex-flame: #fc4854;');
    const template = readFileSync('src/ui/interface.ts', 'utf8');
    const actions = template.match(/<div class="menu-actions"[^>]*>(.*?)<\/div>/)![1];
    // Player actions only, including the EVENTS hub (masterplan §21.4).
    expect(actions.match(/<button data-action=/g)).toHaveLength(7);
    expect(actions).toContain('data-action="events"');
    for (const dev of ['references', 'sessionReview', 'performance', 'visualReview'])
      expect(actions).not.toContain(`data-action="${dev}"`);
    // Developer tools are rendered only inside developer-mode branches.
    expect(template).toMatch(/DEV\s*\?\s*'<div class="dev-tools"/);
    expect(template).toMatch(/this\.developer\s*\?\s*'<div class="dev-tools"/);
  });
});
