import { strings } from "./i18n/strings.js";
import { parseRepoUrl, fetchTree, loadFiles } from "./github.js";
import { selectFiles } from "./select.js";
import { runRules, splitIntentional } from "./rules/engine.js";
import { fixes } from "./rules/fixes.js";
import { computeScore } from "./score.js";
import { buildSummary } from "./summary.js";

let lang = "he";
try { lang = localStorage.getItem("lang") || "he"; } catch {}
let theme = document.documentElement.dataset.theme || "light";

// What the report box currently shows. Kept so it can be redrawn when the language changes.
// { type: "message", key } | { type: "progress", current, n } | { type: "summary", ... }
let state = null;

const STEP_KEYS = ["stepRead", "stepSelect", "stepDownload", "stepChecks"];
const SEVERITY_GROUPS = [["high", "fixFirst"], ["med", "fixNext"], ["low", "lowPriority"]];
const SKIP_ORDER = ["example", "dir", "generated", "type", "large", "limit"];
const MAX_LISTED = 20;
const MAX_FINDING_FILES = 4;
const SVGNS = "http://www.w3.org/2000/svg";

const $ = (id) => document.getElementById(id);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// In Hebrew, wrap English words so they keep their own direction and do not "stick" to the Hebrew text.
function bidi(text) {
  if (lang !== "he") return text;
  const word = "[A-Za-z0-9][A-Za-z0-9_\\/+\\-]*(?:[.:][A-Za-z0-9_\\/+\\-]+)*";
  const re = new RegExp(word + "(?:\\s+" + word + ")*", "g");
  return text.replace(re, (m) => (/[A-Za-z]/.test(m) ? "\u2066" + m + "\u2069" : m));
}

const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text; // textContent only, never innerHTML
  if (cls) node.className = cls;
  return node;
};

const svg = (tag, attrs) => {
  const node = document.createElementNS(SVGNS, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
};

const scoreColor = (n) => (n >= 80 ? "var(--ok)" : n >= 50 ? "var(--accent)" : "var(--bad)");

// Built once and then updated in place, so the CSS transitions can animate smoothly.
function renderProgress(box) {
  const t = strings[lang];
  let wrap = box.querySelector(".progress");
  if (!wrap) {
    box.textContent = "";
    wrap = el("div", undefined, "progress");
    const ul = el("ul", undefined, "steps");
    STEP_KEYS.forEach(() => {
      const li = el("li");
      li.appendChild(el("span", undefined, "step-text"));
      li.appendChild(el("span", undefined, "cursor"));
      ul.appendChild(li);
    });
    const track = el("div", undefined, "bar-track wide");
    track.appendChild(el("div", undefined, "bar-fill"));
    wrap.appendChild(ul);
    wrap.appendChild(track);
    box.appendChild(wrap);
  }
  wrap.querySelectorAll(".steps li").forEach((li, i) => {
    li.className = i < state.current ? "done" : i === state.current ? "active" : "pending";
    li.querySelector(".step-text").textContent = bidi(t[STEP_KEYS[i]].replace("{n}", state.n ?? "\u2026"));
  });
  // +1 so the bar is never empty and keeps moving while the current step runs
  wrap.querySelector(".bar-fill").style.width = Math.round(((state.current + 0.6) / STEP_KEYS.length) * 100) + "%";
}

const verdictKey = (n) => (n >= 80 ? "great" : n >= 60 ? "good" : n >= 40 ? "needs" : "poor");

// Puts the number exactly in the middle of the ring, whatever the font is:
// measure the real height of the digits and move the baseline by half of it.
function centerRingNumber(num, pct, value) {
  const apply = () => {
    try {
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = `700 30px ${getComputedStyle(num).fontFamily}`;
      const m = ctx.measureText(String(value));
      const y = 50 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      num.setAttribute("y", y);
      pct.setAttribute("x", 50 + m.width / 2 + 2);
      pct.setAttribute("y", y - m.actualBoundingBoxAscent + 8);
    } catch { /* no canvas support: the default position is used */ }
  };
  apply();
  if (document.fonts && document.fonts.load) document.fonts.load("700 30px Heebo").then(apply).catch(() => {});
}

function renderScore(score, checks) {
  const t = strings[lang];
  const wrap = el("div", undefined, "score");

  const C = 2 * Math.PI * 42;
  const ring = svg("svg", { viewBox: "0 0 100 100", class: "ring", role: "img", "aria-label": `${t.scoreOutOf}: ${score.overall}` });
  ring.appendChild(svg("circle", { cx: 50, cy: 50, r: 42, class: "ring-track" }));
  const arc = svg("circle", { cx: 50, cy: 50, r: 42, class: "ring-arc", "stroke-dasharray": C, "stroke-dashoffset": C });
  arc.style.stroke = scoreColor(score.overall);
  ring.appendChild(arc);
  const ringWrap = el("div", undefined, "ring-wrap");
  const num = svg("text", { x: 50, y: 62, "text-anchor": "middle", class: "ring-svg-number" });
  num.textContent = String(score.overall);
  const pct = svg("text", { x: 72, y: 44, "text-anchor": "start", class: "ring-svg-pct" });
  pct.textContent = "%";
  ring.appendChild(num);
  ring.appendChild(pct);
  ringWrap.appendChild(ring);
  centerRingNumber(num, pct, score.overall);

  const ringBox = el("div", undefined, "ring-box");
  ringBox.appendChild(ringWrap);
  ringBox.appendChild(el("div", t.scoreOutOf, "ring-label"));
  const verdict = el("div", t.verdicts[verdictKey(score.overall)], "ring-verdict");
  verdict.style.color = scoreColor(score.overall);
  ringBox.appendChild(verdict);
  ringBox.appendChild(el("div", t.scoreBasis.replace("{n}", checks), "ring-basis"));
  wrap.appendChild(ringBox);

  const bars = el("div", undefined, "bars");
  const fills = [];
  Object.entries(score.categories).forEach(([name, c]) => {
    const row = el("div", undefined, "bar-row");
    row.appendChild(el("span", bidi(t.categories[name] || name)));
    const track = el("div", undefined, "bar-track");
    const fill = el("div", undefined, "bar-fill");
    fill.style.background = scoreColor(c.percent);
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el("span", c.percent + "%", "bar-num"));
    bars.appendChild(row);
    fills.push([fill, c.percent]);
  });
  wrap.appendChild(bars);

  // animate after the element is in the page
  setTimeout(() => {
    arc.setAttribute("stroke-dashoffset", C * (1 - score.overall / 100));
    fills.forEach(([fill, percent]) => { fill.style.width = percent + "%"; });
  }, 60);
  return wrap;
}

// A ready-to-copy fix, written by hand (never by the AI)
function fixBlock(id) {
  const t = strings[lang];
  const wrap = el("div", undefined, "fix");
  const head = el("div", undefined, "fix-label");
  head.appendChild(el("span", t.fixLabel));
  const copy = el("button", t.copy, "ghost small");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(fixes[id]);
      copy.textContent = strings[lang].copied;
      setTimeout(() => { copy.textContent = strings[lang].copy; }, 1500);
    } catch { /* clipboard not available, nothing to do */ }
  });
  head.appendChild(copy);
  wrap.appendChild(head);
  const pre = el("pre");
  pre.appendChild(el("code", fixes[id]));
  wrap.appendChild(pre);
  return wrap;
}

function findingItem(f, withWhy) {
  const t = strings[lang];
  const info = t.rules[f.id] || { fail: f.id, pass: f.id, why: "" };
  const items = f.items || [{ file: f.file, detail: f.detail, pass: f.pass }];
  const shown = f.pass ? items : items.filter((i) => !i.pass);
  const title = bidi(f.pass ? info.pass : info.fail);

  const files = el("div", undefined, "body");
  shown.slice(0, MAX_FINDING_FILES).forEach((i) => {
    if (i.file) files.appendChild(el("code", i.file, "file")); // some checks are about the whole repo
    if (i.detail) files.appendChild(el("div", i.detail, "detail"));
  });
  if (shown.length > MAX_FINDING_FILES) {
    files.appendChild(el("div", t.more.replace("{k}", shown.length - MAX_FINDING_FILES), "detail"));
  }

  const li = el("li", undefined, f.pass ? "pass" : "fail");

  if (!withWhy) { // compact "already good" row
    li.appendChild(el("span", "\u2713", "mark"));
    const body = el("div", undefined, "body");
    body.appendChild(el("div", title, "title"));
    body.appendChild(files);
    li.appendChild(body);
    return li;
  }

  const head = el("span", undefined, "finding-head");
  head.appendChild(el("span", "\u2717", "mark"));
  head.appendChild(el("span", title, "title"));
  if (shown.length > 1) head.appendChild(el("span", `(${shown.length})`, "count"));

  const content = el("div", undefined, "body");
  content.appendChild(files);
  content.appendChild(el("p", bidi(info.why), "why"));
  if (fixes[f.id]) content.appendChild(fixBlock(f.id));
  li.appendChild(collapsible("f-" + f.id, head, content));
  return li;
}

function renderGroups(findings) {
  const t = strings[lang];
  const nodes = [];
  const failed = findings.filter((f) => !f.pass);
  const passed = findings.filter((f) => f.pass);

  if (findings.length === 0) {
    nodes.push(el("p", t.noFindings));
    return nodes;
  }
  if (failed.length === 0) nodes.push(el("p", t.noIssues));

  SEVERITY_GROUPS.forEach(([severity, key]) => {
    const items = failed.filter((f) => f.severity === severity);
    if (items.length === 0) return;
    const group = el("div", undefined, "group " + severity);
    group.appendChild(el("h4", `${t[key]} (${items.length})`));
    const ul = el("ul", undefined, "findings");
    items.forEach((f) => ul.appendChild(findingItem(f, true)));
    group.appendChild(ul);
    nodes.push(group);
  });

  if (passed.length > 0) {
    const group = el("div", undefined, "group good");
    group.appendChild(el("h4", `${t.alreadyGood} (${passed.length})`));
    const ul = el("ul", undefined, "findings compact");
    passed.forEach((f) => ul.appendChild(findingItem(f, false)));
    group.appendChild(ul);
    nodes.push(group);
  }
  return nodes;
}

const GROUP_ORDER = ["docker", "ci", "terraform", "yaml", "code", "config", "docs"];

function fileGroup(path) {
  const name = path.split("/").pop();
  if (/^Dockerfile/i.test(name) || /^docker-compose/i.test(name) || name === ".dockerignore") return "docker";
  if (path.startsWith(".github/workflows/") || name === "Jenkinsfile" || name === ".gitlab-ci.yml") return "ci";
  if (/\.tf(vars)?$/.test(name)) return "terraform";
  if (/\.ya?ml$/.test(name)) return "yaml";
  if (/\.(py|js|ts|sh)$/.test(name)) return "code";
  if (/^README/i.test(name) || name === ".gitignore") return "docs";
  return "config";
}

// folder part is dimmed, file name is normal
function pathChip(path) {
  const li = el("li");
  const code = el("code");
  const i = path.lastIndexOf("/");
  if (i >= 0) code.appendChild(el("span", path.slice(0, i + 1), "dir"));
  code.appendChild(document.createTextNode(path.slice(i + 1)));
  li.appendChild(code);
  return li;
}

function chipList(paths, max) {
  const ul = el("ul", undefined, "paths");
  paths.slice(0, max || paths.length).forEach((p) => ul.appendChild(pathChip(p)));
  if (max && paths.length > max) {
    ul.appendChild(el("li", strings[lang].more.replace("{k}", paths.length - max), "more"));
  }
  return ul;
}

// A panel that opens AND closes with an animation (the open/closed state survives a language switch).
function collapsible(key, title, content) {
  const open = Boolean(state.open && state.open[key]);
  const wrap = el("div", undefined, "collapsible" + (open ? " open" : ""));
  const button = el("button", undefined, "toggle");
  button.type = "button";
  button.setAttribute("aria-expanded", String(open));
  button.appendChild(el("span", undefined, "arrow"));
  button.appendChild(typeof title === "string" ? el("span", title) : title);
  const panel = el("div", undefined, "panel");
  const inner = el("div", undefined, "panel-inner");
  inner.appendChild(content);
  panel.appendChild(inner);
  button.addEventListener("click", () => {
    const now = !wrap.classList.contains("open");
    wrap.classList.toggle("open", now);
    button.setAttribute("aria-expanded", String(now));
    state.open = { ...(state.open || {}), [key]: now };
  });
  wrap.appendChild(button);
  wrap.appendChild(panel);
  return wrap;
}

function renderSkipped(skippedList) {
  const t = strings[lang];
  if (skippedList.length === 0) return null;
  const content = el("div");
  SKIP_ORDER.forEach((reason) => {
    const items = skippedList.filter((s) => s.reason === reason);
    if (items.length === 0) return;
    content.appendChild(el("p", bidi(`${t.skipReasons[reason]}: ${items.length}`), "skip-reason"));
    content.appendChild(chipList(items.map((s) => s.path), MAX_LISTED));
  });
  return collapsible("skipped", t.skippedH.replace("{m}", skippedList.length), content);
}

function renderFiles(files) {
  const t = strings[lang];
  const content = el("div");
  GROUP_ORDER.forEach((group) => {
    const items = files.filter((f) => fileGroup(f.path) === group);
    if (items.length === 0) return;
    content.appendChild(el("p", bidi(`${t.fileGroups[group]} (${items.length})`), "skip-reason"));
    content.appendChild(chipList(items.map((f) => f.path)));
  });
  return collapsible("files", t.filesH.replace("{n}", files.length), content);
}

function renderResults(box) {
  const t = strings[lang];
  const sections = [];
  sections.push(el("p", t.scanned.replace("{n}", state.files.length).replace("{m}", state.skipped)));
  if (state.failed > 0) sections.push(el("p", t.failedNote.replace("{f}", state.failed)));
  // Example / scenario files are skipped by default. The offer to check them appears only when it is relevant.
  const exampleCount = state.skippedList.filter((s) => s.reason === "example").length;
  if (exampleCount > 0 && !state.includedExamples) {
    const note = el("p", undefined, "note");
    note.appendChild(document.createTextNode(
      (state.demoLike ? t.demoNote + " " : "") + t.examplesSkipped.replace("{n}", exampleCount) + " "
    ));
    const again = el("button", t.checkAnyway, "ghost small");
    again.type = "button";
    again.addEventListener("click", () => scan({ includeExamples: true }));
    note.appendChild(again);
    sections.push(note);
  } else if (state.demoLike) {
    sections.push(el("p", t.demoNote, "note"));
  }
  if (state.includedExamples) sections.push(el("p", t.examplesIncluded, "note"));
  if (state.score.overall !== null) sections.push(renderScore(state.score, state.findings.length));
  const summaryBox = renderSummaryBox();
  if (summaryBox) sections.push(summaryBox);
  sections.push(...renderGroups(state.findings));
  const skipped = renderSkipped(state.skippedList);
  if (skipped) sections.push(skipped);
  sections.push(renderFiles(state.files));

  const animate = !state.shown; // reveal only the first time, not when switching language
  state.shown = true;
  sections.forEach((node, i) => {
    if (animate) {
      node.classList.add("reveal");
      node.style.animationDelay = i * 110 + "ms";
    }
    box.appendChild(node);
  });
}

function render() {
  const box = $("report");
  if (!state) { box.hidden = true; return; }
  box.hidden = false;
  if (state.type === "progress") return renderProgress(box);
  box.textContent = "";
  if (state.type === "message") box.textContent = bidi(strings[lang][state.key]);
  else renderResults(box);
}

function applyTheme() {
  document.documentElement.dataset.theme = theme;
  $("theme-toggle").textContent = strings[lang][theme === "dark" ? "themeLight" : "themeDark"];
}

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = strings[lang][node.dataset.i18n];
  });
  $("repo-url").placeholder = strings[lang].placeholder;
  applyTheme();
  render();
}

function switchLang() {
  const sheet = document.querySelector(".sheet");
  sheet.classList.add("fading");
  setTimeout(() => {
    lang = lang === "he" ? "en" : "he";
    try { localStorage.setItem("lang", lang); } catch {}
    applyLang();
    sheet.classList.remove("fading");
  }, 160);
}

function switchTheme() {
  theme = theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("theme", theme); } catch {}
  applyTheme();
}

// A hint only: the repo name or README suggests a demo / simulator, where some "problems" are on purpose.
function looksLikeDemo(repo, files) {
  if (/(simulat|demo|playground|sandbox|tutorial|workshop|training|chaos|example)/i.test(repo)) return true;
  const readme = files.find((f) => /^README/i.test(f.path) && !f.path.includes("/"));
  return Boolean(readme && /(simulat|tutorial|workshop|playground|chaos engineering|demonstrat)/i.test(readme.content.slice(0, 1500)));
}

// ---------- summary: what to fix first (calculated from the results, no server needed) ----------
function renderSummaryBox() {
  const t = strings[lang];
  const sum = buildSummary(state.findings, state.score);
  if (sum.total === 0) return null;
  const box = el("div", undefined, "summary-box");
  box.appendChild(el("div", t.summaryTitle, "summary-title"));
  if (sum.failed === 0) {
    box.appendChild(el("p", t.summaryAllGood));
    return box;
  }
  const parts = [["high", "sevHigh"], ["med", "sevMed"], ["low", "sevLow"]]
    .filter(([sev]) => sum.counts[sev] > 0)
    .map(([sev, key]) => t[key].replace("{n}", sum.counts[sev]));
  let text = t.summaryCounts.replace("{f}", sum.failed).replace("{c}", sum.total).replace("{parts}", parts.join(", "));
  if (sum.weakest) {
    text += " " + t.summaryWeakest.replace("{cat}", t.categories[sum.weakest.name] || sum.weakest.name).replace("{p}", sum.weakest.percent);
  }
  box.appendChild(el("p", bidi(text)));
  box.appendChild(el("p", t.summaryFirst, "summary-first"));
  const list = el("ol");
  sum.priorities.forEach((id) => {
    const info = t.rules[id] || { fail: id, why: "" };
    const firstSentence = info.why.split(". ")[0].replace(/\.$/, "");
    list.appendChild(el("li", bidi(info.why ? `${info.fail}: ${firstSentence}.` : info.fail)));
  });
  box.appendChild(list);
  return box;
}

async function scan(options) {
  const parsed = parseRepoUrl($("repo-url").value);
  if (!parsed) { state = { type: "message", key: "errBadUrl" }; return render(); }

  const includeExamples = Boolean(options && options.includeExamples);
  const button = $("scan");
  button.disabled = true;
  button.classList.add("busy");
  button.textContent = strings[lang].scanning;

  try {
    state = { type: "progress", current: 0 };
    render();
    const { tree } = await fetchTree(parsed);
    await pause(400);

    state = { type: "progress", current: 1 };
    render();
    const { selected, skipped, skippedList } = selectFiles(tree, { includeExamples });
    await pause(450);

    state = { type: "progress", current: 2, n: selected.length };
    render();
    const { files, failed } = await loadFiles(parsed, selected);
    await pause(300);

    state = { type: "progress", current: 3, n: selected.length };
    render();
    const { kept, intentional } = splitIntentional(files, includeExamples);
    const allPaths = tree.filter((e) => e.type === "blob").map((e) => e.path);
    const findings = runRules(kept, { allPaths });
    const score = computeScore(findings);
    await pause(550);
    const progressBox = $("report").querySelector(".progress");
    if (progressBox) { progressBox.classList.add("leaving"); await pause(300); }

    const allSkipped = [...skippedList, ...intentional.map((f) => ({ path: f.path, reason: "example" }))];
    const demoLike = looksLikeDemo(parsed.repo, files);
    state = { type: "summary", files: kept, skipped: allSkipped.length, skippedList: allSkipped, failed, findings, score, demoLike, includedExamples: includeExamples, shown: false };
  } catch (err) {
    const map = { NOT_FOUND: "errNotFound", RATE_LIMIT: "errRate" };
    state = { type: "message", key: map[err.message] || "errGeneric" };
  } finally {
    button.disabled = false;
    button.classList.remove("busy");
    button.textContent = strings[lang].scan;
    render();
  }
}

$("lang-toggle").addEventListener("click", switchLang);
$("theme-toggle").addEventListener("click", switchTheme);
$("scan").addEventListener("click", () => scan());

applyLang();
