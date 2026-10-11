/**
 * Developer tooling (reference review, session evidence, performance capture,
 * full-lap visual review, build identity, raw loader detail) stays in the
 * application for engineers and automated tests, but is never shown to
 * players. It is enabled explicitly with `?dev` (or `?dev=1`) in the URL;
 * `?dev=0` keeps it off.
 */
export function developerMode(search: string = globalThis.location?.search ?? ''): boolean {
  try {
    const params = new URLSearchParams(search);
    if (!params.has('dev')) return false;
    const value = params.get('dev')!.toLowerCase();
    return value !== '0' && value !== 'false' && value !== 'off';
  } catch {
    return false;
  }
}
