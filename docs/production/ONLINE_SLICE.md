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
`events {events}` (lap completions, finishes, driver hand-overs), `results {results}`,
`kicked {reason}`, `pong`.

**Size limits:** datagrams ≤ 1200 B, client control messages ≤ 8 KiB, server control messages
≤ 32 KiB (a full classification), ≤ 16 commands per packet, ≤ 32 cars per snapshot. Oversize, truncated,
trailing-byte, non-finite or unknown messages are dropped and counted as a strike.

## 3. Timing, input lead and acknowledgement

The client estimates the newest server tick it could have seen from the least-delayed snapshot arrival
in a 2 s window (`ServerClock`) and the arrival jitter from the spread of the others. It stamps each
command with the server tick it is meant for, running ahead by a *lead* of ≈ RTT plus margin. The server
reports, per snapshot, the smallest margin by which new commands beat their first tick (*slack*); the
client grows the lead quickly when slack falls below `1.5 + 2 × jitter` ticks and shrinks it slowly when
slack is generous, by issuing 3-tick or 1-tick commands instead of 2 — the command stream stays
contiguous. Measured: lead 18 ticks (150 ms) at 100 ms RTT.

The server keeps one `ServerInputQueue` per driver: duplicates are dropped by sequence number, commands
wholly in the past are counted late, commands more than 240 ticks (2 s) ahead are rejected, and a gap
whose successor has already started is never waited on. A tick with no command repeats the previous
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
  (`tests/net-authority.test.ts`), so the online path does not change single-player physics.
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
2. **Grid.** When the lobby's ready check passes, the server builds the field (members in join order,
   AI to the field size), sends `grid` with the full-field identity, and starts ticking 1.5 s later. The
   client checks every grid vehicle against its own content and leaves with a reason if it cannot
   present the field.
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
end tick, and the claim: classification order, laps, every lap time, best laps, a state hash every 10 s
and the final state hash. `verifyRecord` trusts none of it:

1. format, version and bounds; the digest (catches corruption — it is not a signature);
2. options must already be canonical (`validateOptions` round trip): a verifier never repairs a claim;
3. the identity must match this build's content and `SIMULATION_VERSION`; the category must be
   compatible (`recordIncompatibility`);
4. the journal must decode and stay inside the session;
5. headless re-simulation, failing fast at the first divergent checkpoint or lap;
6. every lap time, lap count, best lap, the order and the final hash must be bit-identical.

Tests prove that a lap time forged by 0.25 s (or 0.5 s in the slice script) with a recomputed digest is
rejected by re-simulation, that a 3-LSB steering change in the journal is rejected at the next
checkpoint, and that edited circuit/vehicle/ruleset hashes, another physics version, another seed or
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
one; account authentication belongs to the platform and is not implemented here.

## 8. Resilience (WP54)

| Situation | Behaviour | Test |
|---|---|---|
| Connection silent 1 s | AI takeover (`ai-takeover`), or `ghost`: AI keeps the car moving, flagged GHOST, classified behind running cars | `net-resilience`, slice |
| Commands stop for 250 ms, link alive | AI holds the car until commands resume | `net-resilience` |
| Rejoin with token inside 30 s | Same car; AI holds it until the new connection's first command | `net-resilience`, slice |
| Rejoin after the window, forfeited or unknown token | Rejected with a reason | `net-resilience` |
| Loss, duplication, reordering | Redundant commands, sequence dedup, out-of-order snapshots feed only the interpolation buffer | `net-resilience` (10% loss/dup/reorder), slice |
| Non-finite or out-of-range input | Client rejects/clamps; wire format bounds every field; server clamps again | `net-codec`, `net-resilience` |
| Oversize, malformed, flooding | Dropped, strike; 40 strikes → kicked | `net-codec`, `net-resilience` |
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
| Impersonation, session hijack | 128-bit rejoin tokens; account ids for bans | Tokens come from a seeded generator in tests (CSPRNG required); no transport encryption or platform authentication in the in-memory slice |
| Flooding / resource exhaustion | Token buckets, strikes and kick, size limits, join timeout, bounded queues and lead window | No per-IP limits (no IP layer); verification has a 6 h tick cap and fails fast |
| Forged results or records | Headless re-simulation from inputs; checkpoints; exact lap times | Records are not signed; automated (bot) inputs are valid inputs |
| Modified content (cars, circuit) | Identity hashes compared on join and at grid; the server simulates with its own content regardless | FNV-1a is not cryptographic; it detects mismatch, it does not authenticate |
| Information leakage | Snapshots carry only race state, names and server-assigned ids | All car positions are sent to everyone (no interest management) |

## 10. Measured result (`npm run test:online`)

Eight clients, Aurel, 60 s of racing after the green light (65.7 s session clock), 100 ms RTT (50 ms each
way), 4 ms jitter, 2% loss, 0.5% duplication, 1% reordering, one client's link cut for 3 s at 20 s and
reconnected with its token. Full numbers in [`docs/online-slice.json`](../online-slice.json).

| Measure | Value |
|---|---|
| Downlink per client (payload / wire) | 55.5 / 60.0 kbit/s (WP49 estimate: 43.5 kbit/s payload) |
| Uplink per client (payload / wire) | 21.1 / 27.8 kbit/s |
| Snapshot size (8 cars) / input packet | 347 B / 88 B mean |
| Copies sent per command | 4.4 |
| Input lead | 18 ticks (150 ms) |
| Missing / late input ticks | 142 of 62 491 (111 of them on the cut-off car before the takeover) / 34 |
| Local-car prediction error (shown pose vs authority) | mean 0.040 m, p95 0.137 m, p99 0.26 m, max 1.1 m; heading p95 0.96° |
| Correction jump before smoothing | mean 0.035 m, p95 0.128 m, max 1.03 m; 0 snaps |
| Per-frame motion added by smoothing | p95 0.019 m |
| Remote interpolation error (vs server truth) | p95 0.3 mm, max 0.97 m; delay 117 ms |
| Disconnect → AI takeover / rejoin / human control | 994 ms / 3046 ms / 3236 ms after the cut |
| Record verification | accepted, 7886 ticks re-simulated bit-identically; forged lap rejected |
| Progress disputes | none |
| Server work per tick (wall clock, this container) | mean 6.0 ms, p99 39 ms, 1866 of 7886 ticks over 8.33 ms → `degraded`; 1-minute load average 17 on 4 CPUs during the run (an earlier run at lower load: mean 1.8 ms) |

**Reading these numbers.** The drivers are `ShadowPilot`s: an AI evaluated against the authoritative
car at the moment its client samples input, whose commands then cross the simulated network, so their
control latency (≈ 150 ms) is worse than a predicting human's. Half use a *humanized* profile
(band-limited steering noise, random throttle lifts); real human inputs will still be more abrupt and
produce larger corrections than measured. No car-to-car contact happened in the measured run, so contact
corrections are covered only by unit tests. Server tick timings are wall-clock in a shared container
whose load is recorded in the report; the `degraded` status above is that load, not a budget result, and
none of it is reference-hardware evidence (§23.1). The network, input and prediction figures and the
verification outcome are reproducible from the seed (identical across repeated runs); CPU times are not.

## 11. Known limits

* In-memory transport only; no WebRTC/WebSocket implementation, encryption, NAT traversal or
  matchmaking. Clock drift between peers is not simulated.
* Not integrated with the browser game (`main.ts`, the physics worker or the renderer): no player
  session reaches it, so every row stays **prototype**.
* Local-car prediction is a learned kinematic model, not physics re-simulation; prediction of contacts
  and kerb strikes is deliberately absent.
* `NetDriver` routes every car through the world's AI hook (`autoPlayer`), so `LapTracker.assisted` is set
  for every online car; online records do not use that flag.
* No delta compression or interest management; bandwidth grows linearly with the field.
* Ghost policy without contact immunity; no load shedding on tick overruns; no host migration;
  no journal persistence or restart supervisor; unauthenticated accounts.
