// Higher weight = counts more towards the score
const SEVERITY_WEIGHT = { high: 3, med: 2, low: 1 };
const CATEGORY_WEIGHT = { security: 30, containers: 20, cicd: 20, iac: 20, kubernetes: 20, docs: 10 };

export function computeScore(findings) {
  const categories = {};
  for (const f of findings) {
    const c = (categories[f.category] ||= { earned: 0, total: 0, passed: 0, count: 0 });
    const w = SEVERITY_WEIGHT[f.severity] || 1;
    c.total += w;
    c.count += 1;
    if (f.pass) { c.earned += w; c.passed += 1; }
  }
  let sum = 0;
  let weights = 0;
  for (const [name, c] of Object.entries(categories)) {
    c.percent = Math.round((100 * c.earned) / c.total);
    const w = CATEGORY_WEIGHT[name] || 10;
    sum += c.percent * w;
    weights += w;
  }
  // categories with no files at all are simply absent, so they are not penalized
  return { overall: weights ? Math.round(sum / weights) : null, categories };
}
