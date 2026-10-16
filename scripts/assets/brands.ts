/**
 * Brand screening for third-party content (build, validate:content, tests).
 * Kept out of src/: the application never needs the list, and source strings
 * must not carry real marks (tests/studio-look-contracts.test.ts).
 */
/**
 * Trademarks and product names that must never appear in shipped third-party
 * content, its file names or its credits (vehicle, motorcycle, tyre, fuel,
 * drinks and fashion brands, racing series and games). The circuit names of
 * `PROTECTED_NAMES` (content-validation.ts) are checked separately for the
 * catalogue; this list is about objects and logos a scan or photo could carry.
 */
export const ASSET_BRAND_WORDS = Object.freeze([
  'vespa',
  'piaggio',
  'ferrari',
  'lamborghini',
  'maserati',
  'porsche',
  'mercedes',
  'bmw',
  'audi',
  'volkswagen',
  'toyota',
  'nissan',
  'honda',
  'yamaha',
  'ducati',
  'kawasaki',
  'suzuki',
  'ktm',
  'harley',
  'mclaren',
  'bugatti',
  'aston martin',
  'red bull',
  'redbull',
  'castrol',
  'petronas',
  'pirelli',
  'michelin',
  'bridgestone',
  'goodyear',
  'dunlop',
  'coca-cola',
  'pepsi',
  'heineken',
  'marlboro',
  'rolex',
  'nike',
  'adidas',
  'formula 1',
  'formula one',
  'motogp',
  'nascar',
  'indycar',
  'forza',
  'gran turismo',
] as const);

const BRAND_PATTERN = new RegExp(
  `(^|[^a-z0-9])(${ASSET_BRAND_WORDS.map((w) => w.replace(/[-.]/g, '\\$&')).join('|')})([^a-z0-9]|$)`,
);
/** The first brand word in `text` (case-insensitive, whole words), or null. */
export function brandWordIn(text: string): string | null {
  const match = BRAND_PATTERN.exec(text.toLowerCase());
  return match ? match[2] : null;
}
