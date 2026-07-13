---
paths:
  - 'docs/**'
---

# Documentation summary convention

This repo enforces a **hierarchical, content-hashed documentation summary** tree.
CI runs `cairn check` and **fails the merge** if any summary is missing,
stale, or a link is broken. Treat green `check` as a hard requirement, not a nicety.

## The invariant

1. **File summaries** — every Markdown file longer than the threshold (default 30
   lines) has a sibling `X.summary.md`: a fast-to-read digest of the CURRENT content
   of `X.md`.
2. **Directory summaries** — every in-scope directory has a `_SUMMARY.md` that
   aggregates its direct docs (each doc's `.summary.md` if the doc is big, else the
   doc itself) plus the `_SUMMARY.md` of each direct sub-directory. It links to
   **every** direct child file and sub-directory (link-completeness).
3. **Freshness by content hash** — each summary's first line is
   `<!-- source-sha256: <64-hex> -->`. The checker recomputes the source hash;
   mismatch = stale, absent = missing. This survives git clone and CI (mtime does not).
4. **Bottom-up in one pass** — a directory summary hashes a manifest of its children's
   hashes (a Merkle tree), so (re)write leaves-first: file summaries, then directories
   deepest-first, then stamp.

## Workflow when you edit docs

When you create or edit any doc:

1. If the doc is longer than the threshold, create or update its `X.summary.md` to
   reflect the new content.
2. Update the `_SUMMARY.md` of every affected directory, walking **up** the tree
   leaves-first, and keep a link to every child file and sub-directory.
3. Run the stamp command to (re)write the `source-sha256` hashes bottom-up:
   `npx cairn check --summaries-only --stamp`.
4. Run `npx cairn check` and ensure it exits 0 (green) before you finish.

## Commands

- `npx cairn check` — check summaries + links (exit 1 on any problem).
- `npx cairn check --summaries-only` / `--links-only`.
- `npx cairn check --links-only --fix` — auto-repair unambiguous dead links.
- `npx cairn check --summaries-only --stamp` — write stamps of EXISTING
  summaries bottom-up. It does **not** author prose; you write the content, then stamp.

You author the prose. The tool only verifies and stamps.
