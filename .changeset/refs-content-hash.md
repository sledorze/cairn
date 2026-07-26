---
'@sledorze/cairn': minor
---

New, opt-in `cairn check --refs` (issue #39, Scenario I, v1/whole-file): with `--stamp`, records the content hash of every real reference a doc makes (a cross-file or cross-hierarchy link target) into `.cairn/refs/**`; without `--stamp`, reports any whose target content has changed since — "may be stale," a distinct signal from a broken link, since the target still exists and the link still resolves. Not part of the default `checks.links`/`checks.summaries` gate; must be explicitly requested.
