# DevOps Repo Checker — Project Brief (current state)

> Handoff document. Paste it to any model or collaborator and say: "Continue this project, read the roadmap and do the next unchecked step."
> Update the roadmap and the decisions log after every session.

## 1. What it is

A free tool that scores the DevOps quality of a repository. It reads the files, runs deterministic rules (Docker, Kubernetes, CI/CD, Terraform/AWS, secrets, docs), and shows a score, a per-category chart, a prioritized list ("fix first / worth fixing / lower priority"), and an example fix for every problem. Hebrew (RTL) and English.

Owner: Ron, junior DevOps. Goal: a portfolio centerpiece and a LinkedIn post ("I built a tool to audit my previous project, it scored 68, here is what I fixed").

## 2. Hard constraints

- No credit card, no new accounts, no API keys, no personal data. Everything free.
- Light and simple. No server to maintain.
- Honest results: the tool must not "fix" files that are broken on purpose (demos, tests, problem/fix scenarios).

## 3. Two modes, one rule engine

| | Public demo (GitHub Pages) | Local CLI (planned) |
|---|---|---|
| Runs | in the visitor's browser, static files | `node cli/index.js <folder>` on your machine |
| Input | public GitHub repo URL | any local folder, nothing uploaded |
| Limits | public repos only, max 50 files, 100 KB per file, GitHub API about 60 requests/hour per IP | none (reads the whole folder) |
| AI | none. The summary is calculated from the results | optional `--ai` using the user's own local Ollama |
| Use | try it, show it in a post | accurate scan, CI gate (`--fail-under 70`, exit code) |

The public page must say clearly that it is a lightweight demo and that large projects are scanned more fully with the local CLI.

## 4. Why there is no hosted AI

A static site cannot call an LLM without an API key or a server. Cloudflare Workers AI was built and tested, then dropped because it needs an account. Ollama cannot run on Vercel or GitHub Pages (needs a machine with a model). The only AI path without accounts: the CLI talking to the user's own Ollama on localhost (optionally also a browser button that calls the visitor's own Ollama, which needs OLLAMA_ORIGINS set to the site's origin).

## 4b. Honest scoring notes

- Rules are universal best practices, not tied to the owner's projects.
- Files in `tests/`, `examples/`, `fixtures/`, `demo/`, `scenarios/`, or in a folder that has both a "problem" and a "fix" file, are skipped, and files marked `# devops-checker: ignore` or labeled as incident/chaos/simulation are skipped. The result page says so and offers "Check them too".
- Terraform analysis is text based (no HCL parser), Helm templates are skipped.
- Secret values are never displayed, only the kind and the line number.

## 5. Structure

```
public/            index.html app.js style.css github.js select.js score.js summary.js
public/i18n/       strings.js (he + en)
public/rules/      engine.js docker.js k8s.js cicd.js terraform.js security.js hygiene.js fixes.js
public/vendor/     js-yaml.mjs (YAML parser, v4.1.0)
tests/             rules.test.mjs summary.test.mjs   (run: npm test)
.github/workflows/ deploy.yml (tests, then deploy public/ to GitHub Pages)
package.json       scripts: dev (python static server), test (node --test)
```

Adding a rule = a function in `public/rules/*.js` + texts in `strings.js` (he/en: fail, pass, why) + an example in `fixes.js` + (if new) a category weight in `score.js`.

## 6. Rules (27)

- containers: docker-user-root, docker-latest, docker-healthcheck
- kubernetes: k8s-memory-limit, k8s-requests, k8s-readiness, k8s-nonroot, k8s-privileged, k8s-latest, k8s-secret-ref, k8s-service-selector
- cicd: ci-exists, ci-tests, ci-pinned-actions, ci-permissions, ci-security, tests-exist
- iac: tf-open-ingress, tf-public-s3, tf-iam-wildcard, tf-remote-state, tf-eks-public
- security: secrets-in-code, committed-secret-files
- docs: docs-readme, docs-license, docs-gitignore

Score: severity weights high 3, med 2, low 1; category weights security 30, containers 20, cicd 20, iac 20, kubernetes 20, docs 10; categories without files are not penalized.

## 7. Design

Plain, slightly old-school report look: cream paper, one accent color, Heebo for text, IBM Plex Mono for title, score and file names. No gradients or "AI website" look. Light and dark mode. Animations: scan progress, score ring, collapsible findings.

## 8. Roadmap

- [x] Scanner: GitHub tree, allowlist, scenario/example handling
- [x] 27 rules, example fixes, score ring, category bars, prioritized findings, summary
- [x] Hebrew/English with RTL, dark mode
- [x] Unit tests (npm test) and a CI + Pages workflow file
- [ ] 1. Public-mode notice in the UI ("demo, public repos, up to 50 files; for a full scan use the local CLI")
- [ ] 2. Local CLI: scan a folder with the same engine, text/JSON output, `--lang`, `--fail-under`, optional `--ai` via local Ollama
- [ ] 3. Use the CLI in the project's own CI (the tool checks itself) and add a badge
- [ ] 4. README: what it is, screenshots or a short GIF, architecture diagram, how to run both modes, limitations, what was found on the owner's EKS project
- [ ] 5. One review with Claude Code (review only), fix the blockers
- [ ] 6. Run on the EKS project, fix the findings, run again (before/after), LinkedIn post, CV update
- [ ] 7. Publish: public GitHub repo, Settings > Pages > Source: GitHub Actions

## 9. Decisions log

- Rules reviewed only after being tested against a real repo (the owner's EKS Incident Simulator): scenario folders are skipped, a single file named problem.yaml is not.
- Findings are aggregated per rule (not per file) so the report and the score are not skewed by many files.
- Example fixes are templates ("adapt to your project"), written by hand, never generated.
- Hosted AI removed (needs accounts or keys). Summary is rule-based. Local Ollama only in the CLI.
- Name: "DevOps Repo Checker".
