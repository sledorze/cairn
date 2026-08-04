// Effect program for the first linter built on top of ../../core/structure/
// DocMetadata.ts / DocGraph.ts: an opt-in, evidence-backed structural check
// over a declared doc-kind graph (see the ADR-style rationale in the
// commit history — orphan/coverage detection is the one check requirements-
// traceability tooling, DO-178C/IEC 62304 audits, Sphinx, MkDocs, Confluence,
// and Obsidian have all independently converged on, and it's conspicuously
// absent from Markdown-specific lint tooling).
//
// Three report classes, the first two file-level (matches ../links/
// CheckLinks.ts's own existing broken-link granularity — a violation is an
// ABSENCE, no line to point at), the third a non-fatal config warning:
//   - missing coverage: a `from`-kind doc with no outbound ref to a
//     `to`-kind doc, for some declared rule.
//   - orphan: any declared-kind doc with zero inbound references from
//     anywhere in the scanned corpus.
//   - unmatchedKinds: a declared kind that matched zero scanned docs (see
//     `CoverageResult`'s own doc comment) — never fails the build.
//
// An `exempt` glob opts a doc out of BOTH missing-coverage and orphan
// reporting (not orphan alone) — Sphinx's `:orphan:`/MkDocs' `not_in_nav`
// needed the same escape hatch to keep their own equivalent checks
// tolerable; cairn's is a config glob, not new markdown syntax, consistent
// with `ignore`'s existing shape.
//
// Opt-in via `checks.coverage`'s mere presence in config (Config.ts) — no
// `--coverage` CLI flag exists or is planned: `kinds`/`rules` have no CLI
// equivalent to express them with, so config presence is the whole opt-in
// (see README's own explicit callout of this). Still follows the
// `CheckRefs.ts`/`CheckProseRefs.ts` wiring precedent otherwise — its own
// exit code, `Math.max`'d into the overall one — just without their CLI flag.

import { Effect } from 'effect'

import type { CoverageRule, CoverageTarget, KindDef } from '../../core/Config.ts'
import { isKindTarget, isTargetArray, isUrlTarget, targetsOf } from '../../core/Config.ts'
import { matchesAny, matchesGlob } from '../../core/glob.ts'
import { collectExternalRefTargets, resolveRuleEdges } from '../../core/structure/Coverage.ts'
import { buildDocGraph } from '../../core/structure/DocGraph.ts'
import { extractDocMetadata } from '../../core/structure/DocMetadata.ts'
import { DocsFs, isSafelyWithinBase, readMarkdownCorpus } from '../../io/DocsFs.ts'
import type { CheckPlugin } from '../checks/CheckPlugin.ts'
import type { Locale } from '../locale.ts'
import { pick } from '../locale.ts'

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
  /** A `scope: { under: '...' }` value used by at least one rule that
   * matched ZERO scanned docs at all — of ANY kind, not just the rule's own
   * `to` kind (see `checkCoverage`'s own comment for why the wider check).
   * Sorted, de-duplicated `under` strings. A real, self-found gap
   * (docs/design/CONVENTION.md's "Judging this convention" Claim 2,
   * docs/design/review-prompts.md section 4's own adversarial
   * self-judgment): `under` was validated against neither the declared
   * kind ids (which DO get a decode-time cross-field check, see
   * `CoverageInputSchema` in ../../core/Config.ts) nor `roots` — a typo'd
   * or out-of-`roots` `under` decoded successfully and then silently,
   * permanently reported every `from`-kind doc using it as missing
   * coverage, with nothing pointing at the real cause. Not decode-time
   * checkable: `roots` and `checks.coverage` are sibling top-level fields
   * that can be set in DIFFERENT `extends` layers (`../../config.ts`'s
   * `resolveLayer`), so a single-layer schema decode never sees both at
   * once — this is why the fix lives here, once every layer is folded and
   * the real doc corpus is actually scanned, mirroring `unmatchedKinds`'s
   * own precedent below (a non-fatal hint, never `coverageExitCode`,
   * exactly because a legitimate mid-rollout `under` with no docs YET
   * looks identical to a typo'd one from inside this one check alone). */
  readonly emptyScopeUnders: readonly string[]
  readonly missing: readonly MissingCoverage[]
  readonly orphans: readonly OrphanDoc[]
  /** A declared kind id that matched zero scanned docs — found by
   * dogfooding the real CLI against the README's own example: a kind's
   * glob only classifies docs already inside `roots`, it never widens
   * `roots` itself, so a glob outside every configured root (or a plain
   * typo) silently checks nothing and every rule mentioning it goes
   * quiet, indistinguishable from genuine coverage. Never drives
   * `coverageExitCode` — a kind can legitimately have zero docs yet
   * (mid-rollout), so this is a hint, not a violation. */
  readonly unmatchedKinds: readonly string[]
}

/** 0 when nothing is missing or orphaned, 1 otherwise — same convention as
 * every sibling check's own exit code. */
export const coverageExitCode = (result: CoverageResult): number =>
  result.missing.length > 0 || result.orphans.length > 0 ? 1 : 0

// `base` bounds the ONE place this check does touch the real filesystem
// beyond already-`roots`-scoped docs: an `{ external: 'path' }` rule's
// existence check, below. Every kind-based rule still needs no `isWithinBase`
// bound (it only ever asks whether a path is among the already-scanned doc
// map, matching every sibling check's own `base` convention) — only the
// external-path branch reads real filesystem state.
export const checkCoverage = ({
  base,
  exempt = [],
  ignore = [],
  kinds,
  roots,
  rules,
  trackedFiles,
}: CheckCoverageArgs): Effect.Effect<CoverageResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const mdFiles = yield* readMarkdownCorpus(dfs, roots, ignore, trackedFiles)

    // Deduped by every field that can distinguish two rules on the same
    // kind pair — found via adversarial review, in FIVE rounds so far.
    // Round 1: an accidentally (or programmatically) duplicated rule entry
    // produced a duplicate `missing` report line for the exact same
    // violation, pure noise. Round 2 (a real regression the first fix
    // introduced): deduping by (from, to) ALONE silently collapsed two
    // rules sharing a kind pair but meaning DIFFERENT things — e.g. issue
    // #28's own `implements` vs `verified_by` between the same two kinds —
    // into one, losing a genuine distinct obligation; `name` became the
    // discriminant. Round 3 (the SAME bug reintroduced by the very fix
    // meant to demonstrate evolvability): adding `via` without adding it
    // here meant two same-pair rules differing only in `via` would
    // silently collapse the moment a second `via.by` variant existed —
    // dormant today (only `by: 'link'` is valid), a landmine for the next
    // one. Round 4: adding `scope` (real capturability fix — see
    // `CoverageRuleInputSchema`'s own comment) hit the SAME landmine on
    // sight — caught before it shipped this time, not after, by applying
    // this comment's own standing warning rather than re-discovering it.
    // Round 5: `scope` grew a second, OBJECT-shaped variant (`{ under:
    // '...' }`, see `CoverageRuleScopeInputSchema`) — the Round 4 fix's
    // own `r.scope ?? ''` string-coerces every object to the literal text
    // "[object Object]" regardless of its actual `under` value, so two
    // rules differing only by `under` (e.g. scoped to two different
    // sub-trees) would silently collapse into one — the exact Round 2/3 bug
    // class again. Fixed by `JSON.stringify`-ing the whole `scope` field
    // instead of relying on template-literal coercion.
    // `description` deliberately does NOT appear here: purely cosmetic
    // report text, never changes what the rule actually checks, so two
    // rules differing ONLY in `description` really are the same rule.
    // Every OTHER discriminating field of `CoverageRule` (`name`, `via.by`,
    // `scope`) MUST appear in this key — if a future field is added to
    // distinguish otherwise-identical rules, add it here too, or this exact
    // class of silent data loss reappears a sixth time.
    // Round 6: `to` grew alternation (`targetsOf` in ../../core/Config.ts) —
    // `to` can now be a single target OR an array of them. The previous
    // `isKindTarget(r.to) ? r.to : JSON.stringify(r.to)` branch assumed `to`
    // was never an array; `JSON.stringify(['a', 'b'])` and the plain string
    // `'a'` (the old true branch) are already textually distinct, so
    // simplifying to an UNCONDITIONAL `JSON.stringify(r.to)` both fixes the
    // array case and removes a branch — one fewer place for the next
    // `to`-shape change to have to remember this key exists at all.
    const uniqueRules = [
      ...new Map(
        rules.map((r) => [
          `${r.name ?? ''}\u0000${r.from}\u0000${JSON.stringify(r.to)}\u0000${r.via?.by ?? ''}\u0000${JSON.stringify(r.scope) ?? ''}`,
          r,
        ]),
      ).values(),
    ]

    // `readMarkdownCorpus` already gives an unreadable doc (permission
    // denied) the same lenient skip this used to hand-roll.
    const allDocs = [...mdFiles].map(([file, content]) => extractDocMetadata({ content, kinds, path: file }))

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

    // A rule's `to` can be `{ external: 'path' }` (issue #28's third v1
    // check, doc→code reference resolution) instead of a declared kind id —
    // satisfied by a link resolving to a REAL FILE, not a scanned doc.
    // `resolveRuleEdges` stays pure/IO-free, so the actual filesystem check
    // happens here: collect every candidate target path an external-typed
    // rule could be satisfied by, confirm which ones really exist, and hand
    // that confirmed set in. Bounded concurrency, same convention as every
    // other per-file IO loop in this checker.
    const externalCandidates = collectExternalRefTargets(docs, exempt, uniqueRules)
    const externalExists = new Set<string>()
    yield* Effect.forEach(
      externalCandidates,
      // `isSafelyWithinBase` (../../io/DocsFs.ts): never stat'd on the real
      // filesystem when lexically outside `base` (issue #39's own
      // guarantee) or when a symlink resolves outside `base` even though
      // its own path is lexically in-bounds (adversarial review) — without
      // it, a doc could "satisfy" a required coverage rule by linking to
      // any file reachable outside the repo, turning cairn into a
      // filesystem-existence oracle for an untrusted PR's link target.
      (candidate) =>
        isSafelyWithinBase(dfs, candidate, base).pipe(
          Effect.map((safe) => {
            if (safe) {
              externalExists.add(candidate)
            }
            return safe
          }),
        ),
      { concurrency: 8 },
    )

    // Resolution itself (kind matching, path resolution, `exempt`) lives in
    // ../../core/structure/Coverage.ts's `resolveRuleEdges` — pulled out so
    // a future consumer (e.g. a stale-coverage-link freshness check) reuses
    // the exact same logic instead of re-deriving it as a second, divergent
    // copy. `missing` here is just "which edges had zero satisfying refs."
    const edges = resolveRuleEdges({ docs, exempt, externalExists, rules: uniqueRules })
    const missing: MissingCoverage[] = edges
      .filter((e) => e.satisfiedBy.length === 0)
      .map((e) => ({ path: e.doc, rule: e.rule }))

    // Orphan status only applies to a kind that's actually SUPPOSED to be
    // referenced — a rule's `to` side (matches the real-world "orphan
    // requirement" precedent: a requirement nothing verifies is an orphan;
    // the test that verifies it isn't expected to be referenced BACK). A
    // `from`-only kind (e.g. "feature," which only initiates relations)
    // would otherwise be flagged just for existing, which isn't what
    // "orphan" means in any of the tools/standards this check is modeled on.
    // `{ external: 'path' }` names no kind at all, so it's filtered out
    // here too — an external-only rule's `from` kind must never become
    // orphan-checkable just because it appears on some rule's `to` side.
    // `to` may be an array of alternatives (`targetsOf`) — every KIND
    // alternative is orphan-candidate-eligible, not just a single scalar
    // `to`, since a doc satisfying the rule via any one alternative still
    // makes every kind-shaped alternative a real, referenceable target.
    const orphanCandidateKinds = new Set(uniqueRules.flatMap((r) => targetsOf(r.to)).filter(isKindTarget))
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

    const matchedKindIds = new Set(docs.flatMap((d) => d.kinds))
    const unmatchedKinds = [...new Set(kinds.map((k) => k.id))].filter((id) => !matchedKindIds.has(id))

    // See `CoverageResult.emptyScopeUnders`'s own comment for the full
    // rationale. Checked against `allDocs` (every scanned markdown file,
    // regardless of kind) rather than just `docs`/the rule's own `to` kind
    // deliberately: the question isn't "does the rule's target kind exist
    // under here" (that's exactly what `missing`/`unmatchedKinds` already
    // report, precisely and per-rule) — it's the narrower, structural "does
    // this DIRECTORY exist anywhere in the scanned corpus at all," which a
    // typo'd or out-of-`roots` `under` fails regardless of which kind was
    // meant to live there.
    const underValues = new Set(
      uniqueRules
        .map((r) => r.scope)
        .filter((s): s is { readonly under: string } => typeof s === 'object' && s !== null)
        .map((s) => s.under),
    )
    const emptyScopeUnders = [...underValues]
      .filter((under) => {
        const trimmed = under.replaceAll(/^\/+|\/+$/g, '')
        return !allDocs.some((d) => matchesGlob(d.path, `**/${trimmed}/**`))
      })
      .toSorted()

    return { checked: docs.length, emptyScopeUnders, missing, orphans, unmatchedKinds }
  })

export interface CoverageReportOptions {
  readonly locale?: Locale
}

/** One target's noun phrase, used only inside an alternation (`to: [...]`)
 * report line's "to ANY of: ..." list — the single-target report line below
 * keeps its own, differently-worded, pre-existing phrasing verbatim (a
 * deliberate choice: changing that wording would be a needless behavior
 * change to every existing single-`to` config's report output, exactly what
 * this whole feature promises NOT to do). */
const describeCoverageTarget = (target: CoverageTarget, locale: Locale): string =>
  isKindTarget(target)
    ? pick(locale, { en: `a "${target}"-kind doc`, fr: `un document de type « ${target} »` })
    : isUrlTarget(target)
      ? pick(locale, {
          en: `a link matching "${target.pattern}"`,
          fr: `un lien correspondant à « ${target.pattern} »`,
        })
      : pick(locale, { en: 'an existing file', fr: 'un fichier existant' })

/** Human-readable report lines (pure, so it's unit-tested independently of any IO). */
export const formatCoverageReport = (result: CoverageResult, options: CoverageReportOptions = {}): string[] => {
  const locale = options.locale ?? 'en'
  const lines: string[] = []
  // Appended regardless of branch below — an unmatched kind (the
  // roots/glob-mismatch trap) must be visible even on an otherwise-green
  // report, not just when a real missing/orphan finding already broke the
  // silence. Never affects `coverageExitCode` — see `unmatchedKinds`'s own
  // doc comment on `CoverageResult`.
  const unmatchedWarnings = result.unmatchedKinds.map((id) =>
    pick(locale, {
      en: `⚠️  kind "${id}" matched 0 scanned docs — check its glob against \`roots\`, or that it is simply not typo'd.`,
      fr: `⚠️  le type « ${id} » n’a correspondu à aucun document analysé — vérifiez son glob par rapport à \`roots\`, ou une simple faute de frappe.`,
    }),
  )
  // Same non-fatal-hint treatment as `unmatchedWarnings` above, for the same
  // reason — see `CoverageResult.emptyScopeUnders`'s own doc comment.
  const emptyScopeWarnings = result.emptyScopeUnders.map((under) =>
    pick(locale, {
      en: `⚠️  scope { under: "${under}" } matched 0 scanned docs of any kind — check it for a typo, that it names a directory under a configured \`root\`, or that no docs simply exist there yet.`,
      fr: `⚠️  la portée { under : « ${under}» } n’a correspondu à aucun document analysé, quel que soit son type — vérifiez une faute de frappe, que ce chemin se trouve bien sous une \`root\` configurée, ou qu’aucun document n’y existe encore.`,
    }),
  )
  if (result.missing.length === 0 && result.orphans.length === 0) {
    lines.push(
      pick(locale, {
        en: `✅ Coverage OK (${result.checked} doc(s) checked).`,
        fr: `✅ Couverture OK (${result.checked} document(s) vérifié(s)).`,
      }),
      ...unmatchedWarnings,
      ...emptyScopeWarnings,
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
      // The rule's `name`, when set, disambiguates which obligation this is
      // — two rules can share a (from, to) pair (see CoverageRule's own
      // comment) and would otherwise be indistinguishable in the report.
      const named = rule.name === undefined ? '' : ` ("${rule.name}")`
      lines.push(
        `  ${p}`,
        // Three `to` shapes, three report lines: a declared kind id, a
        // real-file `{ external: 'path' }`, or a `{ external: 'url',
        // pattern }` — the pattern itself is shown so a reader isn't left
        // guessing which external URL is required (`description`, below,
        // still carries the WHY). A rule with an ARRAY `to` (alternation —
        // see `targetsOf`'s own comment in ../../core/Config.ts) gets a
        // fourth, distinct line listing every alternative, so a reader can
        // tell "must link X" (a single required target) apart from "must
        // link EITHER X OR Y" (any one suffices) at a glance, not just by
        // re-deriving it from the config.
        isTargetArray(rule.to)
          ? pick(locale, {
              en: `    ✗ no link${named} to ANY of: ${rule.to.map((t) => describeCoverageTarget(t, locale)).join(', or ')} (required by kind "${rule.from}")`,
              fr: `    ✗ aucun lien${named} vers L’UN des éléments suivants : ${rule.to.map((t) => describeCoverageTarget(t, locale)).join(', ou ')} (requis pour le type « ${rule.from} »)`,
            })
          : isKindTarget(rule.to)
            ? pick(locale, {
                en: `    ✗ no link${named} to a "${rule.to}"-kind doc (required by kind "${rule.from}")`,
                fr: `    ✗ aucun lien${named} vers un document de type « ${rule.to} » (requis pour le type « ${rule.from} »)`,
              })
            : isUrlTarget(rule.to)
              ? pick(locale, {
                  en: `    ✗ no link${named} matching "${rule.to.pattern}" (required by kind "${rule.from}")`,
                  fr: `    ✗ aucun lien${named} correspondant à « ${rule.to.pattern} » (requis pour le type « ${rule.from} »)`,
                })
              : pick(locale, {
                  en: `    ✗ no link${named} to an existing file (required by kind "${rule.from}")`,
                  fr: `    ✗ aucun lien${named} vers un fichier existant (requis pour le type « ${rule.from} »)`,
                }),
      )
      // Real, in-context guidance — see CoverageRuleInputSchema's own comment
      // for why this exists alongside `name`: a bare rule name/label doesn't
      // tell an unfamiliar reader what the relationship MEANS or how to fix
      // it. Absent for a rule with no `description` — never a blank line.
      if (rule.description !== undefined) {
        lines.push(`      ${rule.description}`)
      }
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
  lines.push(...unmatchedWarnings, ...emptyScopeWarnings)
  return lines
}

// The CheckPlugin descriptor cli.ts's registry runner drives — see
// ../checks/CheckPlugin.ts's own header for why this abstraction exists.
// `isEnabled` matches cli.ts's exact prior gate: `resolved.checks.coverage
// !== null` (presence of `checks.coverage` in config IS the opt-in — no CLI
// flag exists, deliberately, since `kinds`/`rules` have no CLI equivalent to
// express them with). The real registry runner (../checks/runCheckPlugin.ts)
// always checks `isEnabled` before calling `run`, so `checks.coverage` being
// non-null here is structurally guaranteed in practice — but `run` still
// checks it explicitly and fails with `Effect.die` (a clear, named defect)
// rather than trusting that invariant via an unguarded cast: an earlier
// version used `resolved.checks.coverage as CoverageConfig`, which any OTHER
// caller of `.run()` directly (a test, a script, a future plugin copying
// this pattern) with coverage disabled hit as a raw, unhelpful
// `TypeError: Cannot destructure property 'exempt' of 'null'` — adversarial
// review found this and this explicit check replaced it.
export const coveragePlugin: CheckPlugin<CoverageResult> = {
  exitCode: coverageExitCode,
  format: (result, options) => formatCoverageReport(result, options),
  isEnabled: (resolved) => resolved.checks.coverage !== null,
  jsonUnsupportedMessage: '--json cannot be combined with checks.coverage yet',
  name: 'coverage',
  run: ({ base, ignore, resolved, roots, trackedFiles }) => {
    const coverage = resolved.checks.coverage
    if (coverage === null) {
      return Effect.die(
        new Error('coveragePlugin.run called with checks.coverage disabled — isEnabled() should have prevented this'),
      )
    }
    const { exempt, kinds, rules } = coverage
    return checkCoverage({
      base,
      exempt,
      ignore,
      kinds,
      roots,
      rules,
      ...(trackedFiles === undefined ? {} : { trackedFiles }),
    })
  },
}
