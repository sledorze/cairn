---
---

No package bump: `src/cli.ts` changes are a pure internal refactor of `runCheck`
(extracted `resolveCheckInputs`/`runSummariesVerb`) with no behavior change —
verified via full test suite + manual dogfooding of every affected flag.
`README.md`'s new "Other flags" table documents 5 pre-existing, already-working
flags (`--root`, `--explain`, `--config`, `--threshold`, `--locale`) that were
simply undocumented; it doesn't describe anything new.
