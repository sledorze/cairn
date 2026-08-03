# Design packages

Full problem-space → solution-space → roadmap design work for non-trivial issues, done
before implementation starts — distinct from `docs/adr/`, which records the resulting
DECISION concisely; these packages carry the full reasoning and evidence behind it.

- [Convention](./CONVENTION.md) — the required package shape, and how `checks.coverage`
  (an existing cairn feature, not a new one) enforces it structurally — reusable by any
  cairn consumer for their own design docs.
- [101 — `--refs` symbol/export-scoped hashing](./101-refs-symbol-scoping/_SUMMARY.md)
