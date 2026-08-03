// Pure planner for issue #106: link-completeness and content hashing both
// assume tracked content persists — nothing notices content that VANISHES.
// A doc deleted on the correct belief that it was pure duplication can still
// carry one heading or outbound reference that existed nowhere else, and
// every other check stays green afterward (the tree got smaller, the hashes
// re-stamped, the delta simply gone). This module answers, for a batch of
// docs known to have disappeared: which of their headings and outbound link
// targets are no longer reachable from ANY remaining doc — informational
// only, never a blocking verdict (deleting genuinely redundant documentation
// must stay cheap; see `program/summaries/CheckDeletions.ts`'s own exit code,
// which never reflects this module's findings).
//
// Deliberately reuses the exact heading/link-extraction shapes
// `program/summaries/CheckSummaries.ts` (`headings`) and
// `core/summaries/SummaryTree.ts` (`resolveLinks`) already use, rather than
// inventing a third — a doc's headings/links mean the same thing here as
// they do in `--explain`'s own output and the directory-summary
// link-completeness rule.

import * as nodePath from 'node:path'

import { extractLinks, isCheckableTarget, stripAnchor, stripCode } from '../links/MarkdownLinks.ts'

const path = nodePath.posix

/** Deduplicated Markdown headings in `content` — same extraction shape as
 * `CheckSummaries.ts`'s own private `headings()`, deduplicated here (unlike
 * that one, which reports an ordered outline, not a set) since a heading
 * repeated within the same doc must not read as two separate findings. */
const headings = (content: string): string[] => [
  ...new Set(
    content
      .split('\n')
      .filter((line) => /^#{1,6}\s/.test(line))
      .map((line) => line.trim()),
  ),
]

/** Absolute targets of the checkable links in `content`, resolved from `dir` —
 * same shape as `SummaryTree.ts`'s own private `resolveLinks()`. */
const resolveLinkTargets = (content: string, dir: string): string[] => {
  const targets = new Set<string>()
  for (const { target } of extractLinks(stripCode(content))) {
    if (!isCheckableTarget(target)) {
      continue
    }
    const rel = stripAnchor(target)
    if (rel) {
      targets.add(path.resolve(dir, rel))
    }
  }
  return [...targets]
}

export interface DeletedDocContentFinding {
  readonly orphanedHeadings: readonly string[]
  readonly orphanedLinkTargets: readonly string[]
  readonly path: string
}

export interface FindDeletedDocContentArgs {
  /** Path -> content, as last seen (e.g. read from git history) for every doc
   * that's confirmed gone from the current corpus. */
  readonly deletedDocs: ReadonlyMap<string, string>
  /** Path -> content of every doc STILL in the current, post-deletion corpus —
   * the universe a deleted doc's headings/links are checked against. */
  readonly remainingFiles: ReadonlyMap<string, string>
}

/**
 * For each deleted doc, the headings and outbound link targets that appear
 * in NEITHER the remaining corpus NOR any other doc in the same deleted
 * batch (issue #106: two docs deleted in the same change that shared a
 * heading are still both genuinely losing it, not "still available
 * elsewhere"). A doc with no orphaned signal at all — everything it carried
 * survives somewhere else — is omitted entirely, not reported with empty
 * arrays. Sorted by path for a deterministic report.
 */
export const findDeletedDocContent = ({
  deletedDocs,
  remainingFiles,
}: FindDeletedDocContentArgs): readonly DeletedDocContentFinding[] => {
  const survivingHeadings = new Set<string>()
  const survivingLinkTargets = new Set<string>()
  for (const [filePath, content] of remainingFiles) {
    for (const h of headings(content)) {
      survivingHeadings.add(h)
    }
    for (const t of resolveLinkTargets(content, path.dirname(filePath))) {
      survivingLinkTargets.add(t)
    }
  }

  const findings: DeletedDocContentFinding[] = []
  for (const [filePath, content] of deletedDocs) {
    const docHeadings = headings(content)
    const docLinkTargets = resolveLinkTargets(content, path.dirname(filePath))
    const orphanedHeadings = docHeadings.filter((h) => !survivingHeadings.has(h))
    const orphanedLinkTargets = docLinkTargets.filter((t) => !survivingLinkTargets.has(t))
    if (orphanedHeadings.length > 0 || orphanedLinkTargets.length > 0) {
      findings.push({ orphanedHeadings, orphanedLinkTargets, path: filePath })
    }
  }
  return findings.toSorted((a, b) => a.path.localeCompare(b.path))
}
