# Solar Harness agent architecture

## Interface preview branches

`Interface_Design_Preview` is a published baseline branch.
`Interface_Redesign_Preview` is the active, published terminal-interface redesign
branch. Keep `main` unchanged while this preview is in progress. Work on the
redesign branch and publish its updates there. Once the redesign is accepted,
the preview branches can be deleted; do not delete them during active work.

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
  Standalone requests such as "turn on auto permissions" apply immediately in
  the host and receive a confirmation even if the model is unavailable. When
  the setting is part of a larger request, Solar still completes that request.
- `workspace_command` lets Solar inspect and modify the active workspace, run
  bounded commands with their exit code and output returned to its current
  session, or start a local server that stays available for browser testing
  until the session resets. Its `serve` action hosts static files from the active
  workspace and returns a listening `localhost` URL; use it for standalone HTML
  pages before opening them in the browser. If a local HTML browser navigation is
  refused, Solar calls `serve` and retries the page using its returned URL.
  Solar can also use its Codex workspace tools.
  Browser and web turns use the Codex CLI's output schema to require a
  structured host tool request before their needed actions are complete.
  Model-issued host tool requests are parsed as JSON and their results are fed
  back into the same session. If Solar emits only a control line, the harness
  asks it to continue the task before returning a failure to the user.
- `browser` is the visible interactive Playwright tool for website and web app
  testing, including local HTML, Next.js, and Three.js apps. It opens pages,
  searches Google or Bing with a visible results page, moves a visible blue
  Solar cursor, clicks selectors, named buttons or links, or viewport coordinates,
  fills fields, presses keys, scrolls, navigates, and captures screenshots.
  Its context persists across tasks until the user closes it, resets the session,
  or exits the app. Launch first resolves the Playwright Chromium executable,
  then falls back to Microsoft Edge through
  Playwright if that executable fails. It displays a "Solar Harness is controlling
  the browser" notice inside the page. Browser actions return the URL, title,
  and accessibility snapshot to the same Solar session; `screenshot` also saves
  a PNG under `.solarharness/screenshots` in the workspace and returns its path.
  Launch it in a compact windowed frame with a blue page tint and control notice.
  Search and page navigation handle supported Google and Bing consent prompts;
  if results remain blocked, report the failure instead of claiming a search.
  For a game test, starting the game alone is incomplete: Solar must use another
  browser mouse or key action and inspect the resulting page. A user pressing a
  key in the visible window does not count as a Solar tool action.
- `web_search_headless` handles ordinary web research in a separate, short-lived
  headless Playwright session. `search` returns titles, source URLs, and snippets;
  `read` returns page text for a source URL. It tries Google first, falls back to
  Bing if Google blocks automation, rejects supported consent prompts, and closes
  its own session after each operation. It never opens or closes the visible
  `browser`. The old `browser` `web_search` action is retired. If results are
  unavailable, report that rather than claiming research was completed.
- Browser requests that name an existing HTML page must use the browser host
  tool even if they do not name a URL. Every conversation prompt includes a
  compact JSON manifest generated from the live host tool registry, with names,
  descriptions, and example inputs. Do not rely on a copied source file as a
  tool catalog. If the user closes the visible browser window, a later open
  action launches a fresh browser in the same Solar session.
- Every main-agent conversation turn receives the structured host tool or answer
  schema and live tool catalog. Wording patterns may require an action for known
  requests or validate a completed action, but they do not decide whether Solar
  can access host tools. If Solar says the browser is unavailable while it is
  registered, require a host tool attempt instead of returning that claim. If
  Solar claims to have opened or displayed a page without a successful browser
  host result in the turn, require the browser action before reporting success.
- The host records each host tool call, input, result, and failure in a session
  operation log. Solar can query it through the read-only `runtime_operations`
  tool. For questions about earlier actions, Solar asks for the log and answers
  from recorded outcomes; it does not interpret a prior model claim as evidence
  or trigger a new search. The log excludes Codex built-in file operations, so
  it cannot establish their order relative to host calls. `/new` clears the log.
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

## Evidence and honest reporting

- Report failed tests and incomplete live runs plainly. Do not weaken a test,
  invent a fallback action, or change the success condition merely to make a
  failure look like a pass. Fix the behavior and rerun the original scenario.
- Distinguish mocked unit tests from live browser tests. A passing mock does not
  prove that the visible browser opened or that a game responded to input.
- Attribute actions only when the harness recorded a successful tool call. A
  browser window can also receive user input; do not credit Solar for clicks,
  key presses, score changes, or visual effects the user may have caused.
  Report the tool action and the observed page state separately. If attribution
  is uncertain, say so.
- Do not claim a task is verified or ready to commit while its required live
  scenario still fails. State what failed, what was changed, and what remains
  unverified. Correct an earlier inaccurate claim as soon as it is found.

## Claude Code-style activity indicator

The Windows Terminal green-hue bug is fixed. It was not an orchestration or ANSI
palette problem: the `✳` spinner frame was promoted to a full-color green emoji,
ignoring the requested foreground color. The activity indicator now uses only
text-safe frames (`·`, `✦`, `✧`, `✦`) and one solid ANSI color per theme.
The default silver theme uses graphite; the plain dark fallback uses terracotta.
Activity text is rendered as a single color span, while only the adjacent glyph
animates at a calm 240 ms cadence. Do not reintroduce emoji-capable spinner
characters or per-character ANSI styling; those can recreate green flashes and
color bleed. The resulting status treatment intentionally resembles Claude Code
without copying an emoji-rendered spinner.

Codex command events are surfaced as compact terminal lines beneath the activity
indicator. Command activity may change the status copy, but it must reuse the
same text-safe spinner and solid activity color treatment.
The main activity copy names the current action, such as opening YouTube,
searching for a query, or running a command. Do not show a generic Thinking label
when a concrete action is known.
Both `npm run dev` and the built CLI open with a short, text-safe Solar splash.
It clears automatically after 1.8 seconds; a keypress dismisses it immediately
and printable input is kept for the chat prompt. Keep startup non-blocking and
avoid emoji-capable glyphs in the splash, as in the activity indicator.
Activity labels must stay short. Use a mentioned file name when available (for
example, `Working on index.html`) and never echo the user's full prompt into the
status line. The `/pets` command selects a text-safe animated cat, dog, or fox
beside Solar's activity line; `/pets off` hides it. Pet animation must not use
emoji-capable glyphs or add per-character color changes to activity text.
The redesign preview keeps Ink and the terminal runtime. Use a centered reading
column, compact transcript rows, and one expressive input frame. Avoid full-width colored
message cards or repeated status panels; those made the interface look like a
chat app with excessive empty space. Keep commands and approval flows accessible.
The preview starts in the silver theme with a brushed-metal terminal background
and dark graphite text. The earlier light and chromatic-blue themes have been
replaced. A dark-to-white metallic rail appears in the header, and compact block
markers distinguish transcript speakers without message cards. The sole message
frame uses text-safe block glyphs and bright silver highlights; keep that
treatment through idle, busy, and approval states. `/theme dark` restores the
terminal's native background, and `/theme silver` restores the default.
Welcome copy should reflect Solar's browser, file inspection,
tool use, and creation abilities rather than only coding work.
The header shows only the Solar brand and workspace. Do not restore the idle
`Ready` badge or a separate header status indicator; active work appears in the
activity line, and approval controls explain pending user action.

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
