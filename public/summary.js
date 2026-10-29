// Builds the short summary from the check results. No server and no AI: plain, predictable logic.
const SEVERITY_ORDER = { high: 0, med: 1, low: 2 };

export function buildSummary(findings, score) {
  const failed = findings.filter((f) => !f.pass);
  const counts = { high: 0, med: 0, low: 0 };
  failed.forEach((f) => { counts[f.severity] += 1; });

  // the weakest category (only if it is not perfect)
  let weakest = null;
  for (const [name, c] of Object.entries(score.categories)) {
    if (c.percent < 100 && (!weakest || c.percent < weakest.percent)) weakest = { name, percent: c.percent };
  }

  // what to fix first: severity first, then the number of affected files
  const affected = (f) => f.items.filter((i) => !i.pass).length;
  const priorities = [...failed]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || affected(b) - affected(a) || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((f) => f.id);

  return { total: findings.length, failed: failed.length, counts, weakest, priorities };
}
