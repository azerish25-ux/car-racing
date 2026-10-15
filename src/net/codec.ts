import { ByteReader, ByteWriter, DecodeError } from './bytes.ts';
import { LIMITS } from './constants.ts';
import { readInputPacket, writeInputPacket, type InputPacket } from './input.ts';
import { validateClientControl, type ClientControl, type ServerControl } from './messages.ts';
import { readSnapshot, writeSnapshot, type Snapshot } from './snapshot.ts';
import type { Channel } from './transport.ts';

/** First byte of every message. */
export const MSG = Object.freeze({ INPUT: 1, SNAPSHOT: 2, CONTROL: 3 });

export type Decoded<T> = { ok: true; value: T } | { ok: false; reason: string };
export type ClientMessage =
  | { type: 'input'; packet: InputPacket }
  | { type: 'control'; control: ClientControl };
export type ServerMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'control'; control: ServerControl };

const encoder = new TextEncoder(),
  decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeInput(packet: InputPacket) {
  const w = new ByteWriter(16 + packet.commands.length * 8).u8(MSG.INPUT);
  writeInputPacket(w, packet);
  return w.finish();
}
export function encodeSnapshot(snapshot: Snapshot) {
  const w = new ByteWriter(32 + snapshot.cars.length * 52).u8(MSG.SNAPSHOT);
  writeSnapshot(w, snapshot);
  return w.finish();
}
export function encodeControl(message: ClientControl | ServerControl) {
  const body = encoder.encode(JSON.stringify(message)),
    out = new Uint8Array(body.length + 1);
  out[0] = MSG.CONTROL;
  out.set(body, 1);
  return out;
}

const byteLength = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
/** Split a list into control messages that each fit `limit` once encoded
 * (`wrap(part, from)` builds the message for items[from, from + part.length)).
 * A single item too large for any message is skipped and reported. */
export function chunkMessages<T, M extends ClientControl | ServerControl>(
  items: readonly T[],
  wrap: (part: T[], from: number) => M,
  onOversize: () => void = () => {},
  limit = sizeLimit('reliable', true),
): M[] {
  const out: M[] = [];
  let i = 0;
  while (i < items.length) {
    const from = i,
      part: T[] = [];
    // JSON arrays have no whitespace: size = empty message + items + commas.
    let size = 1 + byteLength(wrap([], from));
    while (i < items.length) {
      const add = byteLength(items[i]) + (part.length ? 1 : 0);
      if (size + add > limit) break;
      size += add;
      part.push(items[i++]);
    }
    if (part.length) out.push(wrap(part, from));
    else {
      onOversize();
      i++;
    }
  }
  return out;
}

/** Size limit per channel and direction (WP54 message size limits). */
export function sizeLimit(channel: Channel, fromServer: boolean) {
  if (channel === 'unreliable') return LIMITS.datagramBytes;
  return fromServer ? LIMITS.resultBytes : LIMITS.reliableBytes;
}

/** Decode an untrusted client message. Never throws. */
export function decodeClientMessage(data: Uint8Array, channel: Channel): Decoded<ClientMessage> {
  if (!(data instanceof Uint8Array) || data.length < 1)
    return { ok: false, reason: 'empty message' };
  if (data.length > sizeLimit(channel, false))
    return { ok: false, reason: `message of ${data.length} B exceeds the ${channel} limit` };
  try {
    if (data[0] === MSG.INPUT) {
      const r = new ByteReader(data.subarray(1)),
        packet = readInputPacket(r);
      r.end();
      return { ok: true, value: { type: 'input', packet } };
    }
    if (data[0] === MSG.CONTROL) {
      if (channel !== 'reliable') return { ok: false, reason: 'control messages must be reliable' };
      const parsed: unknown = JSON.parse(decoder.decode(data.subarray(1)));
      const control = validateClientControl(parsed);
      if (typeof control === 'string') return { ok: false, reason: control };
      return { ok: true, value: { type: 'control', control } };
    }
    return { ok: false, reason: `unknown message type ${data[0]}` };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof DecodeError || error instanceof SyntaxError || error instanceof TypeError
          ? error.message
          : 'malformed message',
    };
  }
}

/** Decode a server message on the client. Never throws. */
export function decodeServerMessage(data: Uint8Array, channel: Channel): Decoded<ServerMessage> {
  if (!(data instanceof Uint8Array) || data.length < 1)
    return { ok: false, reason: 'empty message' };
  if (data.length > sizeLimit(channel, true)) return { ok: false, reason: 'message too large' };
  try {
    if (data[0] === MSG.SNAPSHOT) {
      const r = new ByteReader(data.subarray(1)),
        snapshot = readSnapshot(r);
      r.end();
      return { ok: true, value: { type: 'snapshot', snapshot } };
    }
    if (data[0] === MSG.CONTROL) {
      const parsed = JSON.parse(decoder.decode(data.subarray(1))) as ServerControl;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string')
        return { ok: false, reason: 'invalid control message' };
      return { ok: true, value: { type: 'control', control: parsed } };
    }
    return { ok: false, reason: `unknown message type ${data[0]}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'malformed message' };
  }
}
