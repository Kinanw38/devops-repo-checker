import { loadAll } from "../vendor/js-yaml.mjs";

// Universal Kubernetes checks. They only run when the repo actually contains Kubernetes manifests.
const WORKLOADS = ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob", "Pod"];
const LONG_RUNNING = ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Pod"];
const SECRET_KINDS = ["Secret", "SealedSecret", "ExternalSecret"];

function podSpecOf(doc) {
  if (doc.kind === "Pod") return doc.spec;
  if (doc.kind === "CronJob") return doc.spec?.jobTemplate?.spec?.template?.spec;
  return doc.spec?.template?.spec;
}

function podLabelsOf(doc) {
  if (doc.kind === "Pod") return doc.metadata?.labels;
  if (doc.kind === "CronJob") return doc.spec?.jobTemplate?.spec?.template?.metadata?.labels;
  return doc.spec?.template?.metadata?.labels;
}

// Finds every Kubernetes object in the YAML files (a file can hold several, separated by ---).
export function parseManifests(files) {
  const docs = [];
  for (const f of files) {
    if (!/\.ya?ml$/i.test(f.path)) continue;
    if (f.path.startsWith(".github/")) continue;   // CI workflows, not Kubernetes
    if (f.content.includes("{{")) continue;        // Helm template, not plain YAML
    let parsed;
    try { parsed = loadAll(f.content); } catch { continue; }
    for (const doc of parsed) {
      if (doc && typeof doc === "object" && typeof doc.apiVersion === "string" && typeof doc.kind === "string") {
        docs.push({ file: f.path, doc });
      }
    }
  }
  return docs;
}

const nameOf = (doc) => `${doc.kind}/${doc.metadata?.name || "?"}`;

function workloadItems(manifests, kinds = WORKLOADS) {
  return manifests
    .filter(({ doc }) => kinds.includes(doc.kind) && podSpecOf(doc))
    .map(({ file, doc }) => ({ file, doc, spec: podSpecOf(doc), label: nameOf(doc) }));
}

const containersOf = (spec) => spec.containers || [];
const allContainersOf = (spec) => [...(spec.initContainers || []), ...(spec.containers || [])];

// One finding per rule and per file. A file passes only if all of its workloads pass.
function makeRule({ id, severity, scope, check }) {
  return {
    id,
    category: "kubernetes",
    severity,
    run(files, ctx) {
      const byFile = new Map();
      for (const item of scope(ctx.manifests)) {
        if (!byFile.has(item.file)) byFile.set(item.file, []);
        const problem = check(item, ctx.manifests);
        if (problem) byFile.get(item.file).push(problem);
      }
      return [...byFile].map(([file, problems]) => ({
        id, category: "kubernetes", severity, pass: problems.length === 0, file, detail: problems.join(", "),
      }));
    },
  };
}

const memoryLimit = makeRule({
  id: "k8s-memory-limit", severity: "med",
  scope: (m) => workloadItems(m),
  check: ({ spec, label }) => (containersOf(spec).every((c) => c.resources?.limits?.memory) ? null : label),
});

const requests = makeRule({
  id: "k8s-requests", severity: "low",
  scope: (m) => workloadItems(m),
  check: ({ spec, label }) => (containersOf(spec).every((c) => c.resources?.requests) ? null : label),
});

const readiness = makeRule({
  id: "k8s-readiness", severity: "med",
  scope: (m) => workloadItems(m, LONG_RUNNING),
  check: ({ spec, label }) => (containersOf(spec).every((c) => c.readinessProbe) ? null : label),
});

const nonRoot = makeRule({
  id: "k8s-nonroot", severity: "med",
  scope: (m) => workloadItems(m),
  check: ({ spec, label }) => {
    const podOk = spec.securityContext?.runAsNonRoot === true || spec.securityContext?.runAsUser > 0;
    const ok = containersOf(spec).every(
      (c) => podOk || c.securityContext?.runAsNonRoot === true || c.securityContext?.runAsUser > 0
    );
    return ok ? null : label;
  },
});

const privileged = makeRule({
  id: "k8s-privileged", severity: "high",
  scope: (m) => workloadItems(m),
  check: ({ spec, label }) => {
    const bad =
      spec.hostNetwork === true || spec.hostPID === true || spec.hostIPC === true ||
      allContainersOf(spec).some((c) => c.securityContext?.privileged === true);
    return bad ? label : null;
  },
});

const imageTag = makeRule({
  id: "k8s-latest", severity: "med",
  scope: (m) => workloadItems(m),
  check: ({ spec, label }) => {
    const bad = allContainersOf(spec).some((c) => {
      const image = String(c.image || "");
      if (!image || image.includes("$") || image.includes("{{") || image.includes("@sha256:")) return false;
      const afterSlash = image.split("/").pop();
      const tag = afterSlash.includes(":") ? afterSlash.split(":")[1] : "";
      return !tag || tag === "latest";
    });
    return bad ? label : null;
  },
});

const secretRefs = makeRule({
  id: "k8s-secret-ref", severity: "low",
  scope: (m) => {
    const defined = new Set(
      m.filter(({ doc }) => SECRET_KINDS.includes(doc.kind))
        .flatMap(({ doc }) => [doc.metadata?.name, doc.spec?.target?.name])
        .filter(Boolean)
    );
    return workloadItems(m)
      .map((item) => {
        const refs = [];
        for (const c of allContainersOf(item.spec)) {
          (c.env || []).forEach((e) => {
            const r = e.valueFrom?.secretKeyRef;
            if (r?.name && !r.optional) refs.push(r.name);
          });
          (c.envFrom || []).forEach((e) => { if (e.secretRef?.name && !e.secretRef.optional) refs.push(e.secretRef.name); });
        }
        (item.spec.volumes || []).forEach((v) => { if (v.secret?.secretName && !v.secret.optional) refs.push(v.secret.secretName); });
        return { ...item, missing: [...new Set(refs)].filter((n) => !defined.has(n)), hasRefs: refs.length > 0 };
      })
      .filter((item) => item.hasRefs); // workloads without secret references are not relevant
  },
  check: (item) => (item.missing.length ? `${item.label} -> ${item.missing.join(", ")}` : null),
});

const serviceSelector = makeRule({
  id: "k8s-service-selector", severity: "med",
  scope: (m) => {
    const podLabels = workloadItems(m).map((w) => podLabelsOf(w.doc) || {});
    if (podLabels.length === 0) return []; // no workloads in the repo, so we cannot tell
    return m
      .filter(({ doc }) => doc.kind === "Service" && doc.spec?.selector && Object.keys(doc.spec.selector).length > 0)
      .map(({ file, doc }) => ({ file, doc, label: nameOf(doc), podLabels }));
  },
  check: ({ doc, label, podLabels }) => {
    const sel = Object.entries(doc.spec.selector);
    const match = podLabels.some((labels) => sel.every(([k, v]) => labels[k] === v));
    return match ? null : label;
  },
});

export const k8sRules = [memoryLimit, requests, readiness, nonRoot, privileged, imageTag, secretRefs, serviceSelector];
