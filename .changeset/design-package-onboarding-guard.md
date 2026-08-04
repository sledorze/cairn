---
'@sledorze/cairn': minor
---

`cairn init --agent claude` now also scaffolds a second skill file,
`.claude/skills/cairn-design-package/SKILL.md`, teaching how to build a structurally-enforced
design package (problem-space/solution-space/spikes/story-map/roadmap/implementation-details/knowledge)
using `checks.coverage`'s existing kinds/rules, with one small generic `scope: "sibling"`
config block that closes a real, verified capturability gap (a shared wildcard kind lets a
hollow package pass by cross-linking a real sibling's docs) without any per-package config,
a vocabulary for naming relationships precisely (`grounded_by`/`builds_on`/`derived_from`/
`sourced_from`, checked against real content rather than picked for sound), and guidance on
stress-testing your own package before trusting it. Distinct from the existing
`.claude/skills/cairn/SKILL.md` (summary-writing methodology) — different trigger, different
content, own file.
