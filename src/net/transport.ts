import { UDP_IP_OVERHEAD_BYTES } from './constants.ts';
import { NetRandom, type EventLoop } from './event-loop.ts';

/** Two delivery classes. `unreliable` behaves like a datagram (may be lost,
 * duplicated or reordered); `reliable` is ordered and eventually delivered,
 * with head-of-line delay when a segment is lost (TCP/SCTP-like). A browser
 * build maps these onto WebRTC data channels; a WebSocket-only build would
 * carry both reliably and pay head-of-line blocking on inputs. */
export type Channel = 'reliable' | 'unreliable';

/** The only surface the client and server code use. Nothing in src/net
 * depends on the in-memory implementation below. */
export interface Transport {
  readonly label: string;
  readonly open: boolean;
  send(data: Uint8Array, channel: Channel): void;
  onMessage: ((data: Uint8Array, channel: Channel) => void) | null;
  onClose: ((reason: string) => void) | null;
  close(reason: string): void;
}

/** One direction of a simulated link. Times are one-way, in ms. */
export interface LinkConditions {
  latencyMs: number;
  /** Standard deviation of the per-packet delay variation. */
  jitterMs: number;
  /** Probability a datagram (or a reliable segment's first try) is lost. */
  loss: number;
  duplicate: number;
  /** Probability a datagram is held back long enough to arrive out of order. */
  reorder: number;
}
export const PERFECT_LINK: LinkConditions = Object.freeze({
  latencyMs: 0,
  jitterMs: 0,
  loss: 0,
  duplicate: 0,
  reorder: 0,
});
/** 100 ms round trip, 2% loss, modest jitter and reordering (the slice target). */
export const TARGET_LINK: LinkConditions = Object.freeze({
  latencyMs: 50,
  jitterMs: 4,
  loss: 0.02,
  duplicate: 0.005,
  reorder: 0.01,
});

export interface DirectionStats {
  packets: number;
  payloadBytes: number;
  /** Payload plus per-datagram IP/UDP overhead. */
  wireBytes: number;
  reliablePayloadBytes: number;
  unreliablePayloadBytes: number;
  dropped: number;
  duplicated: number;
  reordered: number;
  retransmits: number;
  delivered: number;
}
const emptyStats = (): DirectionStats => ({
  packets: 0,
  payloadBytes: 0,
  wireBytes: 0,
  reliablePayloadBytes: 0,
  unreliablePayloadBytes: 0,
  dropped: 0,
  duplicated: 0,
  reordered: 0,
  retransmits: 0,
  delivered: 0,
});

class SimulatedEndpoint implements Transport {
  onMessage: ((data: Uint8Array, channel: Channel) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  peer!: SimulatedEndpoint;
  closed = false;
  /** Earliest time the next reliable message may be delivered (ordering). */
  reliableClock = 0;
  readonly stats = emptyStats();
  constructor(
    readonly label: string,
    private readonly link: SimulatedLink,
    public conditions: LinkConditions,
  ) {}
  get open() {
    return !this.closed;
  }
  send(data: Uint8Array, channel: Channel) {
    if (this.closed) return;
    this.link.transmit(this, data, channel);
  }
  close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.link.notifyClose(this, reason);
  }
}

/** A bidirectional link between one client and the server. */
export class SimulatedLink {
  readonly client: SimulatedEndpoint;
  readonly server: SimulatedEndpoint;
  /** A severed link silently loses everything (cable pulled, NAT expiry):
   * neither side is told, so only timeouts detect it. */
  severed = false;
  constructor(
    private readonly loop: EventLoop,
    private readonly random: NetRandom,
    up: LinkConditions,
    down: LinkConditions,
    label: string,
  ) {
    this.client = new SimulatedEndpoint(`${label}:client`, this, { ...up });
    this.server = new SimulatedEndpoint(`${label}:server`, this, { ...down });
    this.client.peer = this.server;
    this.server.peer = this.client;
  }
  get upStats() {
    return this.client.stats;
  }
  get downStats() {
    return this.server.stats;
  }
  sever() {
    this.severed = true;
  }
  private delay(c: LinkConditions) {
    return Math.max(c.latencyMs * 0.5, c.latencyMs + c.jitterMs * this.random.gaussian());
  }
  transmit(from: SimulatedEndpoint, data: Uint8Array, channel: Channel) {
    const c = from.conditions,
      s = from.stats,
      copy = data.slice();
    s.packets++;
    s.payloadBytes += copy.length;
    s.wireBytes += copy.length + UDP_IP_OVERHEAD_BYTES;
    if (channel === 'reliable') s.reliablePayloadBytes += copy.length;
    else s.unreliablePayloadBytes += copy.length;
    if (this.severed) {
      s.dropped++;
      return;
    }
    const to = from.peer;
    if (channel === 'reliable') {
      // Each lost try costs a retransmission timeout; later messages wait.
      let at = this.loop.now + this.delay(c);
      const rto = Math.max(200, 2 * c.latencyMs + 4 * c.jitterMs);
      while (this.random.next() < c.loss) {
        s.retransmits++;
        s.wireBytes += copy.length + UDP_IP_OVERHEAD_BYTES;
        at += rto;
      }
      at = Math.max(at, from.reliableClock);
      from.reliableClock = at;
      this.loop.at(at, () => this.deliver(from, to, copy, channel));
      return;
    }
    if (this.random.next() < c.loss) {
      s.dropped++;
      return;
    }
    let at = this.loop.now + this.delay(c);
    if (this.random.next() < c.reorder) {
      s.reordered++;
      at += 5 + this.random.next() * (2 * c.jitterMs + 30);
    }
    this.loop.at(at, () => this.deliver(from, to, copy, channel));
    if (this.random.next() < c.duplicate) {
      s.duplicated++;
      const again = this.loop.now + this.delay(c) + this.random.next() * 20;
      this.loop.at(again, () => this.deliver(from, to, copy.slice(), channel));
    }
  }
  private deliver(
    from: SimulatedEndpoint,
    to: SimulatedEndpoint,
    data: Uint8Array,
    channel: Channel,
  ) {
    // Data already in flight when the link is cut is lost too; data sent
    // before a graceful close still arrives (close follows it in order).
    if (this.severed || to.closed) return;
    from.stats.delivered++;
    to.onMessage?.(data, channel);
  }
  notifyClose(from: SimulatedEndpoint, reason: string) {
    if (this.severed) return;
    const to = from.peer,
      at = Math.max(this.loop.now + this.delay(from.conditions), from.reliableClock);
    this.loop.at(at, () => {
      if (to.closed) return;
      to.closed = true;
      to.onClose?.(reason);
    });
  }
}

/** In-memory network: hands out linked client/server transport pairs whose
 * deliveries are scheduled on the shared event loop with seeded conditions. */
export class NetworkSimulator {
  private readonly random: NetRandom;
  readonly links: SimulatedLink[] = [];
  constructor(
    private readonly loop: EventLoop,
    seed = 1,
  ) {
    this.random = new NetRandom(seed);
  }
  connect(up: LinkConditions, down: LinkConditions = up, label = `link${this.links.length}`) {
    const link = new SimulatedLink(this.loop, this.random, up, down, label);
    this.links.push(link);
    return { client: link.client as Transport, server: link.server as Transport, link };
  }
}
