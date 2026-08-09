---
'@sledorze/cairn': patch
---

`cairn init`'s scaffolded onboarding docs (`AGENTS.md`, `.claude/skills/cairn/SKILL.md`,
`.claude/rules/docs-summaries.md`, `.github/instructions/docs-summaries.instructions.md`)
and `cairn init`'s own printed "Next:" hint no longer hardcode
`npx cairn check --summaries-only --stamp` as the literal next-step instruction — they now
point at the repo's configured `stampCommand` instead (`cli.ts`'s hint reads it live from
config; the scaffolded docs reference it generically).

Found by adversarial review: a repo that customizes `stampCommand` (e.g. to format before
stamping) ends up with scaffolded onboarding docs that keep telling readers to run the old
default forever, since the scaffold is a one-time snapshot, not re-synced on config
changes. This repo hit it on itself the moment it customized its own `stampCommand` — a
second adversarial pass then found the first fix only reached 2 of 5 affected files, plus
`cli.ts`'s own printed hint; this closes all of them and adds a regression test tight
enough to reject a decoy wording that mentions `stampCommand` without actually using it as
the run instruction.
