# Solution space (issue #137) — summary

Five directions, evaluated against `problem-space.md`'s constraints:

- **(A) Full vocabulary** — `(subject, predicate, object, evidence)`, closed predicate
  registry, predicate-derived modality. Only option subsuming #101/#130/#133 fully; also
  the largest, with unknown marginal cost per additional predicate beyond the one built
  in spikes.
- **(B) Narrow to #130 only** — declared extra `--refs` targets, no predicate vocabulary.
  Cheapest fix for the one fully-reproduced incident; doesn't touch #101 or #133.
- **(C) Vocabulary without generic checkers** — declare, validate, mandatory evidence,
  gap-report; no Should-tier runners. Makes the invisible visible immediately but can't
  yet catch anything new by itself.
- **(D) Frontmatter-anchored relations** — reuses `DocMetadata.ts`'s existing frontmatter
  reader for extraction, but that reader is flat (no lists/nesting) and frontmatter can't
  address a specific claim SITE, only the whole doc — eight of the issue's twelve real
  examples are claim-site-specific. **Rejected as primary mechanism.**
- **(E) Do nothing** — ADR 0004 keeps handling #101 on its own accepted path; #133 gets a
  narrower doc-vs-source output label; #130 stays open (or gets (B) as a standalone fix).
  Zero new hazard surface, zero risk to ADR 0004's in-flight work.

**Relationship to ADR 0004, stated explicitly:** under (A)/(C), #137 absorbs ADR 0004's
Release 3 (symbol-scoped citations) as one instance of `symbol:`-typed object resolution,
leaving Releases 1–2 (file-level hash granularity) untouched. Under (E), ADR 0004 is
unaffected either way.

**Synthesis, as originally proposed:** (C) ships first — smallest slice that makes #130
expressible — paired with (B)'s object-addressing so the one reproduced incident is
actually caught, not just declared. Generic runners (the rest of (A)'s Should tier) ship
one predicate at a time, each gated on a real declared-but-`open` relation. (D) stays
rejected as primary; (E) is the fallback if the deferred ROI attack comes back negative.

**Revised, once the ROI attack was actually run (`roadmap.md` Release 0):** bundling (C)
with (B) didn't hold up — (B) alone, using only existing `--refs`/`RefStore.ts` machinery,
closes #130 without (C)'s vocabulary, syntax, or config surface. **(B) ships alone; (C) and
everything downstream (including all of A's Should tier) is deferred**, not built, until a
second, independent, in-repo recurrence justifies the added machinery.
