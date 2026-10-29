const API = "https://api.github.com";

// Accepts https://github.com/owner/repo (also with /tree/branch etc.)
export function parseRepoUrl(input) {
  const m = input.trim().match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

// One API call: the whole file list of the default branch (names + sizes only)
export async function fetchTree({ owner, repo }) {
  const res = await fetch(`${API}/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`);
  if (res.status === 404) throw new Error("NOT_FOUND");
  if (res.status === 403 || res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok) throw new Error("GITHUB_ERROR");
  const data = await res.json();
  return { tree: data.tree || [], truncated: Boolean(data.truncated) };
}

// Download only the selected files (raw.githubusercontent does not use the API quota)
export async function loadFiles({ owner, repo }, selected) {
  const results = await Promise.allSettled(
    selected.map(async (f) => {
      const safePath = f.path.split("/").map(encodeURIComponent).join("/");
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${safePath}`);
      if (!res.ok) throw new Error(f.path);
      return { path: f.path, content: await res.text() };
    })
  );
  const files = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const failed = results.filter((r) => r.status === "rejected").length;
  return { files, failed };
}
