# Spikes: feasibility evidence for issue #101 (grounded, not assumed)

Every claim below was run against this repo's actual toolchain, not asserted from general
knowledge — `pnpm`'s pinned dependency versions turned out to matter (see spike 2), which
is exactly the kind of thing an un-run design doc would get wrong.

## Spike 1 — does the `#anchor` syntax already parse for non-Markdown targets? (zero-cost check)

**Question:** does `[checkFile](../src/checking/engine.ts#checkFile)` already extract a
usable `{target, anchor}` pair through `extractReferences`, or would symbol-scoped
citations (solution-space option A) need new parsing in `core/links/MarkdownLinks.ts`
first?

**Method:** read `extractReferences`/`parseTarget` (`src/core/links/MarkdownLinks.ts:300`)
directly — no code needed to run, the split is a plain `target.split('#')` with no
Markdown-target-only restriction.

**Result: confirmed free.** `extractReferences` already returns `{anchor: 'checkFile',
target: '../src/checking/engine.ts'}` for that exact syntax today, identically to how it
already handles `../docs/guide.md#getting-started`. **Zero changes needed in
`MarkdownLinks.ts` for citation syntax** — the entire cost of options A/B is in what
`CheckRefs.ts`/`RefStore.ts` DO with the already-available `anchor`, not in extracting it.

## Spike 2 — is a TypeScript AST parser "free" via the existing `typescript` devDependency?

**Question:** solution-space options A/B both need to locate a named export's declaration
boundary in a `.ts` file. This repo already depends on `typescript` (`package.json:89`,
`^7.0.2`) for its own build — is `ts.createSourceFile` (the classic Node API) usable as-is?

**Method:** ran `node -e "const ts = require('typescript'); console.log(Object.keys(ts))"`
from the repo root.

**Result: NOT free, and surprising.** `typescript@7.0.2`'s root export
(`typescript/lib/version.cjs`, per its `package.json#exports`) only exposes `version`/
`versionMajorMinor` — **the classic `ts.createSourceFile`/full compiler API is gone from
the default entrypoint.** This is TypeScript 7's native-port restructuring: the package now
exposes a family of `typescript/unstable/*` subpath exports instead
(`./unstable/ast`, `./unstable/sync`, `./unstable/async`, `./unstable/fs`, ...). Any design
that assumed "just `require('typescript')` like every TS-tooling blog post shows" would
have been wrong for THIS repo's own pinned version — a genuinely valuable thing to have
caught before writing an ADR around it.

## Spike 3 — is `typescript/unstable/sync`'s full API usable for a one-shot per-file parse?

**Method:** `node -e "console.log(Object.keys(require('typescript/unstable/sync')))"`.

**Result:** exposes `Program`/`Project`/`Checker`/`Snapshot` — an LSP-server-shaped,
project-wide API (type-checking, symbol resolution across a whole `tsconfig.json`
graph), not a lightweight single-file parse. Usable, but meaningfully heavier
than what options A/B actually need (locate one declaration's byte range in one file) —
would mean standing up a `Project` per `--refs` run, a real perf/complexity cost this
design should not accept without first checking a lighter option (spike 4).

## Spike 4 — is `typescript/unstable/ast`'s `createScanner` viable standalone (no `Program`)?

**First attempt failed — recorded here because the failure and its correction are
themselves the useful evidence.** An initial version of this spike used
`createScanner(ScriptTarget.Latest, true)` and looped on
`tok !== SyntaxKind.EndOfFileToken`. Neither is correct for this module:
`typescript/unstable/ast`'s `createScanner` signature is
`createScanner(skipTrivia, languageVariant, ...)`, not `(scriptTarget, skipTrivia)` (that
ordering belongs to the CLASSIC API this module doesn't expose — spike 2); and
`SyntaxKind.EndOfFileToken` doesn't exist in this module's enum at all
(`ast.SyntaxKind.EndOfFileToken === undefined`) — the real member is
`SyntaxKind.EndOfFile`. The loop's exit condition was therefore never true, and the
scanner span forever re-emitting the same token at end-of-file. An earlier draft of this
document claimed this "ran standalone... in a single pass" without having actually
verified the corrected version terminates — caught by adversarial review re-running the
exact code as written, not just re-reading it. This is precisely the failure mode
`knowledge.md`'s "verify before trusting" advice exists to catch, applied to this design's
OWN spike, not just to a future reader's use of it.

**Corrected method, actually run to completion just now:**

```js
import { createScanner, SyntaxKind } from 'typescript/unstable/ast'
const scanner = createScanner(/* skipTrivia */ true, /* languageVariant */ 0)
scanner.setText(readFileSync('src/core/structure/DocCoverage.ts', 'utf8'))
let tok = scanner.scan()
const found = []
while (tok !== SyntaxKind.EndOfFile) {
  if (tok === SyntaxKind.ExportKeyword) found.push(scanner.getTokenStart())
  tok = scanner.scan()
}
```

**Result: confirmed viable — with the corrected signature and enum member, not the
original.** Terminated normally after 143 scanned tokens (not indefinitely), and correctly
found all 4 `export` token positions in the real file — which are 2 `export interface` +
2 `export const` declarations (verified by printing 40 characters of source at each found
position: `export interface DocCoverageArgs {`, `export const findUncoveredSources = ({`,
`export interface UnmatchedKindsArgs {`, `export const findUnmatchedKinds = ({`). The file
has no import/re-export lines at all — an earlier draft of this document incorrectly
described 2 of the 4 matches as "`export`-flavored `import type`/re-export lines," which
does not match this file's actual content; also caught and corrected by re-running the
spike rather than trusting the prior description.

Standalone (no `Program`/`tsconfig`/file-system graph needed), one linear pass, correct
result. **This is the right-sized primitive for options A/B**: a token-level scan can
locate `export` keyword positions and their following declaration's balanced-brace/
semicolon end (the scanner correctly tracks nesting via its own token stream — no separate
brace-counting needed, since template literals/regex/comments are already tokenized
correctly by a real lexer, unlike option C's rejected heuristic). Full semantic
understanding (is this export TYPE-only, does it re-export from elsewhere) still needs
slightly more than bare tokens, but nowhere near a full `Program`.

**What this failure-then-correction implies for `implementation-details.md`:** the
`typescript/unstable/ast` API surface is not just unstable in the sense of "might change
later" — its CURRENT shape already differs non-trivially from the classic `typescript` API
most existing documentation/examples describe, in ways that are easy to get wrong even
once. Release 2's implementation must include the SAME "verify against the real installed
version" discipline this correction just demonstrated, not just a one-time check at design
time.

## Spike 5 — is a third-party lightweight parser already vendored anywhere in the tree?

**Question:** does `oxlint`'s Rust toolchain (`oxc`) expose a reusable JS-facing parser
package already present in `node_modules`, avoiding a new dependency entirely?

**Method:** `ls node_modules | grep -i '^oxc'` and the pnpm store equivalent.

**Result:** nothing found — `oxlint`'s binary is self-contained and doesn't install a
separate `oxc-parser`-style package this repo could import. **No free lunch here**; spike 4's
`typescript/unstable/ast` scanner remains the best already-available primitive.

## What these spikes change about `solution-space.md`'s ranking

- Option B (API-surface hashing)'s cost estimate moves from "assumed: needs a new heavy
  parser dependency" to **"confirmed: zero new dependency, a token-scan against
  `typescript`'s existing `unstable/ast` subpath is sufficient for the common case"** — a
  real, positive de-risking, not just a lucky guess.
- Option A (symbol-scoped citations)'s syntax cost drops to zero (spike 1) — its remaining
  cost is entirely in resolving one specific named declaration's boundary via the same
  scanner primitive spike 4 validated, plus the rename-resilience story `solution-space.md`
  already flagged as unsolved.
- The `typescript/unstable/*` namespace is explicitly marked `unstable` by its own package
  authors — a real, disclosed risk (see `implementation-details.md`'s own "Risks" section):
  this design commits to depending on an API surface TypeScript's own maintainers reserve
  the right to change without a semver-major bump on the classic surface. Any implementation
  must pin/lock this dependency more tightly than usual and re-verify these spikes against
  each `typescript` bump, not just trust `^7.0.2`'s caret range blindly.
