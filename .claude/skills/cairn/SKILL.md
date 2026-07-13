---
name: cairn
description: Methodology for writing and maintaining the hierarchical documentation summary tree enforced by cairn. Use when authoring or refreshing docs summaries (X.summary.md / _SUMMARY.md).
---

# Writing good documentation summaries

Use this when you author or refresh the summary tree that `cairn`
enforces. It covers _how_ to write summaries that are worth reading, and the exact
mechanical order to (re)generate them so `check` goes green in one pass.

## Two kinds of summary — do not conflate them

**A file summary (`X.summary.md`) condenses ONE document.**
Goal: a reader grasps what `X.md` says in ~10 seconds.

- Faithful to the source — never invent, never contradict, never add claims the doc
  doesn't make. It is a digest, not commentary.
- Front-load the thesis and the hard numbers. Lead with the conclusion, the decision,
  the metric — not the background.
- Bullet-dense, no fluff. Drop hedging, transitions, and restated headings.
- If the source changes, the summary changes. A summary that no longer matches its
  source is a bug the checker will catch.

**A directory summary (`_SUMMARY.md`) is a MAP, not a digest.**
Goal: a reader knows what lives in this directory and where to go next.

- A short orientation paragraph (1-3 sentences): what this directory is about.
- Then one line per direct child — file **and** sub-directory — each with a Markdown
  link and a few-word hook describing what's behind it.
- For a big doc, link and hook its `.summary.md`; for a small doc, link the doc itself.
- For a sub-directory, link its `_SUMMARY.md`.
- **Link-completeness:** every direct child must appear as a link. A missing link fails
  `check`. When you add or remove a child, update the parent's `_SUMMARY.md`.

## Why leaves-first — the Merkle mental model

Each summary is stamped with `<!-- source-sha256: <hex> -->` over its source. A
directory summary's source is a **manifest of its children's hashes**, so a child's
hash must be settled before its parent can be stamped. Think of it as a Merkle tree:
change a leaf and every hash on the path to the root must be recomputed. If you stamp
top-down, parents capture stale child hashes and `check` stays red.

## The bottom-up procedure

1. **Author leaves first.** For every doc over the threshold, write/refresh its
   `X.summary.md`. Get the prose right before touching any directory.
2. **Author directories deepest-first.** Walk from the deepest directories up to the
   roots. For each, write its `_SUMMARY.md`: orientation paragraph, then a linked line
   for every direct child (child `.summary.md` or doc, and each sub-dir's `_SUMMARY.md`).
3. **Stamp mechanically.** Run `npx cairn check --summaries-only --stamp`.
   It rewrites every `source-sha256` bottom-up. **Never hand-edit a sha256** — it is
   computed, not authored; a hand-typed hash is always wrong.
4. **Verify.** Run `npx cairn check` and confirm exit 0.

## Tiny examples

A **file summary** (`adr-0007-queue.summary.md`):

```markdown
<!-- source-sha256: 0000...(stamped by the tool) -->

# ADR-0007: Switch to a pull-based queue — ACCEPTED

- Decision: replace the cron fan-out with a pull-based worker queue.
- Why: p99 job latency 42s -> 3s; lost jobs on redeploy eliminated.
- Cost: one new Redis stream; workers idempotent by job id.
- Rejected: bigger cron batches (still bursty), managed SQS (egress cost).
```

A **directory summary** (`adr/_SUMMARY.md`):

```markdown
<!-- source-sha256: 0000...(stamped by the tool) -->

# Architecture Decision Records

Accepted and superseded decisions for the billing service, newest first.

- [ADR-0007: pull-based queue](./adr-0007-queue.summary.md) — killed cron latency
- [ADR-0006: idempotency keys](./adr-0006-idempotency.md) — dedupe retried charges
- [superseded/](./superseded/_SUMMARY.md) — decisions we've since replaced
```

Keep summaries short, keep links complete, stamp last, verify green.
