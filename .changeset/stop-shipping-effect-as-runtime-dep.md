---
'@sledorze/cairn': minor
---

`effect`, `@effect/platform-node`, and `github-slugger` are no longer regular `dependencies` — the published `cairn` CLI (`dist/cli.js`) is fully bundled by esbuild and never needed them resolvable from a consumer's `node_modules` at runtime, so every install of cairn was pulling all three in for nothing.

The concrete harm: `@effect/platform-node@4.0.0-beta.100` declares a _required_ (non-optional) peer dependency on `ioredis@^5.7.0`. Package managers with auto-install-peers behavior (e.g. pnpm) were therefore installing a real `ioredis` into every consumer's dependency graph purely to satisfy that peer — even though cairn never touches Redis. That `ioredis` could then become peer-satisfying for an unrelated package elsewhere in a consumer's tree, silently flipping which build variant that unrelated package resolved to. Removing the runtime dependency removes `ioredis` (and any other transitive peer surface from that chain) from ever reaching consumers.

`effect` and `github-slugger` are still needed by cairn's unbundled programmatic library export (`import { ... } from '@sledorze/cairn'`) — they're now declared as **optional** `peerDependencies` instead. This is a behavior change worth flagging if you use that entrypoint: your own `package.json` must now declare `effect` and `github-slugger` directly (`pnpm add effect github-slugger`) — they will no longer show up for free via cairn. If you only use the `cairn` CLI, this changes nothing for you: nothing extra installs, and nothing extra is required.
