# Solar Harness agent architecture

## Roles

- Solar is the main agent. It owns conversation continuity,
  clarification, direct implementation, delegation approval, orchestration, and
  report synthesis.
- Named sub-agents inspect the workspace, edit files, run commands, validate
  changes, and report results to Solar.
- A sub-agent may request named sub-delegates for independent parts of its
  assignment. Sub-delegates report to their parent sub-agent. Solar can
  inspect and control the complete tree; a sub-agent controls only its direct
  sub-delegates.

## User-selected work mode

Solar handles ordinary requests alone in the active workspace, including
implementation and validation. Solar must not ask whether to delegate or how many
agents to use for an ordinary request. Only an explicit user request for agents
or delegation, or `/delegate`, starts a sub-agent plan. When the user specifies
an agent count, honor it; otherwise Solar chooses the smallest useful number
and asks about the count only if its absence materially changes the work. Plans
still follow the review or auto-approval flow. Planning runs read-only; Solar,
sub-agents, and sub-delegates run with workspace-write access.

## Runtime behavior

- Solar retains one Codex session across turns and sub-agent synthesis.
- Solar creates and runs inside the project `test` workspace by default.
- `/new` asks for confirmation with No selected by default and explicitly warns
  about both kinds of deletion. Only selecting Yes and pressing Enter discards
  Solar's session and transcript, stops and clears agent records,
  deletes every entry inside the `test` workspace, recreates it if needed, and
  activates the empty folder for the fresh session.
- Up to eight agent processes may run concurrently across the full tree.
  Plans may contain up to eight sub-agents. A sub-agent may request up to eight
  direct sub-delegates, subject to the global concurrency limit. Sub-delegates
  cannot create another delegation level.
- When the user explicitly asks to assign a number of agents from one through
  eight, the plan must contain that many distinct sub-agent assignments.
  A browser action in the same request does not suppress this delegation plan.
- `spawn_sub_agent` launches a named sub-agent or sub-delegate.
- `orchestrate` lists, cancels, changes reasoning, resumes, or supplies context
  to sub-agents and sub-delegates.
- `adjust-sub-effort-level` changes one existing agent's next-exchange effort
  to Light, Medium, High, XHigh, or Max.
- `set-auto-permissions` lets Solar enable or disable automatic approval of
  future sub-agent plans from natural-language conversation. It changes the same
  harness-level state as `/auto-approve on|off` and never bypasses `/new`.
- `browser` is the visible interactive Playwright tool for website and web app
  testing, including local HTML, Next.js, and Three.js apps. It opens pages,
  clicks, fills fields, presses keys, scrolls, navigates, and captures screenshots.
  Its context persists across tasks until the user closes it, resets the session,
  or exits the app. Launch first resolves the Playwright Chromium executable,
  then falls back to Microsoft Edge through
  Playwright if that executable fails. It displays a "Solar Harness is controlling
  the browser" notice inside the page. Browser actions return the URL, title,
  and accessibility snapshot to the same Solar session; `screenshot` also saves
  a PNG under `.solarharness/screenshots` in the workspace and returns its path.
  Launch it in a compact windowed frame with a blue page tint and control notice.
- `web_search_headless` handles ordinary web research in a separate, short-lived
  headless Playwright session. `search` returns titles, source URLs, and snippets;
  `read` returns page text for a source URL. It tries Google first, falls back to
  Bing if Google blocks automation, rejects supported consent prompts, and closes
  its own session after each operation. It never opens or closes the visible
  `browser`. The old `browser` `web_search` action is retired. If results are
  unavailable, report that rather than claiming research was completed.
- For requests to search YouTube, opening its home page is incomplete. The host
  runs `youtube_search` with the user's query and verifies the results URL before
  reporting success. Recognize common search word orders, including "search
  YouTube for" and "search for ... on YouTube". If YouTube shows a consent dialog,
  use its visible rejection button and wait for the dialog to close so the
  results are visible. Browser turns must
  return a nonempty user-facing response,
  including when the model emits only a control line or the browser action fails.
- Sub-agent plans require user review by default. `/auto-approve on` is the user's
  standing approval for subsequent plans to launch immediately; `/auto-approve
  off` restores per-plan review.

## Model defaults

The default is GPT-6 Luna with Light reasoning. Light is translated to the
Codex CLI's `low` reasoning setting. Solar and sub-agents inherit the
selected default. Every new sub-delegate starts pinned to Light regardless of
its parent's setting. A sub-agent cannot raise its sub-delegate above Light;
only an explicit adjustment by Solar can authorize that increase.

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
The main activity copy names the current action, such as opening YouTube,
searching for a query, or running a command. Do not show a generic Thinking label
when a concrete action is known.

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
