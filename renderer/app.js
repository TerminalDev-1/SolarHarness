import { hydrateIcons, icon } from "./icons.js";
import { renderMarkdown } from "./markdown.js";
import { diffStat, fileIcon, renderDiff, splitName } from "./diffview.js";

const $ = id => document.getElementById(id);
const el = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const EFFORT_NAMES = { light: "Light", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
const MODE_PLACEHOLDERS = {
  chat: "Ask Solar to build, fix, or explain anything",
  plan: "Describe a task. Solar plans it read-only, then you approve",
  ultra: "Ultra runs this task at Max effort with Fast on"
};
const SUGGESTIONS = [
  { title: "Explain this codebase", detail: "Walk me through how it fits together", prompt: "Explain how this codebase is structured and how the main pieces fit together." },
  { title: "Find and fix a bug", detail: "Hunt down something broken", prompt: "Look for a bug in this project, explain it, and fix it." },
  { title: "Build a landing page", detail: "A polished single-page site", prompt: "Build a polished, responsive landing page in index.html and open it in the browser." },
  { title: "Write tests", detail: "Cover the riskiest code first", prompt: "Add tests for the riskiest untested code in this project and run them." }
];

let app = {};
let mode = "chat";
let attachments = [];
let busy = false;
let stickToBottom = true;
let reviewFiles = [];
let reviewSelected;
let turnCounter = 0;
const turns = new Map();

// ---------- boot ----------

hydrateIcons();
app = await window.solar.state();
document.body.classList.add(`platform-${app.platform}`);
renderChrome();
renderEmpty();
void refreshChanges();

window.solar.onActivity(({ turnId, text }) => turns.get(turnId)?.activity(text));
window.solar.onDiff(diff => { turns.get(diff.turnId)?.diff(diff); scheduleChangesRefresh(); });

// ---------- chrome: sidebar, top bar, composer controls ----------

function renderChrome() {
  $("version-label").textContent = `Solar ${app.version}`;
  $("chat-sub").textContent = app.workspace ?? "";
  $("chat-sub").hidden = !app.workspace;
  $("model-label").textContent = app.models.find(model => model.id === app.model)?.name ?? app.model;
  $("effort-label").textContent = EFFORT_NAMES[app.effort] ?? app.effort;
  const level = app.efforts.indexOf(app.effort);
  [...$("effort-meter").children].forEach((bar, index) => bar.classList.toggle("on", index <= level));
  $("fast-button").classList.toggle("on", app.fast);
  $("status-dot").classList.toggle("busy", busy);
  updateSendState();
}

function updateSendState() {
  $("send").disabled = busy || !app.workspace || (!$("input").value.trim() && !attachments.length);
  $("composer").classList.toggle("busy", busy);
  $("composer").classList.toggle("ultra", mode === "ultra");
  $("composer").classList.toggle("plan", mode === "plan");
}

$("chat-sub").addEventListener("click", chooseWorkspace);
$("new-chat").addEventListener("click", newChat);
$("review-toggle").addEventListener("click", () => toggleReview());
$("review-close").addEventListener("click", () => toggleReview(false));

async function chooseWorkspace() {
  try {
    const previous = app.workspace;
    app = await window.solar.chooseWorkspace();
    renderChrome();
    if (app.workspace !== previous) { clearThread(); renderEmpty(); await refreshChanges(); }
  } catch (error) { toast(error.message); }
}

async function newChat() {
  if (busy) return toast("Solar is still working. Wait for it to finish first.");
  try {
    const result = await window.solar.newChat();
    if (!result.started) return;
    app = result.state;
    renderChrome();
    clearThread();
    renderEmpty();
    await refreshChanges();
    $("input").focus();
  } catch (error) { toast(error.message); }
}

for (const button of $("modes").querySelectorAll("button")) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}

function setMode(next) {
  mode = next;
  for (const button of $("modes").querySelectorAll("button")) button.classList.toggle("active", button.dataset.mode === mode);
  $("input").placeholder = MODE_PLACEHOLDERS[mode];
  updateSendState();
}

$("model-button").addEventListener("click", event => openMenu(event.currentTarget, app.models.map(model => ({
  label: model.name, detail: model.detail, selected: model.id === app.model,
  run: async () => { app = await window.solar.setModel(model.id); renderChrome(); }
}))));

$("effort-button").addEventListener("click", event => openMenu(event.currentTarget, app.efforts.map(effort => ({
  label: EFFORT_NAMES[effort], detail: effort === "light" ? "Quickest replies" : effort === "max" ? "Deepest reasoning" : "", selected: effort === app.effort,
  run: async () => { app = await window.solar.setEffort(effort); renderChrome(); }
}))));

$("fast-button").addEventListener("click", async () => { app = await window.solar.setFast(!app.fast); renderChrome(); });

// ---------- popover menu ----------

function openMenu(anchor, items) {
  const menu = $("menu");
  menu.replaceChildren(...items.map(item => {
    const button = el("button", `menu-item${item.selected ? " selected" : ""}`);
    const text = el("span", "menu-text");
    text.append(el("span", "menu-label", item.label));
    if (item.detail) text.append(el("span", "menu-detail", item.detail));
    button.append(text, icon("check", "menu-check"));
    button.addEventListener("click", async () => { closeMenu(); try { await item.run(); } catch (error) { toast(error.message); } });
    return button;
  }));
  menu.hidden = false;
  const box = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  menu.style.left = `${Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12))}px`;
  menu.style.top = `${box.top - menu.offsetHeight - 8}px`;
  requestAnimationFrame(() => menu.classList.add("open"));
}

function closeMenu() { $("menu").classList.remove("open"); $("menu").hidden = true; }
document.addEventListener("pointerdown", event => { if (!$("menu").hidden && !$("menu").contains(event.target) && !event.target.closest(".pill")) closeMenu(); });

// ---------- composer ----------

const input = $("input");
input.addEventListener("input", () => { autosize(); updateSendState(); });
input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit(); }
});
input.addEventListener("paste", async event => {
  if (![...event.clipboardData.items].some(item => item.type.startsWith("image/"))) return;
  event.preventDefault();
  addAttachments(await window.solar.pasteImages());
});
$("send").addEventListener("click", () => void submit());
$("attach").addEventListener("click", async () => addAttachments(await window.solar.pickImages()));

function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
}

function addAttachments(paths) {
  for (const path of paths) if (!attachments.includes(path) && attachments.length < 8) attachments.push(path);
  renderAttachments();
  updateSendState();
  input.focus();
}

function renderAttachments() {
  const box = $("attachments");
  box.hidden = !attachments.length;
  box.replaceChildren(...attachments.map(path => {
    const chip = el("div", "attachment");
    const image = el("img");
    image.src = fileUrl(path);
    image.alt = "";
    const remove = el("button", "attachment-remove");
    remove.append(icon("close"));
    remove.title = "Remove";
    remove.addEventListener("click", () => { attachments = attachments.filter(item => item !== path); renderAttachments(); updateSendState(); });
    chip.append(image, el("span", "attachment-name", basename(path)), remove);
    return chip;
  }));
}

async function submit() {
  let text = input.value.trim();
  if (busy || !app.workspace || (!text && !attachments.length)) return;
  let turnMode = mode;
  const slash = text.match(/^\/(new|plan|ultraplan|ultra|ultrareview)\b\s*([\s\S]*)$/i);
  if (slash) {
    if (slash[1].toLowerCase() === "new") { input.value = ""; autosize(); return newChat(); }
    turnMode = slash[1].toLowerCase();
    text = slash[2].trim();
    if (!text && turnMode !== "ultrareview") return toast(`Add a task after /${turnMode}.`);
  }
  const images = attachments;
  attachments = [];
  renderAttachments();
  input.value = "";
  autosize();
  await runTurn({ text: text || "Review the current changes", images, mode: turnMode });
}

// ---------- the thread ----------

const thread = $("thread");
const updateJump = () => { $("jump-latest").hidden = stickToBottom || thread.scrollHeight <= thread.clientHeight; };
thread.addEventListener("scroll", () => { stickToBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80; updateJump(); });
const scrollToBottom = (force = false) => { if (force || stickToBottom) thread.scrollTop = thread.scrollHeight; updateJump(); };
$("jump-latest").addEventListener("click", () => { stickToBottom = true; thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" }); });

function clearThread() { $("thread-inner").replaceChildren(); turns.clear(); $("chat-title").textContent = "New chat"; }

function workspaceCard() {
  const card = el("button", "workspace-card");
  card.title = `${app.workspace}\nClick to open a different folder (Ctrl+O)`;
  const text = el("span", "workspace-text");
  text.append(el("span", "workspace-name", app.workspaceName), el("span", "workspace-path", app.workspace));
  card.append(icon("folder", "workspace-icon"), text, icon("swap", "chevron"));
  card.addEventListener("click", chooseWorkspace);
  return card;
}

function renderEmpty() {
  const inner = $("thread-inner");
  inner.replaceChildren();
  const hero = el("div", "hero");
  const sun = el("div", "hero-sun");
  for (let index = 0; index < 12; index++) sun.append(el("i"));
  hero.append(sun);
  if (!app.workspace) {
    hero.append(el("h1", "", "Open a folder to begin"), el("p", "", "Solar works inside a project folder: it reads, edits, runs, and tests your code there."));
    const button = el("button", "primary-button");
    button.append(icon("folder"), document.createTextNode("Open folder"));
    button.addEventListener("click", chooseWorkspace);
    hero.append(button);
  } else {
    hero.append(el("h1", "", "What should we build today?"), workspaceCard());
    const grid = el("div", "suggestions");
    for (const suggestion of SUGGESTIONS) {
      const card = el("button", "suggestion");
      card.append(el("span", "suggestion-title", suggestion.title), el("span", "suggestion-detail", suggestion.detail));
      card.addEventListener("click", () => { input.value = suggestion.prompt; autosize(); updateSendState(); input.focus(); });
      grid.append(card);
    }
    hero.append(grid);
  }
  inner.append(hero);
}

function addUserMessage(text, images, turnMode) {
  $("thread-inner").querySelector(".hero")?.remove();
  const article = el("article", "turn user");
  const bubble = el("div", "bubble");
  if (turnMode !== "chat") bubble.append(el("span", `mode-tag ${turnMode}`, turnMode === "ultrareview" ? "Ultrareview" : turnMode[0].toUpperCase() + turnMode.slice(1)));
  bubble.append(document.createTextNode(text));
  if (images.length) {
    const strip = el("div", "bubble-images");
    for (const path of images) { const image = el("img"); image.src = fileUrl(path); image.title = basename(path); strip.append(image); }
    bubble.append(strip);
  }
  article.append(bubble);
  $("thread-inner").append(article);
  if ($("chat-title").textContent === "New chat") $("chat-title").textContent = text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

async function runTurn({ text, images = [], mode: turnMode = "chat", plan }) {
  const turnId = ++turnCounter;
  if (!plan) addUserMessage(text, images, turnMode);
  const turn = createSolarTurn(turnId, turnMode);
  turns.set(turnId, turn);
  busy = true;
  renderChrome();
  scrollToBottom(true);
  try {
    const result = plan
      ? await window.solar.runPlan({ turnId, request: text, plan })
      : await window.solar.send({ turnId, text, images, mode: turnMode });
    if (result.kind === "plan") turn.finishPlan(result.request, result.plan);
    else turn.finish(result.reply);
  } catch (error) {
    turn.fail(cleanError(error));
  } finally {
    busy = false;
    renderChrome();
    void refreshChanges();
    scrollToBottom();
  }
}

/** One Solar reply: a live header, a timeline of steps with inline diffs, then the answer and a files summary. */
function createSolarTurn(turnId, turnMode) {
  const article = el("article", `turn solar${turnMode === "ultra" || turnMode === "ultraplan" || turnMode === "ultrareview" ? " ultra" : ""}`);
  const head = el("div", "solar-head");
  const avatar = el("span", "avatar working");
  const name = el("span", "solar-name", "Solar");
  const status = el("span", "solar-status shimmer", "Thinking");
  const elapsed = el("span", "solar-elapsed", "0s");
  head.append(avatar, name, status, elapsed);

  const steps = el("div", "steps open");
  const toggle = el("button", "steps-toggle");
  const toggleLabel = el("span", "", "Working");
  toggle.append(icon("chevron", "steps-caret"), toggleLabel);
  toggle.addEventListener("click", () => steps.classList.toggle("open"));
  const list = el("div", "steps-list");
  steps.append(toggle, list);
  const body = el("div", "solar-body");
  article.append(head, steps, body);
  $("thread-inner").append(article);

  const started = Date.now();
  const timer = setInterval(() => { elapsed.textContent = formatElapsed((Date.now() - started) / 1000); }, 1000);
  let stepCount = 0;
  let lastText = "";
  let lastNote;
  const commands = new Map();
  const files = new Map();

  const addStep = (kind, iconName, label, detail) => {
    const step = el("div", `step ${kind}`);
    const marker = el("span", "step-marker");
    marker.append(icon(iconName));
    const content = el("div", "step-content");
    content.append(el("span", "step-label", label));
    if (detail) content.append(el("span", "step-detail", detail));
    step.append(marker, content);
    list.append(step);
    stepCount++;
    scrollToBottom();
    return step;
  };

  return {
    activity(text) {
      if (text === lastText) return;
      lastText = text;
      const parsed = classify(text);
      if (!parsed) return;
      if (parsed.status) status.textContent = parsed.status;
      if (parsed.kind === "file") return;
      if (parsed.kind === "command-done") {
        const step = commands.get(parsed.detail);
        if (step) { markDone(step); return; }
        addStep("command done", "check", "Ran", parsed.detail);
        return;
      }
      const step = addStep(parsed.kind, parsed.icon, parsed.label, parsed.detail);
      if (parsed.kind === "note") lastNote = { step, text: parsed.label };
      if (parsed.kind === "command") commands.set(parsed.detail, step);
    },
    diff(file) {
      let card = files.get(file.path);
      if (!card) {
        card = { added: 0, removed: 0, diffs: [], kind: file.kind, name: file.name, path: file.path };
        files.set(file.path, card);
      }
      card.added += file.added;
      card.removed += file.removed;
      card.diffs.push(file);
      if (file.kind === "deleted") card.kind = "deleted";
      const step = el("div", "step file");
      const marker = el("span", "step-marker");
      marker.append(icon(file.kind === "added" ? "file-plus" : file.kind === "deleted" ? "file-minus" : "file"));
      step.append(marker, fileCard(file, { preview: 14 }));
      list.append(step);
      stepCount++;
      status.textContent = `${file.kind === "added" ? "Created" : file.kind === "deleted" ? "Deleted" : "Edited"} ${splitName(file.name).base}`;
      scrollToBottom();
    },
    finish(reply) {
      done();
      // The final agent message is also narrated; drop the note that repeats the reply.
      if (lastNote && reply.replace(/\s+/g, " ").startsWith(lastNote.text.replace(/\.\.\.$/, "").replace(/\s+/g, " "))) { lastNote.step.remove(); stepCount--; }
      toggleLabel.textContent = summary();
      if (!stepCount) steps.remove();
      body.append(renderMarkdown(reply || "Done."));
      if (files.size) body.append(filesSummary());
      avatar.classList.remove("working");
      status.textContent = "";
    },
    finishPlan(request, plan) {
      done();
      toggleLabel.textContent = summary();
      if (!stepCount) steps.remove();
      const card = el("div", "plan-card");
      const header = el("div", "plan-head");
      header.append(icon("map"), el("span", "", "Proposed plan"), el("span", "plan-note", "Read-only. Nothing has changed yet."));
      const actions = el("div", "plan-actions");
      const run = el("button", "primary-button");
      run.append(icon("play"), document.createTextNode("Run this plan"));
      const dismiss = el("button", "ghost-button", "Dismiss");
      run.addEventListener("click", async () => {
        if (busy) return toast("Solar is still working.");
        actions.replaceChildren(el("span", "plan-status", "Approved"));
        await runTurn({ text: request, plan });
      });
      dismiss.addEventListener("click", () => actions.replaceChildren(el("span", "plan-status muted", "Dismissed")));
      actions.append(run, dismiss);
      card.append(header, renderMarkdown(plan), actions);
      body.append(card);
      avatar.classList.remove("working");
      status.textContent = "";
    },
    fail(message) {
      done();
      toggleLabel.textContent = summary();
      if (!stepCount) steps.remove();
      const card = el("div", "error-card");
      card.append(icon("alert"), el("span", "", message));
      body.append(card);
      avatar.classList.remove("working");
      avatar.classList.add("failed");
      status.textContent = "";
    }
  };

  function done() {
    clearInterval(timer);
    elapsed.textContent = formatElapsed((Date.now() - started) / 1000);
    status.classList.remove("shimmer");
    steps.classList.remove("open");
    for (const step of commands.values()) if (!step.classList.contains("done")) markDone(step);
  }

  function markDone(step) {
    step.classList.add("done");
    step.querySelector(".step-marker").replaceChildren(icon("check"));
    const label = step.querySelector(".step-label");
    if (label.textContent === "Running") label.textContent = "Ran";
  }

  function summary() {
    const seconds = formatElapsed((Date.now() - started) / 1000);
    return `Worked for ${seconds}${stepCount ? ` · ${stepCount} step${stepCount === 1 ? "" : "s"}` : ""}`;
  }

  function filesSummary() {
    const box = el("div", "files-summary");
    const header = el("div", "files-summary-head");
    let added = 0;
    let removed = 0;
    for (const file of files.values()) { added += file.added; removed += file.removed; }
    header.append(el("span", "", `${files.size} file${files.size === 1 ? "" : "s"} changed`), diffStat(added, removed));
    const review = el("button", "link-button", "Review all");
    review.addEventListener("click", () => toggleReview(true));
    header.append(review);
    box.append(header);
    for (const file of files.values()) {
      const merged = { ...file, hunks: file.diffs.flatMap(diff => diff.hunks) };
      box.append(fileCard(merged, { collapsed: true }));
    }
    return box;
  }
}

/** A collapsible file card: icon, path, +/- counts, and its diff. */
function fileCard(file, { preview, collapsed = false } = {}) {
  const card = el("div", `file-card${collapsed ? "" : " open"}`);
  const header = el("button", "file-card-head");
  const { dir, base } = splitName(file.name);
  const title = el("span", "file-title");
  if (dir) title.append(el("span", "file-dir", dir));
  title.append(el("span", "file-base", base));
  header.append(fileIcon(file.kind), title);
  if (file.kind === "added") header.append(el("span", "kind-badge added", "New"));
  if (file.kind === "deleted") header.append(el("span", "kind-badge deleted", "Deleted"));
  header.append(diffStat(file.added, file.removed), icon("chevron", "file-caret"));
  const open = el("button", "icon-button file-open");
  open.title = "Open in the Review panel";
  open.append(icon("expand"));
  open.addEventListener("click", event => { event.stopPropagation(); void toggleReview(true, file.path); });
  header.append(open);
  header.addEventListener("click", () => card.classList.toggle("open"));
  const body = el("div", "file-card-body");
  body.append(renderDiff(file, { limit: preview }));
  card.append(header, body);
  return card;
}

/** Maps a harness activity line to a timeline step. */
function classify(text) {
  let match;
  if ((match = text.match(/^Thinking: (.+)$/))) return { kind: "thinking", icon: "brain", label: match[1], status: match[1] };
  if ((match = text.match(/^Note: (.+)$/))) return { kind: "note", icon: "note", label: match[1], status: undefined };
  if ((match = text.match(/^Running command: (.+)$/))) return { kind: "command", icon: "terminal", label: "Running", detail: match[1], status: "Running a command" };
  if ((match = text.match(/^Command completed: (.+)$/))) return { kind: "command-done", detail: match[1], status: "Checking the output" };
  if ((match = text.match(/^Workspace: (.+)$/))) return { kind: "command", icon: "terminal", label: "Workspace", detail: match[1], status: "Running a command" };
  if ((match = text.match(/^Web search: (.+)$/))) return { kind: "web", icon: "search", label: capitalize(match[1]), status: capitalize(match[1]) };
  if ((match = text.match(/^Browser: (.+)$/))) return { kind: "web", icon: "globe", label: "Browser", detail: match[1], status: "Using the browser" };
  if ((match = text.match(/^Image: (.+)$/))) return { kind: "image", icon: "image", label: "Looking at", detail: match[1], status: `Looking at ${match[1]}` };
  if (text.startsWith("File: ")) return { kind: "file" };
  if ((match = text.match(/^(?:Plan|Review): (.+)$/))) return { kind: "stage", icon: "map", label: capitalize(match[1]), status: capitalize(match[1]) };
  if (/^Inspecting runtime operations/.test(text)) return { kind: "stage", icon: "map", label: text, status: text };
  if (/^\s*[{[]/.test(text)) return undefined;
  return { kind: "misc", icon: "dot", label: text };
}

// ---------- review panel and sidebar changes ----------

let changesTimer;
function scheduleChangesRefresh() { clearTimeout(changesTimer); changesTimer = setTimeout(() => void refreshChanges(), 400); }

async function refreshChanges() {
  try { reviewFiles = await window.solar.changes(); } catch { reviewFiles = []; }
  let added = 0;
  let removed = 0;
  for (const file of reviewFiles) { added += file.added; removed += file.removed; }
  const count = $("review-count");
  count.hidden = !reviewFiles.length;
  count.textContent = String(reviewFiles.length);
  $("side-stats").replaceChildren(...(reviewFiles.length ? [diffStat(added, removed)] : []));
  const side = $("side-changes");
  side.replaceChildren(...(reviewFiles.length ? reviewFiles.map(file => {
    const row = el("button", "side-file");
    const { dir, base } = splitName(file.name);
    const name = el("span", "side-file-name");
    name.append(el("span", "file-base", base));
    if (dir) name.append(el("span", "file-dir", dir.replace(/\/$/, "")));
    row.title = file.name;
    row.append(fileIcon(file.kind), name, diffStat(file.added, file.removed));
    row.addEventListener("click", () => void toggleReview(true, file.path));
    return row;
  }) : [el("div", "side-empty", "Files Solar edits will show up here.")]));
  if (!$("review").hidden) renderReview();
}

async function toggleReview(force, path) {
  const panel = $("review");
  const open = force ?? panel.hidden;
  panel.hidden = !open;
  $("app").classList.toggle("reviewing", open);
  $("review-toggle").classList.toggle("on", open);
  if (!open) return;
  if (path) reviewSelected = path;
  await refreshChanges();
}

function renderReview() {
  let added = 0;
  let removed = 0;
  for (const file of reviewFiles) { added += file.added; removed += file.removed; }
  $("review-totals").replaceChildren(el("span", "muted", `${reviewFiles.length} file${reviewFiles.length === 1 ? "" : "s"}`), diffStat(added, removed, { bar: true }));
  if (!reviewFiles.some(file => file.path === reviewSelected)) reviewSelected = reviewFiles[0]?.path;
  $("review-files").replaceChildren(...reviewFiles.map(file => {
    const row = el("button", `review-file${file.path === reviewSelected ? " selected" : ""}`);
    const { dir, base } = splitName(file.name);
    const name = el("span", "review-file-name");
    name.append(el("span", "file-base", base));
    if (dir) name.append(el("span", "file-dir", dir.replace(/\/$/, "")));
    row.append(fileIcon(file.kind), name, diffStat(file.added, file.removed));
    row.addEventListener("click", () => { reviewSelected = file.path; renderReview(); });
    return row;
  }));
  const diffBox = $("review-diff");
  const file = reviewFiles.find(item => item.path === reviewSelected);
  if (!file) {
    const empty = el("div", "review-empty");
    empty.append(icon("diff"), el("strong", "", "No changes yet"), el("span", "", "When Solar edits files, every change lands here as a diff you can review."));
    diffBox.replaceChildren(empty);
    return;
  }
  const head = el("div", "review-diff-head");
  const title = el("div", "file-title");
  const { dir, base } = splitName(file.name);
  if (dir) title.append(el("span", "file-dir", dir));
  title.append(el("span", "file-base", base));
  const actions = el("div", "review-actions");
  const openButton = el("button", "ghost-button small");
  openButton.append(icon("external"), document.createTextNode("Open"));
  openButton.addEventListener("click", () => void window.solar.openFile(file.path));
  const reveal = el("button", "ghost-button small");
  reveal.append(icon("folder"), document.createTextNode("Reveal"));
  reveal.addEventListener("click", () => void window.solar.revealFile(file.path));
  actions.append(openButton, reveal);
  head.append(fileIcon(file.kind), title, diffStat(file.added, file.removed), actions);
  diffBox.replaceChildren(head, renderDiff(file));
}

// ---------- keyboard ----------

document.addEventListener("keydown", event => {
  if (event.key === "Escape") { closeMenu(); return; }
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === "n") { event.preventDefault(); void newChat(); }
  else if (event.key.toLowerCase() === "o") { event.preventDefault(); void chooseWorkspace(); }
  else if (event.key === "\\") { event.preventDefault(); void toggleReview(); }
});

input.focus();

// ---------- helpers ----------

function formatElapsed(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m ${rest}s`;
  return minutes ? `${minutes}m ${rest}s` : `${seconds}s`;
}

function capitalize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
function basename(path) { return path.split(/[\\/]/).pop(); }
function fileUrl(path) { return `file:///${path.replace(/\\/g, "/").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/").replace(/^([A-Za-z])%3A/, "$1:")}`; }
function cleanError(error) { return String(error?.message ?? error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""); }

let toastTimer;
function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.hidden = false;
  requestAnimationFrame(() => element.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.classList.remove("show"); setTimeout(() => { element.hidden = true; }, 250); }, 3600);
}
