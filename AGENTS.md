# Solar Harness agent architecture

## Roles

- Solar is the main coordinator. It owns conversation continuity, clarification,
  planning, delegation approval, worker orchestration, and report synthesis.
- Named workers inspect the workspace, edit files, run commands, validate changes,
  and report results to Solar.
- A worker may request named sub-workers for independent parts of its assignment.
  Sub-workers report to their parent worker. Solar can inspect and control the
  complete tree; a worker can control only its own direct sub-workers.

## Non-negotiable boundary

Never let the main coordinator do the actual work. The main coordinator must
delegate implementation to workers; only workers and sub-workers perform implementation.
The coordinator remains read-only and must not edit files, run implementation
commands, or bypass delegation approval.

## Runtime behavior

- The coordinator retains one Codex session across turns and worker synthesis.
- Solar creates and runs inside the project `test` workspace by default.
- `/new` asks for confirmation with No selected by default and explicitly warns
  about both kinds of deletion. Only selecting Yes and pressing Enter discards
  the coordinator session and transcript, stops and clears worker records,
  deletes every entry inside the `test` workspace, recreates it if needed, and
  activates the empty folder for the fresh session.
- Up to eight worker processes may run concurrently across the full agent tree.
  Coordinator plans may contain up to eight top-level workers. A top-level worker
  may request up to eight direct sub-workers, subject to the global concurrency
  limit. Sub-workers cannot create another delegation level.
- `spawn_sub_agent` launches a named worker or a named sub-worker.
- `orchestrate` lists, cancels, changes reasoning, resumes, or supplies context
  to workers and sub-workers.
- `adjust-sub-effort-level` changes one existing agent's next-exchange effort
  to Light, Medium, High, XHigh, or Max.
- `set-auto-permissions` lets Solar enable or disable automatic approval of
  future worker plans from natural-language conversation. It changes the same
  harness-level state as `/auto-approve on|off` and never bypasses `/new`.
- `browser` lets Solar inspect and interact with web pages through a separate,
  non-persistent Playwright Chromium context. Browser actions return the page URL,
  title, and accessibility snapshot to the same coordinator session. Solar may
  browse for research but must still delegate project implementation to workers.
  The browser context closes when the coordinator session resets.
- Worker plans require user review by default. `/auto-approve on` is the user's
  standing approval for subsequent plans to launch immediately; `/auto-approve
  off` restores per-plan review.

## Model defaults

The default is GPT-6 Luna with Light reasoning. Light is translated to the
Codex CLI's `low` reasoning setting. Solar and top-level workers inherit the
selected default. Every new sub-worker always starts pinned to Light regardless
of its parent's setting. A worker cannot raise its sub-worker above Light; only
an explicit Solar/coordinator adjustment can authorize that increase.

## Documentation contract

Update `AGENTS.md` whenever agent behavior, orchestration, tool contracts, role
boundaries, implementation constraints, durable compatibility decisions, or
agent-facing policy changes. Keep those rules here so future agents inherit them.

Do not update `README.md` for every small fix or internal change. Update the
README only when the public harness architecture, installation, commands,
workflow, safety model, or meaningful user-facing capabilities change. Keep it
concise and avoid turning routine maintenance into release-note noise.

## Claude Code-style activity indicator

The Windows Terminal green-hue bug is fixed. It was not an orchestration or ANSI
palette problem: the `✳` spinner frame was promoted to a full-color green emoji,
ignoring the requested foreground color. The activity indicator now uses only
text-safe frames (`·`, `✦`, `✧`, `✦`) and one fixed terracotta/orange ANSI color.
Activity text is rendered as a single color span, while only the adjacent glyph
animates at a calm 240 ms cadence. Do not reintroduce emoji-capable spinner
characters or per-character ANSI styling; those can recreate green flashes and
color bleed. The resulting status treatment intentionally resembles Claude Code
without copying an emoji-rendered spinner.

Codex command events are surfaced as compact terminal lines beneath the activity
indicator. Command activity may change the status copy, but it must reuse the
same text-safe spinner and fixed terracotta/orange color treatment.

## Public publishing authorization

The user has granted standing authorization for current and future agents to
commit SolarHarness changes and push them to this project's GitHub repository.
This authorization remains active until the user explicitly revokes it. Do not
request permission again for every ordinary project commit or push.

Keep publication scoped to this repository and the work the user requested. Do
not treat this authorization as permission to publish unrelated data, generated
workspace output, secrets, or changes to other repositories. If a genuinely
ambiguous or unusually consequential publication question arises, mention the
intended action conversationally and casually instead of presenting a repetitive
formal permission prompt. Respect any later revocation immediately.
