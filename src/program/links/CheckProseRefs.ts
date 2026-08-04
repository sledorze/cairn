// Effect program for issue #47: report a bare-backtick prose citation
// (`` `src/services/auth.ts` ``, no `[text](path)` syntax at all) whose
// target does not resolve — never one that does (that's silent, always; see
// `looksLikeRootedPath`'s own header and issue #47's criterion 1).
// Always-silent-unless-broken is what makes this safe for PERMANENT/ongoing
// use, not just a one-time migration step (issue #105) — the report doesn't
// just say "broken," it names the exact `[text](path)` syntax that would
// make the reference structurally checkable by `CheckLinks.ts` going
// forward, encouraging (not requiring) conversion to a real link over time.
//
// Deliberately NOT "moved or deleted": this is a live, stateless
// existence check with no record of a citation's target ever having
// resolved before — it cannot distinguish a path that once existed and was
// since removed from one that was never real to begin with (a typo, an
// illustrative example). "Does not resolve" is the honest claim; anything
// implying history is a claim this check has no way to back (REX feedback:
// the prior "no longer resolves" wording sent a reader looking for a rename
// that never happened, for a path that was never real).
//
// Candidates are resolved rooted at `base` (the repo checkout root) — a bare
// citation like `src/services/auth.ts` is read the way a person would type
// it from the repo root, not relative to the doc's own directory. Existence
// is bounded by the SAME `isWithinBase` containment check #39/#40 already
// established: a candidate that resolves outside `base` (e.g. a
// traversal-shaped citation) is never `stat`'d, reported as unverifiable —
// this is exactly as attacker-reachable as a real Markdown link's target,
// arguably more so since it needs no `[]()` syntax at all.

import * as nodePath from 'node:path'

import { Effect } from 'effect'

import { matchesAny } from '../../core/glob.ts'
import { extractProseRefs } from '../../core/links/ProseRefs.ts'
import { isWithinBase } from '../../core/paths.ts'
import { DocsFs, isSafelyWithinBase, listMarkdownFiles } from '../../io/DocsFs.ts'
import type { CheckPlugin } from '../checks/CheckPlugin.ts'
import { withAncestors } from './CheckLinks.ts'
import type { Locale } from '../locale.ts'
import { pick } from '../locale.ts'

const path = nodePath.posix

export type ProseRefReason = 'missing' | 'unverifiable'

export interface BrokenProseRef {
  readonly reason: ProseRefReason
  /** The exact `[text](path)` syntax that would make this a real,
   * structurally-checkable link — always present, even when `reason` is
   * `'unverifiable'` (the suggested relative path is still well-formed;
   * cairn just can't confirm it resolves without leaving `base`). */
  readonly suggestion: string
  readonly text: string
}

export interface FileBrokenProseRefs {
  readonly file: string
  readonly refs: readonly BrokenProseRef[]
}

export interface ProseRefsResult {
  readonly broken: readonly FileBrokenProseRefs[]
  readonly checked: number
}

export interface CheckProseRefsArgs {
  readonly base: string
  readonly roots: readonly string[]
  /** Found missing via dimension-coverage review: `checkLinks`/`checkSummaries`
   * both wire `ignore`/`trackedFiles` through explicitly (with comments
   * explaining why); this program had neither, so a doc excluded via `ignore`
   * or invisible to a fresh CI checkout via `onlyGitTracked` was still
   * scanned for prose citations — silently inconsistent with every sibling
   * check, not a deliberate scope cut. */
  readonly ignore?: readonly string[]
  /** `checks.proseRefs.ignore` (core/Config.ts): backticked citation TEXT (or
   * a glob over it) to always treat as illustrative, never a real citation —
   * matched before existence is ever checked, same effect as a citation that
   * already resolves. Distinct from `ignore` above, which excludes whole
   * FILES from being scanned at all. */
  readonly ignoreRefs?: readonly string[]
  readonly trackedFiles?: ReadonlySet<string> | undefined
}

export interface ProseRefsReportOptions {
  readonly locale?: Locale
}

/** 0 when nothing was flagged, 1 otherwise — same convention as `linkExitCode`/`refsExitCode`. */
export const proseRefsExitCode = (result: ProseRefsResult): number => (result.broken.length > 0 ? 1 : 0)

const relativeLinkFrom = (fromDir: string, targetAbs: string): string => {
  const rel = path.relative(fromDir, targetAbs)
  return rel.startsWith('.') ? rel : `./${rel}`
}

const resolveOne = ({
  base,
  dfs,
  fromDir,
  ignoreRefs,
  text,
  trackedUniverse,
}: {
  readonly base: string
  readonly dfs: { realPath: (p: string) => Effect.Effect<string | null> }
  readonly fromDir: string
  readonly ignoreRefs: readonly string[]
  readonly text: string
  /** Same shape as `CheckLinks.ts`'s own `trackedUniverse` (files + their
   * ancestor directories): a physically-present target counts as "resolves"
   * only if it's ALSO tracked, so `onlyGitTracked` bounds prose-citation
   * targets exactly the way it already bounds real link targets. */
  readonly trackedUniverse: ReadonlySet<string> | undefined
}): Effect.Effect<BrokenProseRef | null> =>
  Effect.gen(function* () {
    // Config-declared illustrative text (checks.proseRefs.ignore) — checked
    // FIRST, before any existence check, same treatment as a citation that
    // already resolves: silently skipped, never reported.
    if (matchesAny(text, ignoreRefs)) {
      return null
    }
    const targetAbs = path.join(base, text)
    const suggestion = `[\`${text}\`](${relativeLinkFrom(fromDir, targetAbs)})`
    if (!isWithinBase(targetAbs, base)) {
      // Never stat'd, by design — the exact #39/#40 boundary, applied here
      // to a citation that needed no `[]()` syntax to reach the same risk.
      return { reason: 'unverifiable', suggestion, text }
    }

    // Real-corpus false-positive sweep against this repo's own docs/ found a
    // genuine gap: shorthand like `core/Config.ts` (this repo's docs cite
    // paths relative to `src/`, not the repo root) and package-import-style
    // strings like `effect/Schema` are both syntactically path-like
    // (`looksLikeRootedPath` correctly can't distinguish them without more
    // context) but are NOT real repo-rooted citations — flagging them would
    // be exactly the "errors on just citations" noise this feature must
    // avoid. Disambiguate semantically, cheaply: a genuine repo-rooted
    // citation's FIRST segment must itself resolve to something real under
    // `base` (e.g. `src/` really exists at the repo root); if it doesn't,
    // this was never a real candidate — silently skip it, don't report
    // anything, same as a citation that never looked path-like at all.
    const firstSegment = text.split('/')[0] ?? ''
    // `isSafelyWithinBase` (../../io/DocsFs.ts), for both checks below — a
    // symlink physically located INSIDE `base` (including a top-level
    // segment like `src` itself) can still point OUTSIDE it; a lexical
    // `isWithinBase` pass above can't see that (adversarial review, issue
    // #28's PR — same fix already applied to `CheckLinks.ts`/
    // `CheckRefs.ts`/`CheckCoverage.ts`). Without this, an attacker-
    // committed symlink turns this existence-only check right back into
    // the filesystem-existence oracle issue #39 exists to prevent, just
    // reached through a path that's lexically in-bounds.
    const firstSegmentSafe = yield* isSafelyWithinBase(dfs, path.join(base, firstSegment), base)
    if (!firstSegmentSafe) {
      return null
    }

    const physicallyExists = yield* isSafelyWithinBase(dfs, targetAbs, base)
    const exists = physicallyExists && (trackedUniverse === undefined || trackedUniverse.has(targetAbs))
    return exists ? null : { reason: 'missing', suggestion, text }
  })

export const checkProseRefs = ({
  base,
  roots,
  ignore = [],
  ignoreRefs = [],
  trackedFiles,
}: CheckProseRefsArgs): Effect.Effect<ProseRefsResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    // `listMarkdownFiles` (io/DocsFs.ts, issue #93 DRY audit) shares the
    // filter this used to hand-roll — `readMarkdownCorpus`'s Map isn't
    // used here since `checked` (below) must count every LISTED file, not
    // just the ones that turn out readable (adversarial review: an
    // earlier pass here silently shrunk it to "successfully read" instead).
    const mdFiles = yield* listMarkdownFiles(dfs, roots, ignore, trackedFiles)
    const trackedUniverse = trackedFiles === undefined ? undefined : withAncestors([...trackedFiles])

    const broken: FileBrokenProseRefs[] = []
    for (const file of mdFiles) {
      // Found via adversarial "no unhandled exception" review: a doc that
      // lists fine but can't be READ (permission denied) must not crash the
      // whole run — skipped exactly like an untracked/ignored file already
      // is, same discipline as `CheckSummaries.ts`'s own `readMarkdown` fix.
      const content = yield* dfs.readFile(file).pipe(Effect.catchDefect(() => Effect.succeed(null)))
      if (content === null) {
        continue
      }
      const candidates = extractProseRefs(content)
      if (candidates.length === 0) {
        continue
      }
      const fromDir = path.dirname(file)
      const fileBroken: BrokenProseRef[] = []
      for (const candidate of candidates) {
        const result = yield* resolveOne({ base, dfs, fromDir, ignoreRefs, text: candidate.text, trackedUniverse })
        if (result) {
          fileBroken.push(result)
        }
      }
      if (fileBroken.length > 0) {
        broken.push({ file, refs: fileBroken })
      }
    }

    return { broken, checked: mdFiles.length }
  })

export const formatProseRefsReport = (result: ProseRefsResult, options: ProseRefsReportOptions = {}): string[] => {
  const locale = options.locale ?? 'en'
  if (result.broken.length === 0) {
    return [
      pick(locale, {
        en: `✅ No broken prose file-references found (${result.checked} file(s) checked).`,
        fr: `✅ Aucune référence de fichier en prose non résolue (${result.checked} fichier(s) vérifié(s)).`,
      }),
    ]
  }
  const total = result.broken.reduce((n, f) => n + f.refs.length, 0)
  const lines: string[] = [
    pick(locale, {
      en: `❌ ${total} broken prose file-reference(s):`,
      fr: `❌ ${total} référence(s) de fichier en prose non résolue(s) :`,
    }),
  ]
  for (const { file, refs } of result.broken) {
    lines.push(`  ${file}`)
    for (const ref of refs) {
      // "does not resolve", not "no longer resolves" — this is a live
      // existence check with no record of the citation ever having resolved
      // before (REX feedback: the prior wording implied a move/deletion this
      // check has no way to have actually observed; a citation for a path
      // that never existed is reported identically to one that did and was
      // deleted, and the wording must not claim to know which).
      const why =
        ref.reason === 'unverifiable'
          ? pick(locale, { en: 'outside the checkout, cannot verify', fr: 'hors du dépôt, non vérifiable' })
          : pick(locale, { en: 'does not resolve', fr: 'ne se résout pas' })
      lines.push(
        pick(locale, {
          en: `    ✗ \`${ref.text}\` (${why}) → consider a link: ${ref.suggestion}`,
          fr: `    ✗ \`${ref.text}\` (${why}) → envisager un lien : ${ref.suggestion}`,
        }),
      )
    }
  }
  return lines
}

// The CheckPlugin descriptor cli.ts's registry runner drives — see
// ../checks/CheckPlugin.ts's own header for why this abstraction exists.
// `isEnabled` matches cli.ts's exact prior gate: `parsed.prose` (no config
// field of its own, CLI-flag opt-in only, same as `refs`). No `stamp` — this
// check has no write-time verb at all, unlike `refs`.
export const proseRefsPlugin: CheckPlugin<ProseRefsResult> = {
  exitCode: proseRefsExitCode,
  format: (result, options) => formatProseRefsReport(result, options),
  isEnabled: (_resolved, cli) => cli.prose,
  jsonUnsupportedMessage: '--json cannot be combined with --prose-refs yet',
  name: 'proseRefs',
  run: ({ base, ignore, resolved, roots, trackedFiles }) =>
    checkProseRefs({
      base,
      ignore,
      ignoreRefs: resolved.checks.proseRefs.ignore,
      roots,
      ...(trackedFiles === undefined ? {} : { trackedFiles }),
    }),
}
