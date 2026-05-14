/** Trim trailing slashes so paths join predictably. */
export function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!raw) {
    throw new Error("Set VITE_API_BASE_URL to your HttpApiUrl (e.g. CDK output for POST /intent).");
  }
  return raw.replace(/\/+$/, "");
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  accessToken: string | undefined,
): Promise<T> {
  const url = `${apiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const err = json as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return json as T;
}

export interface IntentResponse {
  structuredIntent?: Record<string, unknown>;
  mode?: string;
  error?: string;
}

export interface VisualizeResponse {
  grafana?: {
    dashboardUrl?: string;
    panelEmbedUrl?: string;
    dashboardUid?: string;
    variableName?: string;
  };
  query?: string;
  error?: string;
}
