---
'@sledorze/cairn': patch
---

Fixes a false dead-link report for a `<...>`-wrapped link destination — CommonMark's own way to let a URL contain a literal `)` without it being confused for the link's own closing paren (a real, not-uncommon shape for Wikipedia/LibreTexts-style URLs). The link-extraction regex captured the `<`/`>` delimiters as part of the target instead of reading verbatim to the matching `>` first, which had two effects: an internal `)` truncated the captured target mid-URL, and — more broadly — the leaked leading `<` broke scheme detection (`isCheckableTarget`) so _any_ angle-bracket-wrapped external URL, parens or not, was mistaken for a local relative path and reported broken. Both are fixed; a bare (non-angle) destination's existing paren-truncation behavior is unchanged, since that ambiguity is exactly what `<...>` exists to resolve.
