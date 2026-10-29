import test from "node:test";
import assert from "node:assert/strict";
import { runRules, splitIntentional } from "../public/rules/engine.js";
import { selectFiles } from "../public/select.js";

// Runs the same steps as the website: pick files, drop intentional ones, run the rules.
function scan(repo) {
  const tree = Object.keys(repo).map((path) => ({ path, type: "blob", size: repo[path].length }));
  const { selected } = selectFiles(tree);
  const files = selected.map((f) => ({ path: f.path, content: repo[f.path] }));
  const { kept } = splitIntentional(files);
  return runRules(kept, { allPaths: Object.keys(repo) });
}
const byId = (findings, id) => findings.find((f) => f.id === id);

const DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  template:
    metadata:
      labels: {app: web}
    spec:
      containers:
      - name: web
        image: nginx
`;

test("a Dockerfile without USER fails, with a fixed version it passes the version check", () => {
  const f = scan({ Dockerfile: "FROM python:3.11-slim\nCMD [\"x\"]\n" });
  assert.equal(byId(f, "docker-user-root").pass, false);
  assert.equal(byId(f, "docker-latest").pass, true);
  assert.equal(byId(f, "docker-healthcheck").pass, false);
});

test("a multi-stage Dockerfile is judged by its last stage", () => {
  const f = scan({ Dockerfile: "FROM node:20 AS build\nUSER root\nFROM nginx:1.27\nUSER nginx\nHEALTHCHECK CMD true\n" });
  assert.equal(byId(f, "docker-user-root").pass, true);
});

test("Kubernetes: missing limits, probes and fixed image are reported", () => {
  const f = scan({ "k8s/deploy.yaml": DEPLOYMENT });
  for (const id of ["k8s-memory-limit", "k8s-readiness", "k8s-nonroot", "k8s-latest"]) assert.equal(byId(f, id).pass, false, id);
});

test("Kubernetes: a Service selector that matches no pod is reported", () => {
  const svc = "apiVersion: v1\nkind: Service\nmetadata:\n  name: s\nspec:\n  selector:\n    app: other\n  ports:\n  - port: 80\n";
  const f = scan({ "k8s/deploy.yaml": DEPLOYMENT, "k8s/svc.yaml": svc });
  assert.equal(byId(f, "k8s-service-selector").pass, false);
});

test("problem + fix folders are treated as examples and skipped", () => {
  const f = scan({ "k8s/01/problem.yaml": DEPLOYMENT, "k8s/01/fix.yaml": DEPLOYMENT });
  assert.equal(byId(f, "k8s-memory-limit"), undefined);
});

test("a lone file called problem.yaml is still checked", () => {
  const f = scan({ "ops/problem.yaml": DEPLOYMENT });
  assert.ok(byId(f, "k8s-memory-limit"));
});

test("a file with the ignore marker is skipped", () => {
  const f = scan({ "k8s/old.yaml": "# devops-checker: ignore\n" + DEPLOYMENT });
  assert.equal(byId(f, "k8s-memory-limit"), undefined);
});

test("GitHub Actions: branch refs, missing permissions and missing tests", () => {
  const wf = "name: ci\non: push\njobs:\n  b:\n    steps:\n      - uses: actions/checkout@main\n      - run: echo build\n";
  const f = scan({ ".github/workflows/ci.yml": wf, "app.py": "print(1)\n" });
  assert.equal(byId(f, "ci-pinned-actions").pass, false);
  assert.equal(byId(f, "ci-permissions").pass, false);
  assert.equal(byId(f, "ci-tests").pass, false);
  assert.equal(byId(f, "tests-exist").pass, false);
});

test("Terraform: SSH open to the world, public bucket, IAM wildcard, public EKS endpoint", () => {
  const tf = `provider "aws" {}
resource "aws_security_group" "web" {
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_s3_bucket_acl" "a" {
  acl = "public-read"
}
resource "aws_iam_policy" "p" {
  policy = jsonencode({ Statement = [{ Effect = "Allow", Action = "*", Resource = "*" }] })
}
resource "aws_eks_cluster" "c" {
  vpc_config { endpoint_public_access = true }
}
`;
  const f = scan({ "infra/main.tf": tf });
  for (const id of ["tf-open-ingress", "tf-public-s3", "tf-iam-wildcard", "tf-remote-state", "tf-eks-public"]) assert.equal(byId(f, id).pass, false, id);
  const ingress = byId(f, "tf-open-ingress");
  assert.match(ingress.items.find((i) => !i.pass).detail, /\(22\)/); // port 443 is fine, only 22 is reported
});

test("secrets are found but their value is never shown", () => {
  const key = "AKIA" + "QWERTYUIOPASDFGH";
  const f = scan({ "app/main.py": `KEY = "${key}"\n` });
  const secrets = byId(f, "secrets-in-code");
  assert.equal(secrets.pass, false);
  assert.match(secrets.items[0].detail, /AWS access key \(line 1\)/);
  assert.doesNotMatch(JSON.stringify(f), new RegExp(key));
});

test("committed .env and key files are reported, .env.example is not", () => {
  const f = scan({ ".env": "A=1", ".env.example": "A=", "keys/server.pem": "x" });
  const failed = byId(f, "committed-secret-files").items.filter((i) => !i.pass).map((i) => i.file);
  assert.deepEqual(failed.sort(), [".env", "keys/server.pem"]);
});

test("a healthy repo passes the basic checks", () => {
  const f = scan({
    ".github/workflows/ci.yml": "name: ci\npermissions:\n  contents: read\non: push\njobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n      - run: pytest\n      - uses: aquasecurity/trivy-action@0.20.0\n",
    "app/main.py": "print(1)\n",
    "tests/test_app.py": "def test_a(): pass\n",
    "README.md": "# Project\n" + "Real documentation. ".repeat(20),
    LICENSE: "MIT",
    ".gitignore": "node_modules",
  });
  assert.equal(f.filter((x) => !x.pass).length, 0, JSON.stringify(f.filter((x) => !x.pass).map((x) => x.id)));
});
