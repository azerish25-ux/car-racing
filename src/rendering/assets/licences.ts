/**
 * Licence policy for third-party content (docs/ASSET_PROVENANCE.md).
 *
 * Only these SPDX licences may ship. CC-BY licences need a visible credit
 * (the in-game "Credits & licences" view lists every manifest entry); MIT
 * needs its copyright and permission notice shipped with the files.
 */
export const ALLOWED_LICENCES = Object.freeze([
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-2.0',
  'MIT',
] as const);
export type Licence = (typeof ALLOWED_LICENCES)[number];

export const LICENCE_INFO: Readonly<
  Record<Licence, { name: string; url: string; attribution: boolean; notice: boolean }>
> = Object.freeze({
  'CC0-1.0': {
    name: 'CC0 1.0 Universal (public domain dedication)',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: false,
    notice: false,
  },
  'CC-BY-4.0': {
    name: 'Creative Commons Attribution 4.0 International',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: true,
    notice: false,
  },
  'CC-BY-2.0': {
    name: 'Creative Commons Attribution 2.0 Generic',
    url: 'https://creativecommons.org/licenses/by/2.0/',
    attribution: true,
    notice: false,
  },
  MIT: {
    name: 'MIT License',
    url: 'https://opensource.org/license/mit',
    attribution: true,
    notice: true,
  },
});

export function isAllowedLicence(value: unknown): value is Licence {
  return typeof value === 'string' && (ALLOWED_LICENCES as readonly string[]).includes(value);
}
