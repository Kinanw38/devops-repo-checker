import test from "node:test";
import assert from "node:assert/strict";
import { buildSummary } from "../public/summary.js";
import { computeScore } from "../public/score.js";

const f = (id, category, severity, pass, files = 1) => ({
  id, category, severity, pass, file: "",
  items: Array.from({ length: files }, (_, i) => ({ file: `f${i}`, detail: "", pass })),
});

test("counts, weakest category and priorities", () => {
  const findings = [
    f("a", "containers", "low", false),
    f("b", "containers", "high", false),
    f("c", "cicd", "med", false, 3),
    f("d", "cicd", "med", false, 1),
    f("e", "docs", "low", true),
  ];
  const s = buildSummary(findings, computeScore(findings));
  assert.equal(s.total, 5);
  assert.equal(s.failed, 4);
  assert.deepEqual(s.counts, { high: 1, med: 2, low: 1 });
  assert.deepEqual(s.priorities, ["b", "c", "d"]); // high first, then more affected files
  assert.equal(s.weakest.name, "containers");
});

test("nothing failed: no priorities and no weak category", () => {
  const findings = [f("a", "docs", "low", true), f("b", "cicd", "med", true)];
  const s = buildSummary(findings, computeScore(findings));
  assert.equal(s.failed, 0);
  assert.deepEqual(s.priorities, []);
  assert.equal(s.weakest, null);
});
