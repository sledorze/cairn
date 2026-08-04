// A stringify whose output represents a VALUE, not one particular way of
// constructing it. Plain `JSON.stringify` serializes object properties in
// insertion order, so two objects that are deeply equal but built with
// their keys in a different order (e.g. one from `Schema.decode`'s fixed
// field order, one from a hand-written literal) produce different strings
// — silent breakage for any caller using the string as a dedup/equality
// key (see program/structure/CheckCoverage.ts's own dedup key, the real
// caller this was extracted for). Recursively sorting object keys before
// stringifying closes that: the string depends only on the value's shape
// and content, never the order it happened to be built in.
//
// Deliberately NOT a `Schema`-decoded codec (`Schema.fromJsonString`/
// `Schema.UnknownFromJsonString`): this isn't a domain-boundary decode of
// untrusted external JSON text — it's a generic, in-memory value-to-string
// primitive for an already-typed, already-trusted value, the same
// "genuinely generic, no domain meaning" bar `core/hashing.ts`'s own
// `hashContent` is held to (see `falsestart.config.ts`'s own scoped
// exception for this file).

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const sortKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep)
  }
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = sortKeysDeep(value[key])
    }
    return sorted
  }
  return value
}

/** `JSON.stringify` with object keys sorted (recursively), so the result
 * represents the value, not its construction order. */
export const canonicalJson = (value: unknown): string => JSON.stringify(sortKeysDeep(value))
