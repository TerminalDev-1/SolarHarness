# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation contract

This file is the project's agent-facing contract. Update it whenever agent behavior, orchestration, tool contracts, role boundaries, or durable compatibility decisions change. Update `README.md` only for meaningful user-facing changes (architecture, install, commands, workflow, safety model); don't turn routine fixes into release-note noise.

## Publishing authorization

The user has granted standing authorization to commit SolarHarness changes and push them to this project's GitHub remote after a requested change is completed and verified, until explicitly revoked. Keep unrelated working-tree changes (especially generated `test/` output) out of commits. If verification or push fails, say so plainly.

## Evidence and honest reporting

- Report failed tests and incomplete live runs plainly. Never weaken a test or change a success condition to make a failure pass; fix the behavior and rerun the original scenario.
- Mocked unit tests don't prove the visible browser opened or a game responded to input.
- The visible browser can receive user input too: only credit Solar for actions the harness recorded as successful tool calls, and report tool actions separately from observed page state.

## Behavior invariants

- Solar handles ordinary requests alone; sub-agent plans start only on an explicit delegation request or `/delegate`. An explicitly requested agent count (1–8) must produce exactly that many assignments. Plans need user review unless `/auto-approve on` (or the `set-auto-permissions` tool) is active, which never bypasses the `/new` confirmation.
- Limits: at most 8 concurrent agent processes across the tree, 8 sub-agents per plan, 8 sub-delegates per sub-agent, no third delegation level. New sub-delegates are pinned to Light; only Solar can raise them.
- Default model is GPT-6 Luna at Light reasoning (Codex `low`). Fast mode is passed via `service_tier` and kept separate from reasoning effort.
- `/new` defaults to No and, only on Yes, clears the session, transcript, agents, operation log, and every entry in `test/`.
- Tool availability must never depend on wording heuristics; heuristics may only require or validate an action. If Solar claims a browser action without a successful host result, the harness demands the real tool call.
- YouTube searches must run `youtube_search` and verify the results URL; game tests require an interaction after starting the game.

## UI constraints

- Activity indicator: five-row, eleven-column ASCII sun frames (240 ms) with the label as one solid-color span beside the middle row. No emoji-capable glyphs (the `✳` spinner rendered as a green emoji on Windows Terminal) and no per-character ANSI styling (causes color bleed). Labels stay short and concrete (e.g. `Working on index.html`); never echo the full prompt or show a generic "Thinking" when the action is known. Pets follow the same glyph/color rules.
- Layout: centered reading column, compact transcript rows, a single input frame with the cyan→blue→violet rainbow rails and royal-blue interior in every theme and state. No full-width message cards, repeated status panels, idle `Ready` badge, or metallic silver palette. Dark theme is the default; header shows only brand and workspace.
- The `/` command menu inserts a command but never executes it; Enter on the filled prompt submits.

## Commands

```bash
npm install
npm run build              # tsc -> dist/
npm run check              # type-check only
npm run dev                # run the Ink UI from source via tsx (chat is the default command)
npm test                   # builds, then runs node --test tests/*.test.mjs
npm run test:browser-live  # builds, then drives a real visible Playwright browser against a local page
```

Tests import from `dist/`, not `src/`, so always build before running them. Run a single test by name:

```bash
npm run build && node --test --test-name-pattern "stats persist" tests/harness.test.mjs
```

`npm link` installs the `solar` bin globally; `solar` launched from any directory runs inside that directory's `test/` subfolder (created if missing). In this repo, `test/` is that runtime workspace — the real test suite lives in `tests/`. Avoid committing generated `test/` output.

Env vars: `SOLAR_CODEX_PATH` (explicit Codex executable), `SOLAR_STATS_PATH` (stats file override; tests point it at a temp file).

## Architecture

TypeScript ESM (`"type": "module"`, imports use `.js` suffixes), Node >= 20, Ink/React terminal UI.

- **Model backend is the Codex CLI**, not an API SDK. `codex-provider.ts` spawns `codex exec --json --skip-git-repo-check` (and `codex exec resume <sessionId>`), parses the JSONL event stream, and maps reasoning levels (Light → `low`, etc.) and Fast mode (`service_tier`). It also locates the Codex executable (env var → PATH → Windows Codex desktop install → global npm).
- **`harness.ts` (`SolarHarness`)** owns the single main-agent Codex session (`mainSessionId`) and the host-tool loop in `converse()`: it builds a per-turn prompt containing a JSON manifest of the live tool registry, runs/resumes Codex with an `--output-schema` from `host-turn.ts`, decodes the structured `{kind, tool, input, reply}` response, executes the requested host tool, and resumes the same session with the result. Heuristic request classifiers (browser/YouTube/web-search/runtime-history/delegation) decide when a tool call is *required* and validate completion; they must not gate tool *availability*. It also runs delegation `plan()` / `executePlan()` and `/new` reset (`resetIntoTestWorkspace`).
- **Text protocol lines**: internally responses are normalized to `SOLAR_TOOL: <name> <json>` and a trailing `SOLAR_STATE: READY|DISCOVER` control line. Sub-agents request children via `SOLAR_SUBDELEGATE` lines parsed in `agent-manager.ts`.
- **`tool-registry.ts`** is the tool contract boundary (tool definitions live here, not in the system prompt) and records every host call into the operation log exposed by `runtime_operations`. `host-turn.ts` has its own `HOST_TOOLS` list for the output schema — keep it in sync when adding main-agent host tools, along with the manifest filter in `harness.ts`.
- **`agent-manager.ts`** runs sub-agents and sub-delegates as separate Codex sessions sharing the workspace, enforcing the global concurrency cap, depth limit, and Light-pinning of sub-delegates.
- **Host tools**: `browser-tool.ts` (visible persistent Playwright window, Chromium then Edge fallback, injected cursor/notice), `web-search-headless.ts` (short-lived headless search/read), `workspace-tool.ts` (run/start/serve commands in the workspace).
- **UI**: `ui.tsx` is the whole Ink app (slash-command menu, plan review, `/new` confirmation, themes, pets). `sun.ts`/`activity.ts` produce the activity indicator frames and labels; `pets.ts` the companion sprites; `stats.ts` persists `~/.solarharness/stats.json`.

## Testing notes

`tests/harness.test.mjs` mocks the model by overwriting `harness.provider.run` / `harness.provider.resume` on a real `SolarHarness` instance. Those are unit tests only; don't treat them as proof that the live browser or Codex flow works — use `test:browser-live` or an actual `solar` run for that and report failures plainly.
