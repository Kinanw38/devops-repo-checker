const SKIP_DIRS = ["node_modules/", ".git/", "dist/", "build/", "vendor/", ".terraform/", "__pycache__/", ".venv/"];
const GENERATED_NAMES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Pipfile.lock"];
const ALLOWED_EXT = [".tf", ".tfvars", ".py", ".js", ".ts", ".sh", ".json", ".yml", ".yaml", ".toml", ".cfg"];
const ALLOWED_NAMES = [".dockerignore", ".gitignore", "Jenkinsfile", ".gitlab-ci.yml", "requirements.txt", "package.json"];
const MAX_FILE_SIZE = 100 * 1024; // 100 KB
const MAX_FILES = 50;

// Example / scenario files are meant to be broken or to illustrate something, so they are not real findings.
const EXAMPLE_DIR = /(^|\/)(tests?|__tests__|fixtures?|examples?|samples?|demos?|testdata|scenarios?|mocks?)(\/|$)/i;
const PROBLEM_NAME = /(^|[^a-z])(problem|broken|faulty|insecure|vulnerable|chaos|bad)([^a-z]|$)/i;
const FIX_NAME = /(^|[^a-z])(fix|fixed|solution|resolved|good|correct)([^a-z]|$)/i;

const dirOf = (path) => path.split("/").slice(0, -1).join("/");

// Returns why a file is skipped, or null if it is fine.
// Reasons: dir | generated | example | type | large
function skipReason({ path, size }, scenarioDirs, includeExamples) {
  if (SKIP_DIRS.some((d) => path.startsWith(d) || path.includes("/" + d))) return "dir";
  const name = path.split("/").pop();
  if (GENERATED_NAMES.includes(name) || name.includes(".tfstate") || name.endsWith(".min.js")) return "generated";
  if (!includeExamples && (EXAMPLE_DIR.test(path) || scenarioDirs.has(dirOf(path)))) return "example";
  const nameOk =
    /^(Dockerfile|docker-compose|README|LICENSE|COPYING)/i.test(name) ||
    ALLOWED_NAMES.includes(name) ||
    ALLOWED_EXT.includes(name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "");
  if (!nameOk) return "type";
  if (size > MAX_FILE_SIZE) return "large";
  return null;
}

// Lower number = more important (kept first if there are too many files)
function priority(path) {
  const name = path.split("/").pop();
  if (/^Dockerfile/i.test(name) || path.startsWith(".github/workflows/")) return 1;
  if (name === "Jenkinsfile" || name === ".gitlab-ci.yml") return 1;
  if (path.endsWith(".tf")) return 2;
  if (/\.ya?ml$/.test(path)) return 3;
  if (/^README/i.test(name) || name === ".gitignore") return 4;
  return 5;
}

export function selectFiles(tree, { includeExamples = false, maxFiles = MAX_FILES } = {}) {
  const blobs = tree.filter((e) => e.type === "blob"); // files only, not folders

  // A scenario folder holds a "problem" file AND a "fix" file side by side.
  // A single file with a suspicious name is NOT enough, so real files are not skipped by mistake.
  const seen = {};
  for (const f of blobs) {
    const dir = dirOf(f.path);
    if (!dir) continue;
    const name = f.path.split("/").pop();
    const entry = (seen[dir] ||= { problem: false, fix: false });
    if (PROBLEM_NAME.test(name)) entry.problem = true;
    if (FIX_NAME.test(name)) entry.fix = true;
  }
  const scenarioDirs = new Set(Object.keys(seen).filter((d) => seen[d].problem && seen[d].fix));

  const allowed = [];
  const skippedList = [];
  for (const f of blobs) {
    const reason = skipReason(f, scenarioDirs, includeExamples);
    if (reason) skippedList.push({ path: f.path, reason });
    else allowed.push(f);
  }
  allowed.sort((a, b) => priority(a.path) - priority(b.path));
  const selected = allowed.slice(0, maxFiles);
  allowed.slice(maxFiles).forEach((f) => skippedList.push({ path: f.path, reason: "limit" }));
  return { selected, skipped: skippedList.length, skippedList };
}
