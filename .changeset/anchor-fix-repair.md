---
'@sledorze/cairn': minor
---

`cairn check --fix` now auto-repairs a broken heading anchor (same-page and cross-file) when it differs from a real heading/`<a id="...">` anchor by case alone — an unambiguous, exact match, never a fuzzy guess. Two case-colliding anchors, or no match at all, are left unchanged and still reported, same as today (issue #49). Also fixes a related, pre-existing bug found while implementing this: a same-page anchor with URL-encoded characters (e.g. `#Setup%2DPattern`) is now percent-decoded before matching/suggesting, matching how cross-file anchors were already handled.
