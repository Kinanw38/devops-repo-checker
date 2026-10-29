// Example fixes. They are templates: adapt names, ports and values to your own project.
// Written by hand (not by the AI), so they are always valid syntax.
export const fixes = {
  "docker-user-root": `# Debian/Ubuntu based image (on Alpine: RUN adduser -D app)
RUN useradd --create-home app
USER app`,

  "docker-latest": `# use an explicit version, never :latest
FROM python:3.11-slim`,

  "docker-healthcheck": `# replace <PORT> and the path with your app's health endpoint
# (needs curl in the image, or use wget / a small script instead)
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \\
  CMD curl -f http://localhost:<PORT>/health || exit 1`,

  "k8s-memory-limit": `# example values: size them for your application
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"`,

  "k8s-requests": `# example values: size them for your application
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"`,

  "k8s-readiness": `# replace the path and <PORT> with your app's health endpoint
readinessProbe:
  httpGet:
    path: /health
    port: <PORT>
  initialDelaySeconds: 5
  periodSeconds: 10`,

  "k8s-nonroot": `# the image must be able to run as a non-root user
securityContext:
  runAsNonRoot: true
  runAsUser: 1000`,

  "k8s-privileged": `securityContext:
  privileged: false
  allowPrivilegeEscalation: false
# remove hostNetwork / hostPID / hostIPC unless you really need them`,

  "k8s-latest": `image: my-app:1.4.2   # a fixed version tag, not latest`,

  "k8s-secret-ref": `# create the Secret before the pod starts (replace the name and key)
kubectl create secret generic <SECRET_NAME> --from-literal=<KEY>=<VALUE>
# or define a Secret / ExternalSecret manifest in the repo`,

  "k8s-service-selector": `# Service
spec:
  selector:
    app: my-app        # must equal the labels of the pods
# Deployment
spec:
  template:
    metadata:
      labels:
        app: my-app`,

  "ci-exists": `# .github/workflows/ci.yml  (minimal example, adapt the steps to your project)
name: CI
on: [push, pull_request]
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: echo "replace with your test command"`,

  "ci-tests": `- name: Run tests
  run: <YOUR_TEST_COMMAND>   # e.g. pytest, npm test, terraform validate`,

  "ci-pinned-actions": `# a version tag (or a full commit SHA), not a branch
- uses: actions/checkout@v4`,

  "ci-permissions": `# top of the workflow file: least privilege
permissions:
  contents: read`,

  "ci-security": `# .github/dependabot.yml  (adapt the ecosystem)
version: 2
updates:
  - package-ecosystem: "pip"   # or npm, docker, github-actions
    directory: "/"
    schedule:
      interval: "weekly"`,

  "tests-exist": `# tests/test_app.py  (pytest example, replace with a real check)
def test_example():
    assert 1 + 1 == 2`,

  "tf-open-ingress": `ingress {
  from_port   = 22
  to_port     = 22
  protocol    = "tcp"
  cidr_blocks = ["<YOUR_IP>/32"]   # not 0.0.0.0/0
}`,

  "tf-public-s3": `resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.<NAME>.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}`,

  "tf-iam-wildcard": `Action = ["s3:GetObject", "s3:PutObject"]   # only what is needed, not "*"`,

  "tf-remote-state": `terraform {
  backend "s3" {
    bucket         = "<STATE_BUCKET>"
    key            = "project/terraform.tfstate"
    region         = "<REGION>"
    dynamodb_table = "<LOCK_TABLE>"
    encrypt        = true
  }
}`,

  "tf-eks-public": `vpc_config {
  endpoint_private_access = true
  endpoint_public_access  = true
  public_access_cidrs     = ["<YOUR_IP>/32"]   # or set endpoint_public_access = false
}`,

  "secrets-in-code": `# 1. Revoke / rotate the exposed secret now (it counts as leaked)
# 2. Remove it from the code and read it from the environment or a secret manager
export MY_SECRET="..."          # then use os.environ["MY_SECRET"] in the code
# 3. Remove it from the git history too (git filter-repo or BFG)`,

  "committed-secret-files": `# add to .gitignore
.env
*.pem
*.key
*.tfstate*
# then stop tracking the file
git rm --cached <FILE>`,

  "docs-readme": `# Project name
One sentence: what it does.

## Run it
1. Install ...
2. Run ...

## How it works
Short architecture description.`,

  "docs-license": `# add a LICENSE file in the repo root. A simple, common choice is MIT:
# https://choosealicense.com/licenses/mit/`,

  "docs-gitignore": `# .gitignore (example)
.env
node_modules/
__pycache__/
.venv/
*.tfstate*
.terraform/`,
};
