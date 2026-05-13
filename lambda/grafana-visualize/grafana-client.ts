/**
 * Thin Grafana HTTP API client used by the visualize Lambda.
 *
 * Default path is **variable-driven** (no API call needed to update the panel — the dashboard
 * stays untouched and Grafana picks up `var-<name>=...` from the URL). API calls happen only when:
 *
 * 1. `mode: "panel_patch"` (legacy) — POST dashboard JSON back to Grafana.
 * 2. `render: true` — fetch a PNG (or CSV/XLSX) from `/render/d-solo/...`.
 *
 * Uses the global `fetch` shipped with Node 20 (no extra runtime deps).
 */
export interface GrafanaApiClientOptions {
  url: string;
  apiKey: string;
  /** Timeout for individual API calls. */
  timeoutMs?: number;
  /** Optional `fetch` injection — unit tests pass a stub here. */
  fetchImpl?: typeof fetch;
}

export class GrafanaHttpError extends Error {
  public readonly status: number;
  public readonly bodySnippet: string;

  constructor(status: number, bodySnippet: string, message: string) {
    super(message);
    this.name = "GrafanaHttpError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

function ensureTrailingSlashStripped(url: string): string {
  return url.replace(/\/+$/, "");
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function snippet(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 512 ? `${text.slice(0, 512)}…` : text;
  } catch {
    return "";
  }
}

export class GrafanaApiClient {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GrafanaApiClientOptions) {
    if (!opts.url?.trim()) throw new Error("GrafanaApiClient: url is required");
    if (!opts.apiKey?.trim()) throw new Error("GrafanaApiClient: apiKey is required");
    this.base = ensureTrailingSlashStripped(opts.url);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      ...(extra ?? {}),
    };
  }

  async getDashboard(uid: string): Promise<{ dashboard: GrafanaDashboard; version: number }> {
    const res = await fetchWithTimeout(
      this.fetchImpl,
      `${this.base}/api/dashboards/uid/${encodeURIComponent(uid)}`,
      { method: "GET", headers: this.authHeaders() },
      this.timeoutMs,
    );
    if (!res.ok) {
      throw new GrafanaHttpError(
        res.status,
        await snippet(res),
        `GET /api/dashboards/uid/${uid} failed: HTTP ${res.status}`,
      );
    }
    const json = (await res.json()) as { dashboard: GrafanaDashboard; meta?: { version?: number } };
    return { dashboard: json.dashboard, version: json.meta?.version ?? json.dashboard.version ?? 0 };
  }

  async upsertDashboard(dashboard: GrafanaDashboard, overwrite = true): Promise<{ uid: string; version: number; url: string }> {
    const res = await fetchWithTimeout(
      this.fetchImpl,
      `${this.base}/api/dashboards/db`,
      {
        method: "POST",
        headers: this.authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ dashboard, overwrite }),
      },
      this.timeoutMs,
    );
    if (!res.ok) {
      throw new GrafanaHttpError(
        res.status,
        await snippet(res),
        `POST /api/dashboards/db failed: HTTP ${res.status}`,
      );
    }
    return (await res.json()) as { uid: string; version: number; url: string };
  }

  /**
   * Fetch a rendered panel as raw bytes (PNG by default). Caller decides how to ship them back
   * (base64 in the JSON response, presigned S3 upload, etc).
   */
  async fetchRender(renderUrl: string): Promise<{ contentType: string; bytes: Uint8Array }> {
    const res = await fetchWithTimeout(
      this.fetchImpl,
      renderUrl,
      { method: "GET", headers: this.authHeaders({ Accept: "image/png" }) },
      this.timeoutMs,
    );
    if (!res.ok) {
      throw new GrafanaHttpError(
        res.status,
        await snippet(res),
        `GET ${renderUrl} failed: HTTP ${res.status}`,
      );
    }
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buf = new Uint8Array(await res.arrayBuffer());
    return { contentType, bytes: buf };
  }
}

/**
 * Minimal dashboard JSON shape used by the legacy `panel_patch` flow. Grafana accepts a superset;
 * we keep this loose so the round-trip preserves arbitrary fields the operator authored.
 */
export interface GrafanaDashboard {
  uid?: string;
  id?: number;
  title?: string;
  version?: number;
  panels?: GrafanaPanel[];
  [key: string]: unknown;
}

export interface GrafanaPanel {
  id: number;
  title?: string;
  targets?: GrafanaTarget[];
  [key: string]: unknown;
}

export interface GrafanaTarget {
  refId: string;
  region?: string;
  queryMode?: string;
  expression?: string;
  datasource?: { type: string; uid: string };
  [key: string]: unknown;
}

/**
 * Replace the **first matching panel's** CloudWatch Logs Insights target with `query`. Used by the
 * legacy `panel_patch` mode (see `code_generation_context_2.md`); kept for compatibility but **not**
 * the default — the variable-driven URL is preferred.
 */
export function patchPanelLogsInsightsTarget(
  dashboard: GrafanaDashboard,
  panelId: number,
  query: string,
  datasourceUid: string,
  region: string,
): GrafanaDashboard {
  if (!Array.isArray(dashboard.panels)) {
    throw new Error("Dashboard has no panels array");
  }
  const panel = dashboard.panels.find((p) => p.id === panelId);
  if (!panel) {
    throw new Error(`Panel ${panelId} not found on dashboard ${dashboard.uid ?? "?"}`);
  }
  panel.targets = [
    {
      refId: "A",
      region,
      queryMode: "Logs",
      expression: query,
      datasource: { type: "cloudwatch", uid: datasourceUid },
    },
  ];
  return dashboard;
}
