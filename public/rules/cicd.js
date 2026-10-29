// CI/CD checks. They only run when the repo has code or infrastructure to build, and the pipeline rules only if a pipeline exists.
const isWorkflow = (p) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(p);
const isCi = (p) =>
  isWorkflow(p) ||
  /(^|\/)(Jenkinsfile|\.gitlab-ci\.yml|\.travis\.yml|azure-pipelines\.yml|bitbucket-pipelines\.yml)$/i.test(p) ||
  /(^|\/)\.circleci\/config\.yml$/i.test(p);
const HAS_CODE = /(\.(py|js|ts|go|java|rb|php|cs|rs|sh|tf)$)|(^|\/)Dockerfile/i;
const HAS_APP_CODE = /\.(py|js|ts|go|java|rb|php|cs|rs)$/i;
const TEST_PATH = /(^|\/)(tests?|__tests__|specs?)(\/|$)|(^|\/)test_[^/]+\.py$|_test\.(py|go)$|\.(test|spec)\.[cm]?[jt]sx?$/i;
const TEST_STEP = /\b(tests?|pytest|unittest|jest|vitest|mocha|cypress|playwright|tox|rspec|phpunit|terraform validate|terraform plan|tflint|flake8|ruff|pylint|eslint|mypy|golangci-lint|helm lint|kubeconform|kubeval|yamllint|hadolint|shellcheck)\b/i;
const SECURITY_STEP = /\b(trivy|snyk|codeql|gitleaks|trufflehog|bandit|semgrep|checkov|tfsec|grype|osv-scanner|pip-audit|npm audit|dependency-review|sonarcloud|sonarqube|anchore|kics|terrascan|detect-secrets)\b/i;
const FLOATING_REF = /^(main|master|latest|dev|develop|trunk|head)$/i;

const ciFiles = (files) => files.filter((f) => isCi(f.path));
const hasCode = (ctx) => ctx.allPaths.some((p) => HAS_CODE.test(p));

const ciExists = {
  id: "ci-exists", category: "cicd", severity: "med",
  run(files, ctx) {
    if (!hasCode(ctx)) return [];
    return [{ id: this.id, category: this.category, severity: this.severity, pass: ctx.allPaths.some(isCi), file: "" }];
  },
};

const ciTests = {
  id: "ci-tests", category: "cicd", severity: "med",
  run(files) {
    const ci = ciFiles(files);
    if (ci.length === 0) return [];
    const pass = ci.some((f) => TEST_STEP.test(f.content));
    return [{ id: this.id, category: this.category, severity: this.severity, pass, file: ci[0].path, detail: "" }];
  },
};

const ciPinned = {
  id: "ci-pinned-actions", category: "cicd", severity: "med",
  run(files) {
    return files.filter((f) => isWorkflow(f.path)).map((f) => {
      const bad = [];
      for (const m of f.content.matchAll(/^\s*-?\s*uses:\s*([^\s#'"]+)/gm)) {
        const spec = m[1];
        if (spec.startsWith("./") || spec.startsWith("docker://") || !spec.includes("@")) continue;
        const ref = spec.split("@").pop();
        if (FLOATING_REF.test(ref)) bad.push(spec);
      }
      return { id: this.id, category: this.category, severity: this.severity, pass: bad.length === 0, file: f.path, detail: bad.join(", ") };
    });
  },
};

const ciPermissions = {
  id: "ci-permissions", category: "cicd", severity: "low",
  run(files) {
    return files.filter((f) => isWorkflow(f.path)).map((f) => ({
      id: this.id, category: this.category, severity: this.severity,
      pass: /^\s*permissions\s*:/m.test(f.content), file: f.path, detail: "",
    }));
  },
};

const ciSecurity = {
  id: "ci-security", category: "cicd", severity: "med",
  run(files, ctx) {
    const ci = ciFiles(files);
    if (ci.length === 0) return [];
    const pass =
      ci.some((f) => SECURITY_STEP.test(f.content)) ||
      ctx.allPaths.some((p) => /^\.github\/dependabot\.ya?ml$/i.test(p) || /(^|\/)renovate\.json5?$/i.test(p));
    return [{ id: this.id, category: this.category, severity: this.severity, pass, file: ci[0].path, detail: "" }];
  },
};

const testsExist = {
  id: "tests-exist", category: "cicd", severity: "med",
  run(files, ctx) {
    if (!ctx.allPaths.some((p) => HAS_APP_CODE.test(p))) return [];
    return [{ id: this.id, category: this.category, severity: this.severity, pass: ctx.allPaths.some((p) => TEST_PATH.test(p)), file: "" }];
  },
};

export const cicdRules = [ciExists, ciTests, ciPinned, ciPermissions, ciSecurity, testsExist];
