import { dockerRules } from "./docker.js";
import { k8sRules, parseManifests } from "./k8s.js";
import { cicdRules } from "./cicd.js";
import { terraformRules } from "./terraform.js";
import { securityRules } from "./security.js";
import { hygieneRules } from "./hygiene.js";

const ALL_RULES = [...dockerRules, ...k8sRules, ...cicdRules, ...terraformRules, ...securityRules, ...hygieneRules];

// Rules report one result per file. Here they are merged into one finding per rule,
// so a repo with ten manifests does not show the same problem ten times (and the score is not skewed).
function aggregate(results) {
  const byId = new Map();
  for (const r of results) {
    const g = byId.get(r.id) || { id: r.id, category: r.category, severity: r.severity, pass: true, items: [] };
    g.items.push({ file: r.file, detail: r.detail || "", pass: r.pass });
    if (!r.pass) g.pass = false;
    byId.set(r.id, g);
  }
  return [...byId.values()].map((g) => ({ ...g, file: (g.items.find((i) => !i.pass) || g.items[0]).file }));
}

export function runRules(files, extra = {}) {
  // the YAML is parsed only once, and only if a rule asks for it
  let cache = null;
  const ctx = {
    allPaths: extra.allPaths || files.map((f) => f.path), // every path in the repo, including skipped ones
    get manifests() {
      if (!cache) cache = parseManifests(files);
      return cache;
    },
  };
  const results = [];
  for (const rule of ALL_RULES) {
    try {
      results.push(...rule.run(files, ctx));
    } catch (err) {
      // a broken rule must never break the whole scan
      console.warn("Rule failed:", rule.id, err);
    }
  }
  return aggregate(results);
}

// Files that declare themselves as intentionally broken / demo / ignored are not real findings.
const INTENT_MARKERS = [
  /devops-checker:\s*ignore/i,
  /\bintentional(ly)?\b/i,
  /\bdeliberate(ly)?\b/i,
  /\bon purpose\b/i,
  /\bbroken by design\b/i,
  /\bdemo[- ]only\b|\bfor demo\b/i,
  /^\s*[\w.\/-]*(incident|chaos|simulat)[\w.\/-]*\s*:/im, // e.g. a label like  sim-incident: oomkilled
];
const INFRA_FILE = /(\.ya?ml|\.tf|\.tfvars)$|(^|\/)Dockerfile/i;

export function splitIntentional(files, includeExamples = false) {
  if (includeExamples) return { kept: files, intentional: [] };
  const kept = [];
  const intentional = [];
  for (const f of files) {
    const marked = INFRA_FILE.test(f.path) && INTENT_MARKERS.some((re) => re.test(f.content));
    (marked ? intentional : kept).push(f);
  }
  return { kept, intentional };
}
