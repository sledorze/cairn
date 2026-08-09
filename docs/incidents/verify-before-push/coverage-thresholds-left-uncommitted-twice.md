# Incident: auto-raised coverage thresholds left uncommitted, twice

## What happened

`pnpm ship`'s coverage step raises [`vitest.config.ts`](../../../vitest.config.ts)'s committed
thresholds automatically when real coverage improves, and prints "you may want to push with
updated coverage thresholds." That hint was ignored across two separate ship runs in the
same session — the coverage GATE still passed each time, because the OLD (lower) committed
thresholds were still a valid floor under the NEW (higher) real coverage. Nothing failed;
the drift was just silently sitting in the working tree.

## Root cause

A passing coverage gate reads as "nothing to do here" — but "the floor didn't rise to match
reality" is a real, silent regression in rigor a passing gate doesn't surface at all.

## Fix

`git status` after `pnpm ship`, specifically checking for `vitest.config.ts`, before
considering a push done — not just trusting a green gate.

## Rule this produced

See `AGENTS.md`'s "Full local verify before every push" rule.
