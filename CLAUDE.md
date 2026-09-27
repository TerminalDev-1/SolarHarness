# CLAUDE.md

This branch (`desktop`) holds only the Solar desktop app (Electron). The engine is the Solar Harness CLI on `main`, installed as the `solar-harness` dependency from GitHub (`github:TerminalDev-1/SolarHarness#main`); its `prepare` script builds `dist/` on install. `.npmrc` sets `allow-git=root` and `package.json` `allowScripts` approves that build, both required by npm 12. Engine changes (harness, Codex provider, tools) go on `main`, then `npm update solar-harness` here picks them up. Never copy engine code into this branch.

`npm start` launches the app. `main.js` drives `SolarHarness` from `solar-harness/dist/*` over IPC (`preload.cjs` exposes `window.solar`). The renderer is dependency-free ES modules in `renderer/` with a strict CSP; model text is rendered through DOM APIs, never innerHTML. Diffs: `changes.js` snapshots the workspace's text files before each turn and turns each `File: Created/Edited/Deleted x` event into red/green hunks (jsdiff), plus a session-wide Review list. `npm run demo` runs a scripted harness that edits a temp folder; `npm run screenshots` saves views to `screenshots/` (not committed). Check UI changes with it; it proves layout, not live Codex behavior.

Rules:
- Update this file for architecture or contract changes. After verifying a requested change, commit only its files and push.
- UI: dark theme with sun accents, the spinning full-spectrum rainbow composer frame (faster while working, fastest in Ultra), green/red diffs with word-level highlights. Keep the Review panel and the timeline truthful: show only activity the harness actually reported.
- A new chat in a folder named `test` empties it, so always confirm first.
