# Architectural Decision Records

Decisions that are hard to reverse, surprising without context, or the result of a real
trade-off — recorded once, not re-litigated.

- [0001 — Optional external link liveness checks, scheduled and non-blocking by default](./0001-optional-external-link-liveness-checks.md)
- [0002 — Structural coverage/orphan check: direct links only, orphan status scoped to declared `to`-kinds](./0002-coverage-orphan-check-scoped-to-declared-to-kinds.md)
- [0003 — A CheckPlugin registry for links/refs/proseRefs/coverage — summaries stays hand-wired](./0003-check-plugin-registry.md)
- [0004 — `--refs` hashing granularity: scope config first, export-surface hashing second, symbol citations only if still needed](./0004-refs-scoped-hashing-granularity.md)
- [0005 — Design packages are structurally enforced by the existing `checks.coverage` kinds/rules — no new config primitive](./0005-design-packages-structurally-enforced-by-existing-coverage.md)
