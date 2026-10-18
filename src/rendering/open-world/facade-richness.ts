/** Urban facade richness for the festival's Japanese city (refs 012-014,
 * 030, 038, 039, 053, 066, 069, 086, 089, 097): shader functions the
 * district facade material (buildings.ts) calls for city glazing and walls.
 * Everything is procedural and derivative-filtered; nothing adds a draw.
 *
 * - Glazing: an interior-mapped room behind every city pane (a box room
 *   traced from the view ray: back wall with furniture or shelving, floor,
 *   ceiling with a light panel, side walls), window coverings in front of it
 *   (venetian blinds lowered to any height, drawn curtains, lace, posters on
 *   shop glass, half-open shutters), aluminium sashes, mullions and transoms
 *   in metres, and reflections of the street canyon (facades across the
 *   street below a varying skyline, lit windows and sign colours at night)
 *   where the reflected ray meets buildings instead of the PMREM sky.
 * - Walls: large-format tile (600 x 300 mm), precast concrete panels with
 *   sealant joints at the floor lines, aluminium composite panels, and rain
 *   streaks under every sill and from the parapet coping.
 * - Frosted balcony glass in aluminium frames (ref 089).
 *
 * Pane facade data (buildings.ts / facade-layout.ts): x = room hash,
 * z = -4, w = mode + 4 * bucket, mode 0 window, 1 shopfront, 2 ribbon
 * window (u counts lites), 3 curtain wall; bucket = building style * 32
 * (frame colour and glass tint per building). */

/** Pane mode codes written by addRecessedFacade for city glazing. */
export const PANE_MODE = Object.freeze({ window: 0, shop: 1, ribbon: 2, curtain: 3 });
/** Facade z code of frosted balcony glass. */
export const FROSTED_CODE = -7;

export const URBAN_FACADE_GLSL = /* glsl */ `
vec3 owEmit;
float owMirror;
float owSpecBoost;
float owMirrorSeed;
float owSafeDiv(float v) { return abs(v) < 1e-4 ? (v < 0.0 ? -1e-4 : 1e-4) : v; }
vec3 owPick4(float h, vec3 a, vec3 b, vec3 c, vec3 d) {
  return h < 0.25 ? a : h < 0.5 ? b : h < 0.75 ? c : d;
}
// Interior radiance of a box room behind a pane. p: point on the glass (m,
// x right, y up from the pane's lower-left corner); rd: view ray in the
// pane frame (z into the room); xr: room x extent; sill/head: floor below
// and ceiling above the pane; depth: room depth; shop: 1 for shopfronts.
vec3 owRoom(vec2 p, vec3 rd, vec2 xr, float sill, float head, float depth, float seed,
            float shop, float lit, vec3 lamp, float night, float resolve) {
  float tx = ((rd.x > 0.0 ? xr.y : xr.x) - p.x) / owSafeDiv(rd.x);
  float ty = ((rd.y > 0.0 ? head : -sill) - p.y) / owSafeDiv(rd.y);
  float tz = depth / max(rd.z, 0.02);
  float t = min(tz, min(tx, ty));
  vec3 h = vec3(p, 0.0) + rd * t;
  float h1 = owHash(vec2(seed * 71.3, 4.1)), h2 = owHash(vec2(seed * 13.7, 9.2));
  vec3 wall = shop > 0.5
    ? owPick4(h1, vec3(0.72, 0.71, 0.68), vec3(0.42, 0.27, 0.15), vec3(0.68, 0.66, 0.62), vec3(0.2, 0.2, 0.21))
    : owPick4(h1, vec3(0.62, 0.6, 0.55), vec3(0.6, 0.53, 0.41), vec3(0.5, 0.52, 0.52), vec3(0.47, 0.51, 0.46));
  vec3 floorC = owPick4(h2, vec3(0.27, 0.17, 0.09), vec3(0.2, 0.2, 0.22), vec3(0.45, 0.44, 0.41), vec3(0.34, 0.25, 0.16));
  vec3 c;
  float fy = h.y + sill;  // height above the room floor
  if (t == tz) {
    c = wall;
    if (shop > 0.5) {
      if (h1 < 0.4) {
        // Gondola shelving: 0.36 m shelves from 0.15 to 1.95 m, goods 60-
        // 120 mm wide of varying height, white shelf lips, 0.9 m bays.
        float row = floor(fy / 0.36), inRow = fract(fy / 0.36);
        float item = floor(h.x / 0.09);
        float ih = owHash(vec2(item, row) + seed * 17.0);
        vec3 goods = mix(vec3(0.42), 0.5 + 0.5 * cos(6.2832 * (ih * 2.3 + vec3(0.0, 0.33, 0.67))), 0.45) * 0.7;
        float stocked = step(inRow, 0.35 + 0.5 * ih) * step(0.12, fract(h.x / 0.09 + 0.06)) * step(0.08, inRow);
        float lip = step(inRow, 0.06);
        float bay = step(0.03, fract(h.x / 0.9));
        float zone = step(0.15, fy) * step(fy, 1.95);
        c = mix(c, mix(mix(c * 0.55, goods, stocked), vec3(0.75), lip) * bay, zone * resolve);
      } else if (h1 < 0.6) {
        // Cafe or restaurant: a counter with a back bar of bottles, menu boards.
        float counter = step(fy, 1.05);
        vec2 menu = abs(vec2(fract(h.x / 1.4) - 0.5, fy - 1.75)) - vec2(0.3, 0.22);
        c = mix(c, vec3(0.2, 0.13, 0.08), counter * resolve);
        c = mix(c, vec3(0.08, 0.09, 0.08), step(max(menu.x, menu.y), 0.0) * resolve);
      } else if (h1 < 0.8) {
        // Boutique: garments on a rail at 0.9-1.6 m, sparse and pale.
        float g = floor(h.x / 0.07);
        float on = step(0.35, owHash(vec2(g, seed * 9.0))) * step(0.9, fy) * step(fy, 1.6 - 0.2 * owHash(vec2(g, 3.0)));
        vec3 cloth = mix(vec3(0.5), 0.5 + 0.5 * cos(6.2832 * (owHash(vec2(g, 1.0)) + vec3(0.0, 0.33, 0.67))), 0.45);
        c = mix(c, cloth, on * resolve);
      } else {
        // Office counter and a wall of brochures or listings.
        c = mix(c, vec3(0.3, 0.3, 0.32), step(fy, 1.0) * resolve);
        vec2 sheet = fract(vec2(h.x / 0.32, (fy - 1.2) / 0.4));
        c = mix(c, vec3(0.8), step(1.2, fy) * step(fy, 2.0) * step(0.1, sheet.x) * step(0.1, sheet.y) * resolve * 0.7);
      }
    } else {
      // Furniture below 0.85 m (desks, sofas, cabinets), a tall cupboard,
      // a picture or whiteboard.
      float furn = step(fy, 0.85) * step(0.35, owNoise(vec2(h.x * 0.9 + seed * 9.0, 2.0)));
      float tallC = step(fy, 1.9) * step(abs(h.x - (xr.x + (xr.y - xr.x) * h2)), 0.45);
      vec2 pic = abs(vec2(h.x - (xr.x + xr.y) * 0.5 - (h1 - 0.5), fy - 1.55)) - vec2(0.45, 0.3);
      float frame = step(max(pic.x, pic.y), 0.0);
      c = mix(c, owPick4(h2, vec3(0.16, 0.12, 0.09), vec3(0.3, 0.3, 0.32), vec3(0.42, 0.36, 0.3), vec3(0.12, 0.13, 0.16)), max(furn, tallC * 0.9) * resolve);
      c = mix(c, owPick4(h1, vec3(0.8, 0.8, 0.78), vec3(0.3, 0.42, 0.55), vec3(0.6, 0.4, 0.3), vec3(0.2, 0.35, 0.25)), frame * 0.8 * resolve);
    }
  } else if (t == tx) {
    c = wall * 0.82;
    if (shop > 0.5 && h1 < 0.4) {
      float row = floor(fy / 0.36), inRow = fract(fy / 0.36);
      float ih = owHash(vec2(floor(h.z / 0.1), row) + seed * 5.0);
      vec3 goods = mix(vec3(0.42), 0.5 + 0.5 * cos(6.2832 * (ih * 2.3 + vec3(0.0, 0.33, 0.67))), 0.5) * 0.7;
      float stocked = step(inRow, 0.35 + 0.5 * ih) * step(0.08, inRow);
      c = mix(c, mix(c * 0.55, goods, stocked), step(0.15, fy) * step(fy, 1.95) * resolve);
    }
  } else if (rd.y < 0.0) {
    c = floorC;
    // Tables or display islands on the floor.
    vec2 isl = abs(fract(vec2(h.x / 2.2, h.z / 2.6) + seed) - 0.5);
    c = mix(c, c * 0.45, step(max(isl.x, isl.y), 0.18) * resolve);
  } else {
    c = vec3(0.66, 0.66, 0.64);
  }
  // Day: daylight from the window falls off with depth; shops run their
  // lights in business hours. Night: a ceiling panel (rooms) or tube rows
  // (shops) at a third of the depth lights the room by distance.
  float cx = (xr.x + xr.y) * 0.5, cz = depth * 0.38;
  vec3 toLamp = vec3(cx, head - 0.05, cz) - h;
  float lampLight = 1.0 / (1.0 + (shop > 0.5 ? 0.06 : 0.11) * dot(toLamp, toLamp));
  float panel = 0.0;
  if (t == ty && rd.y > 0.0) {
    if (shop > 0.5) panel = step(0.62, fract(h.z / 1.2)) * step(0.15, fract(h.x / 1.6));
    else panel = step(abs(h.x - cx), 0.55) * step(abs(h.z - cz), 0.32);
    panel *= resolve;
  }
  float day = (shop > 0.5 ? 0.3 : 0.11) * (1.15 - 0.55 * clamp(h.z / depth, 0.0, 1.0));
  float dark = shop > 0.5 ? 0.02 : 0.008;
  vec3 nightLight = mix(vec3(dark), lamp * (lampLight * (shop > 0.5 ? 2.1 : 1.0) + panel * 3.0), lit);
  vec3 dayLight = vec3(day) * (1.0 + panel * lit * 2.0 * (shop > 0.5 ? 1.0 : 0.3));
  return c * mix(dayLight, nightLight, night);
}
// Surroundings reflected by city glazing: the facades across the street up
// to a skyline that changes building by building, the street below; at
// night their lit windows and signs. rgb = albedo, a = coverage; emission
// returned in 'glow'.
vec4 owNeighbour(vec3 r, float seed, float night, out vec3 glow) {
  float horiz = max(length(r.xz), 1e-3);
  float elev = r.y / horiz;
  float az = atan(r.z, r.x);
  // Every derivative is taken before any branch.
  vec2 f = vec2(az * 22.0, elev * 20.0) / vec2(3.3, 3.2);
  vec2 fa = max(fwidth(f), vec2(1e-4));
  vec2 sg = vec2(az * 36.0, elev * 9.0);
  vec2 sa = fwidth(sg);
  float aaE = max(fwidth(elev), 1e-4);
  float block = floor(az * 4.0 + seed * 7.0);
  float skyline = 0.16 + 0.62 * owHash(vec2(block, seed * 3.1)) + 0.12 * owNoise(vec2(az * 31.0, seed));
  float cover = 1.0 - smoothstep(skyline - aaE, skyline + aaE, elev);
  vec3 wallC = owPick4(owHash(vec2(block, 2.0)), vec3(0.45, 0.4, 0.34), vec3(0.32, 0.31, 0.3), vec3(0.5, 0.47, 0.42), vec3(0.42, 0.24, 0.17));
  // Window grid of the facades across a ~20 m street, averaged when it
  // would be smaller than a few pixels.
  vec2 g = fract(f);
  float win = step(0.2, g.x) * step(g.x, 0.8) * step(0.3, g.y) * step(g.y, 0.85);
  float resolve = 1.0 - smoothstep(0.25, 0.6, max(fa.x, fa.y));
  vec3 col = mix(wallC, vec3(0.05, 0.06, 0.07), mix(0.33, win, resolve));
  if (elev < -0.02) col = vec3(0.07, 0.07, 0.075);
  float cellH = owHash(floor(f) + seed * 11.0);
  vec3 lampC = mix(vec3(1.0, 0.72, 0.45), vec3(0.85, 0.92, 1.0), step(0.8, cellH));
  glow = lampC * night * mix(0.07, win * step(0.62, cellH) * 0.55, resolve);
  // Sign boxes low on the facades across the street (refs 066, 068, 069).
  float signCell = owHash(floor(sg) + seed);
  float signFade = 1.0 - smoothstep(0.3, 0.7, max(sa.x, sa.y));
  vec3 signC = 0.5 + 0.5 * cos(6.2832 * (signCell * 3.0 + vec3(0.0, 0.33, 0.67)));
  vec2 sf = fract(sg);
  float box = step(0.3, sf.x) * step(sf.x, 0.7) * step(0.08, sf.y) * step(sf.y, 0.92);
  float signs = mix(0.03, step(0.8, signCell) * box, signFade) * step(elev, 0.35) * step(-0.02, elev);
  glow += signC * signs * (0.05 + 0.9 * night);
  glow *= cover;
  return vec4(col, cover);
}
// City pane: glass over an interior or a covering, in aluminium joinery.
void owCityPane(vec2 q, float room, float tag, vec3 nrm, vec3 viewPos, float night, inout vec3 albedo) {
  // Interpolated 'constant' attributes wobble in the last bits; every hash
  // input is snapped first (the room id sits at a 1/256 bucket centre).
  room = floor(room * 256.0) / 256.0;
  tag = floor(tag + 0.5);
  float mode = mod(tag, 4.0);
  float bucket = floor(tag / 4.0 + 0.01) / 32.0;
  bool shop = mode > 0.5 && mode < 1.5, ribbon = mode > 1.5 && mode < 2.5, curtain = mode > 2.5;
  vec3 N = normalize(nrm);
  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 right = cross(upV, N);
  float rl = length(right);
  right = rl > 1e-4 ? right / rl : vec3(1.0, 0.0, 0.0);
  vec3 upP = cross(N, right);
  // Pane size in metres from the screen derivatives (least squares).
  vec3 P = -viewPos, dp1 = dFdx(P), dp2 = dFdy(P);
  vec2 dq1 = dFdx(q), dq2 = dFdy(q);
  float su = dq1.x * dq1.x + dq2.x * dq2.x, sv = dq1.y * dq1.y + dq2.y * dq2.y;
  float mu = su > 1e-12 ? (dot(dp1, right) * dq1.x + dot(dp2, right) * dq2.x) / su : 2.0;
  float mv = sv > 1e-12 ? (dot(dp1, upP) * dq1.y + dot(dp2, upP) * dq2.y) / sv : 1.7;
  // u runs along up x n on every wall; guard the sign all the same.
  if (mu < 0.0) right = -right;
  if (mv < 0.0) upP = -upP;
  mu = clamp(abs(mu), 0.4, 4.0);
  mv = clamp(abs(mv), 0.4, 4.0);
  vec2 aa = max(fwidth(q), vec2(1e-4));
  float resolve = 1.0 - smoothstep(0.05, 0.2, max(aa.x, aa.y));
  vec3 V = normalize(viewPos);
  vec3 rd = normalize(vec3(-dot(V, right), -dot(V, upP), max(dot(V, N), 0.05)));
  // The lite under this pixel and its room.
  float liteId = ribbon || curtain ? floor(q.x) : 0.0;
  vec2 lq = vec2(ribbon || curtain ? fract(q.x) : q.x, q.y);
  vec2 size = vec2(mu, mv);
  float roomCell = ribbon || curtain ? floor(liteId / 3.0) : 0.0;
  float seed = fract(room * 7.13 + roomCell * 0.618 + bucket * 3.7);
  vec2 p = lq * size;
  vec2 xr = ribbon || curtain
    ? vec2(-mod(liteId, 3.0) * mu, (3.0 - mod(liteId, 3.0)) * mu)
    : vec2(-0.9, mu + 0.9);
  float sill = shop ? 0.08 : curtain ? 0.15 : 0.82;
  float head = mv + (shop ? 0.25 : curtain ? 0.1 : 0.18);
  float depth = shop ? 5.5 + 3.0 * owHash(vec2(seed, 3.0)) : 3.5 + 2.5 * owHash(vec2(seed, 5.0));
  // Night: about two rooms in five lit (offices more), shops all but closed.
  float litH = owHash(vec2(seed * 31.0, 7.7));
  float lit = shop ? 1.0 : step(ribbon || curtain ? 0.45 : 0.58, litH);
  vec3 lamp = shop ? mix(vec3(1.0, 0.84, 0.66), vec3(0.92, 0.96, 1.0), step(0.5, seed))
                   : mix(vec3(1.0, 0.7, 0.44), vec3(0.84, 0.9, 1.0), step(0.72, litH) + (ribbon || curtain ? 0.6 : 0.0));
  lamp = min(lamp, vec3(1.0));
  // Panes a few pixels wide (and every pane on LOW) take the room's average
  // radiance; the traced room only runs where it resolves, blended in.
  vec3 far = vec3(0.46, 0.44, 0.41) * mix(
    vec3(shop ? 0.26 : 0.095),
    mix(vec3(shop ? 0.02 : 0.008), lamp * (shop ? 1.0 : 0.5), lit),
    night);
  float near = owRich * smoothstep(0.0, 0.5, resolve);
  vec3 interior = far;
  if (near > 0.0)
    interior = mix(far, owRoom(p, rd, xr, sill, head, depth, seed, shop ? 1.0 : 0.0, lit, lamp, night, resolve), near);
  // Coverings 5-10 cm behind the glass (refs 030, 089): blinds lowered to
  // any height, curtains drawn from the sides, lace; posters on some shop
  // glass; half-open shutters.
  float cover = 0.0;
  vec3 coverC = vec3(0.0);
  float kindH = owHash(vec2(seed * 19.0, 1.3));
  float amount = owHash(vec2(seed * 23.0, 2.9));
  if (shop && room < 0.13) {
    // A closed roller shutter: 80 mm corrugation, unlit.
    cover = 1.0;
    lit = 0.0;
    float rib = sin(p.y * 6.2832 / 0.08) * (1.0 - smoothstep(0.01, 0.03, fwidth(p.y)));
    coverC = vec3(0.42, 0.43, 0.43) * (0.9 + 0.08 * rib);
  } else if (!shop) {
    float blindP = ribbon || curtain ? 0.6 : 0.3;
    if (kindH < blindP) {
      // Venetian or vertical blinds, cream to pale yellow, from the head down.
      float bottom = mv * (1.0 - (0.25 + 0.75 * amount));
      cover = step(bottom, p.y);
      float slat = sin(p.y * 6.2832 / 0.04);
      float slatFade = 1.0 - smoothstep(0.004, 0.012, fwidth(p.y));
      coverC = owPick4(owHash(vec2(seed, 8.0)), vec3(0.69, 0.62, 0.42), vec3(0.74, 0.73, 0.69), vec3(0.62, 0.6, 0.53), vec3(0.66, 0.66, 0.62));
      coverC *= 0.93 + 0.07 * slat * slatFade;
    } else if (kindH < blindP + 0.24) {
      // Curtains drawn in from both sides with a gap, 0.12 m folds.
      float gap = (0.15 + 0.6 * amount) * mu * 0.5;
      cover = 1.0 - step(abs(p.x - mu * 0.5), gap);
      float fold = sin(p.x * 6.2832 / 0.12);
      float foldFade = 1.0 - smoothstep(0.01, 0.03, fwidth(p.x));
      coverC = owPick4(owHash(vec2(seed, 6.0)), vec3(0.66, 0.6, 0.48), vec3(0.45, 0.5, 0.56), vec3(0.6, 0.62, 0.55), vec3(0.62, 0.42, 0.36));
      coverC *= 0.88 + 0.12 * fold * foldFade;
    } else if (kindH < blindP + 0.32) {
      // Lace: the room stays faintly visible.
      cover = 0.62;
      coverC = vec3(0.7, 0.7, 0.67);
    }
  } else {
    if (room < 0.2 && room >= 0.13) {
      // Half-open roller shutter down to 0.9-1.5 m above the threshold.
      float bottom = 0.9 + 0.6 * amount;
      cover = step(bottom, p.y);
      float rib = sin(p.y * 6.2832 / 0.08) * (1.0 - smoothstep(0.01, 0.03, fwidth(p.y)));
      coverC = vec3(0.42, 0.43, 0.43) * (0.9 + 0.08 * rib);
    } else if (kindH < 0.1) {
      // Listings or posters on the lower glass (estate agents, clinics).
      vec2 sheet = fract(vec2(p.x / 0.5, (p.y - 0.4) / 0.62));
      float onSheet = step(0.08, sheet.x) * step(sheet.x, 0.92) * step(0.08, sheet.y) * step(sheet.y, 0.92);
      cover = onSheet * step(0.4, p.y) * step(p.y, 1.65) * resolve;
      coverC = mix(vec3(0.82, 0.82, 0.8), vec3(0.7, 0.2, 0.15), step(0.8, owHash(floor(vec2(p.x / 0.5, p.y / 0.62)) + seed)));
    }
  }
  // Aluminium joinery in metres: perimeter, meeting rail or mullions,
  // transom, shop kick plate.
  float fr;
  {
    vec2 e = min(p, size - p);
    float perim = min(e.x, e.y);
    float up;
    if (shop) {
      float n = max(2.0, floor(mu / 0.95 + 0.5));
      float k = fract(lq.x * n);
      up = min(k, 1.0 - k) * mu / n;
    } else up = ribbon || curtain ? 1e3 : abs(p.x - mu * 0.5);
    float trH = shop ? mv - 0.42 : ribbon ? mv * 0.78 : curtain ? 0.92 : mv * 0.72;
    bool hasTr = shop || curtain || fract(bucket * 7.0) > 0.5;
    float tr = hasTr ? abs(p.y - trH) : 1e3;
    float kick = shop ? step(p.y, 0.22) : 0.0;
    vec2 fa = max(fwidth(p), vec2(1e-4));
    float w0 = ribbon || curtain ? 0.035 : 0.03;
    fr = max(max(1.0 - smoothstep(w0, w0 + max(fa.x, fa.y), perim), 1.0 - smoothstep(0.022, 0.022 + fa.x, up)),
             max(1.0 - smoothstep(0.02, 0.02 + fa.y, tr), kick));
  }
  vec3 frameC = bucket < 0.55 ? vec3(0.36, 0.37, 0.37) : bucket < 0.8 ? vec3(0.06, 0.06, 0.065) : vec3(0.2, 0.15, 0.11);
  // Tinted reflective glass on curtain walls and some office ribbons.
  vec3 tint = curtain ? vec3(0.3, 0.42, 0.52) : ribbon && bucket > 0.7 ? vec3(0.5, 0.58, 0.62) : vec3(0.9, 0.93, 0.92);
  vec3 glassC = vec3(0.018, 0.022, 0.026);
  albedo = mix(mix(glassC, coverC * 0.92, cover), frameC, fr);
  vec3 coverGlow = coverC * lamp * lit * (0.35 + 0.25 * step(0.9, cover)) * night;
  owEmit = (coverGlow * cover + interior * tint * (1.0 - cover)) * (1.0 - fr);
  owGlass = 1.0 - fr;
  owMirror = (1.0 - fr) * owRich;
  owSpecBoost = curtain ? 2.6 : ribbon && bucket > 0.7 ? 1.9 : 1.3;
  owMirrorSeed = bucket * 11.0 + room;
}
// Urban wall finishes 7-9 and weathering. q: wall UV (m); finish code;
// top: wall height (m, 0 when unknown).
void owCityWall(vec2 q, float finish, float style, float top, inout vec3 c, inout float relief, inout float rough) {
  vec2 aa = max(fwidth(q), vec2(1e-5));
  style = floor(style * 1024.0 + 0.5) / 1024.0;
  if (finish > 6.5 && finish < 7.5) {
    // Large-format tile 600 x 300 mm, stack bond, 3 mm light joints.
    vec2 course = vec2(0.6, 0.3);
    vec2 cell = q / course, f = fract(cell), edge = min(f, 1.0 - f) * course;
    vec2 m = smoothstep(vec2(0.003), vec2(0.003) + aa, edge);
    float resolve = 1.0 - smoothstep(0.3, 0.9, max(aa.x / course.x, aa.y / course.y));
    float v = owHash(floor(cell) + style * 41.0);
    vec3 unit = c * (0.93 + 0.12 * v);
    vec3 joint = c * 1.12 + 0.03;
    c = mix(mix(c, joint, 0.03), mix(joint, unit, m.x * m.y), resolve);
    relief += (m.x * m.y - 1.0) * 0.0015 * resolve;
    rough = mix(0.55, 0.38, m.x * m.y * resolve);
  } else if (finish > 7.5 && finish < 8.5) {
    // Precast concrete panels: horizontal joints at every floor line and
    // the sill line, vertical joints every 1.65 m; 15 mm dark sealant.
    vec2 cell = vec2(q.x / 1.65, floor(q.y / 3.2) * 2.0 + step(0.8, mod(q.y, 3.2)));
    float ex = min(fract(q.x / 1.65), 1.0 - fract(q.x / 1.65)) * 1.65;
    float ey = min(mod(q.y, 3.2), min(abs(mod(q.y, 3.2) - 0.8), 3.2 - mod(q.y, 3.2)));
    float resolve = 1.0 - smoothstep(0.015, 0.05, max(aa.x, aa.y));
    float seam = min(smoothstep(0.0075, 0.0075 + aa.x, ex), smoothstep(0.0075, 0.0075 + aa.y, ey));
    float v = owHash(floor(cell) + style * 23.0);
    c *= (0.94 + 0.1 * v) * mix(1.0, mix(0.55, 1.0, seam), resolve);
    relief += (seam - 1.0) * 0.004 * resolve;
    rough = 0.82;
  } else if (finish > 8.5 && finish < 9.5) {
    // Aluminium composite panels 1.0 x 0.5 m, open 10 mm joints.
    vec2 course = vec2(1.0, 0.5);
    vec2 f = fract(q / course), edge = min(f, 1.0 - f) * course;
    vec2 m = smoothstep(vec2(0.005), vec2(0.005) + aa, edge);
    float resolve = 1.0 - smoothstep(0.02, 0.06, max(aa.x, aa.y));
    float v = owHash(floor(q / course) + style * 13.0);
    c *= (0.97 + 0.05 * v) * mix(1.0, mix(0.4, 1.0, m.x * m.y), resolve);
    relief += (m.x * m.y - 1.0) * 0.003 * resolve;
    rough = 0.34;
  }
  // Rain streaks: dark runs below each sill (sills 0.8 m above every floor
  // line) and from the parapet coping, broken into narrow tracks.
  float below = mod(0.8 - q.y, 3.2);
  float track = smoothstep(0.5, 0.85, owNoise(vec2(q.x * 3.1 + style * 17.0, q.y * 0.35)));
  float sillRun = exp(-below / 1.3) * step(1.0, q.y) * track;
  float topRun = top > 0.5 ? exp(-max(top - q.y, 0.0) / 2.6) * smoothstep(0.45, 0.8, owNoise(vec2(q.x * 2.3 + style * 5.0, 3.0))) : 0.0;
  float streakFade = 1.0 - smoothstep(0.03, 0.12, aa.x);
  float stain = max(sillRun * 0.22, topRun * 0.3) * mix(0.5, 1.0, streakFade);
  c *= 1.0 - stain;
  c = mix(c, c * vec3(0.92, 0.95, 0.9), stain * 0.6);
}
// Frosted laminated balcony glass in 1.2 m aluminium frames.
void owFrosted(vec2 q, float style, inout vec3 c, inout float rough) {
  vec2 aa = max(fwidth(q), vec2(1e-4));
  float k = fract(q.x / 1.2);
  float e = min(k, 1.0 - k) * 1.2;
  float frame = 1.0 - smoothstep(0.03, 0.03 + aa.x, e);
  float tone = 0.94 + 0.06 * owNoise(q * vec2(0.6, 1.4) + style * 9.0);
  vec3 glass = vec3(0.6, 0.66, 0.66) * tone;
  c = mix(glass, vec3(0.38, 0.39, 0.39), frame);
  rough = mix(0.24, 0.45, frame);
}
`;

/** Injected after three's lights_fragment_maps: where a city pane's
 * reflected ray meets the buildings across the street, their radiance
 * replaces the PMREM sky; coated glass reflects more. */
export const URBAN_REFLECTION_GLSL = /* glsl */ `
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
if (owMirror > 0.0) {
  vec3 owR = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
  vec3 owNbGlow;
  vec4 owNb = owNeighbour(owR, owMirrorSeed, owNight, owNbGlow);
  vec3 owNbLit = owNb.rgb * iblIrradiance * RECIPROCAL_PI * (2.4 - 1.8 * owNight) + owNbGlow;
  radiance = mix(radiance, owNbLit, owNb.a * owMirror) * mix(1.0, owSpecBoost, owMirror);
}
#endif
`;
