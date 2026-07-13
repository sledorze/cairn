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
  const contentHash = (p: string): string => hashContent(files.get(p) ?? '')
  const recorded = (p: string): string | null => (files.has(p) ? extractSourceHash(files.get(p) ?? '') : null)

  const sourceDocs = allPaths.filter(
    (p) => p.endsWith('.md') && !isSummaryFile(p, naming) && !isDirSummary(p, naming) && !matchesAny(p, ignore),
  )
  const isBig = (doc: string): boolean => countLines(files.get(doc) ?? '') > thresholdLines

  // --- file summaries ---
  const fileNodes: PlanNode[] = []
  for (const doc of sourceDocs.toSorted()) {
    if (!isBig(doc)) {
      continue
    }
    const sp = summaryPathFor(doc, naming)
    const expectedHash = contentHash(doc)
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
    return { nodes: fileNodes, todo: fileNodes.filter((n) => n.status !== 'ok') }
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

  // --- directory summaries ---
  const dirNodes: PlanNode[] = []
  for (const dir of dirs) {
    const childDocs = sourceDocs.filter((p) => path.dirname(p) === dir)
    const childDirs = [...dirs].filter((p) => path.dirname(p) === dir)
    const inputs = [
      ...childDocs.map((doc) => (isBig(doc) ? summaryPathFor(doc, naming) : doc)),
      ...childDirs.map((sub) => path.join(sub, naming.dirSummary)),
    ]
    const manifest = inputs
      .map((input) => `${path.relative(dir, input)}:${contentHash(input)}`)
      .toSorted()
      .join('\n')
    const dsp = path.join(dir, naming.dirSummary)
    const expectedHash = hashContent(manifest)
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
  return { nodes, todo: nodes.filter((n) => n.status !== 'ok') }
}
