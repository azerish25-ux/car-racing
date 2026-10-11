/**
 * Exact-size download of one authored, integrity-checked asset (A01-A04,
 * A21, A51-A54).
 *
 * Two failure modes used to be misreported:
 *
 *  - a slow but healthy connection was killed by a fixed 60 s budget for the
 *    whole transfer, even while bytes kept arriving. The budget is now a STALL
 *    timeout: it restarts with every received chunk, so a slow link finishes
 *    and only a connection that delivers nothing for `stallMs` is abandoned;
 *  - a request resolved against the wrong base URL (a look-dev page in a sub
 *    directory, a mis-deployed build) is answered by the dev server's or CDN's
 *    SPA fallback with `200 text/html`. That used to surface as "Truncated
 *    A01 download"; it is now named for what it is.
 *
 * Exact byte count, byte budget and cancellation semantics are unchanged.
 */
export const AUTHORED_DOWNLOAD = Object.freeze({ stallMs: 30000, pollMs: 50 });

export interface AuthoredDownload {
  /** Asset id used in messages, e.g. `A01`. */
  label: string;
  /** Human name for the HTTP failure message, e.g. `A01 barriers`. */
  title: string;
  /** Exact expected byte length (from the manifest). */
  bytes: number;
  url: string;
  cancelled: () => boolean;
  fetcher: typeof fetch;
  aborted: () => DOMException;
  stallMs?: number;
}

export async function downloadAuthoredAsset(o: AuthoredDownload) {
  if (o.cancelled()) throw o.aborted();
  const controller = new AbortController(),
    stallMs = o.stallMs ?? AUTHORED_DOWNLOAD.stallMs;
  let stalled = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallMs);
  };
  const poll = setInterval(() => {
    if (o.cancelled()) controller.abort();
  }, AUTHORED_DOWNLOAD.pollMs);
  const failure = (error: unknown) => {
    if (o.cancelled()) return o.aborted();
    if (stalled)
      return new Error(`${o.label} download stalled: no data for ${Math.round(stallMs / 1000)} s`);
    return error;
  };
  arm();
  try {
    let response: Response;
    try {
      // Called unbound: `fetch` throws "Illegal invocation" with any other receiver.
      const fetcher = o.fetcher;
      response = await fetcher(o.url, { signal: controller.signal });
    } catch (error) {
      throw failure(error);
    }
    if (!response.ok || !response.body)
      throw new Error(`Unable to load ${o.title} (${response.status})`);
    const type = response.headers.get('content-type') ?? '';
    if (/text\/html/i.test(type)) {
      await response.body.cancel().catch(() => undefined);
      throw new Error(
        `${o.label} request was answered with an HTML page, not the asset: wrong asset base URL (${o.url})`,
      );
    }
    // Without a transfer encoding the advertised length is the payload length.
    const advertised = Number(response.headers.get('content-length') ?? NaN);
    if (
      !response.headers.get('content-encoding') &&
      Number.isFinite(advertised) &&
      advertised > 0
    ) {
      if (advertised > o.bytes) {
        await response.body.cancel().catch(() => undefined);
        throw new Error(`${o.label} download exceeds byte budget`);
      }
      if (advertised < o.bytes) {
        await response.body.cancel().catch(() => undefined);
        throw new Error(
          `Truncated ${o.label} download: server offers ${advertised} of ${o.bytes} bytes`,
        );
      }
    }
    const bytes = new Uint8Array(o.bytes),
      reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          throw failure(error);
        }
        if (chunk.done) break;
        if (o.cancelled() || controller.signal.aborted) throw failure(o.aborted());
        const value = chunk.value;
        if (size + value.length > bytes.length)
          throw new Error(`${o.label} download exceeds byte budget`);
        bytes.set(value, size);
        size += value.length;
        arm();
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (size !== bytes.length)
      throw new Error(`Truncated ${o.label} download: ${size} of ${o.bytes} bytes received`);
    if (o.cancelled()) throw o.aborted();
    return bytes;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}
