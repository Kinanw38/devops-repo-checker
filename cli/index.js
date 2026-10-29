#!/usr/bin/env node
// Local CLI: the same rule engine as the web demo, on a folder on your machine. Nothing is uploaded.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { selectFiles } from "../public/select.js";
import { runRules, splitIntentional } from "../public/rules/engine.js";
import { computeScore } from "../public/score.js";
import { buildSummary } from "../public/summary.js";
import { fixes } from "../public/rules/fixes.js";
import { strings } from "../public/i18n/strings.js";
import { getAiAdvice, ollamaBase } from "./ai.js";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "vendor", ".terraform", "__pycache__", ".venv"]);
const CLI_MAX_FILES = 5000;
const GROUPS = [["high", "fixFirst", "31"], ["med", "fixNext", "33"], ["low", "lowPriority", "90"]];

const HELP = `DevOps Repo Checker (local)

Usage: node cli/index.js <folder> [options]

  --lang en|he        report language (default: en). Hebrew is shown reversed in
                      many terminals, which is why English is the default
  --json              print the result as JSON
  --fixes             print an example fix under each problem
  --include-examples  also check tests/, examples/ and intentionally broken files
  --fail-under N      exit with code 1 if the score is below N
  --ai                add a short summary from your own local Ollama (optional)
  --model NAME        Ollama model for --ai (default: the first installed model)
  -h, --help          show this help

Ollama address: http://localhost:11434, or the OLLAMA_HOST environment variable.
`;

function parseArgs(argv) {
  const opts = { lang: "en", json: false, fixes: false, includeExamples: false, failUnder: null, ai: false, model: null, folder: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--fixes") opts.fixes = true;
    else if (a === "--include-examples") opts.includeExamples = true;
    else if (a === "--ai") opts.ai = true;
    else if (a === "--model") opts.model = value();
    else if (a === "--lang") {
      opts.lang = value();
      if (!["en", "he"].includes(opts.lang)) throw new Error("--lang must be en or he");
    } else if (a === "--fail-under") {
      opts.failUnder = Number(value());
      if (!Number.isFinite(opts.failUnder)) throw new Error("--fail-under needs a number");
    } else if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
    else if (opts.folder === null) opts.folder = a;
    else throw new Error("Only one folder is allowed");
  }
  return opts;
}

// Builds a GitHub-style tree: [{ path, type: "blob", size }] with forward slashes.
async function walk(root) {
  const tree = [];
  let ignoredDirs = 0;
  async function visit(dir, prefix) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const rel = prefix + e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) ignoredDirs++;
        else await visit(join(dir, e.name), rel + "/");
      } else if (e.isFile()) {
        tree.push({ path: rel, type: "blob", size: (await stat(join(dir, e.name))).size });
      }
    }
  }
  await visit(root, "");
  return { tree, ignoredDirs };
}

const verdictKey = (n) => (n >= 80 ? "great" : n >= 60 ? "good" : n >= 40 ? "needs" : "poor");

async function scanFolder(folder, { includeExamples = false, maxFiles = CLI_MAX_FILES } = {}) {
  const root = resolve(folder);
  const { tree, ignoredDirs } = await walk(root);
  const { selected, skippedList } = selectFiles(tree, { includeExamples, maxFiles });
  const loaded = await Promise.allSettled(selected.map(async (f) => ({ path: f.path, content: await readFile(join(root, f.path), "utf8") })));
  const files = loaded.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const unreadable = loaded.length - files.length;
  const { kept, intentional } = splitIntentional(files, includeExamples);
  const findings = runRules(kept, { allPaths: tree.map((e) => e.path) });
  const score = computeScore(findings);
  const skipped = {};
  for (const s of [...skippedList, ...intentional.map(() => ({ reason: "example" }))]) skipped[s.reason] = (skipped[s.reason] || 0) + 1;
  return { findings, score, summary: buildSummary(findings, score), scanned: kept.length, skipped, ignoredDirs, unreadable, maxFiles };
}

const failedFiles = (f) => f.items.filter((i) => !i.pass);

function toJson(r, ai) {
  return {
    score: r.score.overall,
    verdict: r.score.overall === null ? null : verdictKey(r.score.overall),
    categories: Object.fromEntries(Object.entries(r.score.categories).map(([k, c]) => [k, c.percent])),
    findings: r.findings.map((f) => ({
      id: f.id, category: f.category, severity: f.severity, pass: f.pass,
      files: failedFiles(f).map((i) => ({ file: i.file, detail: i.detail })),
    })),
    scanned: r.scanned,
    skipped: r.skipped,
    ignoredFolders: r.ignoredDirs,
    ...(ai ? { ai } : {}),
  };
}

function render(r, opts, ai) {
  const t = strings[opts.lang];
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const out = [];
  const overall = r.score.overall;

  out.push("", c("1", "DevOps Repo Checker"), "");
  if (overall === null) {
    out.push(t.noFindings);
  } else {
    const col = overall >= 80 ? "32" : overall >= 60 ? "33" : "31";
    out.push(`${t.scoreOutOf}: ${c("1;" + col, overall + " / 100")}  ${c(col, t.verdicts[verdictKey(overall)])}`);
    out.push(c("90", t.scoreBasis.replace("{n}", r.findings.length)), "");
    for (const [name, cat] of Object.entries(r.score.categories)) {
      const filled = Math.round(cat.percent / 5);
      const bar = "█".repeat(filled) + "░".repeat(20 - filled);
      out.push(`  ${(t.categories[name] || name).padEnd(24)} ${c(cat.percent >= 80 ? "32" : cat.percent >= 60 ? "33" : "31", bar)} ${String(cat.percent).padStart(3)}%`);
    }
  }

  const failed = r.findings.filter((f) => !f.pass);
  if (overall !== null && failed.length === 0) out.push("", c("32", t.noIssues));
  for (const [severity, key, col] of GROUPS) {
    const items = failed.filter((f) => f.severity === severity);
    if (items.length === 0) continue;
    out.push("", c("1;" + col, `${t[key]} (${items.length})`));
    for (const f of items) {
      const bad = failedFiles(f);
      out.push(`  ${c(col, "✗")} ${t.rules[f.id]?.fail || f.id}${bad.length > 1 ? ` (${bad.length})` : ""}`);
      for (const i of bad.slice(0, 5)) if (i.file) out.push(c("90", `      ${i.file}${i.detail ? ` - ${i.detail}` : ""}`));
      if (bad.length > 5) out.push(c("90", "      " + t.more.replace("{k}", bad.length - 5)));
      if (opts.fixes && fixes[f.id]) {
        out.push(c("36", `      ${t.fixLabel}:`));
        for (const line of fixes[f.id].split("\n")) out.push("        " + line);
      }
    }
  }

  const passed = r.findings.length - failed.length;
  if (passed > 0) out.push("", c("32", `${t.alreadyGood}: ${passed}`));

  if (ai) {
    out.push("", c("1", `AI (${ai.model}, local)`), "  " + ai.summary);
    ai.priorities.forEach((p, i) => out.push(`  ${i + 1}. ${p}`));
  }

  const skippedTotal = Object.values(r.skipped).reduce((a, b) => a + b, 0);
  out.push("", c("90", t.scanned.replace("{n}", r.scanned).replace("{m}", skippedTotal)));
  for (const [reason, n] of Object.entries(r.skipped)) {
    const text = reason === "limit" ? `Over the limit of ${r.maxFiles} files` : t.skipReasons[reason] || reason;
    out.push(c("90", `  ${n} - ${text}`));
  }
  if (r.ignoredDirs) out.push(c("90", `  ${r.ignoredDirs} folders ignored (${[...SKIP_DIRS].join(", ")})`));
  if (r.unreadable) out.push(c("90", "  " + t.failedNote.replace("{f}", r.unreadable)));
  out.push("");
  return out.join("\n");
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message + "\n\n" + HELP);
    return 2;
  }
  if (opts.help || !opts.folder) {
    console.log(HELP);
    return opts.help ? 0 : 2;
  }

  let result;
  try {
    result = await scanFolder(opts.folder, opts);
  } catch (err) {
    console.error(`Cannot read folder "${opts.folder}": ${err.message}`);
    return 2;
  }

  let ai = null;
  if (opts.ai && result.score.overall !== null) {
    const en = strings.en.rules;
    const failed = result.findings.filter((f) => !f.pass).map((f) => ({ severity: f.severity, text: en[f.id]?.fail || f.id, files: failedFiles(f).length }));
    if (failed.length) ai = await getAiAdvice({ failed, score: result.score.overall, lang: opts.lang, model: opts.model, base: ollamaBase() });
    if (!ai && failed.length) {
      console.error("AI summary skipped: Ollama is not running or did not answer. Start it (ollama serve), install a model (ollama pull llama3.2) and try again.");
    }
  }

  console.log(opts.json ? JSON.stringify(toJson(result, ai), null, 2) : render(result, opts, ai));
  return opts.failUnder !== null && result.score.overall !== null && result.score.overall < opts.failUnder ? 1 : 0;
}

process.exitCode = await main();
