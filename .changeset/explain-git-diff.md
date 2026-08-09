---
'@sledorze/cairn': minor
---

`cairn check --summaries-only --explain` now shows a real git line-count delta for a stale file summary (e.g. `changed since 029d0f0e…: +3/-0 lines`) instead of only the source's current outline — the "reflexive re-stamping" gap (issues #101/#142/#154): a bare hash mismatch says nothing about _what_ changed, so a human or agent re-stamps without looking. Best-effort only: silently falls back to today's output when there's no git repo, the recorded hash predates the file's available history, or the change is binary. Bounded on both axes — at most 50 past commits walked per doc, and at most 20 stale docs enriched per `--explain` run — so a large repo with many stale docs can't make this slow; later docs simply show without a diff line. No effect on `check`'s exit code, on non-`--explain` output, or when git is unavailable — purely additive.
