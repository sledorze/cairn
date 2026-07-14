// Pure planner for the HIERARCHICAL summary system.
//
// Two kinds of summaries:
//  - file summary `X.summary.md` for every source doc `X.md` over the threshold;
//  - directory summary `DIR/_SUMMARY.md` for every directory, aggregating its
//    direct docs (or their summary when the doc is big) AND the `_SUMMARY.md`
//    of its direct sub-directories.
//
// Freshness is content-hash based (clone/CI-proof, unlike mtime). Each summary
// embeds `<!-- source-sha256: H -->`:
//  - file summary  -> H = hash(source doc content)
//  - dir summary   -> H = hash(manifest of its inputs' relative-path:content-hash)
//
// `planSummaries` returns every expected summary with its status and, crucially,
// the bottom-up order in which to (re)generate them so a single pass converges:
// file summaries first, then directories deepest-first (a parent's manifest then
// sees its already-fresh children).
//
// Filenames (`naming`), the line threshold, ignored globs and whether directory
// summaries are required are all configurable; defaults reproduce the original.

import * as nodePath from 'node:path'

import type { Naming, SummaryStatus } from './DocSummaries.ts'
import {
  countLines,
  DEFAULT_NAMING,
  extractSourceHash,
  hashContent,
  isSummaryFile,
  summaryPathFor,
} from './DocSummaries.ts'
import { matchesAny } from './glob.ts'
import { extractLinks, isCheckableTarget, stripAnchor, stripCode } from './MarkdownLinks.ts'

// POSIX path semantics so the plan is identical on every OS (inputs normalised
// to `/` at the IO boundary).
const path = nodePath.posix

/** Default per-directory digest filename. */
export const DIR_SUMMARY = DEFAULT_NAMING.dirSummary

export interface PlanNode {
  readonly expectedHash: string
  readonly inputs: readonly string[]
  readonly kind: 'dir' | 'file'
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
  readonly thresholdLines?: number
}

export interface SummaryPlan {
  readonly nodes: readonly PlanNode[]
  readonly orphans: readonly string[]
  readonly todo: readonly PlanNode[]
}

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
  thresholdLines = DEFAULT_THRESHOLD_LINES,
}: PlanArgs): SummaryPlan => {
  const allPaths = [...files.keys()]
  const recorded = (p: string): string | null => (files.has(p) ? extractSourceHash(files.get(p) ?? '') : null)

  const sourceDocs = allPaths.filter(
    (p) => p.endsWith('.md') && !isSummaryFile(p, naming) && !isDirSummary(p, naming) && !matchesAny(p, ignore),
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
    fileNodes.push({
      expectedHash,
      inputs: [doc],
      kind: 'file',
      missingLinks: [],
      path: sp,
      recordedHash,
      status: statusOf(files.has(sp), recordedHash, expectedHash),
    })
  }

  if (!requireDirSummaries) {
    const orphans = findOrphans({ files, ignore, naming, nodes: fileNodes, requireDirSummaries })
    return { nodes: fileNodes, orphans, todo: fileNodes.filter((n) => n.status !== 'ok') }
  }

  // --- directories in scope ---
  const inScope = (d: string): boolean => roots.some((r) => d === r || d.startsWith(`${r}/`))
  const dirs = new Set<string>()
  for (const doc of sourceDocs) {
    let d = path.dirname(doc)
    while (inScope(d)) {
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
    // A directory summary must link every direct sub-file AND sub-folder.
    const requiredLinks = [...childDocs, ...childDirs]
    const linked = resolveLinks(files.get(dsp) ?? '', dir)
    const missingLinks = requiredLinks.filter((target) => !linked.has(target)).toSorted()
    const fresh = exists && recordedHash === expectedHash && missingLinks.length === 0
    dirNodes.push({
      expectedHash,
      inputs: inputs.toSorted(),
      kind: 'dir',
      missingLinks,
      path: dsp,
      recordedHash,
      status: exists ? (fresh ? 'ok' : 'stale') : 'missing',
    })
  }

  // Bottom-up order: file summaries first, then dirs deepest-first.
  const depth = (p: string): number => p.split('/').length
  dirNodes.sort((a, b) => depth(b.path) - depth(a.path) || a.path.localeCompare(b.path))

  const nodes = [...fileNodes, ...dirNodes]
  const orphans = findOrphans({ files, ignore, naming, nodes, requireDirSummaries })
  return { nodes, orphans, todo: nodes.filter((n) => n.status !== 'ok') }
}

interface FindOrphansArgs {
  readonly files: ReadonlyMap<string, string>
  readonly ignore: readonly string[]
  readonly naming: Naming
  readonly nodes: readonly PlanNode[]
  readonly requireDirSummaries: boolean
}

/**
 * A `.summary.md`/`_SUMMARY.md` on disk that no longer corresponds to any
 * expected node — its source doc was deleted, renamed, or (for file summaries)
 * dropped below the threshold. Excludes paths matching `ignore`. When
 * `requireDirSummaries` is false, directory summaries are never expected, so
 * they are never flagged as orphans.
 */
const findOrphans = ({ files, ignore, naming, nodes, requireDirSummaries }: FindOrphansArgs): string[] => {
  const expected = new Set(nodes.map((n) => n.path))
  const actualSummaries = [...files.keys()].filter(
    (p) => isManagedSummaryPath(p, naming, requireDirSummaries) && !matchesAny(p, ignore),
  )
  return actualSummaries.filter((p) => !expected.has(p)).toSorted()
}

/** A path cairn manages as a summary artifact under `naming` — a file summary always, a directory summary only when required. */
const isManagedSummaryPath = (p: string, naming: Naming, requireDirSummaries: boolean): boolean =>
  isSummaryFile(p, naming) || (requireDirSummaries && isDirSummary(p, naming))
