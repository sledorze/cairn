---
'@sledorze/cairn': patch
---

Fixes two more instances of the same quadratic-time (ReDoS) regex shape just fixed in the Markdown link checker's `LINK_RE` (see the sibling changeset in this release) — found by auditing the codebase for the same unbounded `[^\]]*`/`[^)\s]+` pattern rather than waiting for another one to surface independently. Both are real, reachable with ordinary (or adversarial) document content, not theoretical: `Anchors.ts`'s heading-anchor slugging (an inline link/image inside a heading, reduced to its own text before computing the anchor) and `ProseRefs.ts`'s bare-backtick-citation scanning (masking a real Markdown link's text span before candidate extraction) both scan every heading/every document's prose respectively. Fixed the same way — bounding every previously-unbounded quantifier at a generous 2000 characters — restoring linear-time scanning in both.
