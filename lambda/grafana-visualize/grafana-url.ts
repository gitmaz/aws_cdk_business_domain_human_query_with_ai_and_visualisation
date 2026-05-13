/**
 * URL builders for the **fast** Grafana visualization path.
 *
 * The cleaner design called out in `code_generation_context_2.md` is to keep the dashboard
 * **static** and feed dynamic data via **Grafana variables** instead of rewriting dashboard
 * JSON per request. The dashboard panel's CloudWatch Logs target is authored once as:
 *
 *     ${dynamicQuery}
 *
 * and we drive it by appending `?var-dynamicQuery=<encoded query>` to the dashboard URL.
 *
 * This avoids:
 * - dashboard JSON `POST /api/dashboards/db` round-trips (slow + version churn)
 * - race conditions when multiple users query at once
 * - audit log noise from constant dashboard mutations
 */
import type { StructuredQueryIntent, TimeUnit } from "../shared/query-intent";

export interface BuildVariableUrlInput {
  /** Base Grafana workspace URL — `https://g-xxxx.grafana-workspace.<region>.amazonaws.com` for AMG. */
  grafanaUrl: string;
  dashboardUid: string;
  variableName: string;
  query: string;
  /** Additional Grafana template variables: `{ region: "ap-southeast-2", ... }` → `var-region=...`. */
  variables?: Record<string, string | number | boolean>;
  /** Time range; converted to Grafana `from=now-<n><unit>`. */
  timeRange?: { value: number; unit: TimeUnit };
  /** Explicit Grafana `from`/`to` — overrides `timeRange` when set. */
  from?: string;
  to?: string;
  /** Refresh interval e.g. `30s`, `1m`. */
  refresh?: string;
  /** Optional dashboard slug for prettier URLs (`/d/<uid>/<slug>`). */
  slug?: string;
  /** When set, build a single-panel embed URL (`/d-solo/...&panelId=N`). */
  panelId?: number;
}

const TIME_UNIT_TO_GRAFANA: Record<TimeUnit, string> = {
  hour: "h",
  day: "d",
  week: "w",
};

export function timeRangeToGrafanaFromTo(timeRange?: { value: number; unit: TimeUnit }): {
  from: string;
  to: string;
} {
  if (!timeRange) return { from: "now-24h", to: "now" };
  const unit = TIME_UNIT_TO_GRAFANA[timeRange.unit] ?? "h";
  const value = Number.isFinite(timeRange.value) && timeRange.value > 0 ? timeRange.value : 24;
  return { from: `now-${value}${unit}`, to: "now" };
}

function normaliseBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function encodeVariableValue(value: string | number | boolean): string {
  return encodeURIComponent(String(value));
}

/**
 * Build a **fast** Grafana variable-driven URL. The panel's authored expression is `${variableName}`,
 * so Grafana itself runs the CloudWatch Logs Insights query — no dashboard mutation, no API key
 * required to render (links use the user's existing Grafana session / SSO).
 */
export function buildVariableDashboardUrl(input: BuildVariableUrlInput): string {
  if (!input.grafanaUrl.trim()) throw new Error("grafanaUrl is required");
  if (!input.dashboardUid.trim()) throw new Error("dashboardUid is required");
  if (!input.variableName.trim()) throw new Error("variableName is required");

  const base = normaliseBaseUrl(input.grafanaUrl);
  const route = input.panelId !== undefined ? "d-solo" : "d";
  const slug = input.slug ? `/${encodeURIComponent(input.slug)}` : "";
  const path = `${base}/${route}/${encodeURIComponent(input.dashboardUid)}${slug}`;

  const params = new URLSearchParams();
  params.set(`var-${input.variableName}`, input.query);

  if (input.variables) {
    for (const [k, v] of Object.entries(input.variables)) {
      if (v === undefined || v === null) continue;
      params.append(`var-${k}`, String(v));
    }
  }

  const tr = input.from || input.to ? null : timeRangeToGrafanaFromTo(input.timeRange);
  params.set("from", input.from ?? tr?.from ?? "now-24h");
  params.set("to", input.to ?? tr?.to ?? "now");

  if (input.refresh) params.set("refresh", input.refresh);
  if (input.panelId !== undefined) params.set("panelId", String(input.panelId));

  /**
   * `URLSearchParams.toString()` percent-encodes values; we want the query string to stay
   * shareable / readable in Grafana logs and use `+` for spaces (matches Grafana docs).
   * `URLSearchParams` already does that, but it also percent-encodes the `|` pipe which Logs
   * Insights queries use heavily — Grafana accepts both, so we leave the safe encoding intact.
   */
  return `${path}?${params.toString()}`;
}

export interface BuildRendererUrlInput extends BuildVariableUrlInput {
  panelId: number;
  width: number;
  height: number;
  /** Grafana org id; default 1. AMG workspaces are single-org. */
  orgId?: number;
  /** PNG | csv | xlsx. Default `png`. */
  renderType?: "png" | "csv" | "xlsx";
  timezone?: string;
}

/**
 * Build a `/render/d-solo/...` URL for the **Grafana Image Renderer** (must be enabled on the
 * workspace — AMG supports it via the renderer plugin / sidecar). Returns a PNG/CSV when fetched
 * with a service-account `Authorization: Bearer ...` token.
 */
export function buildRendererUrl(input: BuildRendererUrlInput): string {
  if (input.panelId === undefined) throw new Error("panelId is required for renderer URL");
  const base = normaliseBaseUrl(input.grafanaUrl);
  const slug = input.slug ? `/${encodeURIComponent(input.slug)}` : "";
  const renderType = input.renderType ?? "png";
  const path = `${base}/render/d-solo/${encodeURIComponent(input.dashboardUid)}${slug}`;

  const params = new URLSearchParams();
  params.set(`var-${input.variableName}`, input.query);
  if (input.variables) {
    for (const [k, v] of Object.entries(input.variables)) {
      if (v === undefined || v === null) continue;
      params.append(`var-${k}`, String(v));
    }
  }
  const tr = input.from || input.to ? null : timeRangeToGrafanaFromTo(input.timeRange);
  params.set("from", input.from ?? tr?.from ?? "now-24h");
  params.set("to", input.to ?? tr?.to ?? "now");
  params.set("panelId", String(input.panelId));
  params.set("width", String(input.width));
  params.set("height", String(input.height));
  if (input.orgId !== undefined) params.set("orgId", String(input.orgId));
  if (input.timezone) params.set("tz", input.timezone);
  if (renderType !== "png") params.set("type", renderType);

  return `${path}?${params.toString()}`;
}

/**
 * Map a `StructuredQueryIntent.visualization` to a sensible Grafana refresh hint. The dashboard
 * author controls the actual refresh rate; this is just a URL preference.
 */
export function suggestRefreshForIntent(intent: StructuredQueryIntent | undefined): string {
  if (!intent) return "30s";
  if (intent.visualization === "stat") return "10s";
  if (intent.visualization === "table") return "1m";
  return "30s";
}

/** Test/helper export: re-export the encoder so call-sites can stay symmetrical. */
export const __testables = {
  encodeVariableValue,
  normaliseBaseUrl,
};
