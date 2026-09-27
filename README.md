# SolarHarness

> **v1.0:** SolarHarness is out of preview. This is the first stable release.

**First committed:** 20 September 2026.

SolarHarness is a terminal coding agent. You talk to **Solar**, which works in the
directory you launch it from: it reads and edits files, runs commands, tests pages in
a visible browser, researches the web, looks at images, and narrates what it is doing
as it goes. Solar works alone by default and uses sub-agents only when you ask it to
delegate. The model backend is the Codex CLI.

## Quick start

Requirements:

- Node.js 20 or newer.
- An authenticated Codex CLI or Codex desktop installation.
- Playwright's Chromium (`npx playwright install chromium`), or Microsoft Edge as a
  fallback, for browser testing and web search.

```powershell
npm install
npm run build
npm link
cd C:\path\to\your\project
solar
```

`npm link` installs the `solar` command once; after that, run `solar` in any
directory. That directory becomes Solar's workspace, whether or not it is a Git
repository. A short splash appears first; press any key to skip it.

Launch options:

```powershell
solar --model gpt-6-luna      # Codex model (default gpt-6-luna)
solar --reasoning high        # effort for this launch only
solar --version               # prints 1.0
```

Solar finds Codex through `SOLAR_CODEX_PATH`, then `PATH`, then the Windows Codex
desktop install, then the global npm install. If none works, the error explains how
to set `SOLAR_CODEX_PATH`.

## Working with Solar

Type a request and press Enter. Solar handles ordinary requests itself and asks a
question only when the answer would change the work.

**While it works**, the live area above the input shows:

- An expanding ASCII sun with a short activity label and the elapsed time (`42s`,
  then `4m 02s`, then `1h 02m 05s`).
- Codex's reasoning summaries as the label while Solar thinks, for example
  "Verifying the count".
- The latest steps: what Solar says it will do next (`›`), commands it ran (`$`),
  and files it created (`+`, with line counts), edited (`~`, with the changed
  lines), or deleted (`-`).

**When a turn finishes**, the transcript keeps that timeline in order, with
consecutive commands folded into "Ran N commands", followed by Solar's reply
rendered as Markdown (headings, bold, inline code, lists, quotes, code blocks).

Finished messages print once into your terminal's normal scrollback, so you can
scroll back through a long session without the view jumping.

### Images and vision

Mention an image file in a message and Solar attaches it for the model to look at:

```text
What's wrong with the layout in screenshots/home.png?
Compare @mockup.jpg with the current page.
```

Paths can be relative to the workspace, absolute, quoted (for spaces), or prefixed
with `@`. Dragging a file into Windows Terminal pastes its path, which also works.
PNG, JPEG, GIF, WebP, and BMP are supported, up to eight per message. Attached
images appear as `@ Viewed <file>` steps.

When Solar takes a browser screenshot, the image itself goes back to the model, so
Solar reports what a page actually shows rather than guessing from its HTML.

## Commands

Type `/` to open the command menu. Up and Down select, Tab or Enter inserts, Esc
closes it; press Enter again to run the command.

| Command | What it does |
| --- | --- |
| `/help` | Lists the commands. |
| `/ultra <task>` | Runs one task at Max effort with Fast mode on, then restores your settings. |
| `/plan <task>` | Solar inspects the workspace read-only and proposes a plan. Choose **Execute** to carry it out or **Keep planning** to leave everything unchanged. |
| `/ultraplan <task>` | Like `/plan`, at Max effort, with a second pass that critiques the draft against the actual files. |
| `/ultrareview [target]` | Code review: three read-only reviewers (correctness, security, design) run in parallel, then a Max-effort verifier re-checks every finding and drops false positives. With no target it reviews uncommitted Git changes (or the last commit), or the workspace files outside Git. |
| `/effort` or `/effort <level>` | Changes effort for this session: Light, Medium, High, XHigh, or Max. |
| `/default-effort <level>` | Changes the effort every new session starts with. It starts as Max. The current session is unchanged. |
| `/speed` or `/fast <on\|off\|status>` | Chooses Standard or Fast processing. Fast uses more credits. |
| `/memory` | Lists the `SOLAR.md` files Solar has loaded, or where you can create one. |
| `/delegate` | Prepares a sub-agent plan for your last request. |
| `/agents` | Shows whether sub-agents are assigned. |
| `/agent <name> reasoning <level>` | Sets a sub-agent's or sub-delegate's effort for its next exchange. |
| `/agent <name> context <message>` | Sends more context to an agent; a finished agent resumes to apply it. |
| `/agent <name> cancel` | Cancels an agent and the sub-delegates it owns. |
| `/auto-approve <on\|off>` | Launches future delegation plans without the review screen, or restores it. |
| `/new` | Starts a fresh session (see [Safety](#safety)). |
| `/theme <dark\|light>` | Switches the palette. |
| `/pets <cat\|dog\|fox\|off>` | Chooses the animated pet above the input, or hides it. |
| `/stats` | Shows chats, prompts, tracked tokens, favorite model, and achievements. |
| `/quit` or `/exit` | Closes Solar. Ctrl+C also works. |

Up and Down step through your earlier messages when the command menu is closed.

Solar also understands some settings in plain language: "turn auto permissions on"
or "set Forge to max effort" call the same tools as the commands.

### Effort

Every session starts at the saved default effort, which is **Max** until you change
it with `/default-effort`. `solar --reasoning <level>` overrides it for one launch,
and `/effort` changes only the current session. The footer always shows the current
model, effort, speed, theme, and auto-approve state. During `/ultra`, `/ultraplan`,
and `/ultrareview` it shows Max, and the rainbow input frame spins twice as fast on
deep purple.

## Delegation

Solar never delegates on its own. Ask for it ("use 3 agents to...", "delegate this")
or run `/delegate` after describing the task.

1. Solar drafts a plan of one to eight independent tasks, each with a short agent
   name. If you ask for a specific number of agents, the plan has exactly that many.
2. Review the plan: Up and Down select a task, Space accepts or rejects it, A
   accepts all, Enter launches the accepted tasks, and Esc or R rejects the plan.
   With `/auto-approve on`, plans launch without this step.
3. Accepted sub-agents run in parallel, each in its own Codex session in the shared
   workspace. The Team panel shows each agent's state, effort, and latest activity,
   plus recent commands and file changes.
4. A sub-agent may hand independent parts of its task to up to eight sub-delegates.
   Sub-delegates start pinned to Light effort, cannot delegate further, and only
   Solar can raise their effort.
5. When the batch finishes, Solar summarizes what each agent did, what was
   validated, and what risks remain.

Limits: eight concurrent agents, eight tasks per plan, eight sub-delegates per
sub-agent, two levels in total. Give parallel agents separate files or directories
when you can, because they share the workspace.

## Tools Solar uses

Solar chooses tools from a live registry on every turn, whatever words you use.

- **`workspace_command`** runs a bounded command (2-minute limit, output capped),
  starts a long-running process such as a dev server, or serves the workspace's
  static files at a `localhost` URL. It uses PowerShell on Windows and `/bin/sh`
  elsewhere.
- **`browser`** drives one visible Playwright window: open pages, search Google or
  Bing, search YouTube, read an accessibility snapshot, take screenshots, move a
  visible Solar cursor, click elements, named buttons, links, or coordinates, fill
  fields, press keys, scroll, and go back or forward. The window has a blue tint and
  a "Solar Harness is controlling the browser" notice. It stays open between turns,
  and a new window opens if you closed it. Chromium is tried first, then Edge.
- **`web_search_headless`** searches Google without a window, falls back to Bing
  when Google blocks automation, and can read a source page by URL. Solar cites the
  URLs it used.
- **`runtime_operations`** returns the recorded log of host tool calls, so when you
  ask what Solar did earlier, it answers from what actually ran.
- **`set-auto-permissions`** and **`adjust-sub-effort-level`** back the plain-language
  settings above.

Solar only claims a browser action worked when a successful tool result recorded
it. It also uses Codex's own file editing and shell tools inside the workspace.

## Configuration and files

**`SOLAR.md`** gives Solar standing instructions, like `CLAUDE.md`. Solar loads, in
order (later files win):

1. `~/.solarharness/SOLAR.md` for every project.
2. The parent directory's `SOLAR.md`, when you launch inside a folder named `test`.
3. `SOLAR.md` in the workspace.

The instructions reach Solar, planners, sub-agents, and reviewers. Edits are
picked up on your next message.

Files Solar keeps:

| Path | Contents |
| --- | --- |
| `~/.solarharness/settings.json` | The saved default effort. Other keys in the file are preserved. |
| `~/.solarharness/stats.json` | Chat, prompt, token, and achievement counts for `/stats`. |
| `<workspace>/.solarharness/` | Structured-output schemas and browser screenshots. It contains its own `.gitignore`, so Git ignores it without changes to your project. |

Environment variables: `SOLAR_CODEX_PATH` (the Codex executable), `SOLAR_HOME`
(replaces `~/.solarharness`), and `SOLAR_STATS_PATH` (the stats file).

## Safety

- Solar and its sub-agents can write files in the workspace. Planning (`/plan`,
  `/ultraplan`, delegation plans) and `/ultrareview` run in read-only Codex
  sandboxes and cannot change files.
- Rejected plans and rejected tasks never launch.
- `/new` asks first, with **No** selected. It shows the workspace path and says
  whether files will be deleted. Confirming stops every agent, clears their
  records, closes the browser and servers, and resets the conversation. Files are
  deleted only when the workspace is a folder named `test`; any other directory
  keeps all its files. Auto-approve never skips this confirmation.
- Web pages and tool output are treated as untrusted data.
- Use Solar in version-controlled projects and review its changes before you
  commit them.

## Architecture

Solar runs the Codex CLI as a subprocess (`codex exec --json --skip-git-repo-check`,
and `codex exec resume` to continue a session) and reads its JSONL event stream. No
model API is called directly.

**The main loop** (`SolarHarness.converse` in `harness.ts`) keeps one Codex session
for the conversation. Each turn sends the tool registry, your message, any attached
images, and `SOLAR.md` at session start or when it changes. Codex must reply in a
structured `{kind, tool, input, reply}` shape enforced with `--output-schema`
(`host-turn.ts`): either an answer or a host tool call. The harness runs the tool,
resumes the same session with the result (and any screenshot as an image), and
repeats for up to 20 steps. Some requests, such as web research or visible browser
testing, require a real tool call before Solar may answer.

| Module | Role |
| --- | --- |
| `index.ts` | CLI entry: options, default effort, launch. |
| `ui.tsx` | Ink interface: transcript, live activity, pickers, command handling. |
| `harness.ts` | Main loop, `/plan`, `/ultra`, `/ultraplan`, `/ultrareview`, delegation plans. |
| `codex-provider.ts` | Spawns Codex; turns its events into activity, reasoning, narration, and file-change steps. |
| `agent-manager.ts` | Sub-agents and sub-delegates: limits, naming, pinning, cancellation, reports. |
| `tool-registry.ts` | Host tool definitions and the runtime operation log. |
| `browser-tool.ts`, `web-search-headless.ts`, `workspace-tool.ts` | The host tools. |
| `file-changes.ts` | Turns Codex file changes into "Created / Edited (lines) / Deleted" steps. |
| `images.ts` | Finds image paths in a message and builds `--image` arguments. |
| `instructions.ts`, `settings.ts`, `stats.ts` | `SOLAR.md`, saved default effort, usage stats. |
| `markdown.ts` | Markdown parsing for replies. |
| `activity.ts`, `sun.ts`, `pets.ts` | Activity labels, the sun animation, the pets. |

Planners and reviewers use separate read-only Codex sessions, so they never touch
the main conversation's session. Sub-agents each get their own session; a
sub-agent requests sub-delegates with a `SOLAR_SUBDELEGATE:` line and controls them
with `SOLAR_SUBDELEGATE_TOOL:` lines.

See [`CLAUDE.md`](./CLAUDE.md) for the rules contributors follow.

## Development

```powershell
npm run dev                 # run the UI from source
npm run check               # type-check
npm test                    # build, then run tests/*.test.mjs
npm run test:browser-live   # build, then drive a real visible browser
```

The unit tests replace the Codex provider with fakes, so they do not prove live
Codex or browser behavior; `test:browser-live` checks the real cursor, clicks, and
key presses. `tests/` holds the test suite; `test/` is a scratch workspace whose
contents are never committed.
