# Authoritative online racing slice (WP50–WP54)

Masterplan §22. **State: prototype.** The modules in `src/net/` are tested in isolation and run a
complete eight-client race in one process over an in-memory transport with simulated latency, jitter,
loss, duplication and reordering. Nothing here is reachable from a player session, nothing is deployed,
and no real network transport exists yet. Run it with `npm run test:online` (writes
[`docs/online-slice.json`](../online-slice.json)); the unit and integration tests are
`npx vitest run tests/net-*.test.ts`.

| Module | Responsibility |
|---|---|
| `src/net/constants.ts` | Cadences, limits, timeouts, rates, `COLLISION_AUTHORITY` |
| `src/net/transport.ts` | `Transport` interface; `NetworkSimulator` (seeded loss/latency/jitter/duplication/reordering, reliable head-of-line model, link severing) |
| `src/net/event-loop.ts` | Deterministic discrete-event clock shared by server and clients in tests |
| `src/net/codec.ts`, `bytes.ts`, `input.ts`, `snapshot.ts`, `messages.ts` | Wire formats, bounds-checked decoding of untrusted bytes, control-message validation |
| `src/net/authority.ts` | `AuthoritativeWorld`: the Simulation stepped with accepted inputs; `NetDriver` per car; input journal; replay |
| `src/net/progress.ts` | Server-side legal-progress audit with `RouteGraph`/`RouteProgress` |
| `src/net/server.ts` | `RaceServer`: lifecycle, joins, input queues, snapshots, disconnect/rejoin, moderation, tick budget |
| `src/net/client.ts`, `prediction.ts`, `interpolation.ts` | `RaceClient`: commands with redundancy, local-car prediction and smoothing, jitter-buffered remote interpolation |
| `src/net/lobby.ts`, `identity.ts`, `records.ts`, `guards.ts` | Lobbies/directory, content agreement, verified records, token buckets and tick-budget monitor |
| `src/net/bots.ts`, `slice.ts`, `scripts/online-slice.ts` | Test drivers and the 8-client harness |

No Node WebSocket server script is included: no `ws` library is resolvable in this repository (and
none was installed for this work).

## 1. Cadences

| Clock | Rate | Notes |
|---|---|---|
| Physics tick | 120 Hz | `SIMULATION_TICK_HZ`, server only |
| Input sampling | 60 Hz | One command covers two ticks nominally (1–4 while the lead adjusts) |
| Input send | 30 Hz | Each packet repeats every unacknowledged future command (≤ 12) |
| Snapshot | 20 Hz | Every 6 ticks, per recipient |
| Client render | 60 Hz | Local car predicted, remote cars interpolated |

The three network-facing rates are independent of each other and of the physics tick; changing one
changes no other code path.

## 2. Protocol

Every message starts with a type byte: `1` input (binary, unreliable), `2` snapshot (binary,
unreliable), `3` control (UTF-8 JSON, reliable). The transport offers two delivery classes: datagrams
(may be lost, duplicated, reordered) and a reliable ordered channel (TCP/SCTP-like, head-of-line delay
on loss). A browser deployment would map these onto WebRTC data channels; a WebSocket-only deployment
would carry inputs reliably and pay head-of-line blocking.

**Input packet** (client → server), 18 B + 8 B per command:

| Field | Bytes | Meaning |
|---|---|---|
| sentAt | 4 | Client clock (ms, wrapped), echoed back for RTT |
| ackTick | 4 | Newest snapshot tick received |
| count, firstSeq, firstTick | 1 + 4 + 4 | A run of commands contiguous in sequence and tick |
| per command: ticks | 1 | Ticks covered (1–8) |
| per command: throttle, brake, clutch | 3 | 8-bit |
| per command: steer | 2 | 16-bit signed |
| per command: bits | 2 | shift, ERS mode, manual clutch, reverse, DRS, overtake (edge), pit (edge) |

Both peers derive the applied value from the same integers (`quantizeControls`), so the client
predicts with exactly the numbers the server applies.

**Snapshot** (server → client): a 22 B header — tick, phase, race time, the recipient's contiguous input
acknowledgement, measured input slack, missing-input count, RTT echo and hold time, car count — then
39 B per car: id, flags, position (3 × f32), orientation (4 × i16), velocity (3 × i16 at 1 cm/s),
steer/throttle/brake/gear/rpm, track progress (f32), laps and rank. The recipient's own car is sent
FULL (+12 B: angular velocity and world acceleration) because prediction needs them. Flags: FULL,
IN_PIT, RETIRED, FINISHED, CONTACT, AI (server AI driving), DRS_OPEN, GHOST. For 8 cars a snapshot is
347 B; the WP49 estimate (34 B/car, no header) was 272 B.

**Control messages.** Client → server (validated field by field; anything unexpected is rejected, not
repaired): `join {net, name, vehicle, identity, token?, account?}`, `ready {ready}`, `leave`,
`ping {t}`. Server → client: `welcome {player, token, lobby}`, `reject {reason}`, `lobby {lobby}`,
`grid {options, identity, entries, car, startTick, serverTick, startInMs, events?}`,
`events {events}` (lap completions, finishes, driver hand-overs), `lapTimes {car, from, times}`,
`results {results}`, `kicked {reason}`, `pong {t, serverTick}`. A client keeps pinging every 500 ms
until its inputs flow (lobby, grid, and a race it has no snapshot for yet); the smallest ping round
trip seeds its input lead. On a rejoin during the countdown the grid message carries the time left;
during the race it carries an empty `events` list (race running, history reset) and the history
follows in `events` chunks.

**Size limits:** datagrams ≤ 1200 B, client control messages ≤ 8 KiB, server control messages
≤ 32 KiB, ≤ 16 commands per packet, ≤ 32 cars per snapshot. Oversize, truncated, trailing-byte,
non-finite or unknown messages are dropped and counted as a strike. The server never sends a control
message over the client's limit: event lists are split into as many `events` messages as needed, and a
classification too large for one message (long races, full fields) sends its lap times ahead in
`lapTimes` chunks, then `results` with `lapTimesSeparate` (`chunkMessages`). Anything still over the
limit is not sent and is counted (`oversizeMessages`, 0 in every test and slice run).

## 3. Timing, input lead and acknowledgement

The client estimates the newest server tick it could have seen from the least-delayed snapshot arrival
in a 2 s window (`ServerClock`) and the arrival jitter from the spread of the others. It stamps each
command with the server tick it is meant for, running ahead by a *lead* of ≈ RTT plus margin. The first
lead comes from the smallest keep-alive round trip (before any input packet has been echoed). The server
reports, per snapshot, the smallest margin by which new commands beat their first tick (*slack*) —
negative when a command arrived after its ticks were simulated, so a lead that starts too short (or a
round trip that grows) is corrected from the late commands alone; the client grows the lead quickly
when slack falls below `1.5 + 2 × jitter` ticks and shrinks it slowly when slack is generous, by issuing
3-tick or 1-tick commands instead of 2 — the command stream stays contiguous. Measured: lead 18 ticks
(150 ms) at 100 ms RTT; clients at 200 and 300 ms RTT drive from the first command, and a client whose
RTT jumps from 100 to 300 ms at the start recovers (`tests/net-resilience.test.ts`).

The server keeps one `ServerInputQueue` per driver: duplicates are dropped by sequence number, commands
wholly in the past are counted late, commands more than 240 ticks (2 s) ahead or more than 480
sequence numbers above the acknowledgement are rejected and never remembered (each packet carrying one
is a strike), and a gap whose successor has already started is never waited on. Its dedup state is
therefore bounded by the sequence window whatever a peer sends. A tick with no command repeats the previous
level controls (never the one-shot edges) and is counted missing; 250 ms without commands hands the car
to the AI until commands resume (*input starvation*), so a car never drives on stale inputs for longer.
The acknowledgement is the highest contiguous sequence received; the client resends everything after it.

## 4. Authority

The server owns accepted inputs, the simulation, contacts, legal progress, penalties, results and the
record. The client owns nothing authoritative and never sends state.

* **Simulation.** `AuthoritativeWorld` runs the unchanged `Simulation` with a `NetDriver` in place of
  each car's `AIDriver`. A human car follows its network controls, sanitized exactly as
  `Simulation.setInput` does for the local player; the AI it extends takes over in the pit lane, after
  the flag and on disconnect. An all-AI NetDriver field is bit-identical to the plain Simulation
  (`tests/net-authority.test.ts`), so the online path does not change single-player physics. One-shot
  controls are bounded server-side: a pit request toggles at most once per 0.5 s, and an overtake edge
  is journaled (and applied) only when it starts the boost, so a client sending one-tick commands that
  flip every control adds about one journal entry per tick, not three.
* **Collision authority** (`COLLISION_AUTHORITY`): contacts are resolved only by the server's
  `CollisionSolver`. Clients never predict, push or resolve contacts. A contact reaches the client as a
  corrected state plus a CONTACT flag, which shortens the visual blend from 100 ms to 40 ms for 300 ms so
  the impact is felt promptly; corrections above 5 m or 25° snap. Remote cars are pure interpolation of
  authoritative states, so the predicted (ahead-in-time) local car may visually overlap a remote car
  drawn in the past; this is accepted and never "fixed" client-side.
* **Legal progress.** `RaceDirector` classifies; every car is also tracked through a two-edge
  `RouteGraph` along the circuit with `RouteProgress`, which only credits permitted transitions and
  bounded steps. Any disagreement between the two lap counts is reported in the results as a progress
  dispute (none in the measured run).

**Prediction (WP50).** Full re-simulation of the shared world on the client is not possible today: the
Simulation has no state restore (flashback re-simulates from the start), and re-running an 8-car world
for the ≈ 18 unacknowledged ticks at every snapshot would cost ≈ 30–40 ms per snapshot (≈ 1.7 ms per
8-car tick, WP49), more than half a core at 20 Hz. The client therefore predicts only its own car: from
the newest authoritative state it integrates a constant-turn-rate-and-acceleration model (midpoint
step) up to the tick its newest command covers, adding the effect of its own unacknowledged inputs
through a `ResponseModel` learned online from the authoritative stream (longitudinal acceleration
against throttle/brake and yaw rate against steering, per 5 m/s band, ≈ 10 s memory, 50 ms input delay
and 40 ms response). Each snapshot re-runs the prediction from the new state; the difference to the old
present pose goes into a position/rotation offset that decays with a 100 ms time constant. Remote cars
are drawn ≈ 117 ms in the past (two snapshot intervals plus twice the measured jitter, slew-limited),
with cubic Hermite position (snapshot velocities as tangents) and slerped orientation; they extrapolate
at most 125 ms and are not drawn before the buffer reaches the render time. A client with no snapshot for
250 ms reports itself stalled.

## 5. Session lifecycle and content agreement (WP51)

`lobby → grid → race → results → teardown`.

1. **Join.** The client computes `joinIdentity(advertised session, its vehicle)` — a
   `RecordedSessionIdentity` from its *own* content (`sessionIdentity`) — and sends it with the network
   protocol version. The server compares it with its own computation for that vehicle: simulation
   version (`SIMULATION_VERSION`), snapshot format, tick rate, circuit id and content hash, ruleset id and
   hash, vehicle id and hash, assists and seed. The first mismatch is returned as the reject reason
   (e.g. *"content mismatch: circuit aurel content 0badc0de differs from the server's …"*). Vehicle
   class against the ruleset is checked with `sessionIncompatibilities`.
2. **Grid.** When the lobby's ready check passes — re-run on every join, ready change and departure
   (leave, kick, lobby timeout), so the last unready member leaving starts the session — the server
   builds the field (members in join order, AI to the field size), sends `grid` with the full-field
   identity, and starts ticking 1.5 s later. The client checks every grid vehicle against its own
   content and leaves with a reason if it cannot present the field. A driver's silence in the race is
   counted from the first physics tick at the earliest.
3. **Race.** The simulation's own lights sequence (≈ 5.6 s) gives clients time to synchronize; cars are
   held on the brake until their first command.
4. **Results.** At the flag (or the configured session limit) the server archives the verified record and
   sends the classification with the record digest.
5. **Teardown.** After 2 s every connection is closed and all timers stop.

**Host migration** is out of scope (the server is dedicated).

**Server crash/restart.** The journal is the complete authoritative history. A supervisor that persisted
the grid message and the journal can rebuild the exact world by replay — `AuthoritativeWorld.replay`,
tested to reproduce the live state hash and to continue identically — and let drivers rejoin with their
tokens inside the rejoin window. Clients detect the crash as silence (1 s) and show the stall. *Not
implemented:* journal persistence, the supervisor, and moving clients to a new server address; today a
server crash voids the session, and no record is issued for a session without results.

## 6. Verified records (WP52)

A `SessionRecord` holds the seed and canonical session options, the full-field `RecordedSessionIdentity`,
the leaderboard category (`recordCategory`), the binary input journal (every level-control change,
overtake edge, pit request and driver-mode change, stamped with the tick it was applied before), the
end tick, and the claim: classification order, laps, every lap time, best laps, per lap whether the
server AI drove the car at any tick of it (AI entrant, disconnect takeover, input starvation, pit
lane), a state hash at every multiple of 10 s up to the end, and the final state hash. `verifyRecord`
trusts none of it:

1. format, version and bounds; the checkpoints must be exactly the session's (ticks 1200, 2400, … up
   to the end tick, 8-hex hashes), the order a permutation of the field, every per-car list one entry
   per car; the digest (catches corruption — it is not a signature);
2. options must already be canonical (`validateOptions` round trip): a verifier never repairs a claim;
3. the identity must match this build's content and `SIMULATION_VERSION`; the category must be
   compatible (`recordIncompatibility`);
4. the journal must be no longer than the live server can write for that many ticks and cars (6
   entries per car per tick: a genuine 6 h, 12-car record always fits), decode and stay inside the
   session;
5. headless re-simulation, failing fast at the first divergent checkpoint (so within 10 simulated
   seconds of a forged state), lap time or AI-assisted flag;
6. every lap time, lap count, best lap, AI-assisted flag, checkpoint, the order and the final hash
   must be bit-identical.

An accepted record reports `categoryBest`: car 0's best lap that is valid, unpenalized and driven by its
human driver throughout (0 when there is none). That is the only lap a leaderboard may take from it; a
record whose car 0 the server AI drove still verifies as a session, with no leaderboard lap.

Tests prove that a lap time forged by 0.25 s (or 0.5 s in the slice script) with a recomputed digest is
rejected by re-simulation, that a 3-LSB steering change in the journal is rejected at the next
checkpoint, that invented checkpoints and a lap falsely claimed human-driven are rejected, that a
partly AI-driven lap verifies but gives no `categoryBest`, that a 75-minute 8-car journal is within
bounds, and that edited circuit/vehicle/ruleset hashes, another physics version, another seed or
non-canonical options are rejected with their reason.

Verification proves that the claimed result follows from the recorded inputs under this build's
physics and content. It does not prove that a person produced those inputs (input automation needs
behavioural detection), and it is same-build/same-engine determinism: cross-platform float determinism
is not claimed (§6.5). A deployment would also sign records server-side.

## 7. Lobbies (WP53)

`LobbyDirectory` creates (validated with `sessionIncompatibilities` for the AI-filled field), lists
(filter by circuit, ruleset, open), joins and leaves lobbies, removing empty unstarted ones. A `Lobby`
enforces capacity (≤ 12), the vehicle's class against the ruleset, readiness (every member ready and a
minimum player count), host-only moderation with `kick`/`ban` reported through `ModerationHooks`
(`isBanned`, `onKick`, `onBan`), and builds the session (pole first in join order). Directory requests are
rate-limited per player; server connections have separate token buckets for control messages (8/s, burst
16) and input packets (75/s, burst 40). Bans stick to a platform account id when the client presents
one; account authentication belongs to the platform and is not implemented here. Anonymous players get
server ids `guest:N`, which no account id can spell (accounts match `[A-Za-z0-9_-]{1,32}`), so a client
can neither squat a server-assigned id nor inherit its bans.

## 8. Resilience (WP54)

| Situation | Behaviour | Test |
|---|---|---|
| Connection silent 1 s | AI takeover (`ai-takeover`), or `ghost`: AI keeps the car moving, flagged GHOST, classified behind running cars | `net-resilience`, slice |
| Commands stop for 250 ms, link alive | AI holds the car until commands resume | `net-resilience` |
| Rejoin with token inside 30 s | Same car; AI holds it until the new connection's first command | `net-resilience`, slice |
| Rejoin during the grid countdown | Gets the time left, keeps pinging until inputs flow, races | `net-resilience` |
| Rejoin while the holder is still connected (heard within 1 s) | Refused; the holder keeps the car. A restarted client whose old connection the server has not lost yet retries after the timeout | `net-resilience` |
| Rejoin late in a long race | Event history in size-limited chunks | `net-resilience` |
| Rejoin after the window, forfeited or unknown token, other account, > 5 tries in a burst | Rejected with a reason | `net-resilience` |
| Lobby member leaves, is kicked or times out | Ready check re-run; the grid starts if the rest are ready | `net-lifecycle` |
| Loss, duplication, reordering | Redundant commands, sequence dedup, out-of-order snapshots feed only the interpolation buffer | `net-resilience` (10% loss/dup/reorder), slice |
| Non-finite or out-of-range input | Client rejects/clamps; wire format bounds every field; server clamps again | `net-codec`, `net-resilience` |
| Oversize, malformed, flooding | Dropped, strike; 40 strikes → kicked | `net-codec`, `net-resilience` |
| Commands outside the tick/sequence window | Rejected, never remembered, strike per packet | `net-transport`, `net-resilience` |
| Tick over budget (8.33 ms) | Counted; 12 consecutive overruns → `degraded` status | `net-transport`, slice |

The tick-budget monitor reports only; shedding load (lower snapshot rate, refusing joins) is not
implemented. Ghosts are not contact-immune: that needs a per-car collision mask in the shared solver.

## 9. Threat model

Assets: race results and records, other players' experience, server capacity. Adversaries: a modified
client, a flooding peer, a forger of records. The server is trusted; a malicious server is out of scope.

| Threat | Mitigation here | Gap |
|---|---|---|
| Speed, teleport, wall-clip hacks | Client sends only controls; the server simulates every car | — |
| Out-of-range, NaN or impossible inputs | Quantized wire fields, decode bounds, sanitize, server clamp | — |
| Input timing abuse (inputs from the future, rewriting the past) | Commands > 2 s ahead rejected; applied ticks are never rewritten; lead comes from server-measured slack | A client can choose its own latency (lag switch) up to the 1 s timeout; starvation hands the car to the AI after 250 ms |
| Impersonation, session hijack | Independent 128-bit rejoin tokens from the platform CSPRNG (`crypto.getRandomValues`), compared in constant time; a token is bound to the account it was issued to; a rejoin never replaces a connection heard within 1 s; 5 tries per token in a burst, then 1/s; account ids for bans; anonymous ids outside the account namespace | No transport encryption or platform authentication in the in-memory slice, so a token is only as secret as the channel; no per-source limits (the transport exposes no address) |
| Flooding / resource exhaustion | Token buckets, strikes and kick, size limits, join timeout, input queues bounded by the tick and sequence windows, lead window, journal edges bounded per car | No per-IP limits (no IP layer); verification has a 6 h tick cap, a journal bound per tick and car, and fails within 10 s of a forged state |
| Forged results or records | Headless re-simulation from inputs; exact checkpoints; exact lap times; per-lap AI-assisted flags, AI laps never count for a category | Records are not signed; automated (bot) inputs are valid inputs |
| Modified content (cars, circuit) | Identity hashes compared on join and at grid; the server simulates with its own content regardless | FNV-1a is not cryptographic; it detects mismatch, it does not authenticate |
| Information leakage | Snapshots carry only race state, names and server-assigned ids | All car positions are sent to everyone (no interest management) |

## 10. Measured result (`npm run test:online`)

Eight clients, Aurel, 70 s of racing after the green light (75.7 s session clock), 100 ms RTT (50 ms each
way), 4 ms jitter, 2% loss, 0.5% duplication, 1% reordering, one client's link cut for 3 s at 20 s and
reconnected with its token. Full numbers in [`docs/online-slice.json`](../online-slice.json). The
window was 60 s until the review fixes; the standing-start first lap takes 54–59 s depending on how
the pack sorts itself out (inputs one tick apart at the start are enough to move it by 2 s), and the
forged-lap check needs a completed lap, so the window now has margin.

| Measure | Value |
|---|---|
| Downlink per client (payload / wire) | 55.6 / 60.0 kbit/s (WP49 estimate: 43.5 kbit/s payload) |
| Uplink per client (payload / wire) | 21.1 / 27.8 kbit/s |
| Snapshot size (8 cars) / input packet | 347 B / 88 B mean |
| Copies sent per command | 4.4 |
| Input lead | 18 ticks (150 ms) |
| Missing / late input ticks | 146 of 72 091 (114 of them on the cut-off car before the takeover) / 39 |
| Local-car prediction error (shown pose vs authority) | mean 0.043 m, p95 0.147 m, p99 0.29 m, max 1.7 m; heading p95 1.2° |
| … human-driven, no contact within the prediction window | p95 0.146 m, max 0.93 m (11 747 samples) |
| … within reach of a server-resolved contact | p95 1.27 m, max 1.74 m (33 samples) |
| Correction jump before smoothing | mean 0.038 m, p95 0.145 m, max 2.04 m; 5 snaps (> 5 m or 25°) |
| Per-frame motion added by smoothing | p95 0.020 m (every client's frames, 36 277) |
| Remote interpolation error (vs server truth) | p95 0.3 mm, max 0.83 m; delay 117 ms |
| Disconnect → AI takeover / rejoin / human control | 994 ms / 3046 ms / 3244 ms after the cut |
| Record verification | accepted, 9086 ticks re-simulated bit-identically; forged lap rejected; `categoryBest` 59.26 s (car 0's human-driven lap) |
| Progress disputes | none |
| Oversize control messages | none |
| Server work per tick (wall clock, this container) | mean 4.7 ms, p99 28.9 ms, 1464 of 9086 ticks over 8.33 ms (longest streak 10), status `ok`; 1-minute load average 16 on 4 CPUs during the run (a run of this build at load 8.7: mean 3.7 ms; earlier runs: load 17, mean 6.0 ms, `degraded`; lower load, mean 1.8 ms) |

**Reading these numbers.** The drivers are `ShadowPilot`s: an AI evaluated against the authoritative
car at the moment its client samples input, whose commands then cross the simulated network, so their
control latency (≈ 150 ms) is worse than a predicting human's. Half use a *humanized* profile
(band-limited steering noise, random throttle lifts); real human inputs will still be more abrupt and
produce larger corrections than measured. Contacts (the server's impact signal) occurred late in this
run: the prediction samples within reach of one and the 5 snaps are those, which is the policy working
(contacts are never predicted; large corrections snap). Server tick timings are wall-clock in a shared
container whose load is recorded in the report, and none of it is reference-hardware evidence (§23.1).
The network, input and prediction figures and the verification outcome are reproducible from the seed
(identical across repeated runs); CPU times and session tokens (CSPRNG) are not.

## 11. Known limits

* In-memory transport only; no WebRTC/WebSocket implementation, encryption, NAT traversal or
  matchmaking. Clock drift between peers is not simulated.
* Not integrated with the browser game (`main.ts`, the physics worker or the renderer): no player
  session reaches it, so every row stays **prototype**.
* Local-car prediction is a learned kinematic model, not physics re-simulation; prediction of contacts
  and kerb strikes is deliberately absent.
* `NetDriver` routes every car through the world's AI hook (`autoPlayer`), so `LapTracker.assisted` is set
  for every online car; online records carry their own per-lap AI-assisted flag instead (`NetDriver`
  marks every tick it hands to the AI).
* No delta compression or interest management; bandwidth grows linearly with the field.
* Level-control changes are journaled up to once per tick per car (one-tick commands are legal while
  the lead adjusts), so a client that changes its controls every tick for 6 h writes ≈ 2.6 M entries;
  the verifier's bound admits that, and server memory grows with it.
* Ghost policy without contact immunity; no load shedding on tick overruns; no host migration;
  no journal persistence or restart supervisor; unauthenticated accounts.
