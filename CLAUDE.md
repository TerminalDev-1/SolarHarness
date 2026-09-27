# CLAUDE.md

`npm run check` type-checks; `npm test` builds then runs `tests/*.test.mjs` (they import `dist/`; filter with `--test-name-pattern`). Tests mock `harness.provider.run`/`resume`, so they don't prove live Codex or browser behavior. `test/` is runtime output: never commit it.

TS ESM (`.js` imports), Ink UI, Codex CLI backend (`codex-provider.ts`). `harness.ts` `converse()` loops one main session through structured host turns (`host-turn.ts`). New host tool: update `tool-registry.ts`, `HOST_TOOLS`, and the manifest filter in `harness.ts`. Workspace is the launch dir; `/new` empties it only if it's named `test`. `SOLAR.md` (`instructions.ts`): home, parent-of-`test`, workspace. `/plan`, `/ultraplan`, `/ultrareview` use read-only `planner` sessions. Codex `file_change` items become `File: Created/Edited x (lines a-b)` events (`file-changes.ts`) shown as a step list; reasoning summaries (`model_reasoning_summary="detailed"`) become `Thinking:` labels. Solar replies render via `markdown.ts`. Ultra commands show max effort and a rotating full-spectrum input rail.

Rules:
- Update this file for agent/tool contract changes, README for user-facing ones. After verifying a requested change, commit only its files and push.
- Never weaken tests. Credit Solar only for recorded successful tool calls.
- Delegate only on explicit request or `/delegate`; max 8 agents, two levels, sub-delegates pinned Light. Auto-approve never bypasses `/new` confirmation. Wording heuristics never gate tool availability.
- UI: header and finished messages go in Ink `<Static>`; keep the live area shorter than the window, or Ink clears the terminal each frame and breaks scrolling. ASCII sun, one solid-color label span, no emoji-capable glyphs or per-char ANSI, short activity labels, rainbow input frame in all themes; no cards, status panels, `Ready` badge, or silver palette.
