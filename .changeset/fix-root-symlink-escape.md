---
'@sledorze/cairn': minor
---

`roots` entries that can only legitimately resolve inside the project directory (no `..` segment anywhere or absolute path) now fail loudly with a clear error if the resolved directory turns out to be a symlink pointing outside the project — closing a gap where a malicious PR could replace a configured root (e.g. `docs/`) with a symlink to reach content outside the repository.

This is a **stricter** check: if you rely on a plain `roots` entry (e.g. the default `"docs"`) resolving via a symlink to somewhere outside your project directory, `cairn check` will now fail with `cairn: root "..." resolves to "...", a symlink pointing OUTSIDE the project directory`. If that's intentional, express it with a `..`-relative or absolute path instead — those are unaffected and continue to work exactly as before (this is how a legitimate monorepo sibling-docs setup, e.g. `roots: ["../shared-docs"]`, is already expected to be configured).
