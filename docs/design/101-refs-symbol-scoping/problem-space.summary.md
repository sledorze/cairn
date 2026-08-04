# Problem space (issue #101) — summary

`--refs` hashes a cited target's WHOLE file content
(`resolveReferenceContent`, `CheckRefs.ts:83`). `RefRecord.anchor`
already parses `#fragment` citations but nothing uses it to narrow
hashing yet.

**Reported failure** (cairn 0.6.0 dogfooded on `sledorze/falsestart`):
a doc citing 14 implementation files failed `--refs` on ANY edit to
ANY of them, even changes unrelated to the doc's actual claims —
re-stamping became reflexive, defeating the point of a freshness gate.

**The reporter's fix** (restructuring the source tree into
per-area `index.ts` facades, citing 6 facades instead of 14 leaves)
works but is the wrong general answer: it forces an architecture
change purely to satisfy a doc tool, and doesn't generalize to a repo
with no natural facade boundary.

**Why this matters here too:** cairn's own `checks.docCoverage`
(issue #108) now has `docs/architecture.md` citing dozens of
`src/**/*.ts` files directly — turning `--refs` on for this repo
today would hit the same failure. `--refs` isn't enabled in
`.cairnrc.json` yet, precisely because of this open issue.

**Root cause:** "did the thing this citation is ABOUT change" ≠ "did
the file it lives in change." Whole-file hashing conflates the two.

**`refs.scope` (the proposed fix) is a genuinely new axis** — the
existing top-level `ignore` config key scopes which DOCS get scanned
as citation sources, not which cited TARGETS get hashed; not already
redundant with it.

**Evidence basis, stated honestly:** one reported case (the issue
itself, zero outside corroboration) plus one independently-verifiable
instance in this repo's own dogfooded config (`--refs` deliberately
not enabled here yet, for this exact reason) — two real instances of
the same root cause, not confirmed multi-user demand.

**Constraints on any fix:** never hide real drift; no hard new
language-parser dependency for the common case; `typescript` must be
an optional peer dependency (matching `effect`/`github-slugger`'s
existing precedent), never a hard bundled one; backwards compatible;
must not become a competing link-parsing mechanism alongside
`checks.docCoverage`.
