import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import AWSXRay from "aws-xray-sdk-core";

import { buildQueriesForIntent } from "../domain-builders/index";
import type { BuiltQueries, StructuredQueryIntent } from "../shared/query-intent";

import {
  readGrafanaConfig,
  resolveGrafanaApiKey,
  type GrafanaConfig,
} from "./grafana-config";
import {
  GrafanaApiClient,
  GrafanaHttpError,
  patchPanelLogsInsightsTarget,
} from "./grafana-client";
import {
  buildRendererUrl,
  buildVariableDashboardUrl,
  suggestRefreshForIntent,
  timeRangeToGrafanaFromTo,
} from "./grafana-url";

/**
 * `POST /visualize` — turn an AI-generated CloudWatch Logs Insights query into a Grafana
 * panel/dashboard render.
 *
 * Default behaviour is the **fast** variable-driven path from `code_generation_context_2.md`:
 *
 *     Grafana Variable = ${dynamicQuery}
 *
 * The dashboard's panel target is authored once as `${dynamicQuery}`; this Lambda just builds the
 * deep link with `?var-dynamicQuery=<encoded query>`. No dashboard mutation, no API call, no
 * version churn. Grafana itself executes the query against the **CloudWatch** datasource using the
 * dashboard's `from`/`to` time range.
 *
 * Optional modes:
 * - **`render: true`** — also fetch a PNG (or CSV) via the Grafana Image Renderer.
 * - **`mode: "panel_patch"`** — legacy: GET → mutate → POST the dashboard JSON (slow, version
 *   churn, audit noise — kept for back-compat only).
 *
 * ## Does this Lambda ever call Grafana on `stage=local`?
 *
 * There is **no** LocalStack-hosted Grafana — the brief assumes Grafana is AWS-hosted (AMG) for
 * every stage. Whether the LocalStack-deployed Lambda touches the real workspace depends on:
 *
 * 1. `GRAFANA_MODE` — auto-degrades to `MOCK` when `GRAFANA_URL` is empty (see `grafana-config.ts`).
 *    In `MOCK` mode this handler short-circuits and returns the URL it *would* have built; no fetch.
 * 2. Request `mode` — `variable` (default) is pure URL construction with no HTTP call from the
 *    Lambda even in `AWS` mode (Grafana is hit by the user's *browser* when the URL is opened).
 *    `panel_patch` is the legacy path that does call `GET/POST /api/dashboards/...`.
 * 3. `render: true` — fetches `GET /render/d-solo/...` server-side; the only default-shape path
 *    that actually punches HTTP out of the LocalStack container to the AMG workspace.
 *
 * Full matrix is in **`README.md` § "Does `stage=local` really POST to Grafana, or simulate?"**.
 */
export interface VisualizeRequest {
  /** Either provide a built query directly, or a `structuredIntent` to build server-side. */
  query?: string;
  structuredIntent?: StructuredQueryIntent;

  dashboardUid?: string;
  panelId?: number;
  variableName?: string;
  /** Additional Grafana template variables — `{ region: "ap-southeast-2" }` → `var-region=…`. */
  variables?: Record<string, string | number | boolean>;

  timeRange?: StructuredQueryIntent["timeRange"];
  /** Explicit Grafana time range — overrides `timeRange`. */
  from?: string;
  to?: string;
  refresh?: string;

  /** Legacy mode: PUT dashboard JSON. Default `variable` (fast). */
  mode?: "variable" | "panel_patch";

  /** When true, also fetch a server-side render (PNG by default) via the Grafana Image Renderer. */
  render?: boolean;
  renderWidth?: number;
  renderHeight?: number;
  renderType?: "png" | "csv" | "xlsx";

  /** Optional dashboard slug for prettier URLs. */
  slug?: string;
  /** Override CloudWatch region used by the rendered query / panel_patch. */
  region?: string;
}

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});

function parseBody(event: APIGatewayProxyEventV2): VisualizeRequest {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body) as VisualizeRequest;
  } catch {
    throw new Error("Body must be valid JSON");
  }
}

function resolveQuery(req: VisualizeRequest, env: NodeJS.ProcessEnv): { query: string; built?: BuiltQueries } {
  if (req.query?.trim()) {
    return { query: req.query.trim() };
  }
  if (req.structuredIntent?.domain && req.structuredIntent?.intent) {
    const built = buildQueriesForIntent(req.structuredIntent, env);
    return { query: built.logsInsightsQuery, built };
  }
  throw new Error("Provide `query` (Logs Insights string) or `structuredIntent` (domain + intent)");
}

function resolveDashboardUid(req: VisualizeRequest, cfg: GrafanaConfig): string {
  const uid = (req.dashboardUid ?? cfg.defaultDashboardUid).trim();
  if (!uid) {
    throw new Error(
      "dashboardUid is required (set on the request body or env GRAFANA_DEFAULT_DASHBOARD_UID)",
    );
  }
  return uid;
}

function resolvePanelId(req: VisualizeRequest, cfg: GrafanaConfig): number | undefined {
  if (typeof req.panelId === "number" && Number.isFinite(req.panelId)) return req.panelId;
  return cfg.defaultPanelId;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const seg = AWSXRay.getSegment();
  if (seg) seg.addAnnotation("handler", "grafana-visualize");

  let cfg: GrafanaConfig;
  try {
    cfg = readGrafanaConfig(process.env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(500, { error: `Invalid Grafana config: ${msg}` });
  }
  if (seg) seg.addAnnotation("grafanaMode", cfg.mode);

  let req: VisualizeRequest;
  try {
    req = parseBody(event);
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : String(e) });
  }

  let query: string;
  let built: BuiltQueries | undefined;
  try {
    const r = resolveQuery(req, process.env);
    query = r.query;
    built = r.built;
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : String(e) });
  }

  const variableName = (req.variableName ?? cfg.defaultVariableName).trim() || "dynamicQuery";
  const mode = req.mode ?? "variable";
  const refresh = req.refresh ?? suggestRefreshForIntent(req.structuredIntent);
  const region = (req.region ?? cfg.defaultRegion).trim() || "us-east-1";

  let dashboardUid: string;
  try {
    dashboardUid = resolveDashboardUid(req, cfg);
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : String(e) });
  }
  const panelId = resolvePanelId(req, cfg);

  if (seg) {
    seg.addAnnotation("dashboardUid", dashboardUid);
    seg.addAnnotation("visualizeMode", mode);
    if (panelId !== undefined) seg.addAnnotation("panelId", panelId);
  }

  /** Always build the variable URL — it is the share/embed link, even when `panel_patch` is used. */
  const dashboardUrl = buildVariableDashboardUrl({
    grafanaUrl: cfg.url || "https://grafana.example.invalid",
    dashboardUid,
    variableName,
    query,
    variables: req.variables,
    timeRange: req.timeRange ?? req.structuredIntent?.timeRange,
    from: req.from,
    to: req.to,
    refresh,
    slug: req.slug,
  });

  /** Single-panel embed link is handy for iframes / Slack unfurls. */
  const panelEmbedUrl =
    panelId !== undefined
      ? buildVariableDashboardUrl({
          grafanaUrl: cfg.url || "https://grafana.example.invalid",
          dashboardUid,
          variableName,
          query,
          variables: req.variables,
          timeRange: req.timeRange ?? req.structuredIntent?.timeRange,
          from: req.from,
          to: req.to,
          refresh,
          slug: req.slug,
          panelId,
        })
      : undefined;

  const grafanaTimeRange = timeRangeToGrafanaFromTo(
    req.timeRange ?? req.structuredIntent?.timeRange,
  );

  const baseResponse = {
    grafana: {
      mode,
      grafanaMode: cfg.mode,
      dashboardUid,
      variableName,
      panelId,
      dashboardUrl,
      panelEmbedUrl,
      timeRange: {
        from: req.from ?? grafanaTimeRange.from,
        to: req.to ?? grafanaTimeRange.to,
      },
      refresh,
      datasourceUid: cfg.defaultDatasourceUid,
      region,
    },
    query,
    builtQueries: built,
    notes: [
      "Variable-driven URL: dashboard panel target is `${" + variableName + "}` — Grafana applies var-* without rewriting dashboard JSON.",
      mode === "panel_patch"
        ? "panel_patch mode mutates dashboard JSON; prefer `mode: \"variable\"` for high-frequency analytics."
        : "Variable-driven mode avoids version churn / race conditions vs PUT /api/dashboards/db.",
    ],
  };

  if (cfg.mode === "MOCK") {
    return json(200, {
      ...baseResponse,
      grafana: {
        ...baseResponse.grafana,
        renderUrl: req.render
          ? buildRendererUrl({
              grafanaUrl: cfg.url || "https://grafana.example.invalid",
              dashboardUid,
              variableName,
              query,
              variables: req.variables,
              from: req.from,
              to: req.to,
              timeRange: req.timeRange ?? req.structuredIntent?.timeRange,
              panelId: panelId ?? 1,
              width: req.renderWidth ?? cfg.rendererWidth,
              height: req.renderHeight ?? cfg.rendererHeight,
              renderType: req.renderType,
            })
          : undefined,
      },
      mockNote: "GRAFANA_MODE=MOCK (or GRAFANA_URL unset) — no outbound HTTP to Grafana.",
    });
  }

  /** AWS mode — real HTTP. Need an API key for `panel_patch` and `render`; URL-only mode does not. */
  const needsApiKey = mode === "panel_patch" || req.render === true;
  let client: GrafanaApiClient | undefined;
  if (needsApiKey) {
    let apiKey: string;
    try {
      apiKey = await resolveGrafanaApiKey(cfg);
    } catch (e) {
      return json(503, {
        error: `Failed to resolve Grafana API key: ${e instanceof Error ? e.message : String(e)}`,
        hint: "Set GRAFANA_API_KEY or GRAFANA_API_KEY_SECRET_ARN on the Lambda environment.",
      });
    }
    if (!apiKey.trim()) {
      return json(503, {
        error: "Grafana API key is empty",
        hint: "Set GRAFANA_API_KEY or GRAFANA_API_KEY_SECRET_ARN; required for panel_patch and render modes.",
      });
    }
    client = new GrafanaApiClient({ url: cfg.url, apiKey });
  }

  let panelPatchResult: { uid: string; version: number; url: string } | undefined;
  if (mode === "panel_patch" && client) {
    if (panelId === undefined) {
      return json(400, { error: "panel_patch mode requires `panelId` (request or GRAFANA_DEFAULT_PANEL_ID)" });
    }
    try {
      const { dashboard } = await client.getDashboard(dashboardUid);
      const patched = patchPanelLogsInsightsTarget(
        dashboard,
        panelId,
        query,
        cfg.defaultDatasourceUid,
        region,
      );
      panelPatchResult = await client.upsertDashboard(patched, true);
    } catch (e) {
      const status = e instanceof GrafanaHttpError ? 502 : 500;
      return json(status, {
        error: `panel_patch failed: ${e instanceof Error ? e.message : String(e)}`,
        bodySnippet: e instanceof GrafanaHttpError ? e.bodySnippet : undefined,
      });
    }
  }

  let renderResult:
    | { contentType: string; bytesBase64: string; url: string }
    | { error: string; url: string }
    | undefined;
  if (req.render === true && client) {
    if (panelId === undefined) {
      return json(400, { error: "render requires `panelId` (request or GRAFANA_DEFAULT_PANEL_ID)" });
    }
    const renderUrl = buildRendererUrl({
      grafanaUrl: cfg.url,
      dashboardUid,
      variableName,
      query,
      variables: req.variables,
      from: req.from,
      to: req.to,
      timeRange: req.timeRange ?? req.structuredIntent?.timeRange,
      panelId,
      width: req.renderWidth ?? cfg.rendererWidth,
      height: req.renderHeight ?? cfg.rendererHeight,
      renderType: req.renderType,
    });
    if (!cfg.rendererEnabled) {
      renderResult = {
        error: "GRAFANA_RENDERER_ENABLED is not set — install the Image Renderer plugin on the workspace.",
        url: renderUrl,
      };
    } else {
      try {
        const r = await client.fetchRender(renderUrl);
        renderResult = {
          contentType: r.contentType,
          bytesBase64: Buffer.from(r.bytes).toString("base64"),
          url: renderUrl,
        };
      } catch (e) {
        renderResult = {
          error: `render fetch failed: ${e instanceof Error ? e.message : String(e)}`,
          url: renderUrl,
        };
      }
    }
  }

  return json(200, {
    ...baseResponse,
    grafana: {
      ...baseResponse.grafana,
      renderUrl: renderResult?.url,
      renderType: renderResult && "contentType" in renderResult ? renderResult.contentType : undefined,
      renderBytesBase64: renderResult && "bytesBase64" in renderResult ? renderResult.bytesBase64 : undefined,
      renderError: renderResult && "error" in renderResult ? renderResult.error : undefined,
      panelPatch: panelPatchResult,
    },
  });
};
