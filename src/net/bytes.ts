/** Bounds-checked little-endian binary writer/reader. Every decode of peer
 * data goes through ByteReader, which throws DecodeError (never RangeError
 * or a silently short value) on truncated or malformed input. */
export class DecodeError extends Error {}

export class ByteWriter {
  private buffer: Uint8Array;
  private view: DataView;
  length = 0;
  constructor(capacity = 256) {
    this.buffer = new Uint8Array(capacity);
    this.view = new DataView(this.buffer.buffer);
  }
  private reserve(n: number) {
    if (this.length + n <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) {
    this.reserve(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
    return this;
  }
  i8(v: number) {
    this.reserve(1);
    this.view.setInt8(this.length, v);
    this.length += 1;
    return this;
  }
  u16(v: number) {
    this.reserve(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
    return this;
  }
  i16(v: number) {
    this.reserve(2);
    this.view.setInt16(this.length, v, true);
    this.length += 2;
    return this;
  }
  u32(v: number) {
    this.reserve(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
    return this;
  }
  f32(v: number) {
    this.reserve(4);
    this.view.setFloat32(this.length, v, true);
    this.length += 4;
    return this;
  }
  f64(v: number) {
    this.reserve(8);
    this.view.setFloat64(this.length, v, true);
    this.length += 8;
    return this;
  }
  /** Unsigned LEB128 for small non-negative integers. */
  varint(v: number) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error('varint must be a non-negative integer');
    do {
      let byte = v % 128;
      v = Math.floor(v / 128);
      if (v > 0) byte |= 0x80;
      this.u8(byte);
    } while (v > 0);
    return this;
  }
  bytes(data: Uint8Array) {
    this.reserve(data.length);
    this.buffer.set(data, this.length);
    this.length += data.length;
    return this;
  }
  finish() {
    return this.buffer.slice(0, this.length);
  }
}

export class ByteReader {
  private readonly view: DataView;
  offset = 0;
  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  get remaining() {
    return this.data.length - this.offset;
  }
  private need(n: number) {
    if (this.offset + n > this.data.length) throw new DecodeError('Message is truncated');
  }
  u8() {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }
  i8() {
    this.need(1);
    return this.view.getInt8(this.offset++);
  }
  u16() {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  i16() {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    if (!Number.isFinite(v)) throw new DecodeError('Non-finite value');
    return v;
  }
  f64() {
    this.need(8);
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    if (!Number.isFinite(v)) throw new DecodeError('Non-finite value');
    return v;
  }
  varint() {
    let value = 0,
      scale = 1;
    for (let i = 0; i < 8; i++) {
      const byte = this.u8();
      value += (byte & 0x7f) * scale;
      if (!(byte & 0x80)) return value;
      scale *= 128;
    }
    throw new DecodeError('varint is too long');
  }
  bytes(n: number) {
    this.need(n);
    const out = this.data.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  end() {
    if (this.remaining !== 0) throw new DecodeError('Trailing bytes after message');
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Base64 without platform dependencies (Node and browsers alike). */
export function toBase64(data: Uint8Array) {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i],
      b = i + 1 < data.length ? data[i + 1] : 0,
      c = i + 2 < data.length ? data[i + 2] : 0,
      n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < data.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < data.length ? B64[n & 63] : '=';
  }
  return out;
}
export function fromBase64(text: string): Uint8Array {
  if (typeof text !== 'string' || text.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(text))
    throw new DecodeError('Invalid base64');
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  if (text.slice(0, text.length - pad).includes('=')) throw new DecodeError('Invalid base64');
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n =
      (B64.indexOf(text[i]) << 18) |
      (B64.indexOf(text[i + 1]) << 12) |
      ((text[i + 2] === '=' ? 0 : B64.indexOf(text[i + 2])) << 6) |
      (text[i + 3] === '=' ? 0 : B64.indexOf(text[i + 3]));
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
