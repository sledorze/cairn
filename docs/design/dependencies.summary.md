# Cross-package dependencies — summary

Opens with a small Mermaid context-map diagram (nodes = design packages, edges = real
dependencies only) — renders natively on GitHub's own file view; the prose below remains
the actual source of truth for any renderer without Mermaid support. Justified explicitly as
NOT repeating the earlier Team Topologies mistake: C4/DDD context-map notation is a modeling
convention used identically regardless of team size, unlike an organizational framework.

The single, top-level, non-sibling-scoped register of REAL cross-package relations —
deliberately not inside any one package directory, so a claim about a DIFFERENT package's
state never has to live as free prose inside a sibling-scoped `roadmap.md` (the failure that
motivated this file: `137-typed-relations/roadmap.md` once asserted `101-refs-symbol-scoping`'s
own release priority inline, went stale silently, and needed a hand-patched fix).

Vocabulary is plain, not borrowed from an organizational framework: **stable-interface
dependency** — consuming another package's already-shipped, stable public surface, no
ongoing coordination needed — is the ONLY kind defined, and the only one this repo has a
real instance of (an earlier Team Topologies-based draft was reverted on review as a poor
fit for a single-maintainer repo). A roadmap declares it via `external-dependency-kind:
stable-interface` frontmatter; `checks.coverage`'s `depends_on` rule then requires that
roadmap link this file. Coverage only confirms the link exists, never that the entry is
accurate — read it. This file's own freshness beyond link-existence is a disclosed,
argued-not-oversight limitation (see the file's own section): `checks.freshness` exists in
this repo but isn't wired to this file, matching the same "no real staleness incident yet"
reasoning `CONVENTION.md` already applies to not enabling it anywhere else.

**Real relation recorded:** `137-typed-relations` → `101-refs-symbol-scoping`
(stable-interface dependency) — 137's on-hold Release 2 is scoped to reuse 101's
spike-4-validated scanner primitive; 101's own Release 1 (`refs.scope`) has shipped,
closing the stale "should ship first" claim this file replaces. 137's Release 2 itself
stays on hold, gated on a real second recurrence per its own roadmap.
