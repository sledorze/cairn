// Report language. Only user-facing report strings are localised. `Locale` itself
// lives in `core/Config.ts` (it's a config field type) and is re-exported here so
// existing `program/`-relative imports keep working.

import type { Locale } from '../core/Config.ts'

export type { Locale } from '../core/Config.ts'

/** Pick the value for `locale` from an `{ en, fr }` pair. */
export const pick = <T>(locale: Locale, values: { readonly en: T; readonly fr: T }): T => values[locale]

/** English-only text for a `pick()` call, e.g. new debug-oriented output not worth translating. */
export const enOnly = <T>(value: T): { readonly en: T; readonly fr: T } => ({ en: value, fr: value })
