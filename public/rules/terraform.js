// Terraform checks (plain text analysis, no HCL parser). They only run if the repo has .tf files.
const tfFiles = (files) => files.filter((f) => /\.tf$/i.test(f.path));

// Finds  header { ... }  blocks, matching nested braces. The header regex must end with \{
function extractBlocks(text, headerRe) {
  const out = [];
  const re = new RegExp(headerRe.source, "g");
  let m;
  while ((m = re.exec(text))) {
    let i = re.lastIndex;
    const start = i;
    let depth = 1;
    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    }
    out.push({ match: m, body: text.slice(start, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

const RESOURCE = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/;
const resources = (text) => extractBlocks(text, RESOURCE).map((b) => ({ type: b.match[1], name: b.match[2], body: b.body }));

function openToWorld(ruleText) {
  if (!/0\.0\.0\.0\/0|::\/0/.test(ruleText)) return null;
  if (/(ip_protocol|protocol)\s*=\s*"(-1|all)"/.test(ruleText)) return "all ports";
  const from = ruleText.match(/from_port\s*=\s*(\d+)/);
  const to = ruleText.match(/to_port\s*=\s*(\d+)/);
  if (!from || !to) return null; // cannot tell
  const a = Number(from[1]);
  const b = Number(to[1]);
  if (a === b && (a === 80 || a === 443)) return null; // public web traffic is normal
  return a === b ? String(a) : `${a}-${b}`;
}

const openIngress = {
  id: "tf-open-ingress", category: "iac", severity: "high",
  run(files) {
    const results = [];
    for (const f of tfFiles(files)) {
      const bad = [];
      let relevant = false;
      for (const r of resources(f.content)) {
        if (r.type === "aws_security_group") {
          relevant = true;
          for (const b of extractBlocks(r.body, /\bingress\s*\{/)) {
            const port = openToWorld(b.body);
            if (port) bad.push(`${r.type}.${r.name} (${port})`);
          }
        } else if (
          r.type === "aws_vpc_security_group_ingress_rule" ||
          (r.type === "aws_security_group_rule" && /type\s*=\s*"ingress"/.test(r.body))
        ) {
          relevant = true;
          const port = openToWorld(r.body);
          if (port) bad.push(`${r.type}.${r.name} (${port})`);
        }
      }
      if (relevant) results.push({ id: this.id, category: this.category, severity: this.severity, pass: bad.length === 0, file: f.path, detail: bad.join(", ") });
    }
    return results;
  },
};

const publicS3 = {
  id: "tf-public-s3", category: "iac", severity: "high",
  run(files) {
    return tfFiles(files)
      .filter((f) => /aws_s3_bucket/.test(f.content))
      .map((f) => {
        const bad =
          /acl\s*=\s*"public-read(-write)?"/.test(f.content) ||
          /(block_public_acls|block_public_policy|ignore_public_acls|restrict_public_buckets)\s*=\s*false/.test(f.content);
        return { id: this.id, category: this.category, severity: this.severity, pass: !bad, file: f.path, detail: "" };
      });
  },
};

const iamWildcard = {
  id: "tf-iam-wildcard", category: "iac", severity: "high",
  run(files) {
    return tfFiles(files)
      .filter((f) => /aws_iam_|data\s+"aws_iam_policy_document"/.test(f.content))
      .map((f) => {
        const bad = /["']?(Action|actions)["']?\s*[=:]\s*(\[\s*)?["']\*["']/.test(f.content);
        return { id: this.id, category: this.category, severity: this.severity, pass: !bad, file: f.path, detail: "" };
      });
  },
};

const remoteState = {
  id: "tf-remote-state", category: "iac", severity: "low",
  run(files) {
    const tf = tfFiles(files);
    const root = tf.find((f) => /\bprovider\s+"/.test(f.content)); // a root module, not just a shared module
    if (!root) return [];
    const pass = tf.some((f) => /\bbackend\s+"[a-z0-9]+"\s*\{/.test(f.content) || /\bcloud\s*\{/.test(f.content));
    return [{ id: this.id, category: this.category, severity: this.severity, pass, file: root.path, detail: "" }];
  },
};

const eksPublic = {
  id: "tf-eks-public", category: "iac", severity: "med",
  run(files) {
    const results = [];
    for (const f of tfFiles(files)) {
      const bad = [];
      let relevant = false;
      for (const r of resources(f.content)) {
        if (r.type !== "aws_eks_cluster") continue;
        relevant = true;
        const closed = /endpoint_public_access\s*=\s*false/.test(r.body);
        const restricted = /public_access_cidrs\s*=\s*\[\s*"(?!0\.0\.0\.0\/0)/.test(r.body);
        if (!closed && !restricted) bad.push(`${r.type}.${r.name}`);
      }
      if (relevant) results.push({ id: this.id, category: this.category, severity: this.severity, pass: bad.length === 0, file: f.path, detail: bad.join(", ") });
    }
    return results;
  },
};

export const terraformRules = [openIngress, publicS3, iamWildcard, remoteState, eksPublic];
