// Pure, IO-free extraction of positioned, kind-classified document metadata
// — the small reusable "structure" layer future linters register against
// (starting with ../../program/structure/CheckCoverage.ts). Takes an
// already-read doc's content; does no IO of its own.
//
// Ordering discipline (matches GitHub issue #29's own locked decision, so
// this composes with the larger structure-engine effort later instead of
// needing a rewrite to align with it): WITHIN a doc, `nodes` is a `Seq` —
// real document order, positionally meaningful, the type's own contract.
// ACROSS docs (see ../../program/structure/CheckCoverage.ts's corpus graph),
// any collection is a `Bag` — a multiset, order carries no meaning there.

import { extractHeadingsWithPosition } from '../links/Anchors.ts'
import { extractLinksWithPosition, isCheckableTarget, parseTarget, stripCode } from '../links/MarkdownLinks.ts'
import { matchesAny } from '../glob.ts'

/**
 * How a doc is classified into a kind. A discriminated union, not just the
 * `'path'` variant this increment implements, so declaring a new selector
 * shape later (once cairn parses frontmatter) is a new union member, not a
 * breaking change to `KindDef`/`DocMetadata`'s own shape — reuses the shape
 * GitHub issue #28 already designed for this exact purpose.
 */
export interface KindSelector {
  readonly by: 'path'
  readonly glob: string
}

export interface KindDef {
  readonly id: string
  readonly select: KindSelector
}

export type StructureNode =
  | {
      readonly level: number
      readonly line: number
      readonly slug: string
      readonly tag: 'heading'
      readonly text: string
    }
  | { readonly anchor: string | null; readonly line: number; readonly tag: 'ref'; readonly target: string }

export interface DocMetadata {
  readonly path: string
  /** Every matching kind id — zero or more, never a nullable singular: a
   * `KindSelector` can legitimately match more than one declared kind (e.g.
   * overlapping globs), so this stays an array from day one rather than
   * needing a breaking type change the first time that happens for real. */
  readonly kinds: readonly string[]
  /** One ordered sequence of tagged nodes — not separate `headings`/`refs`
   * arrays — so relative document order between a heading and the refs
   * under it is preserved and queryable (what a future heading-scoped rule
   * needs), and adding a new node kind later is a new tag, not a new
   * top-level array every consumer has to learn about. */
  readonly nodes: readonly StructureNode[]
}

export interface ExtractDocMetadataArgs {
  readonly content: string
  readonly kinds: readonly KindDef[]
  readonly path: string
}

/** Offset (into `content`) of the start of each line, 0-indexed lines. Build
 * once per doc and reuse across every `offsetToLine` lookup — a fresh O(n)
 * scan per lookup would make position-tagging a whole doc's ref nodes
 * O(n * refs), the same "cheap alone, quadratic in a loop" shape this
 * session's own ReDoS fixes exist to avoid. */
export const lineStarts = (content: string): readonly number[] => {
  const starts = [0]
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '\n') {
      starts.push(i + 1)
    }
  }
  return starts
}

/** 1-indexed line number for `offset`, given `starts` from `lineStarts` for
 * the SAME content. Binary search — O(log lines) per call, and doesn't
 * assume callers look up offsets in increasing order (an implicit ordering
 * requirement would be a real, easy-to-violate footgun for a general-
 * purpose utility). An offset exactly at a line's own start resolves to
 * that line, not the previous one. */
export const offsetToLine = (starts: readonly number[], offset: number): number => {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    // `mid` is always a valid index of `starts` by this loop's own
    // invariant (0 <= lo <= mid <= hi <= starts.length - 1, and
    // `lineStarts` always returns at least `[0]`, never empty) — never a
    // runtime possibility a fallback needs to defend against, same
    // reasoning as `MarkdownLinks.ts`'s own `linkTarget` helper.
    if ((starts[mid] as number) <= offset) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return lo + 1
}

const matchesSelector = (path: string, select: KindSelector): boolean => matchesGlob(path, select)

// Kept as its own tiny function (rather than inlining `matchesAny`) so a
// future second `KindSelector` variant (`by: 'frontmatter'`, `by: 'any'`)
// only needs a switch added HERE — `extractDocMetadata`'s own loop over
// `kinds` stays unchanged.
const matchesGlob = (path: string, select: KindSelector): boolean => matchesAny(path, [select.glob])

/** Every declared kind id whose selector matches `path`. */
const classify = (path: string, kinds: readonly KindDef[]): readonly string[] =>
  kinds.filter((k) => matchesSelector(path, k.select)).map((k) => k.id)

/** Extract one doc's positioned, kind-classified metadata. Pure — no IO,
 * `path` is used only for kind classification and to label ref/heading
 * nodes' owning doc implicitly (the caller already knows `path`, so nodes
 * themselves don't repeat it). */
export const extractDocMetadata = ({ content, kinds, path }: ExtractDocMetadataArgs): DocMetadata => {
  const masked = stripCode(content)
  const starts = lineStarts(content)

  const headingNodes: StructureNode[] = extractHeadingsWithPosition(content).map((h) => ({
    level: h.level,
    line: h.line,
    slug: h.slug,
    tag: 'heading',
    text: h.text,
  }))

  const refNodes: StructureNode[] = []
  for (const link of extractLinksWithPosition(masked)) {
    if (!isCheckableTarget(link.target)) {
      continue
    }
    const { anchor, path: target } = parseTarget(link.target)
    if (target === '') {
      continue
    }
    refNodes.push({ anchor, line: offsetToLine(starts, link.index), tag: 'ref', target })
  }

  // Both node lists are already individually in document order (each came
  // from its own single left-to-right scan); merging by line number (stable
  // sort — ties keep their relative extraction order) combines them into
  // ONE correctly-ordered sequence without re-scanning the document.
  const nodes = [...headingNodes, ...refNodes].toSorted((a, b) => a.line - b.line)

  return { kinds: classify(path, kinds), nodes, path }
}
