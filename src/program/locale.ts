// Report language. English is the default for broad reuse; French mirrors the
// tool's origin. Only user-facing report strings are localised.

export type Locale = 'en' | 'fr'

/** Pick the value for `locale` from an `{ en, fr }` pair. */
export const pick = <T>(locale: Locale, values: { readonly en: T; readonly fr: T }): T => values[locale]
