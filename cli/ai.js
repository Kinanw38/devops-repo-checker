// Optional local AI: talks to the user's own Ollama. Never required, never sends file contents or file names.
const DEFAULT_HOST = "http://localhost:11434";
const TIMEOUT_MS = 20000;

// OLLAMA_HOST can be "127.0.0.1:11434", "0.0.0.0" or a full URL
export function ollamaBase(env = process.env.OLLAMA_HOST) {
  if (!env) return DEFAULT_HOST;
  let host = env.trim();
  if (!/^https?:\/\//i.test(host)) host = "http://" + host;
  const u = new URL(host);
  if (u.hostname === "0.0.0.0") u.hostname = "localhost";
  if (!u.port && !/^https:/i.test(u.protocol)) u.port = "11434";
  return u.origin;
}

// Only failed checks (English text, severity, number of files) and the score leave the report.
export function buildPrompt(failed, score, lang) {
  const checks = failed.map((f) => `- [${f.severity}] ${f.text} (${f.files} file${f.files === 1 ? "" : "s"})`).join("\n");
  const language = lang === "he" ? "Hebrew" : "English";
  return [
    "You are a senior DevOps engineer. A static checker scored a repository " + score + "/100.",
    "These checks failed:",
    checks,
    `Reply with ONLY a JSON object, written in ${language}, in this exact shape:`,
    '{"summary": "<2 short sentences>", "priorities": ["<step 1>", "<step 2>", "<step 3>"]}',
  ].join("\n");
}

// model output goes to a terminal: drop control characters (ANSI escapes etc.)
const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();

export function parseAdvice(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data.summary !== "string" || !Array.isArray(data.priorities)) return null;
  const priorities = data.priorities.filter((p) => typeof p === "string" && p.trim()).slice(0, 5).map(clean);
  const summary = clean(data.summary);
  if (!summary || priorities.length === 0) return null;
  return { summary, priorities };
}

// Returns { model, summary, priorities } or null (Ollama missing, no model, slow, or an invalid answer).
export async function getAiAdvice({ failed, score, lang, model, base = ollamaBase() }) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    let name = model;
    if (!name) {
      const res = await fetch(`${base}/api/tags`, { signal });
      if (!res.ok) return null;
      name = (await res.json()).models?.[0]?.name;
      if (!name) return null;
    }
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: name, prompt: buildPrompt(failed, score, lang), stream: false, format: "json" }),
      signal,
    });
    if (!res.ok) return null;
    const advice = parseAdvice((await res.json()).response);
    return advice && { model: name, ...advice };
  } catch {
    return null;
  }
}
