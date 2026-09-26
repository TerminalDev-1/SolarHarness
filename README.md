# SolarHarness

> **Preview:** SolarHarness is under active development. Its interfaces, behavior,
> and safety boundaries may change before a stable release.

**First committed:** 20 September 2026.

SolarHarness is a terminal-native coding workspace. Solar handles ordinary tasks
itself without asking about delegation. Sub-agents are used only when you ask
Solar to delegate. Delegation plans are reviewed before launch unless
auto-approve is enabled. Sub-agents can create named Light-pinned sub-delegates
for independent scopes.

SolarHarness uses a centered terminal layout with a compact conversation and
one blocky input frame. It opens in the dark theme on the terminal's native
background, with a monochrome header rail and a rainbow-blue message frame.
`/theme light` restores the earlier light palette while keeping the input frame.
Its welcome view highlights browsing, file inspection, tool
use, and creation.

## What it can do

- Handle ordinary coding requests directly in the active workspace.
- Run workspace commands through a host tool that returns command output to Solar;
  start a local app server in the background for visible browser testing.
- When you request delegation, turn the task into an implementation-ready sub-agent
  plan with one to eight sub-agents based on genuinely parallel scopes.
- Honor an explicit request for one to eight agents, including when the same
  message also asks Solar to browse a page.
- Create multiple directories and their contents in parallel inside `test`. For
  example, eight approved sub-agents can own separate folders there.
- Give sub-agents memorable names instead of presenting only generated IDs.
- Let a sub-agent delegate independent scopes to direct sub-delegates, then integrate
  their reports. Solar controls the full tree; each sub-agent controls its children.
- Let every sub-agent create nested directories and files recursively, run relevant
  commands, validate its own assignment, and return a concise report.
- Give Solar, sub-agents, and sub-delegates workspace-write access for
  implementation; keep delegation planning read-only.
- Let Solar test local HTML, Next.js, and Three.js apps in a windowed Playwright
  browser with a blue control tint, notice, and visible Solar cursor. It can
  search visibly, handle supported consent prompts, move its cursor, click page
  elements or coordinates, press keys, and
  save full-page screenshots. The window remains open after a task; Playwright
  tries managed Chromium first, then Microsoft Edge if needed.
- Search and read sources through the separate `web_search_headless` tool. It
  tries Google first and falls back to Bing when Google blocks automation.
- Present every proposed sub-agent separately so tasks can be accepted or rejected,
  or allow `/auto-approve on` to launch future plans without pausing.
- Retain Solar's context across user turns, planning, sub-agent execution, and
  final report synthesis.
- Start a genuinely clean session with `/new`, including clearing old sub-agent
  records and deleting all contents of the `test` workspace.
- Change Solar's default reasoning effort at runtime from Light through Max.
- Select Standard or Fast processing with `/speed` or `/fast on|off|status`.
- Keep a shaded cat, dog, or fox moving across the terminal while idle or working;
  choose one with `/pets` or hide it with `/pets off`.
- View local chats, completed prompts, tracked Codex token usage, favorite model,
  and milestones with `/stats`. Stats are saved under `~/.solarharness/stats.json`.
- Adjust a particular sub-agent's next-exchange effort through a command or a
  natural-language request to Solar.
- Display the nested agent tree, reasoning pins, live state, elapsed time, recent
  commands, and an expanding golden sun while work is running.
- Switch between dark and light interface palettes while keeping the rainbow-blue
  input frame and active workspace visible.
- Find the native Codex executable installed with the Codex desktop app even when
  its versioned directory is missing from the terminal's `PATH`.

## Workspace and parallel directories

SolarHarness creates and uses a `test` directory under the directory from which
`solar` is launched. Its absolute path appears in the header. Sub-agents share
that workspace and may create separate top-level or nested directories there.

For example, a request such as:

```text
Create eight independent agent directories. In each directory, create five test
files and verify their contents.
```

can be split into eight concurrent sub-agent assignments because it has eight clear,
non-overlapping scopes. Eight is a ceiling, not a default: ordinary review work
is grouped into fewer assignments when additional sub-agents add no value. Each
sub-agent can own a different directory, allowing directory trees to be created at
once instead of sequentially.

Sub-agents are separate Codex sessions but share the same `test` workspace. Give
parallel sub-agents non-overlapping directory or file ownership when possible. Solar
includes shared context in each assignment, and the final response synthesizes
only the sub-agents launched for the current approved plan.

## Requirements

- Node.js 20 or newer.
- An authenticated Codex CLI or Codex desktop installation.
- Playwright and its managed Chromium browser, or Microsoft Edge as a fallback.

SolarHarness first honors `SOLAR_CODEX_PATH`, then checks `PATH`, the Windows Codex
desktop installation, and the standard global npm installation. If discovery
fails, the displayed error explains how to configure the executable explicitly.

## Install and run

```powershell
npm install
npm run build
npm link
cd C:\path\to\your\project
solar
```

`npm link` installs the `solar` command on this machine. Run it once from the
SolarHarness source directory, then launch Solar from any directory. Solar uses
that directory's `test` folder, even when the parent is not a Git repository.
For source development, use:

```powershell
npm run dev
```

If Playwright is missing globally, run `npm install -g playwright`. Install its
browser executable with `playwright install chromium` if needed. The project also
installs Playwright locally through `npm install`.

Run `npm run test:browser-live` to verify the visible cursor, page clicks, and
key presses against a local test page.

`chat` is the default command, so `npm run dev` opens the interface directly.
Startup shows a brief Solar splash before chat; press any key to continue
immediately.
For a compiled production run:

```powershell
npm run build
npm run start -- chat
```

Solar uses GPT-6 Luna with Light reasoning by default. Override the Codex model
or reasoning at launch:

```powershell
npm run dev -- chat --model gpt-6-luna --reasoning max
```

## Delegation workflow

1. Ask Solar to delegate a task, or use `/delegate` after describing it.
2. Solar keeps talking with you in the same session and asks a
   question only when a missing answer would materially affect the work.
3. Solar proposes up to eight independent tasks.
4. Review the plan before launch:

   - `Up` / `Down` selects a task.
   - `Space` toggles the selected task between accepted and rejected.
   - `A` accepts every proposed task.
   - `Enter` launches the accepted tasks concurrently.
   - `Esc` rejects the plan without launching sub-agents.

5. A sub-agent may create direct sub-delegates at Light reasoning. Solar displays the
   full agent tree and command activity.
6. Solar synthesizes the reports when the current
   batch finishes.

## Commands

Type `/` to see matching commands. Use Up and Down to select one, then Tab or
Enter to insert it. Press Enter again to run it, or Esc to close the list.

| Command | Behavior |
| --- | --- |
| `/help` | Shows available interaction controls. |
| `/new` | Opens a destructive-action confirmation with **No** selected by default. **Yes** resets context, stops and clears agents, deletes everything inside `test`, and activates the empty folder. |
| `/auto-approve on` | Treats subsequent plans as pre-approved and launches them immediately. |
| `/auto-approve off` | Restores the plan review screen. |
| `/effort` | Opens the effort selector: Light, Medium, High, XHigh, or Max. |
| `/effort <level>` | Changes Solar's effort and the default for newly launched top-level sub-agents. New sub-delegates still start pinned to Light. |
| `/theme dark` or `/theme light` | Switches the interface palette; the rainbow input stays the same. |
| `/speed` or `/fast <on|off|status>` | Selects Standard or Fast processing in Codex mode. |
| `/pets <cat|dog|fox|off>` | Chooses a moving terminal pet or hides it. |
| `/stats` | Shows local chat, token, favorite model, and achievement counts. |
| `/agents` | Shows whether sub-agents are currently assigned. |
| `/agent <id-or-name> reasoning <level>` | Solar authorizes a sub-agent or sub-delegate's next-exchange effort. |
| `/agent <id-or-name> context <message>` | Sends additional context to a sub-agent or sub-delegate; a completed agent resumes its session. |
| `/agent <id-or-name> cancel` | Cancels an agent and any direct sub-delegates it owns. |
| `/delegate` | Asks Solar to prepare a sub-agent plan from the current brief. You can also request delegation in natural language. |
| `/quit` or `/exit` | Closes SolarHarness. |

Solar also has the registered `adjust-sub-effort-level` tool. This
means you can say something like “set Forge to max effort” instead of
typing the explicit `/agent` form. The harness validates the sub-agent ID and effort
before applying the adjustment.

Solar also has a registered `set-auto-permissions` tool, so a natural
request such as “turn auto permissions on” updates the same state as
`/auto-approve on`. This only pre-approves future sub-agent plans; it cannot bypass
the explicit `/new` workspace-deletion confirmation.

## Session and workspace safety

- Solar can implement directly with workspace-write access. Delegation planning
  remains read-only, and sub-agent plans still follow the chosen approval setting.
- Approved sub-agents run with workspace-write access rooted in the visible `test`
  workspace.
- Rejected tasks never launch.
- `/new` defaults to **No**, explains both context and folder deletion, and shows
  the exact workspace path before anything destructive happens.
- Confirming `/new` aborts active sub-agents, clears their records, resets the
  Solar transcript and model session ID, deletes every entry inside the
  validated `test` directory, recreates it when necessary, and starts there.
- Generated `.solarharness` schemas and `test/agent-*` experiment output are
  excluded from source control.

## Architecture

SolarHarness invokes `codex exec --json --skip-git-repo-check` and consumes its
JSONL event stream. The Solar session is stored and resumed between
conversational turns and after sub-agent synthesis. Planning uses a constrained JSON schema; a plan may
contain one to eight independent tasks.

The runtime `ToolRegistry` exposes these main capabilities:

- `spawn_sub_agent` creates a named sub-agent or direct sub-delegate.
- `orchestrate` lists, cancels, changes reasoning, supplies context to, or resumes
  any agent Solar owns.
- `adjust-sub-effort-level` changes one existing agent's next-exchange effort.
- `set-auto-permissions` enables or disables automatic sub-agent-plan approval.
- `browser` opens and inspects visible web apps and pages, searches YouTube, clicks, fills fields,
  presses keys, scrolls, navigates history, saves screenshots, and closes its session.
  Solar receives URL, title, and an accessibility snapshot after each action.
  Screenshots are saved under `.solarharness/screenshots` in the workspace.
- `web_search_headless` searches the web without a visible window and returns
  source titles, URLs, and snippets; it can also read a source page by URL.
- `workspace_command` runs commands, starts processes, or serves standalone HTML
  and other static files from the active workspace at a ready `localhost` URL.
- `runtime_operations` lets Solar inspect recorded host tool calls and their
  results when asked what actually happened earlier in the session.

Solar receives a JSON tool catalog and the host tool protocol on every
conversation turn, regardless of the wording of the request. Closing the
visible browser window does not end the Solar session; the next open action
launches a new window.

Each agent receives its own Codex session and assignment while sharing the test
workspace. A top-level sub-agent can return a structured sub-delegate request; the
harness runs those named children at Light reasoning, sends their reports back to
the parent session for integration, and keeps the complete tree visible to
Solar. No third delegation level is allowed.

The user chooses direct Solar work or delegation. See [`AGENTS.md`](./AGENTS.md)
for the role and runtime contract.

## Claude Code-style activity indicator

SolarHarness uses a compact activity treatment: an expanding golden sun,
a concrete status such as `Opening YouTube` or
`Working on index.html`, and
elapsed time on one line.
It is an approximation designed for this Ink-based terminal UI rather than a copy
of Claude Code's renderer.

The first implementation attempted a moving, multishade text shimmer. On Windows
Terminal it exposed two rendering problems: per-character ANSI style resets could
briefly reveal the terminal's default foreground color, and the `✳` spinner frame
was promoted to a full-color green emoji that ignored the requested orange ANSI
color. Changing the palette could not fix an emoji renderer overriding that
palette, which is why the green flash survived several color adjustments.

The current implementation renders the activity label as one solid ANSI color
and animates an adjacent fixed-width ASCII sun. It grows from a point to a wide
ray shape and contracts again, with gold tones tracking its size. Frames advance
every 240 ms without emoji substitution or per-character style resets.

An animated text pet moves across the interface while Solar is idle or working. The cat is
selected by default; use `/pets cat`, `/pets dog`, `/pets fox`, or `/pets off`
to change it. Run `/pets` to see the current selection.

## Preview status

SolarHarness is not stable yet. Use it in disposable or version-controlled
workspaces, review delegation plans carefully, give parallel sub-agents clear file or
directory ownership, and inspect changes before committing them.
