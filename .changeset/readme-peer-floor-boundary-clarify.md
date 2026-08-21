---
'@sledorze/cairn': patch
---

README clarifies that the `effect` peer dependency floor is a testing boundary, not a
verified compatibility one: it's the oldest version this package's own CI runs against, not
necessarily the oldest that actually works. Prompted by a real REX (cairn#187): under npm the
stated floor is a hard `ERESOLVE` if unmet; under pnpm's default (looser) peer resolution, an
older `effect` still installs and runs without complaint — this package has no runtime
dependency on `effect` itself (it's a peer, and the CLI is fully bundled), so nothing here can
currently tell those two cases apart for you.
