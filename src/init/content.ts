// Prose surfaces injected by `cairn init`.
// These are agent-neutral bodies; the generator wraps each with the
// frontmatter appropriate to its target (Claude rule, Copilot instructions,
// AGENTS.md block, or SKILL.md).

export const CONVENTION_BODY = `# Documentation summary convention

This repo enforces a **hierarchical, content-hashed documentation summary** tree.
CI runs \`cairn check\` and **fails the merge** if any summary is missing,
stale, or a link is broken. Treat green \`check\` as a hard requirement, not a nicety.

## The invariant

1. **File summaries** — every Markdown file longer than the threshold (default 30
   lines) has a sibling \`X.summary.md\`: a fast-to-read digest of the CURRENT content
   of \`X.md\`.
2. **Directory summaries** — every in-scope directory has a \`_SUMMARY.md\` that
   aggregates its direct docs (each doc's \`.summary.md\` if the doc is big, else the
   doc itself) plus the \`_SUMMARY.md\` of each direct sub-directory. It links to
   **every** direct child file and sub-directory (link-completeness).
3. **Freshness by content hash, tracked OUTSIDE your docs** — each summary's hash is
   recorded in a hidden sidecar under \`.cairn/\`, one JSON file mirroring each summary's
   path (e.g. \`.cairn/docs/a.summary.md.json\`). The checker recomputes the source hash
   and compares it to the sidecar; mismatch = stale, absent = missing. This survives git
   clone and CI (mtime does not), and it means the tracking system leaves **zero bytes**
   in the docs you write — no stamp comment to see, ignore, or accidentally hand-edit.
   Commit \`.cairn/\` alongside your docs; it's not gitignored.
4. **Bottom-up in one pass** — a directory summary hashes a manifest of its children's
   hashes (a Merkle tree), so (re)write leaves-first: file summaries, then directories
   deepest-first, then stamp.
5. **Deletions are caught too** — a sidecar left behind with no matching doc (its source
   was deleted or renamed) is flagged as a deleted-source stamp; \`--prune\` removes both
   the leftover summary and its sidecar.

## Upgrading from an older cairn (legacy \`<!-- source-sha256 -->\` stamp)

**Nothing special to do — do not go looking for a migration step.** If a summary still
carries the old in-content \`<!-- source-sha256: ... -->\` comment, the ordinary stamp
command (\`npx cairn check --summaries-only --stamp\`) strips it and writes the
\`.cairn/\` sidecar in the same run, automatically. There is no separate command to
discover or remember: whatever \`stampCommand\` this repo already runs already does it.
(\`--migrate-stamps\` also exists, purely as an optional explicit/reportable alias for
the same self-healing behaviour — never required.)

## Workflow when you edit docs

When you create or edit any doc:

1. If the doc is longer than the threshold, create or update its \`X.summary.md\` to
   reflect the new content.
2. Update the \`_SUMMARY.md\` of every affected directory, walking **up** the tree
   leaves-first, and keep a link to every child file and sub-directory.
3. Run the stamp command to (re)write the sidecar hashes under \`.cairn/\` bottom-up:
   \`npx cairn check --summaries-only --stamp\`.
4. Run \`npx cairn check\` and ensure it exits 0 (green) before you finish.
5. Commit your doc changes **together with** the \`.cairn/\` sidecar changes — a doc
   edit without its matching sidecar update is exactly what \`check\` is designed to catch.

## Commands

- \`npx cairn check\` — check summaries + links (exit 1 on any problem).
- \`npx cairn check --summaries-only\` / \`--links-only\`.
- \`npx cairn check --links-only --fix\` — auto-repair unambiguous dead links.
- \`npx cairn check --summaries-only --stamp\` — write the \`.cairn/\` sidecar hash of
  EXISTING summaries bottom-up. It does **not** author prose; you write the content,
  then stamp.
- \`npx cairn check --prune\` — delete orphan summaries and orphan \`.cairn/\` sidecars
  (source doc deleted, renamed, or below threshold).
- \`npx cairn check --migrate-stamps\` — optional: the same self-healing \`--stamp\`
  already does for a legacy in-content stamp, as its own named/reported step. Never
  required.

## Other opt-in checks (all off by default — see the README for full details)

- \`--refs\` (with \`--stamp\`) — tracks the *content* of what a link points to, not
  just whether it resolves: \`--refs --stamp\` records a hash of every reference
  target; a later \`--refs\` run reports any that changed since.
- \`--prose-refs\` — safe for permanent, ongoing use (not just a one-time migration
  step): flags a bare-backtick file citation in prose (e.g. a citation with no
  \`[text](path)\` syntax) whose target has moved or been deleted. Silent for
  anything that still resolves.
- \`checks.coverage\` (config only, no CLI flag) — for docs beyond code reference
  (PRDs, specs, decision logs): declares doc **kinds** by path glob and **rules**
  ("every \`feature\` doc must link to a \`decision\` doc"), then reports missing
  links and orphaned docs. Catches something the checks above can't: a repo can have
  zero broken links and still have unrelated feature/decision docs that were never
  actually connected. Worth checking for if you're asked to organize product
  knowledge, not just code docs.
- \`--report-deletions\` (with \`--deletions-since <ref>\`, default \`HEAD\`) —
  informational only, never affects exit code: when a doc has disappeared since
  that ref, reports which of its headings/outbound links appear in NO remaining
  doc — a lossy deletion or consolidation the checks above can't see, since
  everything that remains stays internally consistent. Worth running before
  deleting a doc you believe is pure duplication.

You author the prose. The tool only verifies and stamps — and it never touches your prose to do it.
`

export const SKILL_BODY = `# Writing good documentation summaries

Use this when you author or refresh the summary tree that \`cairn\`
enforces. It covers *how* to write summaries that are worth reading, and the exact
mechanical order to (re)generate them so \`check\` goes green in one pass.

## Two kinds of summary — do not conflate them

**A file summary (\`X.summary.md\`) condenses ONE document.**
Goal: a reader grasps what \`X.md\` says in ~10 seconds.

- Faithful to the source — never invent, never contradict, never add claims the doc
  doesn't make. It is a digest, not commentary.
- Front-load the thesis and the hard numbers. Lead with the conclusion, the decision,
  the metric — not the background.
- Bullet-dense, no fluff. Drop hedging, transitions, and restated headings.
- If the source changes, the summary changes. A summary that no longer matches its
  source is a bug the checker will catch.

**A directory summary (\`_SUMMARY.md\`) is a MAP, not a digest.**
Goal: a reader knows what lives in this directory and where to go next.

- A short orientation paragraph (1-3 sentences): what this directory is about.
- Then one line per direct child — file **and** sub-directory — each with a Markdown
  link and a few-word hook describing what's behind it.
- For a big doc, link and hook its \`.summary.md\`; for a small doc, link the doc itself.
- For a sub-directory, link its \`_SUMMARY.md\`.
- **Link-completeness:** every direct child must appear as a link. A missing link fails
  \`check\`. When you add or remove a child, update the parent's \`_SUMMARY.md\`.

## Why leaves-first — the Merkle mental model

Each summary's hash is stamped into a hidden sidecar under \`.cairn/\` (never into the
summary's own content — that's what keeps the docs you write free of tool bytes). A
directory summary's source is a **manifest of its children's hashes**, so a child's
hash must be settled before its parent can be stamped. Think of it as a Merkle tree:
change a leaf and every hash on the path to the root must be recomputed. If you stamp
top-down, parents capture stale child hashes and \`check\` stays red.

## The bottom-up procedure

1. **Author leaves first.** For every doc over the threshold, write/refresh its
   \`X.summary.md\`. Get the prose right before touching any directory.
2. **Author directories deepest-first.** Walk from the deepest directories up to the
   roots. For each, write its \`_SUMMARY.md\`: orientation paragraph, then a linked line
   for every direct child (child \`.summary.md\` or doc, and each sub-dir's \`_SUMMARY.md\`).
3. **Stamp mechanically.** Run \`npx cairn check --summaries-only --stamp\`.
   It rewrites every \`.cairn/\` sidecar hash bottom-up. **Never hand-edit a sidecar** — it
   is computed, not authored; a hand-typed hash is always wrong.
4. **Verify.** Run \`npx cairn check\` and confirm exit 0.

## Tiny examples

A **file summary** (\`guides/getting-started.summary.md\`) — pure prose, no stamp inside it:

\`\`\`markdown
# Getting started — summary

- Install as a dev dependency, then run the init command.
- Configure via a single rc file; every option has a sensible default.
- First run scaffolds an example and prints the next command to run.
\`\`\`

Its hash lives in \`.cairn/guides/getting-started.summary.md.json\` (stamped by the tool):

\`\`\`json
{"sha256":"0000...(stamped by the tool)","version":1}
\`\`\`

A **directory summary** (\`guides/_SUMMARY.md\`) — also stamp-free:

\`\`\`markdown
# Guides

How-to guides for everyday tasks, in reading order.

- [getting-started](./getting-started.summary.md) — install, configure, first run
- [configuration](./configuration.md) — every rc option, with its default
- [advanced/](./advanced/_SUMMARY.md) — recipes for larger setups
\`\`\`

Keep summaries short, keep links complete, stamp last, verify green.
`
