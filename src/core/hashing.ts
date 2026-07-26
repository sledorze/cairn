// The one hashing primitive shared across BOTH domains: summaries/ uses it
// to stamp/verify a doc's own freshness, links/ uses it (CheckRefs.ts) to
// stamp/verify a REFERENCED target's content hash. Genuinely generic — no
// summary-specific or link-specific meaning lives here, which is exactly why
// it moved out of summaries/DocSummaries.ts (found via a "does the file
// grouping match the real import graph" audit: DocSummaries.ts was consumed
// by both program/CheckSummaries.ts AND program/CheckRefs.ts, but only for
// this one function).

import { hash as hashHex } from 'node:crypto'

// One-shot `crypto.hash` (Node >=20.12) skips the streaming Hash object's
// internal state entirely — faster than `createHash().update().digest()` for
// the KB-sized markdown content this hashes, at the scale this runs at (once
// per file/manifest per plan).
/** Deterministic content hash used to stamp and verify freshness/drift. */
export const hashContent = (content: string): string => hashHex('sha256', content, 'hex')
