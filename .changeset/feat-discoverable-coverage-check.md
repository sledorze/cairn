---
'@sledorze/cairn': patch
---

`checks.coverage` — a config-only opt-in check with no CLI flag of its own — is now mentioned in `cairn check --help` and `cairn --help` (closes #104). Previously it was invisible to anyone who hadn't already read the README or the JSON schema by hand.
