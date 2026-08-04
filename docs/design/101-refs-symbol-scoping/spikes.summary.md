# Spikes (issue #101) — summary

Five feasibility checks, each actually RUN against this repo's real
toolchain, not assumed:

1. **`#anchor` syntax already parses for non-Markdown targets** —
   confirmed free by reading `MarkdownLinks.ts`; zero new parsing
   needed for citation syntax itself.
2. **Classic `ts.createSourceFile` is NOT available** at
   `typescript@^7.0.2`'s root export in this repo (`typescript` 7's
   native-port restructuring moved the API under `typescript/unstable/*`
   subpaths) — a real, surprising finding that would have broken a
   naive implementation plan.
3. **`typescript/unstable/sync`** exposes a full `Program`/`Project`
   API — usable but too heavy (project-wide setup) for a one-file
   scoped hash.
4. **`typescript/unstable/ast`'s `createScanner`** — confirmed viable
   standalone (no `Program` needed) _after correcting the spike's own
   first attempt_, which used the wrong function signature and a
   nonexistent enum member and would have hung forever. The corrected
   version terminates normally and correctly tokenizes a real repo
   file, finding all `export` keyword positions in one pass. This is
   the right-sized primitive for options A/B, at zero new dependency
   cost — but the failure-then-correction is itself a real finding:
   this API surface is easy to get subtly wrong even once.
5. **No lightweight third-party parser already vendored** (checked
   `oxlint`'s bundled `oxc` — nothing importable) — spike 4's scanner
   remains the best available option.

**Net effect on the design:** option B's cost drops from "assumed
heavy new dependency" to "confirmed zero-dependency, moderate work."
The `typescript/unstable/*` surface is explicitly marked unstable by
its own maintainers — a real, ongoing risk any implementation must
isolate behind one narrow module and re-verify on `typescript` bumps.
