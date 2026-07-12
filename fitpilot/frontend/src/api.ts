const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8787";

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `HTTP ${res.status}`);
  return body as T;
}

export const apiBase = BASE;

export function get<T>(path: string): Promise<T> {
  return fetch(`${BASE}/api${path}`).then((r) => handle<T>(r));
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => handle<T>(r));
}
