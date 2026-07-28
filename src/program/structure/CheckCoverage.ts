// Effect program for the first linter built on top of ../../core/structure/
// DocMetadata.ts / DocGraph.ts: an opt-in, evidence-backed structural check
// over a declared doc-kind graph (see the ADR-style rationale in the
// commit history — orphan/coverage detection is the one check requirements-
// traceability tooling, DO-178C/IEC 62304 audits, Sphinx, MkDocs, Confluence,
// and Obsidian have all independently converged on, and it's conspicuously
// absent from Markdown-specific lint tooling).
//
// Two report classes, both file-level (matches ../links/CheckLinks.ts's own
// existing broken-link granularity — a violation is an ABSENCE, no line to
// point at):
//   - missing coverage: a `from`-kind doc with no outbound ref to a
//     `to`-kind doc, for some declared rule.
//   - orphan: any declared-kind doc with zero inbound references from
//     anywhere in the scanned corpus (an `exempt` glob opts a doc out —
//     Sphinx's `:orphan:`/MkDocs' `not_in_nav` needed the same escape
//     hatch to keep the check tolerable; cairn's is a config glob, not new
//     markdown syntax, consistent with `ignore`'s existing shape).
//
// Opt-in via `checks.coverage` (Config.ts) or `--coverage`, following the
// `CheckRefs.ts`/`CheckProseRefs.ts` precedent — not part of the default
// `checks.links`/`checks.summaries` gate.

import * as nodePath from 'node:path'

import { Effect } from 'effect'

import type { CoverageRule, KindDef } from '../../core/Config.ts'
import { matchesAny } from '../../core/glob.ts'
import { buildDocGraph } from '../../core/structure/DocGraph.ts'
import { extractDocMetadata } from '../../core/structure/DocMetadata.ts'
import { DocsFs } from '../../io/DocsFs.ts'
import type { Locale } from '../locale.ts'
import { pick } from '../locale.ts'

const path = nodePath.posix

export interface CheckCoverageArgs {
  readonly base: string
  readonly exempt?: readonly string[]
  readonly ignore?: readonly string[]
  readonly kinds: readonly KindDef[]
  readonly roots: readonly string[]
  readonly rules: readonly CoverageRule[]
  readonly trackedFiles?: ReadonlySet<string> | undefined
}

export interface MissingCoverage {
  readonly path: string
  readonly rule: CoverageRule
}

export interface OrphanDoc {
  readonly kinds: readonly string[]
  readonly path: string
}

export interface CoverageResult {
  /** Docs matching at least one declared kind — the in-scope universe both
   * report classes are drawn from, same "what did this actually look at"
   * transparency `RefsCheckResult.checked` already gives. */
  readonly checked: number
  readonly missing: readonly MissingCoverage[]
  readonly orphans: readonly OrphanDoc[]
}

/** 0 when nothing is missing or orphaned, 1 otherwise — same convention as
 * every sibling check's own exit code. */
export const coverageExitCode = (result: CoverageResult): number =>
  result.missing.length > 0 || result.orphans.length > 0 ? 1 : 0

const listMdFiles = (
  roots: readonly string[],
  ignore: readonly string[],
  trackedFiles?: ReadonlySet<string>,
): Effect.Effect<readonly string[], never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const allFiles = yield* dfs.listFiles(roots, ignore)
    return allFiles.filter(
      (f) => f.endsWith('.md') && !matchesAny(f, ignore) && (trackedFiles === undefined || trackedFiles.has(f)),
    )
  })

// `base` is part of `CheckCoverageArgs` (matching every sibling check's
// signature convention) but unused here: unlike `CheckRefs.ts`, this check
// never reads a TARGET's content, only whether its path is among the
// already-`roots`-scoped docs already read — no out-of-base path can reach
// that map, so there's no `isWithinBase` bound to enforce.
export const checkCoverage = ({
  exempt = [],
  ignore = [],
  kinds,
  roots,
  rules,
  trackedFiles,
}: CheckCoverageArgs): Effect.Effect<CoverageResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const mdFiles = yield* listMdFiles(roots, ignore, trackedFiles)

    // Deduped by (from, to) — found via adversarial review: an accidentally
    // (or programmatically) duplicated rule entry used to produce a
    // duplicate `missing` report line for the exact same violation, pure
    // noise for a reader. A genuine duplicate rule carries no extra
    // information over a single one, so it's collapsed here, once, rather
    // than every downstream consumer needing to know rules can repeat.
    const uniqueRules = [...new Map(rules.map((r) => [`${r.from}\u0000${r.to}`, r])).values()]

    const allDocs = []
    for (const file of mdFiles) {
      // Same discipline as every sibling check: a file that lists fine but
      // can't be READ (permission denied) must not crash the whole run.
      const content = yield* dfs.readFile(file).pipe(Effect.catchDefect(() => Effect.succeed(null)))
      if (content === null) {
        continue
      }
      allDocs.push(extractDocMetadata({ content, kinds, path: file }))
    }

    // The inbound graph is built from EVERY scanned doc, not just
    // declared-kind ones: an outbound reference from an unclassified doc
    // (e.g. ordinary prose linking to a decision) is still a real inbound
    // reference for orphan-clearing purposes — only the REPORTED docs
    // (below) are restricted to declared kinds, not who's allowed to link
    // to them.
    const graph = buildDocGraph(allDocs)

    // Only declared-kind docs are ever in scope for either report class —
    // an unclassified doc (kinds: []) has nothing this check can say about
    // it, same as a doc `ignore`'d out of every other check.
    const docs = allDocs.filter((d) => d.kinds.length > 0)
    const docsByPath = new Map(docs.map((d) => [d.path, d]))

    const missing: MissingCoverage[] = []
    for (const doc of docs) {
      if (matchesAny(doc.path, exempt)) {
        continue
      }
      const fromDir = path.dirname(doc.path)
      for (const rule of uniqueRules) {
        if (!doc.kinds.includes(rule.from)) {
          continue
        }
        const satisfied = doc.nodes.some((node) => {
          if (node.tag !== 'ref') {
            return false
          }
          const targetDoc = docsByPath.get(path.resolve(fromDir, node.target))
          return targetDoc !== undefined && targetDoc.kinds.includes(rule.to)
        })
        if (!satisfied) {
          missing.push({ path: doc.path, rule })
        }
      }
    }

    // Orphan status only applies to a kind that's actually SUPPOSED to be
    // referenced — a rule's `to` side (matches the real-world "orphan
    // requirement" precedent: a requirement nothing verifies is an orphan;
    // the test that verifies it isn't expected to be referenced BACK). A
    // `from`-only kind (e.g. "feature," which only initiates relations)
    // would otherwise be flagged just for existing, which isn't what
    // "orphan" means in any of the tools/standards this check is modeled on.
    const orphanCandidateKinds = new Set(uniqueRules.map((r) => r.to))
    const orphans: OrphanDoc[] = []
    for (const doc of docs) {
      if (matchesAny(doc.path, exempt)) {
        continue
      }
      if (!doc.kinds.some((k) => orphanCandidateKinds.has(k))) {
        continue
      }
      if (!graph.inboundByPath.has(doc.path)) {
        orphans.push({ kinds: doc.kinds, path: doc.path })
      }
    }

    return { checked: docs.length, missing, orphans }
  })

export interface CoverageReportOptions {
  readonly locale?: Locale
}

/** Human-readable report lines (pure, so it's unit-tested independently of any IO). */
export const formatCoverageReport = (result: CoverageResult, options: CoverageReportOptions = {}): string[] => {
  const locale = options.locale ?? 'en'
  const lines: string[] = []
  if (result.missing.length === 0 && result.orphans.length === 0) {
    lines.push(
      pick(locale, {
        en: `✅ Coverage OK (${result.checked} doc(s) checked).`,
        fr: `✅ Couverture OK (${result.checked} document(s) vérifié(s)).`,
      }),
    )
    return lines
  }
  if (result.missing.length > 0) {
    lines.push(
      pick(locale, {
        en: `❌ ${result.missing.length} doc(s) missing required coverage:`,
        fr: `❌ ${result.missing.length} document(s) sans la couverture requise :`,
      }),
    )
    for (const { path: p, rule } of result.missing) {
      lines.push(
        `  ${p}`,
        pick(locale, {
          en: `    ✗ no link to a "${rule.to}"-kind doc (required by kind "${rule.from}")`,
          fr: `    ✗ aucun lien vers un document de type « ${rule.to} » (requis pour le type « ${rule.from} »)`,
        }),
      )
    }
  }
  if (result.orphans.length > 0) {
    lines.push(
      pick(locale, {
        en: `❌ ${result.orphans.length} orphan doc(s) — no inbound reference from anywhere in the corpus:`,
        fr: `❌ ${result.orphans.length} document(s) orphelin(s) — aucune référence entrante dans le corpus :`,
      }),
    )
    for (const { kinds: docKinds, path: p } of result.orphans) {
      lines.push(`  ${p} (${docKinds.join(', ')})`)
    }
  }
  return lines
}
