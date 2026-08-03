---
'@sledorze/cairn': patch
---

Fixed link-completeness rejecting a link from a parent `_SUMMARY.md` straight to a child directory's own `_SUMMARY.md` (closes #103). Previously only a bare directory link (e.g. `[docs/](./docs)`) satisfied the check; `[docs/](./docs/_SUMMARY.md)` was reported as a missing child link even though it points at the curated index — the more precise, GitHub-rendering-friendly destination, and exactly the artifact whose content hash the summary tree tracks for that child. Both link forms now count.

This is a **loosening**: a repo that previously carried both links (the documented workaround) is unaffected; a repo that only ever wrote the bare directory link is also unaffected. No existing passing config can newly fail.
