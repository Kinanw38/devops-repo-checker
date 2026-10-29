import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));
// a fake key that looks real to the secrets rule but is not one
const SECRET = "AKIA" + "ABCDEFGHIJKLMNOP";
let dir;

function run(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, NO_COLOR: "1", ...env } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "devops-checker-"));
  await writeFile(join(dir, "Dockerfile"), "FROM node:latest\nCOPY . .\nCMD [\"node\", \"app.js\"]\n");
  await writeFile(join(dir, "config.py"), `KEY = "${SECRET}"\n`);
  await mkdir(join(dir, "node_modules", "x"), { recursive: true });
  await writeFile(join(dir, "node_modules", "x", "Dockerfile"), "FROM scratch\n");
  await mkdir(join(dir, "tests"));
  await writeFile(join(dir, "tests", "bad.yml"), "kind: Pod\n");
});

after(() => rm(dir, { recursive: true, force: true }));

test("text report: score, findings, skipped counts, never the secret value", async () => {
  const r = await run([dir]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\d+ \/ 100/);
  assert.match(r.stdout, /Fix first/);
  assert.match(r.stdout, /config\.py/);
  assert.match(r.stdout, /AWS access key \(line 1\)/);
  assert.match(r.stdout, /1 folders ignored/);
  assert.match(r.stdout, /skipped/);
  assert.ok(!r.stdout.includes(SECRET));
  assert.ok(!r.stdout.includes("Example fix"));
});

test("--fixes adds example fixes", async () => {
  const r = await run([dir, "--fixes"]);
  assert.match(r.stdout, /Example fix/);
});

test("--json is valid, has no file contents and no secret", async () => {
  const r = await run([dir, "--json"]);
  const data = JSON.parse(r.stdout);
  assert.equal(typeof data.score, "number");
  assert.ok(data.findings.some((f) => f.id === "secrets-in-code" && !f.pass));
  assert.ok(!r.stdout.includes(SECRET));
  assert.equal(data.skipped.example, 1);
});

test("--fail-under sets the exit code", async () => {
  assert.equal((await run([dir, "--fail-under", "100"])).code, 1);
  assert.equal((await run([dir, "--fail-under", "0"])).code, 0);
});

test("--include-examples checks the tests folder too", async () => {
  const data = JSON.parse((await run([dir, "--json", "--include-examples"])).stdout);
  assert.equal(data.skipped.example, undefined);
});

test("--lang he prints Hebrew", async () => {
  assert.match((await run([dir, "--lang", "he"])).stdout, /[֐-׿]/);
});

test("bad usage exits with code 2", async () => {
  assert.equal((await run([])).code, 2);
  assert.equal((await run([dir, "--lang", "fr"])).code, 2);
  assert.equal((await run(["/no/such/folder/at/all"])).code, 2);
});

// --- optional AI (mock Ollama on a random port) ---

function mockOllama(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        requests.push({ url: req.url, body });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(handler(req.url)));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, requests, host: `127.0.0.1:${server.address().port}` }));
  });
}

test("--ai uses the first model, sends no file names or contents", async () => {
  const advice = { summary: "Fix the secret first.", priorities: ["Remove the key", "Pin the image", "Add a healthcheck"] };
  const m = await mockOllama((url) => (url === "/api/tags" ? { models: [{ name: "tiny:1b" }] } : { response: JSON.stringify(advice) }));
  try {
    const r = await run([dir, "--ai"], { OLLAMA_HOST: m.host });
    assert.match(r.stdout, /AI \(tiny:1b, local\)/);
    assert.match(r.stdout, /Fix the secret first\./);
    const sent = m.requests.find((q) => q.url === "/api/generate").body;
    assert.equal(JSON.parse(sent).model, "tiny:1b");
    for (const forbidden of [SECRET, "config.py", "Dockerfile", "node:latest"]) assert.ok(!sent.includes(forbidden), forbidden);
  } finally {
    m.server.close();
  }
});

test("--ai with an invalid answer prints one friendly line and still reports", async () => {
  const m = await mockOllama((url) => (url === "/api/tags" ? { models: [{ name: "tiny:1b" }] } : { response: "not json" }));
  try {
    const r = await run([dir, "--ai"], { OLLAMA_HOST: m.host });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\d+ \/ 100/);
    assert.match(r.stderr, /AI summary skipped/);
  } finally {
    m.server.close();
  }
});

test("--ai with Ollama not running does not break the report", async () => {
  const r = await run([dir, "--ai"], { OLLAMA_HOST: "127.0.0.1:1" });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\d+ \/ 100/);
  assert.match(r.stderr, /AI summary skipped/);
});
