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

import * as nodePath from 'node:path'

import { Effect } from 'effect'

import { canonicalJson } from '../../core/canonicalJson.ts'
import type { CoverageRule, CoverageTarget, CoverageToSpec, KindDef } from '../../core/Config.ts'
import { isAnyTarget, isAtLeastTarget, isKindTarget, isTargetArray, isUrlTarget, targetsOf } from '../../core/Config.ts'
import { matchesAny, matchesGlob } from '../../core/glob.ts'
import { toPosix } from '../../core/paths.ts'
import type { RuleEdge } from '../../core/structure/Coverage.ts'
import { collectExternalRefTargets, filterRuleEdgesByChanged, resolveRuleEdges } from '../../core/structure/Coverage.ts'
import { buildDocGraph } from '../../core/structure/DocGraph.ts'
import { extractDocMetadata } from '../../core/structure/DocMetadata.ts'
import { DocsFs, isSafelyWithinBase, readMarkdownCorpus } from '../../io/DocsFs.ts'
import type { CheckPlugin } from '../checks/CheckPlugin.ts'
import type { Locale } from '../locale.ts'
import { pick } from '../locale.ts'

export interface CheckCoverageArgs {
  readonly base: string
  /** `--changed <path...>` (spike, cli.ts) — zero or more paths, relative to
   * `base` or absolute, either is fine (resolved against `base` the same
   * way `toAbsPosix` resolves a git-reported path in ../../io/Git.ts).
   * Absent or empty means "no scoping" — `CoverageResult.changedGuidance`
   * stays `null` and every existing report is completely unaffected; this
   * is the ENTIRE additivity guarantee for this flag. */
  readonly changed?: readonly string[]
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
  /** Absent/`undefined` (from `checkCoverage` itself, always set — this is
   * only optional so an OLDER hand-built `CoverageResult` literal, e.g. an
   * existing test fixture, stays valid without every call site touching
   * this new field) or `null` when `--changed` wasn't passed — the
   * ordinary, unfiltered report. Otherwise every `RuleEdge`
   * (../../core/structure/Coverage.ts) touching one of the changed paths,
   * per `filterRuleEdgesByChanged`'s own doc comment (as `edge.doc` OR as a
   * `satisfiedBy` target). An empty array (as opposed to `null`/`undefined`)
   * means `--changed` WAS passed but matched no rule edge at all — a real,
   * reportable "nothing relevant changed," distinct from "the flag wasn't
   * used." */
  readonly changedGuidance?: readonly RuleEdge[] | null
  /** Absent/`undefined`/`null` under the exact same rule as `changedGuidance`
   * above (this is its sibling field, always set together) — otherwise the
   * count of real `missing`/`orphans` issues that exist SOMEWHERE in the
   * corpus but fall OUTSIDE `changedGuidance`'s scoped view. Exists because
   * `coverageExitCode` deliberately stays corpus-wide even under `--changed`
   * (a scoping/reporting convenience must never quietly relax cairn's own
   * "green check is a hard requirement" gate — AGENTS.md) — which means a
   * scoped report showing zero problems can still legitimately exit 1. This
   * field is what lets `formatChangedGuidance` say so explicitly instead of
   * leaving that exit code unexplained (adversarial review: an all-clean
   * scoped report with exit code 1 and no visible cause is worse than no
   * scoping at all). Computed from `missing.length` (minus the count of
   * `missing` entries already shown, unsatisfied, inside `changedGuidance`)
   * plus the FULL, unconditional `orphans.length` — every orphan counts,
   * regardless of whether the orphan's own path happens to be one of the
   * changed paths (round-2 adversarial review: an earlier version excluded
   * an orphan here whenever its own path was in `changed`, wrongly assuming
   * that made it "already visible" — `formatChangedGuidance` never renders
   * orphans at all, scoped or not, so that exclusion silently hid a real,
   * otherwise completely undisclosed cause of a non-zero exit). See
   * `checkCoverage`'s own computation for the exact accounting. */
  readonly changedOtherIssues?: number | null
  /** A `scope: { under: '...' }` value used by at least one rule that
   * matched ZERO scanned docs at all — of ANY kind, not just the rule's own
   * `to` kind (see `checkCoverage`'s own comment for why the wider check).
   * Sorted, de-duplicated `under` strings. A real, self-found gap
   * (docs/design/CONVENTION.md's "Judging this convention" Claim 2,
   * docs/design/review-findings.md section 2's own adversarial
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
 * every sibling check's own exit code. Deliberately ALWAYS corpus-wide, off
 * `result.missing`/`result.orphans` directly — never narrowed to
 * `result.changedGuidance` even when `--changed` scoped the printed report.
 * `--changed` is a reporting/guidance convenience (see its own doc comments
 * on `CoverageResult`); letting it also narrow the exit verdict would mean
 * `cairn check --changed <diff files>` in CI could pass with real,
 * unrelated corpus defects sitting untouched — exactly the "green check is
 * a hard requirement" gate AGENTS.md exists to protect, silently punched
 * through by an otherwise-innocuous review-scoping flag. See
 * `CoverageResult.changedOtherIssues` for how a scoped report stays
 * self-explanatory about ITS OWN non-zero exit code without changing what
 * that code means. */
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
  changed,
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
    // kind pair — found via adversarial review, in SIX rounds before this
    // one (full history kept below, no longer prescriptive). Every one of
    // those rounds was the same shape of bug: the key was a hand-maintained
    // ALLOWLIST of "the fields that currently matter," so a new
    // `CoverageRule` field silently didn't count toward the key the moment
    // it was added — a structural footgun an allowlist can never notice on
    // its own, only ever caught after the fact by an adversarial pass
    // remembering to re-check it.
    //
    // Fixed here by inverting the key from an allowlist to a DENYLIST:
    // `{ ...r, description: undefined }` structurally includes EVERY field
    // `r` actually has (via the spread) and blanks out only the one field
    // this file has always deliberately excluded — `description`, purely
    // cosmetic report text; two rules differing ONLY in `description`
    // really are the same rule. `JSON.stringify` omits an `undefined`-
    // valued property entirely, so blanking `description` this way removes
    // it from the key exactly like the old explicit omission did. A FUTURE
    // field added to `CoverageRule` is now automatically part of the key
    // the moment it exists on the object — this closes the recurring bug
    // CLASS, not just this round's instance of it.
    //
    // `canonicalJson` (not plain `JSON.stringify`) matters here: `JSON.
    // stringify` serializes object properties in INSERTION order, so two
    // semantically identical rules (same `to`/`scope` object, keys just
    // built in a different order — `Schema.decode`'s fixed field order vs.
    // a hand-written literal or a future rule-builder) would otherwise
    // stringify to different keys and be treated as DISTINCT rules — the
    // mirror-image of every prior round's bug: under-deduplication instead
    // of over-collapse. `canonicalJson` recursively sorts object keys
    // before stringifying so the key represents the RULE's VALUE, not one
    // particular way of constructing it.
    //
    // Full history, for context only (no longer prescriptive — the
    // denylist above needs no per-field updates): Round 1, an accidentally
    // duplicated rule entry produced a duplicate `missing` report line for
    // the exact same violation. Round 2, deduping by (from, to) ALONE
    // silently collapsed two rules sharing a kind pair but meaning
    // DIFFERENT things (e.g. issue #28's own `implements` vs
    // `verified_by`) into one; `name` became a discriminant. Round 3,
    // adding `via` without adding it to the key meant two same-pair rules
    // differing only in `via` would silently collapse. Round 4, adding
    // `scope` hit the same landmine. Round 5, `scope` grew an
    // OBJECT-shaped variant (`{ under: '...' }`) that the then-current
    // `r.scope ?? ''` string-coerced to the literal text "[object Object]"
    // regardless of its actual value. Round 6, `to` grew alternation
    // (array-shaped), which an `isKindTarget(r.to) ? r.to :
    // JSON.stringify(r.to)` branch hadn't accounted for.
    const uniqueRules = [...new Map(rules.map((r) => [canonicalJson({ ...r, description: undefined }), r])).values()]

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

    // `--changed` scoping (cli.ts) — resolved to absolute POSIX here (the
    // one IO-adjacent step this stays responsible for, matching
    // `filterRuleEdgesByChanged`'s own "caller resolves paths" contract in
    // ../../core/structure/Coverage.ts). `nodePath.resolve(base, p)` already
    // returns `p` untouched (aside from normalization) when `p` is absolute,
    // so this needs no separate `isAbsolute` branch — same shortcut
    // `toAbsPosix` (../../io/Git.ts) takes for the identical
    // "relative-or-absolute, resolve against base" shape. `null` (not an
    // empty `Set`) when `--changed` wasn't passed, so `changedGuidance`/
    // `changedOtherIssues` below stay `null` too — the whole "completely
    // unaffected when absent" contract hinges on this one `null` check.
    const changedSet =
      changed === undefined || changed.length === 0
        ? null
        : new Set(changed.map((p) => toPosix(nodePath.resolve(base, p))))
    const changedGuidance = changedSet === null ? null : filterRuleEdgesByChanged(edges, changedSet)
    // `e.satisfied` (../../core/structure/Coverage.ts), not
    // `e.satisfiedBy.length === 0` — the two agreed for every `to` shape
    // that existed before `{ atLeast: { n, of } }`, but a rule requiring a
    // MINIMUM COUNT across several distinct targets can have a non-empty
    // `satisfiedBy` (some link matched something) while still being
    // genuinely unsatisfied (fewer than `n` distinct targets matched) —
    // `satisfied` is the one field that resolves this correctly for every
    // shape, not just the ones that predate `atLeast`.
    const missing: MissingCoverage[] = edges.filter((e) => !e.satisfied).map((e) => ({ path: e.doc, rule: e.rule }))

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

    // `coverageExitCode` (below) deliberately stays corpus-wide even when
    // `--changed` scoped the PRINTED report — see `CoverageResult.
    // changedOtherIssues`'s own doc comment for why (never let a
    // reporting/scoping convenience quietly relax the hard build gate). This
    // is the count that makes an otherwise-unexplained non-zero exit code
    // legible from a scoped report alone: every `missing` entry NOT already
    // shown as an unsatisfied edge in `changedGuidance` (a `missing` entry is
    // exactly `edges.filter(!satisfied)`, and `changedGuidance` is always a
    // SUBSET of `edges`, so this subtraction is exact, never negative) plus
    // EVERY orphan, unconditionally.
    //
    // Round-2 adversarial review caught a real bug here: an earlier version
    // excluded an orphan from this count whenever the orphan's OWN path was
    // itself one of the changed paths, on the assumption that made it
    // "already visible" in the scoped report. False — `formatChangedGuidance`
    // never renders orphans in ANY case (an orphan is a standalone per-doc
    // fact, not a `RuleEdge`; it's structurally invisible to that report
    // regardless of `changed`). Reproduced live: a corpus whose only defect
    // is an orphan doc, scoped with `--changed <that orphan's own path>`,
    // printed a clean "no rule touches" report with exit code 1 and no
    // warning anywhere — exactly the failure this whole field exists to
    // prevent. Every orphan is counted here, full stop; `changedSet` is not
    // consulted for orphans at all.
    const changedOtherIssues =
      changedSet === null
        ? null
        : missing.length - (changedGuidance?.filter((e) => !e.satisfied).length ?? 0) + orphans.length

    return {
      changedGuidance,
      changedOtherIssues,
      checked: docs.length,
      emptyScopeUnders,
      missing,
      orphans,
      unmatchedKinds,
    }
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

/** The full "...to/matching/etc" phrase that follows `no link${named} ` in a
 * missing-coverage report line — one branch per `CoverageToSpec` shape.
 * Extracted out of `formatCoverageReport`'s own loop so the four-way (now
 * five-way, with `{ atLeast }`) branch reads as one small table instead of a
 * deepening ternary chain. The array/single/url/external-file branches keep
 * their EXACT pre-existing wording verbatim — changing that text would be a
 * needless behavior change to every existing config's report output, the
 * opposite of what every prior additive `to` change here has promised. */
const describeToRequirement = (to: CoverageToSpec, locale: Locale): string => {
  if (isTargetArray(to) || isAnyTarget(to)) {
    const alternatives = isTargetArray(to) ? to : to.any
    return pick(locale, {
      en: `to ANY of: ${alternatives.map((t) => describeCoverageTarget(t, locale)).join(', or ')}`,
      fr: `vers L’UN des éléments suivants : ${alternatives.map((t) => describeCoverageTarget(t, locale)).join(', ou ')}`,
    })
  }
  if (isAtLeastTarget(to)) {
    const { n, of } = to.atLeast
    return pick(locale, {
      en: `to AT LEAST ${n} of: ${of.map((t) => describeCoverageTarget(t, locale)).join(', ')}`,
      fr: `vers AU MOINS ${n} des éléments suivants : ${of.map((t) => describeCoverageTarget(t, locale)).join(', ')}`,
    })
  }
  if (isKindTarget(to)) {
    return pick(locale, { en: `to a "${to}"-kind doc`, fr: `vers un document de type « ${to} »` })
  }
  if (isUrlTarget(to)) {
    return pick(locale, { en: `matching "${to.pattern}"`, fr: `correspondant à « ${to.pattern} »` })
  }
  return pick(locale, { en: 'to an existing file', fr: 'vers un fichier existant' })
}

/** `--changed` (spike, cli.ts) report mode: every rule edge touching a
 * changed path, with its rule's own `description` printed as guidance —
 * "if this file changed, here's what a reviewer should re-check, and why."
 * Deliberately its own small report rather than a filtered VARIANT of
 * `formatCoverageReport`'s missing/orphan sections: those two report
 * classes answer "is the corpus compliant," this answers "what's relevant
 * to the diff," and conflating them would make an edge that IS satisfied
 * (nothing wrong with it, still worth a reviewer's attention because it
 * touches the diff) invisible from a report that only ever lists
 * violations. */
export const formatChangedGuidance = (
  edges: readonly RuleEdge[],
  otherIssues: number,
  options: CoverageReportOptions = {},
): string[] => {
  const locale = options.locale ?? 'en'
  const lines: string[] =
    edges.length === 0
      ? [
          pick(locale, {
            en: '✅ No coverage rule touches the changed path(s).',
            fr: '✅ Aucune règle de couverture ne concerne le(s) chemin(s) modifié(s).',
          }),
        ]
      : [
          pick(locale, {
            en: `🔎 ${edges.length} coverage rule edge(s) relevant to the changed path(s):`,
            fr: `🔎 ${edges.length} relation(s) de couverture pertinente(s) pour le(s) chemin(s) modifié(s) :`,
          }),
        ]
  for (const edge of edges) {
    const named = edge.rule.name === undefined ? '' : ` ("${edge.rule.name}")`
    const status = edge.satisfied
      ? pick(locale, { en: 'satisfied', fr: 'satisfaite' })
      : pick(locale, { en: 'NOT satisfied', fr: 'NON satisfaite' })
    lines.push(
      `  ${edge.doc}`,
      pick(locale, {
        en: `    rule${named} — link${named} ${describeToRequirement(edge.rule.to, locale)} (required by kind "${edge.rule.from}"): ${status}`,
        fr: `    règle${named} — lien${named} ${describeToRequirement(edge.rule.to, locale)} (requis pour le type « ${edge.rule.from} ») : ${status}`,
      }),
    )
    if (edge.rule.description !== undefined) {
      lines.push(`      ${edge.rule.description}`)
    }
  }
  // The exit code (`coverageExitCode`) deliberately stays corpus-wide even
  // in this scoped report mode (see `CoverageResult.changedOtherIssues`'s
  // own doc comment — a scoping convenience must never quietly relax
  // cairn's own hard build gate). Without this line, a scoped report
  // showing zero (or only satisfied) edges but a non-zero exit code would
  // be unexplainable from its own output — adversarial review's exact
  // finding. Omitted entirely when there's nothing to disclose (0), so a
  // truly clean corpus's scoped report stays exactly as short as before.
  //
  // Deliberately scope-NEUTRAL wording ("not shown above," never "outside
  // the changed path(s)") — round-3 adversarial review: an orphan counted
  // here (see `changedOtherIssues`'s own doc comment) can have its OWN path
  // be exactly one of the changed paths; orphan-ness is a per-doc fact this
  // report structurally never renders regardless of scope, so "outside the
  // changed path(s)" would be an outright false location claim in exactly
  // that case, misdirecting a reviewer to look elsewhere in the corpus when
  // the real defect is the file they were already looking at.
  if (otherIssues > 0) {
    lines.push(
      pick(locale, {
        en: `⚠️  ${otherIssues} other coverage issue(s) not shown above — run \`cairn check\` without --changed to see the full report.`,
        fr: `⚠️  ${otherIssues} autre(s) problème(s) de couverture non affiché(s) ci-dessus — lancez \`cairn check\` sans --changed pour le rapport complet.`,
      }),
    )
  }
  return lines
}

/** Human-readable report lines (pure, so it's unit-tested independently of any IO). */
export const formatCoverageReport = (result: CoverageResult, options: CoverageReportOptions = {}): string[] => {
  const locale = options.locale ?? 'en'
  // `--changed` scoping short-circuits to its own report entirely (see
  // `formatChangedGuidance`'s own comment for why it's a distinct mode, not
  // a filtered variant of the sections below) — every other line in this
  // function is unreached whenever `changedGuidance` is non-`null`, which is
  // exactly and only when `--changed` was passed (`checkCoverage`'s own
  // contract on this field).
  if (result.changedGuidance !== null && result.changedGuidance !== undefined) {
    return [...formatChangedGuidance(result.changedGuidance, result.changedOtherIssues ?? 0, options)]
  }
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
      // Five `to` shapes, one line each, resolved by `describeToRequirement`
      // (above) so this loop doesn't itself keep growing a ternary chain
      // every time `to` grows a new variant — the pattern/kind/alternatives
      // themselves are shown so a reader isn't left guessing what's actually
      // required (`description`, below, still carries the WHY).
      lines.push(
        `  ${p}`,
        pick(locale, {
          en: `    ✗ no link${named} ${describeToRequirement(rule.to, locale)} (required by kind "${rule.from}")`,
          fr: `    ✗ aucun lien${named} ${describeToRequirement(rule.to, locale)} (requis pour le type « ${rule.from} »)`,
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
  run: ({ base, cli, ignore, resolved, roots, trackedFiles }) => {
    const coverage = resolved.checks.coverage
    if (coverage === null) {
      return Effect.die(
        new Error('coveragePlugin.run called with checks.coverage disabled — isEnabled() should have prevented this'),
      )
    }
    const { exempt, kinds, rules } = coverage
    return checkCoverage({
      base,
      // `cli.changed` (../checks/CheckPlugin.ts) is always defined (an
      // empty array when `--changed` wasn't passed); `checkCoverage` treats
      // an empty array the same as `undefined` (see its own `changedGuidance`
      // comment), so no presence check is needed here.
      changed: cli.changed,
      exempt,
      ignore,
      kinds,
      roots,
      rules,
      ...(trackedFiles === undefined ? {} : { trackedFiles }),
    })
  },
}
