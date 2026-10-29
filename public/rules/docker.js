// Each rule: { id, category, severity, run(files) -> findings[] }
// A finding: { id, category, severity, pass, file }

const baseName = (path) => path.split("/").pop();
const isDockerfile = (f) => /^Dockerfile/i.test(baseName(f.path));

// Dockerfile lines without comments and blank lines
function cleanLines(content) {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

const FROM_RE = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i;

const rootRule = {
  id: "docker-user-root",
  category: "containers",
  severity: "high",
  run(files) {
    return files.filter(isDockerfile).map((f) => {
      const lines = cleanLines(f.content);
      // only the last build stage matters: that is the image that actually runs
      let lastFrom = 0;
      lines.forEach((l, i) => { if (/^FROM\s/i.test(l)) lastFrom = i; });
      const users = lines.slice(lastFrom).filter((l) => /^USER\s/i.test(l));
      const lastUser = users.length ? users[users.length - 1].split(/\s+/)[1] : null;
      const isRoot = !lastUser || lastUser === "root" || lastUser === "0" || lastUser.startsWith("root:");
      return { id: this.id, category: this.category, severity: this.severity, pass: !isRoot, file: f.path };
    });
  },
};

const latestRule = {
  id: "docker-latest",
  category: "containers",
  severity: "med",
  run(files) {
    return files.filter(isDockerfile).map((f) => {
      const stages = new Set();
      let bad = false;
      for (const line of cleanLines(f.content)) {
        const m = line.match(FROM_RE);
        if (!m) continue;
        const image = m[1];
        const alias = m[2];
        if (alias) stages.add(alias.toLowerCase());
        if (image.toLowerCase() === "scratch") continue;
        if (stages.has(image.toLowerCase())) continue; // refers to an earlier stage
        if (image.includes("$")) continue;             // version comes from a variable, cannot tell
        if (image.includes("@sha256:")) continue;      // pinned by digest
        const afterSlash = image.split("/").pop();
        const tag = afterSlash.includes(":") ? afterSlash.split(":")[1] : "";
        if (!tag || tag === "latest") bad = true;
      }
      return { id: this.id, category: this.category, severity: this.severity, pass: !bad, file: f.path };
    });
  },
};

const healthcheckRule = {
  id: "docker-healthcheck",
  category: "containers",
  severity: "low",
  run(files) {
    return files.filter(isDockerfile).map((f) => {
      const has = cleanLines(f.content).some((l) => /^HEALTHCHECK\s/i.test(l));
      return { id: this.id, category: this.category, severity: this.severity, pass: has, file: f.path };
    });
  },
};

export const dockerRules = [rootRule, latestRule, healthcheckRule];
