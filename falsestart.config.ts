import type { FalsestartConfig } from '@sledorze/falsestart'

// `core/canonicalJson.ts` is a generic value-to-string primitive used only
// as a structural-equality/dedup key (never parsed back), not a decode
// boundary for untrusted input or a domain object's encode/decode codec —
// the same "genuinely generic, no domain meaning" case `no-json-global`'s
// own rule doc names as its one honest exception (it scopes itself out of
// the rule for exactly this reason, serializing a literal for an external
// wire protocol). Comparable-key serialization is a second instance of
// that same exception: there is no decode side to keep in step because the
// string is never parsed, only compared.
export default {
  rules: {
    'no-json-global': {
      files: ['**/*.{ts,tsx,mts,cts}'],
      ignores: [
        '**/*.test.{ts,tsx,mts,cts}',
        '**/*.spec.{ts,tsx,mts,cts}',
        '**/*.bench.{ts,tsx,mts,cts}',
        'src/core/canonicalJson.ts',
      ],
    },
  },
} satisfies FalsestartConfig
