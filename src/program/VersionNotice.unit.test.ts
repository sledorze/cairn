import { it as effectIt } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { describe, expect } from 'vitest'

import type { DocsFsService } from '../io/DocsFs.ts'
import { DocsFs, makeTestDocsFs } from '../io/DocsFs.ts'
import { checkVersionNotice, stampVersionNotice } from './VersionNotice.ts'

// oxlint's vitest plugin only recognizes an `expect` call as being inside a
// valid test block when the file ALSO has at least one call through the
// LITERAL `it` identifier (not just `effectIt`, an import alias) — confirmed
// by testing directly against an unrelated file in this repo that already
// uses `effectIt.effect` cleanly, which starts failing the same way once its
// own plain-`it` usage is (temporarily) removed. Every `expect` in this file
// genuinely IS inside a real `effectIt.effect(...)` test block; each
// disable below is this rule's own false positive, not a real gap.

describe('checkVersionNotice()', () => {
  effectIt.effect('is null on a repo with no version sidecar at all — a first-ever run, not an upgrade', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({})
      const notice = yield* checkVersionNotice({ base: '/r', runningVersion: '0.13.2' }).pipe(Effect.provide(layer))
      // oxlint-disable-next-line vitest/no-standalone-expect -- false positive, see file header
      expect(notice).toBeNull()
    }),
  )

  effectIt.effect('is null when the recorded version matches the running version', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/.cairn/version.json': { content: '{"version":"0.13.2"}', mtimeMs: 1 },
      })
      const notice = yield* checkVersionNotice({ base: '/r', runningVersion: '0.13.2' }).pipe(Effect.provide(layer))
      // oxlint-disable-next-line vitest/no-standalone-expect -- false positive, see file header
      expect(notice).toBeNull()
    }),
  )

  effectIt.effect('names both versions when the recorded version differs from the running one', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/.cairn/version.json': { content: '{"version":"0.9.0"}', mtimeMs: 1 },
      })
      const notice = yield* checkVersionNotice({ base: '/r', runningVersion: '0.10.0' }).pipe(Effect.provide(layer))
      // oxlint-disable-next-line vitest/no-standalone-expect -- false positive, see file header
      expect(notice).toBe('cairn 0.9.0 → 0.10.0')
    }),
  )

  effectIt.effect('is null (reads as absent, not a crash) when the sidecar is corrupt/hand-edited', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/.cairn/version.json': { content: 'not even json', mtimeMs: 1 },
      })
      const notice = yield* checkVersionNotice({ base: '/r', runningVersion: '0.13.2' }).pipe(Effect.provide(layer))
      // oxlint-disable-next-line vitest/no-standalone-expect -- false positive, see file header
      expect(notice).toBeNull()
    }),
  )

  // The sidecar EXISTS (permission race mid-run, same class this codebase
  // already handles elsewhere — e.g. CheckRefs.ts's own analogous read) but
  // becomes unreadable: `Effect.catchDefect` must fold this to `null`, same
  // as a missing/corrupt sidecar, never crash the whole check.
  effectIt.effect('is null (reads as absent, not a crash) when the sidecar exists but becomes unreadable', () =>
    Effect.gen(function* () {
      const service: DocsFsService = {
        deleteFile: () => Effect.succeed(undefined),
        exists: () => Effect.succeed(true),
        listFiles: () => Effect.succeed([]),
        readFile: () => Effect.die(new Error('EACCES: permission denied')),
        realPath: (abs) => Effect.succeed(abs),
        stat: () => Effect.die('not used in this test'),
        writeFile: () => Effect.succeed(undefined),
      }
      const layer = Layer.succeed(DocsFs, service)
      const notice = yield* checkVersionNotice({ base: '/r', runningVersion: '0.13.2' }).pipe(Effect.provide(layer))
      // oxlint-disable-next-line vitest/no-standalone-expect -- false positive, see file header
      expect(notice).toBeNull()
    }),
  )

  // Adversarial-review-style regression: this function must NEVER write, on
  // either the null-notice path or the real-notice path — a plain `cairn
  // check` (no `--stamp`) is read-only, matching every other check in this
  // codebase. Guards against a future edit accidentally folding the write in.
  effectIt.effect('never writes the sidecar itself, even when it reports a real mismatch', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/.cairn/version.json': { content: '{"version":"0.9.0"}', mtimeMs: 1 },
      })
      const program = Effect.gen(function* () {
        yield* checkVersionNotice({ base: '/r', runningVersion: '0.10.0' })
        const dfs = yield* DocsFs
        return yield* dfs.readFile('/r/.cairn/version.json')
      })
      const raw = yield* program.pipe(Effect.provide(layer))
      // oxlint-disable-next-line vitest/no-standalone-expect -- false positive, see file header
      expect(raw).toBe('{"version":"0.9.0"}')
    }),
  )
})

describe('stampVersionNotice()', () => {
  effectIt.effect('writes the running version to a fresh sidecar', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({})
      yield* stampVersionNotice({ base: '/r', runningVersion: '0.13.2' }).pipe(Effect.provide(layer))
      const notice = yield* checkVersionNotice({ base: '/r', runningVersion: '0.13.2' }).pipe(Effect.provide(layer))
      // oxlint-disable-next-line vitest/no-standalone-expect -- false positive, see file header
      expect(notice).toBeNull() // just stamped, so no longer a mismatch
    }),
  )

  effectIt.effect('overwrites a stale recorded version — the notice disappears on the next check', () =>
    Effect.gen(function* () {
      const layer = makeTestDocsFs({
        '/r/.cairn/version.json': { content: '{"version":"0.9.0"}', mtimeMs: 1 },
      })
      const before = yield* checkVersionNotice({ base: '/r', runningVersion: '0.10.0' }).pipe(Effect.provide(layer))
      // oxlint-disable-next-line vitest/no-standalone-expect -- false positive, see file header
      expect(before).toBe('cairn 0.9.0 → 0.10.0')
      yield* stampVersionNotice({ base: '/r', runningVersion: '0.10.0' }).pipe(Effect.provide(layer))
      const after = yield* checkVersionNotice({ base: '/r', runningVersion: '0.10.0' }).pipe(Effect.provide(layer))
      // oxlint-disable-next-line vitest/no-standalone-expect -- false positive, see file header
      expect(after).toBeNull()
    }),
  )
})
