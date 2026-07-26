---
'@sledorze/cairn': patch
---

Fixes several real, user-triggerable crashes found via adversarial "no unhandled exception" review — `cairn check` (and `--refs`/`--prose-refs`) previously died with a raw internal stack trace, instead of a clean report, when scanning a docs tree containing:

- a broken symlink,
- an unreadable (permission-denied) subdirectory,
- a permission-denied doc file.

A **nested** broken symlink or unreadable subdirectory is now silently excluded from the scan (matching how an ordinary non-file directory entry is already treated) — but a **root** directory (the one you actually configured/passed) that can't be read at all still fails the run rather than being treated as empty: an earlier version of this fix conflated the two, and a permission-denied root silently reported `✅ OK, 0 file(s) checked` with exit 0 — a false "all clear" that's worse than the original crash, caught by a second, independent round of adversarial review before this shipped.

A permission-denied doc file is new, explicit, and non-silent for `cairn check`/`--links-only`: it's listed in a new `unreadable` field on the link-check result (also surfaced in `--json`), reported clearly, and makes the run exit non-zero. `--summaries-only`, `--refs`, and `--prose-refs` skip an unreadable doc without crashing, matching the same "never crash on one bad file" guarantee, though deliberately without the richer `unreadable` reporting `--links-only` gets (a wider fix there would touch `SummaryPlan`'s widely-consumed pure shape) — for `--summaries-only` specifically, an unreadable-but-existing summary currently reads as `missing` rather than distinctly `unreadable`, a known, named scope decision, not silently glossed over.

Also fixes a latent (currently unreachable) correctness landmine found via review of the recent `applyFixesToFile` extraction: the decision of whether to write a repaired file back to disk is now driven by `applyFix`'s own `changed` flag end-to-end, not by comparing before/after file content as strings — the two can legitimately disagree when a suggested replacement is textually identical to the original.
