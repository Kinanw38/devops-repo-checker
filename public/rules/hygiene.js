// Basic repository hygiene.
const readme = {
  id: "docs-readme", category: "docs", severity: "low",
  run(files) {
    const f = files.find((x) => /^README/i.test(x.path) && !x.path.includes("/"));
    const pass = Boolean(f) && f.content.trim().length >= 200;
    return [{ id: this.id, category: this.category, severity: this.severity, pass, file: f ? f.path : "", detail: "" }];
  },
};

const license = {
  id: "docs-license", category: "docs", severity: "low",
  run(files, ctx) {
    return [{ id: this.id, category: this.category, severity: this.severity, pass: ctx.allPaths.some((p) => /^(LICENSE|LICENCE|COPYING)(\.\w+)?$/i.test(p)), file: "", detail: "" }];
  },
};

const gitignore = {
  id: "docs-gitignore", category: "docs", severity: "low",
  run(files, ctx) {
    return [{ id: this.id, category: this.category, severity: this.severity, pass: ctx.allPaths.includes(".gitignore"), file: "", detail: "" }];
  },
};

export const hygieneRules = [readme, license, gitignore];
