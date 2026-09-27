# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build              # tsc -> dist/
npm run check              # type-check only
npm run dev                # Ink UI from source
npm test                   # build + node --test tests/*.test.mjs
npm run test:browser-live  # build + real visible Playwright run
npm run build && node --test --test-name-pattern "<name>" tests/harness.test.mjs
```

Tests import from `dist/`, so build first. `tests/` is the test suite; `test/` is Solar's runtime workspace (never commit its output). Unit tests mock `harness.provider.run`/`resume`; they don't prove live browser or Codex behavior.

## Architecture

TypeScript ESM (`.js` import suffixes), Node >= 20, Ink UI. The model backend is the Codex CLI (`codex exec --json --skip-git-repo-check` / `exec resume`) spawned by `codex-provider.ts`, not an API SDK.

`SolarHarness.converse()` (`harness.ts`) keeps one main Codex session and loops: prompt with a live tool-registry manifest → structured `{kind, tool, input, reply}` via `--output-schema` (`host-turn.ts`) → run host tool → resume with result. Responses normalize to `SOLAR_TOOL:` / `SOLAR_STATE:` lines; sub-agents request children via `SOLAR_SUBDELEGATE` (`agent-manager.ts`). When adding a main-agent host tool, update `tool-registry.ts`, `HOST_TOOLS` in `host-turn.ts`, and the manifest filter in `harness.ts`.

`SOLAR.md` (`instructions.ts`) loads `$SOLAR_HOME` (default `~/.solarharness`), the launch dir (parent of `test`, survives `/new`), then `test/`; later overrides earlier. It is sent at main-session start (re-sent only when changed), and to planners, sub-agents, synthesis, plan and review runs. `/plan` and `/ultraplan` (`planTask`) use a fresh `planner`-role (read-only) session, never the main one; ultra = max effort + a critique resume. Approved plans run via `converse(request, _, approvedPlan)` so heuristics see only the request. `/ultrareview` runs 3 read-only xhigh reviewers in parallel, then a max verifier.

## Rules

- Update this file when agent behavior or tool contracts change; update `README.md` only for user-facing changes.
- Standing authorization: after a requested change is verified, commit only its files and push to the GitHub remote. Report failures plainly.
- Never weaken tests or success conditions to pass. Credit Solar only for recorded successful tool calls (the user can also click in the visible browser).
- Solar delegates only on explicit request or `/delegate`; honor a requested count (1–8). Limits: 8 concurrent agents, 8 per plan, 8 sub-delegates each, two levels max; sub-delegates pinned to Light. Plans need review unless auto-approve is on, which never bypasses `/new`'s No-default confirmation.
- Wording heuristics may require/validate tool calls but must never gate tool availability.
- UI: ASCII sun indicator with a single solid-color label span. No emoji-capable glyphs (the `✳` green-emoji bug) or per-character ANSI styling (color bleed). Short concrete activity labels, never the full prompt. Keep the rainbow input frame in all themes; no message cards, status panels, `Ready` badge, or silver palette.
