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
  \`[text](path)\` syntax) whose target does not resolve. Silent for anything that
  does. It's a live existence check with no history — it can't tell a real
  citation that was moved/deleted from a path-shaped example that was never a
  citation at all; use \`checks.proseRefs.ignore\` in config to exempt the latter
  (e.g. a documented sample path in a table).
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

export const DESIGN_PACKAGE_SKILL_BODY = `# Building a design package with \`checks.coverage\`

Use this when a problem is big enough to need a real design before code: a full
problem-space → solution-space → spikes → story-map → roadmap → implementation-details →
knowledge package, structurally enforced by \`checks.coverage\` — not just prose that happens
to have the right headings.

## The seven required documents

A design package is a directory (e.g. \`docs/design/<slug>/\`) containing:

- \`_SUMMARY.md\` — the package's own index, linking every doc below.
- \`problem-space.md\` — what you're actually trying to address: the real need, market, or
  context this work responds to, not just its technical symptom (a bug report is EVIDENCE the
  problem exists, not the problem itself). Also carries root cause, constraints on any fix,
  and an HONEST evidence basis (how many real reports this rests on — one anecdote, or
  corroborated?).
- \`solution-space.md\` — candidate directions, evaluated and ranked; REJECTED options
  recorded with real reasoning, not silently dropped.
- \`spikes.md\` — feasibility evidence actually RUN, not assumed. If a spike's first attempt
  fails, keep the failure and the correction in the doc — that's real evidence too.
- \`story-map.md\` — the real user workflow, mapped to stories and a walking-skeleton slice.
- \`roadmap.md\` — shippable increments, with migration notes.
- \`implementation-details.md\` — concrete enough to start from.
- \`knowledge.md\` — the reusable technique, for whoever extends this later.

## Wire it into \`checks.coverage\` — ONE generic block, safe by construction

A shared wildcard kind (\`"glob": "**/docs/design/*/spikes.md"\`) alone is **capturable**: a
different, hollow package can satisfy every rule by cross-linking a real sibling's docs
without writing a word of its own — verified concretely, not theoretically. The fix isn't
per-package hand-scoping (tried, found its own cost: a package nobody wires in becomes
invisible, and config grows without bound as packages accumulate) — it's \`scope: "sibling"\`
on the rule: satisfied only by a \`to\`-kind doc in the SAME directory as the \`from\` doc. One
small, GENERIC block below now works for every package, present and future, no per-package
edits ever:

\`\`\`json
"checks": {
  "coverage": {
    "kinds": [
      { "id": "design-package", "description": "The package's own index — links to every other required document and marks a directory as a design package.", "select": { "by": "path", "glob": "**/docs/design/*/_SUMMARY.md" } },
      { "id": "problem-space", "description": "The real need, market, or context this work responds to — not just its technical symptom.", "select": { "by": "path", "glob": "**/docs/design/*/problem-space.md" } },
      { "id": "solution-space", "description": "Candidate directions, evaluated and ranked, with rejected options recorded.", "select": { "by": "path", "glob": "**/docs/design/*/solution-space.md" } },
      { "id": "spikes", "description": "Feasibility evidence actually run, not assumed.", "select": { "by": "path", "glob": "**/docs/design/*/spikes.md" } },
      { "id": "story-map", "description": "The real user workflow, mapped to stories and a walking-skeleton release.", "select": { "by": "path", "glob": "**/docs/design/*/story-map.md" } },
      { "id": "roadmap", "description": "Shippable increments, with migration notes.", "select": { "by": "path", "glob": "**/docs/design/*/roadmap.md" } },
      { "id": "implementation-details", "description": "Concrete enough to start implementation from directly.", "select": { "by": "path", "glob": "**/docs/design/*/implementation-details.md" } },
      { "id": "knowledge", "description": "The reusable technique and lessons, for whoever extends this work later.", "select": { "by": "path", "glob": "**/docs/design/*/knowledge.md" } }
    ],
    "rules": [
      { "from": "design-package", "name": "requires", "description": "Every design package must include and link to its own problem-space.md — skipping it means no one recorded WHY this work matters.", "scope": "sibling", "to": "problem-space" },
      { "from": "design-package", "name": "requires", "description": "Every design package must include and link to its own solution-space.md — skipping it means alternatives were never actually weighed.", "scope": "sibling", "to": "solution-space" },
      { "from": "design-package", "name": "requires", "description": "Every design package must include and link to its own spikes.md — skipping it means claims rest on assumption, not evidence.", "scope": "sibling", "to": "spikes" },
      { "from": "design-package", "name": "requires", "description": "Every design package must include and link to its own story-map.md — skipping it means there's no real user workflow behind the plan.", "scope": "sibling", "to": "story-map" },
      { "from": "design-package", "name": "requires", "description": "Every design package must include and link to its own roadmap.md — skipping it means there's no sequencing or migration plan.", "scope": "sibling", "to": "roadmap" },
      { "from": "design-package", "name": "requires", "description": "Every design package must include and link to its own implementation-details.md — skipping it means the design isn't concrete enough to start from.", "scope": "sibling", "to": "implementation-details" },
      { "from": "design-package", "name": "requires", "description": "Every design package must include and link to its own knowledge.md — skipping it means lessons learned won't reach whoever extends this next.", "scope": "sibling", "to": "knowledge" }
    ]
  }
}
\`\`\`

Every \`kind\` above carries a real \`description\` — unlike a rule's report line (which at
least has an auto-generated sentence around it), a bare kind id has NO surrounding sentence
at all, so \`description\` is unconditionally required there, not conditional on anything.

Use a single \`*\` (not \`**\`) between \`docs/design/\` and the filename — \`**\` can match ZERO
segments, which would also match \`docs/design/_SUMMARY.md\` itself (a parent index, not a
package). A real bug found only by running this against real content, not by reading the
glob and assuming it was right.

## Name relationships precisely, and let the reader understand WHY

If a doc cites another for a REASON beyond membership (a claim justified by a spike, a
roadmap realizing a story-map concept), add a real \`{from, to, name}\` rule, not just prose.
Pick the \`name\` by re-reading the actual sentence making the claim — \`grounded_by\` (an
argument supported by evidence), \`builds_on\` (an implementation using a validated approach
as its foundation), \`derived_from\` (one doc's structure literally comes from another's),
\`sourced_from\` (content copied/restated from elsewhere) are NOT interchangeable. A generic
name picked for how it sounds, not checked against the content, is worse than no name at all
— it looks rigorous without being rigorous.

Add a real \`description\` too — \`name\` alone is only a disambiguating label (its own purpose
is telling two same-pair rules apart, nothing more); it explains nothing to a reader who
hits \`no link ("grounded_by") to a "spikes"-kind doc\` with no prior context. \`description\`
renders as a real guidance line right under that message — write the ACTUAL fix ("cite the
spike that backs this claim"), not a restatement of the rule name. **Mandatory whenever
\`name\` is set** — a named rule with no description fails config decode entirely, so this
can't silently regress the next time someone adds one. NOT mandatory on an unnamed rule
(its report line is already self-explanatory) — but treat that as a narrow escape hatch, not
a default to reach for: this repo's own 7 "design-package requires X" rules were first left
unnamed on exactly that theory, and it didn't survive contact with the real question "why
DOES a design package need its own spikes.md." All 13 rules in this repo's own config ended
up named with real descriptions once re-examined honestly — naming and describing even a
seemingly self-evident rule is usually worth it.

## Stress-test your own package before trusting it

Before calling a design package done: try to make a fake, hollow version of it pass. Create
a throwaway sibling directory whose \`_SUMMARY.md\` cross-links your real package's docs with
none of its own — if \`cairn check\` stays green, your kinds aren't scoped tightly enough.
Delete the throwaway directory either way; it's a test, not a keeper.
`
