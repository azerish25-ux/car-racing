import type * as T from 'three';

/** Pending sub-ranges an attribute may hold before one full upload is cheaper. */
const MAX_PENDING_RANGES = 16;

/** Upload only items `first..last` (inclusive) of a dynamic attribute at its
 * next render. Ranges added before that render merge; an empty span is a
 * no-op, so an unchanged attribute costs no transfer at all. */
export function markItems(attribute: T.BufferAttribute, first: number, last: number) {
  if (last < first) return;
  const size = attribute.itemSize;
  if (attribute.updateRanges.length >= MAX_PENDING_RANGES) markAll(attribute);
  else {
    attribute.addUpdateRange(first * size, (last - first + 1) * size);
    attribute.needsUpdate = true;
  }
}

/** Upload the whole attribute at its next render. An explicit full range,
 * rather than an empty range list, keeps later partial marks in the same
 * frame from narrowing the upload. */
export function markAll(attribute: T.BufferAttribute) {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, attribute.array.length);
  attribute.needsUpdate = true;
}
