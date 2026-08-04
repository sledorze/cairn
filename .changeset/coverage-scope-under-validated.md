---
'@sledorze/cairn': minor
---

`checks.coverage`'s `scope: { under: "..." }` is now validated for real, closing a known limitation recorded in a previous release: a typo'd or out-of-corpus `under` value used to decode successfully and then silently, permanently report every rule using it as unsatisfiable, with nothing pointing at the real cause.

`cairn check` now surfaces a non-fatal warning line for any `under` value that matches zero scanned docs of any kind:

```
⚠️  scope { under: "docs/desing/team-b" } matched 0 scanned docs of any kind — check it for a typo, that it names a directory under a configured `root`, or that no docs simply exist there yet.
```

This is checked at `cairn check` run time, once the doc corpus is actually scanned — not at config-decode time, unlike a `from`/`to` kind-id typo (`roots` and `checks.coverage` can be set in different `extends` layers, so no single-layer decode can see both together). Like the existing `unmatchedKinds` warning, it never fails the build on its own (a legitimately not-yet-populated directory looks the same as a typo from this check alone) — it's a diagnostic hint, not a new violation class.
