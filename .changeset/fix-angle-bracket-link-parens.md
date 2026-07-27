---
'@sledorze/cairn': patch
---

Two fixes to the Markdown link checker, both in the same link-extraction regex:

1. **False dead-link report for a `<...>`-wrapped destination.** CommonMark's own way to let a URL contain a literal `)` without it being confused for the link's own closing paren (a real, not-uncommon shape for Wikipedia/LibreTexts-style URLs) — `[text](<https://example.com/path_(with_parens)/more>)`. The link-extraction regex captured the `<`/`>` delimiters as part of the target instead of reading verbatim to the matching `>` first, which had two effects: an internal `)` truncated the captured target mid-URL, and — more broadly — the leaked leading `<` broke scheme detection (`isCheckableTarget`) so _any_ angle-bracket-wrapped external URL, parens or not, was mistaken for a local relative path and reported broken. Both are fixed; a bare (non-angle) destination's existing paren-truncation behavior is unchanged, since that ambiguity is exactly what `<...>` exists to resolve.

2. **A real, pre-existing quadratic-time (ReDoS) vulnerability**, present since before this file's angle-bracket support was ever added — flagged by CodeQL (`js/polynomial-redos`) and confirmed empirically (a crafted doc with many unclosed `[` sequences and no closing `]` scaled the link scan quadratically with content length, a real denial-of-service risk on untrusted or messily-authored Markdown, not a theoretical finding). Fixed by bounding every previously-unbounded quantifier in the link-matching regex at a generous 2000 characters — link text and destinations are realistically far under that — restoring linear-time scanning.
