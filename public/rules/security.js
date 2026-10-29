// Secrets. The secret value itself is NEVER shown: only the kind of secret and the line number.
const SECRET_PATTERNS = [
  { name: "AWS access key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "AWS secret key", re: /aws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9\/+=]{40}["']?/gi },
  { name: "Private key", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Stripe live key", re: /\bsk_live_[0-9a-zA-Z]{20,}\b/g },
];

const secretsInCode = {
  id: "secrets-in-code", category: "security", severity: "high",
  run(files) {
    const results = [];
    for (const f of files) {
      if (/\.mdx?$/i.test(f.path)) continue; // docs often contain examples
      const found = [];
      for (const { name, re } of SECRET_PATTERNS) {
        for (const m of f.content.matchAll(re)) {
          if (/EXAMPLE|PLACEHOLDER|XXXX/i.test(m[0])) continue; // documented fake values
          const line = f.content.slice(0, m.index).split("\n").length;
          found.push(`${name} (line ${line})`);
        }
      }
      if (found.length) results.push({ id: this.id, category: this.category, severity: this.severity, pass: false, file: f.path, detail: found.join(", ") });
    }
    if (results.length === 0) results.push({ id: this.id, category: this.category, severity: this.severity, pass: true, file: "", detail: "" });
    return results;
  },
};

const SECRET_FILES = [
  /(^|\/)\.env(\.(?!example|sample|template|dist|defaults?$)[\w.-]+)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/,
  /\.tfstate(\.backup)?$/i,
];

const secretFiles = {
  id: "committed-secret-files", category: "security", severity: "high",
  run(files, ctx) {
    const bad = ctx.allPaths.filter((p) => SECRET_FILES.some((re) => re.test(p)));
    if (bad.length === 0) return [{ id: this.id, category: this.category, severity: this.severity, pass: true, file: "", detail: "" }];
    return bad.map((p) => ({ id: this.id, category: this.category, severity: this.severity, pass: false, file: p, detail: "" }));
  },
};

export const securityRules = [secretsInCode, secretFiles];
