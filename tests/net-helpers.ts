import {
  DEFAULT_OPTIONS,
  controls,
  validateOptions,
  type SessionOptions,
} from '../src/simulation/config.ts';
import type { RecordedSessionIdentity } from '../src/core/session-identity.ts';
import { RaceClient, type InputSource } from '../src/net/client.ts';
import { EventLoop } from '../src/net/event-loop.ts';
import { Lobby, type ModerationHooks } from '../src/net/lobby.ts';
import { RaceServer, type RaceServerConfig } from '../src/net/server.ts';
import { NetworkSimulator, TARGET_LINK, type LinkConditions } from '../src/net/transport.ts';

/** Shared fixture for the online tests: one server, an in-memory network and
 * a factory for clients. Not a test file (no `.test.ts` suffix). */
export function onlineFixture(
  options: {
    capacity?: number;
    minPlayers?: number;
    raceSeconds?: number;
    link?: LinkConditions;
    moderation?: ModerationHooks;
    server?: Partial<RaceServerConfig>;
    session?: Partial<SessionOptions>;
  } = {},
) {
  const loop = new EventLoop(),
    net = new NetworkSimulator(loop, 17),
    capacity = options.capacity ?? 2,
    session = validateOptions({
      ...DEFAULT_OPTIONS,
      mode: 'race',
      laps: 1,
      opponents: capacity - 1,
      seed: 99,
      ...options.session,
    });
  const created = Lobby.create(
    'T',
    {
      name: 'Test',
      options: session,
      capacity,
      fieldSize: capacity,
      minPlayers: options.minPlayers ?? capacity,
    },
    options.moderation,
  );
  if (!created.ok) throw new Error(created.reasons.join('; '));
  const server = new RaceServer({
    loop,
    lobby: created.lobby,
    raceSeconds: options.raceSeconds ?? 1,
    moderation: options.moderation,
    ...options.server,
  });
  const cruise: InputSource = () => ({ ...controls(), throttle: 0.35 });
  const connect = (
    name: string,
    extra: {
      vehicle?: string;
      identity?: (id: RecordedSessionIdentity) => RecordedSessionIdentity;
      input?: InputSource;
      token?: string;
      account?: string;
      autoReady?: boolean;
      link?: LinkConditions;
    } = {},
  ) => {
    const pair = net.connect(extra.link ?? options.link ?? TARGET_LINK);
    server.accept(pair.server);
    const client = new RaceClient({
      loop,
      transport: pair.client,
      name,
      vehicle: extra.vehicle ?? 'apx01',
      advertised: session,
      input: extra.input ?? cruise,
      autoReady: extra.autoReady ?? true,
      ...(extra.identity ? { identity: extra.identity } : {}),
      ...(extra.token ? { token: extra.token } : {}),
      ...(extra.account ? { account: extra.account } : {}),
    });
    client.join();
    return { client, link: pair.link, transport: pair.client };
  };
  return { loop, net, server, session, connect, lobby: created.lobby };
}
