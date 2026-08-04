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
// Every satisfying ref is collected, not collapsed to a boolean — a future
// cardinality rule (`via: { by: 'link', minCount: 2 }`) needs the count, and
// a future stale-link check needs every target path to hash-track, not just
// one arbitrarily-chosen "the" satisfying ref.

import * as nodePath from 'node:path'

import type { CoverageRule } from '../Config.ts'
import { isKindTarget, isUrlTarget } from '../Config.ts'
import { matchesAny } from '../glob.ts'
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
  /** Every ref (zero or more) in `doc` that resolves to a `to`-kind doc.
   * Empty means the rule is unsatisfied for this doc. */
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

/** Whether one `node` satisfies `rule` for a doc rooted at `fromDir` — pulled
 * out of `resolveRuleEdges`'s own triple-nested loop purely to keep that
 * loop's own block nesting shallow (oxlint's `max-depth`); no behavior
 * change from having this inline. Returns the satisfying target (for
 * `SatisfyingRef.targetPath`) or `null` when `node` doesn't satisfy `rule`
 * at all (wrong node tag, wrong target, whatever the reason). */
const matchNode = (
  rule: CoverageRule,
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
  if (isUrlTarget(rule.to)) {
    return node.tag === 'urlRef' && node.target.includes(rule.to.pattern) ? node.target : null
  }
  if (node.tag !== 'ref') {
    return null
  }
  const targetPath = path.resolve(fromDir, node.target)
  // `rule.to` is either a declared kind id (resolve against the
  // already-classified doc graph, no IO) or `{ external: 'path' }` (resolve
  // against the caller's pre-checked existence set — see
  // `ResolveRuleEdgesArgs.externalExists`'s own comment for why this stays a
  // lookup here, not a filesystem call).
  const kindSatisfied = isKindTarget(rule.to)
    ? (docsByPath.get(targetPath)?.kinds.includes(rule.to) ?? false)
    : externalExists.has(targetPath)
  // `scope: 'sibling'` (see CoverageRuleInputSchema's own comment for the
  // capturability finding this closes): a wildcard `to`-kind glob matching
  // many instances (e.g. every design package's spikes.md) must not let doc
  // A's rule be satisfied by doc B's sibling — only a target sharing doc A's
  // own parent directory counts. `{ external: 'path' }` targets have no kind
  // classification to scope by (no sibling GROUP to belong to in the first
  // place), so `scope` is a deliberate no-op for them, not an oversight.
  const scopeSatisfied = rule.scope !== 'sibling' || !isKindTarget(rule.to) || path.dirname(targetPath) === fromDir
  return kindSatisfied && scopeSatisfied ? targetPath : null
}

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
      edges.push({ doc: doc.path, rule, satisfiedBy })
    }
  }

  return edges
}

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
  // in that doc into the filesystem-check candidate set.
  const externalFromKinds = new Set(rules.filter((r) => !isKindTarget(r.to) && !isUrlTarget(r.to)).map((r) => r.from))
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
