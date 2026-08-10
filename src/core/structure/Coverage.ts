// Pure, IO-free rule-satisfaction resolution over already-scanned, kind-
// classified docs — extracted out of ../../program/structure/CheckCoverage.ts
// so a future consumer (e.g. a stale-coverage-link freshness check, tracking
// content-hash drift on a rule's SATISFYING target the same way
// ../links/RefStore.ts already does for plain references) can reuse the
// exact same resolution logic instead of re-deriving kind matching, path
// resolution, and `exempt` handling as a second, divergent copy. Two
// consumers computing "which doc/rule pairs are satisfied, and by what" is
// exactly the kind of duplicated LOGIC (not just duplicated config) this
// extraction exists to prevent.
//
// Every satisfying ref is collected, not collapsed to a boolean — a stale-
// link check needs every target path to hash-track, not just one
// arbitrarily-chosen "the" satisfying ref. The cardinality rule this comment
// used to call hypothetical (`via: { by: 'link', minCount: 2 }`) now exists,
// shaped differently than guessed here: `to: { atLeast: { n, of } }`
// (../Config.ts) rather than a `via` field — see `quantifierOf`'s own
// comment for why `RuleEdge.satisfied` (below) is what actually resolves it.

import * as nodePath from 'node:path'

import type { CoverageRule, CoverageTarget } from '../Config.ts'
import { isKindTarget, isUrlTarget, quantifierOf, targetsOf } from '../Config.ts'
import { matchesAny, matchesGlob } from '../glob.ts'
import type { DocMetadata, StructureNode } from './DocMetadata.ts'

const path = nodePath.posix

/** One `ref` or `urlRef` node (never a `heading` one — narrowed at the type
 * level so a consumer never has to re-check `.tag`). */
export type RefNode = Extract<StructureNode, { readonly tag: 'ref' } | { readonly tag: 'urlRef' }>

export interface SatisfyingRef {
  readonly node: RefNode
  /** For a `ref` node: the resolved (absolute, POSIX) path of the doc it
   * points at. For a `urlRef` node (an `{ external: 'url', pattern }` rule's
   * match): the node's own raw href, unresolved — a URL has no "directory"
   * to resolve against. */
  readonly targetPath: string
}

export interface RuleEdge {
  /** The `from`-kind doc's own path. */
  readonly doc: string
  readonly rule: CoverageRule
  /** Whether the rule counts as satisfied for `doc`. For a single target or
   * an OR-shaped `to` (array / `{ any }`, `quantifierOf`'s `n: 1` case) this
   * is exactly `satisfiedBy.length > 0` — unchanged from before `{ atLeast
   * }` existed. For `{ atLeast: { n, of } }` it's true only when at least
   * `n` of `of`'s targets EACH have their own satisfying ref —
   * `satisfiedBy.length > 0` alone can no longer answer "is this rule
   * satisfied" once a MINIMUM COUNT across several distinct targets is
   * possible, not just "some link matched something." Always computed via
   * `quantifierOf` (../Config.ts), the one place a rule's cardinality is
   * resolved. */
  readonly satisfied: boolean
  /** Every ref (zero or more) in `doc` that resolves to any of `to`'s
   * targets — informational (which links actually matched), not by itself
   * the satisfaction verdict once `{ atLeast }` exists; use `satisfied`
   * for that. */
  readonly satisfiedBy: readonly SatisfyingRef[]
}

export interface ResolveRuleEdgesArgs {
  /** Already scanned AND already kind-classified (`kinds.length > 0`) —
   * this function does no scanning/classification of its own, matching
   * `buildDocGraph`'s own "docs' path fields must already be absolute,
   * POSIX-normalised" contract in ../structure/DocGraph.ts. */
  readonly docs: readonly DocMetadata[]
  /** Globs — a doc matching one produces NO edge at all, for ANY rule.
   * Applied here (not by the caller) so every consumer inherits the same
   * exemption semantics automatically. */
  readonly exempt: readonly string[]
  /** Every absolute path CONFIRMED to exist on disk, for resolving a rule
   * whose `to` is `{ external: 'path' }` — computed by the caller (real IO
   * lives in ../../program/structure/CheckCoverage.ts, this function stays
   * pure). Absent/omitted paths are simply unsatisfied, never assumed to
   * exist — see `collectExternalRefTargets` for how a caller learns which
   * paths need checking in the first place. */
  readonly externalExists?: ReadonlySet<string>
  /** Already deduped by the caller (see CheckCoverage.ts's own dedup-key
   * comment) — this function has no opinion on what makes two rules "the
   * same," only on resolving whichever rules it's given. */
  readonly rules: readonly CoverageRule[]
}

/** Whether one `node` satisfies `rule` AGAINST ONE SPECIFIC `target` (one
 * element of `targetsOf(rule.to)`) for a doc rooted at `fromDir` — pulled
 * out of `matchNode`'s own loop purely to keep block nesting shallow
 * (oxlint's `max-depth`); no behavior change from having this inline for a
 * rule with a single, non-array `to` (the only case that existed before
 * alternation). Returns the satisfying target (for `SatisfyingRef.targetPath`)
 * or `null` when `node` doesn't satisfy `target` at all (wrong node tag,
 * wrong target, whatever the reason). */
const matchNodeAgainstTarget = (
  rule: CoverageRule,
  target: CoverageTarget,
  node: StructureNode,
  fromDir: string,
  docsByPath: ReadonlyMap<string, DocMetadata>,
  externalExists: ReadonlySet<string>,
): string | null => {
  // `{ external: 'url', pattern }` is resolved entirely differently from the
  // other two `to` shapes — no path resolution, no doc-graph or filesystem
  // lookup, just a raw substring match against a `urlRef` node's own href
  // (see `StructureNode`'s own comment in ./DocMetadata.ts for why URL
  // targets are a distinct tag from `ref`).
  if (isUrlTarget(target)) {
    return node.tag === 'urlRef' && node.target.includes(target.pattern) ? node.target : null
  }
  if (node.tag !== 'ref') {
    return null
  }
  const targetPath = path.resolve(fromDir, node.target)
  // `target` is either a declared kind id (resolve against the
  // already-classified doc graph, no IO) or `{ external: 'path' }` (resolve
  // against the caller's pre-checked existence set — see
  // `ResolveRuleEdgesArgs.externalExists`'s own comment for why this stays a
  // lookup here, not a filesystem call).
  const kindSatisfied = isKindTarget(target)
    ? (docsByPath.get(targetPath)?.kinds.includes(target) ?? false)
    : externalExists.has(targetPath)
  // `scope: 'sibling'` (see CoverageRuleInputSchema's own comment for the
  // capturability finding this closes): a wildcard `to`-kind glob matching
  // many instances (e.g. every design package's spikes.md) must not let doc
  // A's rule be satisfied by doc B's sibling — only a target sharing doc A's
  // own parent directory counts. `{ external: 'path' }` targets have no kind
  // classification to scope by (no sibling GROUP to belong to in the first
  // place), so `scope` is a deliberate no-op for them, not an oversight.
  //
  // `scope: { under: '...' }` (CoverageRuleInputSchema's own comment): the
  // granularity gap between `'sibling'` (exact same directory) and unscoped
  // (anywhere in the corpus) — satisfied by a `to`-kind doc nested ANYWHERE
  // below the given project-relative directory, not just directly in it.
  // Matched as a glob (`**/<under>/**`) rather than a plain path-prefix
  // string compare, so `under` matches regardless of the absolute scan root
  // a given run happens to resolve `targetPath` against — the same
  // "`**/`-prefixed, root-independent" convention every kind's own `by:
  // 'path'` glob already relies on (see `KindSelectorInputSchema`'s own
  // comment). A leading/trailing slash on `under` is trimmed so
  // `"docs/design/team-b"` and `"/docs/design/team-b/"` behave identically.
  const scopeSatisfied =
    rule.scope === undefined || !isKindTarget(target)
      ? true
      : rule.scope === 'sibling'
        ? path.dirname(targetPath) === fromDir
        : matchesGlob(targetPath, `**/${rule.scope.under.replaceAll(/^\/+|\/+$/g, '')}/**`)
  return kindSatisfied && scopeSatisfied ? targetPath : null
}

/** Whether one `node` satisfies `rule` for a doc rooted at `fromDir` —
 * satisfied when the node matches ANY ONE of `rule.to`'s targets
 * (`targetsOf`'s own "alternation/OR" semantics — see
 * `CoverageTargetOrAlternativesInputSchema`'s own comment in ../Config.ts).
 * For a rule with a single, non-array `to` (every rule written before this
 * field existed already means that), `targetsOf` returns a one-element
 * list, so this loops exactly once — identical behavior to the pre-
 * alternation code this replaces. Returns the FIRST satisfying target, not
 * every one — matches this function's own pre-existing "first satisfying
 * result wins" contract for a single target; `resolveRuleEdges` below still
 * collects one `SatisfyingRef` per NODE, not per (node, target) pair. */
const matchNode = (
  rule: CoverageRule,
  node: StructureNode,
  fromDir: string,
  docsByPath: ReadonlyMap<string, DocMetadata>,
  externalExists: ReadonlySet<string>,
): string | null => {
  for (const target of quantifierOf(rule.to).targets) {
    const result = matchNodeAgainstTarget(rule, target, node, fromDir, docsByPath, externalExists)
    if (result !== null) {
      return result
    }
  }
  return null
}

/** For `{ atLeast: { n, of } }` (and, degenerately, every other `to` shape,
 * where it's equivalent to "is `satisfiedBy` non-empty"): how many of
 * `targets` have AT LEAST ONE satisfying node in `doc`, checked
 * independently per target (unlike `matchNode`'s own "first target wins"
 * loop, which exists purely to pick ONE representative match per node for
 * `satisfiedBy` — the right choice when only "matched something" matters,
 * wrong for `atLeast`'s "how many DISTINCT targets were matched," which
 * needs every target checked on its own regardless of what else the same
 * node happens to also satisfy). */
const countSatisfiedTargets = (
  rule: CoverageRule,
  targets: readonly CoverageTarget[],
  nodes: readonly StructureNode[],
  fromDir: string,
  docsByPath: ReadonlyMap<string, DocMetadata>,
  externalExists: ReadonlySet<string>,
): number =>
  targets.filter((target) =>
    nodes.some(
      (node) =>
        (node.tag === 'ref' || node.tag === 'urlRef') &&
        matchNodeAgainstTarget(rule, target, node, fromDir, docsByPath, externalExists) !== null,
    ),
  ).length

/** For every (doc, rule) pair where `doc.kinds` includes `rule.from` and
 * `doc` doesn't match `exempt`, resolve every ref in `doc` that satisfies
 * `rule` (targets a doc whose `kinds` includes `rule.to`) — direct
 * resolution only, never transitive (a chain `feature -> decision -> spec`
 * does not by itself satisfy a direct `feature -> spec` rule; see
 * docs/adr/0002's own Decision section for why). */
export const resolveRuleEdges = ({
  docs,
  exempt,
  externalExists = new Set(),
  rules,
}: ResolveRuleEdgesArgs): readonly RuleEdge[] => {
  const docsByPath = new Map(docs.map((d) => [d.path, d]))
  const edges: RuleEdge[] = []

  for (const doc of docs) {
    if (matchesAny(doc.path, exempt)) {
      continue
    }
    const fromDir = path.dirname(doc.path)
    for (const rule of rules) {
      if (!doc.kinds.includes(rule.from)) {
        continue
      }
      const satisfiedBy: SatisfyingRef[] = []
      for (const node of doc.nodes) {
        // `matchNode` only ever returns non-`null` for a `ref` or `urlRef`
        // node (never `heading`) — narrowed here, not inside `matchNode`
        // itself, so `SatisfyingRef.node` stays typed as `RefNode` without a
        // cast.
        if (node.tag !== 'ref' && node.tag !== 'urlRef') {
          continue
        }
        const targetPath = matchNode(rule, node, fromDir, docsByPath, externalExists)
        if (targetPath !== null) {
          satisfiedBy.push({ node, targetPath })
        }
      }
      const { n, targets } = quantifierOf(rule.to)
      // For `n === 1` (every `to` shape except `{ atLeast }` with `n > 1`),
      // this is provably identical to `satisfiedBy.length > 0`: `targets`
      // covers exactly the same candidates `matchNode` already looped over
      // above, so at least one of them has a satisfying node iff
      // `satisfiedBy` is non-empty. Only diverges from that shortcut when
      // `n > 1`, which is exactly when the shortcut stops being correct in
      // the first place — see `countSatisfiedTargets`'s own comment for why
      // a SEPARATE, per-target-independent count is needed rather than
      // reusing `satisfiedBy`.
      const satisfied = countSatisfiedTargets(rule, targets, doc.nodes, fromDir, docsByPath, externalExists) >= n
      edges.push({ doc: doc.path, rule, satisfied, satisfiedBy })
    }
  }

  return edges
}

/** Every `RuleEdge` whose OWN `doc`, or one of whose `satisfiedBy` targets,
 * is in `changed` — the pure logic behind the CLI's `--changed` scoping
 * (../../program/structure/CheckCoverage.ts): "if this file changed, which
 * rule edges are relevant to re-check, and why" (an edge's `rule.
 * description`), for AI-review guidance. Both directions matter: a changed
 * `from`-kind doc has its OWN obligations to re-verify, and a changed doc
 * that some OTHER doc's rule points AT (a `satisfiedBy` target) means that
 * other doc's edge is worth re-checking too — a decision doc changing
 * content is exactly as relevant to review as the feature doc that cites it.
 *
 * Pure path-set membership only, no glob/resolution — the caller must hand
 * in `changed` already resolved to the same absolute-POSIX form
 * `RuleEdge.doc`/`SatisfyingRef.targetPath` use (`buildDocGraph`'s own
 * contract), same division of labor as `externalExists` above (IO/
 * resolution stays in ../../program/structure/CheckCoverage.ts, this module
 * stays IO-free). */
export const filterRuleEdgesByChanged = (
  edges: readonly RuleEdge[],
  changed: ReadonlySet<string>,
): readonly RuleEdge[] =>
  edges.filter((edge) => changed.has(edge.doc) || edge.satisfiedBy.some((ref) => changed.has(ref.targetPath)))

/** Every distinct resolved target path a `from`-kind doc's ref points at,
 * for every rule whose `to` is `{ external: 'path' }` — the candidate set a
 * caller must confirm exists on disk (via IO) before calling
 * `resolveRuleEdges` with the result as `externalExists`. Pure: reuses the
 * exact same kind/exempt filtering `resolveRuleEdges` applies, so a doc that
 * would never produce an edge never produces a candidate either. */
export const collectExternalRefTargets = (
  docs: readonly DocMetadata[],
  exempt: readonly string[],
  rules: readonly CoverageRule[],
): readonly string[] => {
  // Only `{ external: 'path' }` rules need a filesystem-existence candidate
  // — `{ external: 'url', pattern }` (../Config.ts) matches a `urlRef` node
  // directly in `resolveRuleEdges`, no IO involved, so a `from` kind used
  // ONLY by a url rule must not pull every OTHER (unrelated, same-kind) ref
  // in that doc into the filesystem-check candidate set. A rule's `to` may
  // be an array of alternatives (`targetsOf`) — `.some(...)` here means "at
  // least one alternative needs a real-file check," so a `from` kind is
  // still included even when only ONE of its several `to` alternatives is
  // `{ external: 'path' }`.
  const externalFromKinds = new Set(
    rules.filter((r) => targetsOf(r.to).some((t) => !isKindTarget(t) && !isUrlTarget(t))).map((r) => r.from),
  )
  if (externalFromKinds.size === 0) {
    return []
  }

  const targets = new Set<string>()
  for (const doc of docs) {
    if (matchesAny(doc.path, exempt)) {
      continue
    }
    if (!doc.kinds.some((k) => externalFromKinds.has(k))) {
      continue
    }
    const fromDir = path.dirname(doc.path)
    for (const node of doc.nodes) {
      if (node.tag !== 'ref') {
        continue
      }
      targets.add(path.resolve(fromDir, node.target))
    }
  }
  return [...targets]
}
