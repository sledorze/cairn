// The shared low-level primitive under every hidden `.cairn/**` metadata
// sidecar: path mapping (a node's real path -> its sidecar's path, and back)
// and a lenient JSON codec factory. Used by BOTH `summaries/StampStore.ts`
// (doc-freshness records) and `links/RefStore.ts` (reference content-hash
// records) — genuinely shared mechanics, kept deliberately separate from
// either domain's own record shape (`StampRecord` vs `RefsRecord`), which
// stay domain-owned: forcing one schema to serve two different sidecar
// kinds would leave one half always meaningless for any given sidecar.
//
// Two invariants this module enforces:
//  - every node path handed to `sidecarPathFor` must live under `base` (real
//    usage: `base` is the project root, every root/node resolved under it) —
//    violating this is a programming error, not a data error, so it throws;
//  - a codec's `parse` decodes LENIENTLY: unknown keys are ignored rather
//    than rejected (forward-compatible), and a corrupt/hand-edited/merge-
//    conflicted sidecar reads as `null` — exactly equivalent to no record at
//    all, never a crash.

import * as nodePath from 'node:path'

import { Result, Schema } from 'effect'

// POSIX path semantics so sidecar paths are identical on every OS.
const path = nodePath.posix

/** The hidden directory name every metadata tree lives under, relative to `base`. */
export const META_DIR = '.cairn'

export interface MetaLayout {
  /** The project root every node path and every sidecar is resolved under. */
  readonly base: string
  /** `join(base, META_DIR)` — passed explicitly (not recomputed) so callers who
   * already have it (e.g. after listing `.cairn/**`) don't rederive it. */
  readonly metaRoot: string
}

export const metaRootFor = (base: string): string => path.join(base, META_DIR)

/** True for any path inside the hidden metadata tree — used to keep `.cairn/**`
 * out of the set of markdown source files a plan considers. */
export const isSidecarPath = (candidate: string, metaRoot: string): boolean =>
  candidate === metaRoot || candidate.startsWith(`${metaRoot}/`)

/**
 * `<base>/docs/a.summary.md` -> `<metaRoot>/docs/a.summary.md.json`, or, with
 * a `namespace` (e.g. `'refs'`), `<metaRoot>/refs/docs/a.summary.md.json` —
 * the mechanism that keeps two DIFFERENT sidecar kinds for the SAME doc path
 * from colliding (a doc's own freshness stamp vs its reference hashes; see
 * `links/RefStore.ts`'s header for the real collision this closes). Throws
 * if `nodeAtPath` isn't under `base`: every real node path is (roots are
 * always resolved under the project root before a plan ever runs), so this
 * signals a caller bug, not a runtime data condition to recover from.
 */
export const sidecarPathFor = (nodeAtPath: string, layout: MetaLayout, namespace?: string): string => {
  const rel = path.relative(layout.base, nodeAtPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`sidecarPathFor: "${nodeAtPath}" is not under base "${layout.base}"`)
  }
  const root = namespace === undefined ? layout.metaRoot : path.join(layout.metaRoot, namespace)
  return `${path.join(root, rel)}.json`
}

/**
 * The inverse of `sidecarPathFor` (namespace-free form): given a sidecar's
 * own path (e.g. found by listing `.cairn/**`), recover the node path it
 * mirrors. Returns `null` for a path that isn't a well-formed sidecar under
 * `metaRoot` (not `.json`, or outside the tree) rather than throwing —
 * unlike `sidecarPathFor`, this reads data that could plausibly be malformed
 * (a stray non-JSON file dropped into `.cairn/` by hand), so `null` is the
 * right "not a sidecar" signal, not a crash.
 */
export const nodePathForSidecar = (sidecarPath: string, layout: MetaLayout): string | null => {
  if (!isSidecarPath(sidecarPath, layout.metaRoot) || !sidecarPath.endsWith('.json')) {
    return null
  }
  const rel = path.relative(layout.metaRoot, sidecarPath)
  if (rel.startsWith('..')) {
    return null
  }
  return path.join(layout.base, rel.slice(0, -'.json'.length))
}

export interface SidecarCodec<A> {
  /** Read a sidecar's record back, or `null` if missing/corrupt/malformed —
   * NEVER throws (see module header). */
  readonly parse: (content: string) => A | null
  /** The sidecar's on-disk JSON form. Trailing newline for a clean git diff. */
  readonly serialize: (record: A) => string
}

/** Build a lenient JSON codec for one sidecar record shape from its `Schema`. */
export const makeSidecarCodec = <S extends Parameters<typeof Schema.decodeUnknownResult>[0]>(
  schema: S,
): SidecarCodec<S['Type']> => {
  const decode = Schema.decodeUnknownResult(schema)
  return {
    parse: (content) => {
      let json: unknown
      try {
        json = JSON.parse(content)
      } catch {
        return null
      }
      const decoded = decode(json)
      return Result.isSuccess(decoded) ? decoded.success : null
    },
    serialize: (record) => `${JSON.stringify(record, null, 2)}\n`,
  }
}
