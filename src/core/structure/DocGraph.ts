// Pure, IO-free corpus-wide inbound-reference graph — inverts every doc's
// outbound `ref` nodes (from ./DocMetadata.ts) into "which docs point AT
// this path." The Set-difference orphan check (mirroring `findOrphans` in
// ../summaries/SummaryTree.ts) applies directly on top: a declared-kind doc
// with no entry here has no inbound reference from anywhere in the corpus.
//
// `inboundByPath` is a `Bag`, not a `Seq` (matches GitHub issue #29's own
// locked cross-file ordering discipline): which doc referenced a target
// FIRST has no meaning and must never be relied on by a rule built on top.

import * as nodePath from 'node:path'

import type { DocMetadata } from './DocMetadata.ts'

const path = nodePath.posix

export interface DocGraph {
  /** Absolute path -> the absolute paths of every doc that references it,
   * each doc listed at most once even if it references the target more
   * than once. A path with zero inbound references has NO entry here (not
   * an empty array) — callers test with `.has`, not `(arr ?? []).length`. */
  readonly inboundByPath: ReadonlyMap<string, readonly string[]>
}

/** `docs`' own `path` fields must already be absolute, POSIX-normalised —
 * the same contract `DocsFs.listFiles` already guarantees for every path
 * flowing through the rest of this codebase; a ref's `target` is resolved
 * against its OWN doc's directory, same as `checkContent` in
 * `../links/MarkdownLinks.ts` already does. */
export const buildDocGraph = (docs: readonly DocMetadata[]): DocGraph => {
  const inbound = new Map<string, Set<string>>()
  for (const doc of docs) {
    const fromDir = path.dirname(doc.path)
    for (const node of doc.nodes) {
      if (node.tag !== 'ref') {
        continue
      }
      const targetAbs = path.resolve(fromDir, node.target)
      const referrers = inbound.get(targetAbs)
      if (referrers) {
        referrers.add(doc.path)
      } else {
        inbound.set(targetAbs, new Set([doc.path]))
      }
    }
  }
  return { inboundByPath: new Map([...inbound].map(([target, referrers]) => [target, [...referrers]])) }
}
