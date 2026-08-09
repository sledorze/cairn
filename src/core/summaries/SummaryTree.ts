// Pure planner for the HIERARCHICAL summary system.
//
// Two kinds of summaries:
//  - file summary `X.summary.md` for every source doc `X.md` over the threshold;
//  - directory summary `DIR/_SUMMARY.md` for every directory, aggregating its
//    direct docs (or their summary when the doc is big) AND the `_SUMMARY.md`
//    of its direct sub-directories.
//
// Freshness is content-hash based (clone/CI-proof, unlike mtime). Each summary's
// hash H is recorded in a hidden sidecar under `.cairn/` (see StampStore.ts),
// never inside the summary's own content:
//  - file summary  -> H = hash(source doc content)
//  - dir summary   -> H = hash(manifest of its inputs' relative-path:content-hash)
// `planSummaries` never reads or writes a sidecar itself — it's handed the
// already-loaded `stamps` map (node path -> recorded hash) as a plain value, so
// this whole module stays pure and storage-agnostic; `program/CheckSummaries.ts`
// is the impure edge that loads `stamps` from `.cairn/**` via `DocsFs`.
//
// `planSummaries` returns every expected summary with its status and, crucially,
// the bottom-up order in which to (re)generate them so a single pass converges:
// file summaries first, then directories deepest-first (a parent's manifest then
// sees its already-fresh children).
//
// Filenames (`naming`), the line threshold, ignored globs and whether directory
// summaries are required are all configurable; defaults reproduce the original.

import * as nodePath from 'node:path'

import { extractLinks, isCheckableTarget, stripAnchor, stripCode } from '../links/MarkdownLinks.ts'
import { hashContent } from '../hashing.ts'
import { isIgnored, isInScope } from '../paths.ts'
import type { Naming, SummaryStatus } from './DocSummaries.ts'
import { countLines, DEFAULT_NAMING, extractSourceHash, isSummaryFile, summaryPathFor } from './DocSummaries.ts'

// POSIX path semantics so the plan is identical on every OS (inputs normalised
// to `/` at the IO boundary).
const path = nodePath.posix

/** Default per-directory digest filename. */
export const DIR_SUMMARY = DEFAULT_NAMING.dirSummary

export interface PlanNode {
  readonly expectedHash: string
  readonly inputs: readonly string[]
  readonly kind: 'dir' | 'file'
  /** True when the summary's OWN content still carries the legacy in-content
   * `<!-- source-sha256: ... -->` stamp (pre-sidecar format, see
   * DocSummaries.ts's `extractSourceHash`). Only ever true for a `stale`
   * node whose source is otherwise unchanged — an ordinary `--stamp` (or the
   * explicit `--migrate-stamps` alias) self-heals it in one pass. Reporting
   * uses this to distinguish a genuine content drift from a one-time format
   * upgrade (issue #142 item #1) instead of the generic "stale" message. */
  readonly legacyStamp: boolean
  readonly missingLinks: readonly string[]
  readonly path: string
  readonly recordedHash: string | null
  readonly status: SummaryStatus
}

export interface PlanArgs {
  readonly files: ReadonlyMap<string, string>
  readonly ignore?: readonly string[]
  readonly naming?: Naming
  readonly requireDirSummaries?: boolean
  readonly roots: readonly string[]
  /** Node path -> recorded hash, loaded from `.cairn/**` sidecars. Optional and
   * defaults to empty — an absent/not-yet-populated stamp store degrades every
   * node to `stale`/`missing`, the correct first-run behaviour, never a crash. */
  readonly stamps?: ReadonlyMap<string, string>
  readonly thresholdLines?: number
}

export interface SummaryPlan {
  readonly nodes: readonly PlanNode[]
  readonly orphans: readonly string[]
  /** A `.cairn/**` sidecar whose node no longer exists — its source doc (and
   * possibly its summary file too) was deleted, renamed, or dropped below the
   * size threshold. See `findDeletedStamps` for why this is distinct from
   * `orphans`. */
  readonly orphanStamps: readonly string[]
  readonly todo: readonly PlanNode[]
}

const EMPTY_STAMPS: ReadonlyMap<string, string> = new Map()

const DEFAULT_THRESHOLD_LINES = 30

/** True when `p` is a directory summary under the configured naming. */
export const isDirSummary = (p: string, naming: Naming = DEFAULT_NAMING): boolean =>
  p === naming.dirSummary || p.endsWith(`/${naming.dirSummary}`)

/** Absolute targets of the relative links found in `content`, resolved from `dir`. */
const resolveLinks = (content: string, dir: string): Set<string> => {
  const set = new Set<string>()
  for (const { target } of extractLinks(stripCode(content))) {
    if (!isCheckableTarget(target)) {
      continue
    }
    const rel = stripAnchor(target)
    if (rel) {
      set.add(path.resolve(dir, rel))
    }
  }
  return set
}

const statusOf = (exists: boolean, recorded: string | null, expected: string): SummaryStatus => {
  if (!exists) {
    return 'missing'
  }
  if (recorded !== expected) {
    return 'stale'
  }
  return 'ok'
}

/**
 * True only for a `stale` node whose summary content still carries the
 * legacy in-content stamp (see DocSummaries.ts's `extractSourceHash`) AND
 * that stamp's embedded hash matches the node's CURRENT `expectedHash` —
 * i.e. the source is unchanged since the legacy stamp was written; the only
 * thing missing is the `.cairn/**` sidecar entry (a one-time format
 * migration, `--migrate-stamps`/self-healing `--stamp`). A tag present but
 * embedding a DIFFERENT hash means the source has genuinely drifted since —
 * that's real content drift on top of the format gap, not migration alone,
 * so it must NOT be reported as the softer "format migration" message.
 * Gated on `status === 'stale'` so it can never surface on an `ok` node
 * (relevant beyond the text report — the full `SummaryPlan.nodes`, not just
 * `todo`, is what `--json` serialises).
 */
const hasLegacyStamp = (status: SummaryStatus, content: string, expectedHash: string): boolean =>
  status === 'stale' && extractSourceHash(content) === expectedHash

export interface NodeHashArgs {
  readonly files: ReadonlyMap<string, string>
  readonly inputs: readonly string[]
  readonly kind: 'dir' | 'file'
  readonly path: string
}

/**
 * A single node's expected hash, computed directly from its (structurally
 * stable — doesn't change while stamping) `inputs` and their CURRENT content —
 * without re-deriving the whole directory graph. `planSummaries` uses this to
 * build each node; `stampSummaries` reuses it to recompute just-stamped nodes'
 * parents against freshly-written children, without a full replan per node
 * (previously O(nodes) work repeated once per node, i.e. O(nodes^2) overall).
 */
export const nodeExpectedHash = ({ files, inputs, kind, path: nodeAtPath }: NodeHashArgs): string => {
  if (kind === 'file') {
    return hashContent(files.get(inputs[0] ?? '') ?? '')
  }
  const dir = path.dirname(nodeAtPath)
  const manifest = inputs
    .map((input) => `${path.relative(dir, input)}:${hashContent(files.get(input) ?? '')}`)
    .toSorted()
    .join('\n')
  return hashContent(manifest)
}

/** Compute the full hierarchical summary plan from the current file contents. */
export const planSummaries = ({
  files,
  ignore = [],
  naming = DEFAULT_NAMING,
  requireDirSummaries = true,
  roots,
  stamps = EMPTY_STAMPS,
  thresholdLines = DEFAULT_THRESHOLD_LINES,
}: PlanArgs): SummaryPlan => {
  const allPaths = [...files.keys()]
  const recorded = (p: string): string | null => stamps.get(p) ?? null

  const sourceDocs = allPaths.filter(
    (p) => p.endsWith('.md') && !isSummaryFile(p, naming) && !isDirSummary(p, naming) && !isIgnored(p, ignore, roots),
  )
  // Computed once per doc up front (a Set lookup below) rather than via a
  // countLines() call at each of the two sites that ask "is this doc big" — the
  // file-node filter and the dir-manifest input mapping both need the answer.
  const bigDocs = new Set(sourceDocs.filter((doc) => countLines(files.get(doc) ?? '') > thresholdLines))
  const isBig = (doc: string): boolean => bigDocs.has(doc)

  // --- file summaries ---
  const fileNodes: PlanNode[] = []
  for (const doc of sourceDocs.toSorted()) {
    if (!isBig(doc)) {
      continue
    }
    const sp = summaryPathFor(doc, naming)
    const expectedHash = nodeExpectedHash({ files, inputs: [doc], kind: 'file', path: sp })
    const recordedHash = recorded(sp)
    const status = statusOf(files.has(sp), recordedHash, expectedHash)
    fileNodes.push({
      expectedHash,
      inputs: [doc],
      kind: 'file',
      legacyStamp: hasLegacyStamp(status, files.get(sp) ?? '', expectedHash),
      missingLinks: [],
      path: sp,
      recordedHash,
      status,
    })
  }

  if (!requireDirSummaries) {
    const orphans = findOrphans({ files, ignore, naming, nodes: fileNodes, requireDirSummaries, roots })
    const orphanStamps = findDeletedStamps({
      expectedNodePaths: new Set(fileNodes.map((n) => n.path)),
      ignore,
      roots,
      stampNodePaths: stamps.keys(),
    })
    return { nodes: fileNodes, orphanStamps, orphans, todo: fileNodes.filter((n) => n.status !== 'ok') }
  }

  // --- directories in scope ---
  const dirs = new Set<string>()
  for (const doc of sourceDocs) {
    let d = path.dirname(doc)
    while (isInScope(d, roots)) {
      dirs.add(d)
      const parent = path.dirname(d)
      if (parent === d) {
        break
      }
      d = parent
    }
  }

  // --- bucket each doc/dir under its parent once, instead of re-filtering
  // `sourceDocs`/`dirs` from scratch inside the loop below (which was
  // O(dirs x docs) + O(dirs^2) on a large tree). ---
  const docsByParent = new Map<string, string[]>()
  for (const doc of sourceDocs) {
    const parent = path.dirname(doc)
    const bucket = docsByParent.get(parent)
    if (bucket) {
      bucket.push(doc)
    } else {
      docsByParent.set(parent, [doc])
    }
  }
  const dirsByParent = new Map<string, string[]>()
  for (const d of dirs) {
    const parent = path.dirname(d)
    const bucket = dirsByParent.get(parent)
    if (bucket) {
      bucket.push(d)
    } else {
      dirsByParent.set(parent, [d])
    }
  }

  // --- directory summaries ---
  const dirNodes: PlanNode[] = []
  for (const dir of dirs) {
    const childDocs = docsByParent.get(dir) ?? []
    const childDirs = dirsByParent.get(dir) ?? []
    const inputs = [
      ...childDocs.map((doc) => (isBig(doc) ? summaryPathFor(doc, naming) : doc)),
      ...childDirs.map((sub) => path.join(sub, naming.dirSummary)),
    ]
    const dsp = path.join(dir, naming.dirSummary)
    const expectedHash = nodeExpectedHash({ files, inputs, kind: 'dir', path: dsp })
    const recordedHash = recorded(dsp)
    const exists = files.has(dsp)
    // A directory summary must link every direct sub-file AND sub-folder. A
    // sub-folder counts as linked either way (issue #103): a bare directory
    // link (`./sub`) or a link straight to that child's own `_SUMMARY.md`
    // (`./sub/_SUMMARY.md`) — the curated index, and precisely the artifact
    // whose hash the Merkle model tracks for that child, not merely a
    // friendlier alternative to the bare path.
    const linked = resolveLinks(files.get(dsp) ?? '', dir)
    const isChildDirLinked = (sub: string): boolean => linked.has(sub) || linked.has(path.join(sub, naming.dirSummary))
    const missingLinks = [
      ...childDocs.filter((doc) => !linked.has(doc)),
      ...childDirs.filter((sub) => !isChildDirLinked(sub)),
    ].toSorted()
    const fresh = exists && recordedHash === expectedHash && missingLinks.length === 0
    const status: SummaryStatus = exists ? (fresh ? 'ok' : 'stale') : 'missing'
    dirNodes.push({
      expectedHash,
      inputs: inputs.toSorted(),
      kind: 'dir',
      legacyStamp: hasLegacyStamp(status, files.get(dsp) ?? '', expectedHash),
      missingLinks,
      path: dsp,
      recordedHash,
      status,
    })
  }

  // Bottom-up order: file summaries first, then dirs deepest-first.
  const depth = (p: string): number => p.split('/').length
  dirNodes.sort((a, b) => depth(b.path) - depth(a.path) || a.path.localeCompare(b.path))

  const nodes = [...fileNodes, ...dirNodes]
  const orphans = findOrphans({ files, ignore, naming, nodes, requireDirSummaries, roots })
  const orphanStamps = findDeletedStamps({
    expectedNodePaths: new Set(nodes.map((n) => n.path)),
    ignore,
    roots,
    stampNodePaths: stamps.keys(),
  })
  return { nodes, orphanStamps, orphans, todo: nodes.filter((n) => n.status !== 'ok') }
}

interface FindDeletedStampsArgs {
  readonly expectedNodePaths: ReadonlySet<string>
  readonly ignore: readonly string[]
  readonly roots: readonly string[]
  readonly stampNodePaths: Iterable<string>
}

/**
 * A `.cairn/**` sidecar (see StampStore.ts) whose node no longer corresponds to
 * any expected node. Unlike `findOrphans` (which only sees a leftover summary
 * FILE still on disk), a sidecar is written exclusively by the tool and never
 * touched by hand — so it remains as evidence even when the summary file
 * itself was deleted alongside its source, catching a deletion `findOrphans`
 * alone would miss entirely.
 */
const findDeletedStamps = ({ expectedNodePaths, ignore, roots, stampNodePaths }: FindDeletedStampsArgs): string[] =>
  [...stampNodePaths].filter((p) => !expectedNodePaths.has(p) && !isIgnored(p, ignore, roots)).toSorted()

interface FindOrphansArgs {
  readonly files: ReadonlyMap<string, string>
  readonly ignore: readonly string[]
  readonly naming: Naming
  readonly nodes: readonly PlanNode[]
  readonly requireDirSummaries: boolean
  readonly roots: readonly string[]
}

/**
 * A `.summary.md`/`_SUMMARY.md` on disk that no longer corresponds to any
 * expected node — its source doc was deleted, renamed, or (for file summaries)
 * dropped below the threshold. Excludes paths matching `ignore`. When
 * `requireDirSummaries` is false, directory summaries are never expected, so
 * they are never flagged as orphans.
 */
const findOrphans = ({ files, ignore, naming, nodes, requireDirSummaries, roots }: FindOrphansArgs): string[] => {
  const expected = new Set(nodes.map((n) => n.path))
  const actualSummaries = [...files.keys()].filter(
    (p) => isManagedSummaryPath(p, naming, requireDirSummaries) && !isIgnored(p, ignore, roots),
  )
  return actualSummaries.filter((p) => !expected.has(p)).toSorted()
}

/** A path cairn manages as a summary artifact under `naming` — a file summary always, a directory summary only when required. */
const isManagedSummaryPath = (p: string, naming: Naming, requireDirSummaries: boolean): boolean =>
  isSummaryFile(p, naming) || (requireDirSummaries && isDirSummary(p, naming))
