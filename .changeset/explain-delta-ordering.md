---
'@sledorze/cairn': patch
---

`cairn check --summaries-only --explain`'s real git line-count delta (added in a prior
minor) now prints immediately below the expected/recorded hash pair for a stale file
summary, instead of below the source's full heading outline. On a large doc the delta
— the actual answer to "is this a real content change or a reflex re-stamp?" — used to
land 20+ lines below the question; it's now adjacent to it. Pure reordering: the
outline itself still always prints in full, for both `missing` and `stale` nodes — a
stale summary has to be rewritten, and the outline is exactly the source's current
section shape that a rewrite is done against (issue #162, item #2; the outline was
suppressed for stale nodes in an earlier version of this fix, then withdrawn after
further review of that issue for that same reason).
