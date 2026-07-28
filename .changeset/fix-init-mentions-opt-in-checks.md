---
'@sledorze/cairn': patch
---

`cairn init`'s scaffolded agent guidance (`AGENTS.md`, `CLAUDE.md`'s Claude rule, Copilot instructions, the `cairn` skill) now names every opt-in check — `--refs`, `--prose-refs`, and `checks.coverage` — not just the always-on summaries+links baseline. Previously an agent working in a fresh repo had no way to discover these features short of separately reading the npm README, which a repo-scoped agent doesn't naturally do.
